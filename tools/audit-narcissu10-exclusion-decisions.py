"""Evidence supplement to audit-narcissu10-exclusions.mjs.

Read-only resource inputs; this writes verification JSON in this repository.
No reader manifest, original archive, native graph, or saved game is changed.
"""
from __future__ import annotations
import difflib
import hashlib
import json
import pathlib
import re
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
RESOURCE = pathlib.Path(r"D:\PROGETTO\narcissu-kana-research")
OUT = ROOT / "reports/verification/content-repair-20261013/narcissu10"
MANIFEST = json.loads((RESOURCE / "manifests/generated/reader-adapter.json").read_text(encoding="utf-8"))
STORIES = {s["canonicalStoryId"]: s for s in MANIFEST["stories"]}
AUDIT = json.loads((OUT / "exclusion-audit.json").read_text(encoding="utf-8"))
EXCLUDED = {s["storyId"]: s for s in AUDIT["excluded"]}

def digest(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode("utf-8")).hexdigest()

def norm(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))

def jp_variant(story):
    return next((v for v in story["variants"] if v["sourceLocale"] == "ja-JP" and "original-ja-jp" in v["id"]),
                next((v for v in story["variants"] if v["sourceLocale"] == "ja-JP"), story["variants"][0]))

def doc(story_id, variant=None):
    variant = variant or jp_variant(STORIES[story_id])
    relative = variant["references"]["script"]
    data = (RESOURCE / relative).read_bytes()
    return json.loads(data), {"canonicalStoryId": story_id, "variantId": variant["id"],
        "scriptPath": relative, "scriptSha256": digest(data),
        "plainPath": variant["references"]["plainObject"],
        "plainSha256": digest((RESOURCE / variant["references"]["plainObject"]).read_bytes())}

def units(story_id):
    document, source = doc(story_id)
    return [norm(x["text"]) for x in document["textEvents"] if norm(x["text"])], source

def raw_rows(story_id, indices=None):
    document, _ = doc(story_id)
    return [{"textEventIndex": i, "codeOffset": e["codeOffset"], "text": e["text"]}
            for i,e in enumerate(document["textEvents"]) if indices is None or i in indices]

def compare(whole, parts):
    original, source = units(whole)
    part_data = [units(part) for part in parts]
    combined = [x for values,_ in part_data for x in values]
    present = set(combined)
    return {"whole": source, "parts": [s for _,s in part_data],
        "wholeUnits": len(original), "partUnits": len(combined),
        "exactSequence": original == combined,
        "exactJoinedCharacters": "".join(original) == "".join(combined),
        "wholeJoinedSha256": digest("".join(original)),
        "partsJoinedSha256": digest("".join(combined)),
        "originalUnitsPresentInParts": sum(x in present for x in original),
        "originalUnitsAbsentFromParts": [row for row in raw_rows(whole) if norm(row["text"]) not in present]}

himeko_id = "narcissu-himeko/himeko_ep"
himeko_parts = ["narcissu-himeko/himeko_ep" + i for i in ("00", "01", "02")]
himeko = compare(himeko_id, himeko_parts)
himeko["conclusion"] = ("Original prototype body is covered by the published split chapters. "
    "All eight unmatched text events are author/integration instructions; "
    "the source itself labels this a temporary assembly and says the body is unchanged.")
assert himeko["wholeUnits"] == 1500
assert himeko["originalUnitsPresentInParts"] == 1492
assert [x["textEventIndex"] for x in himeko["originalUnitsAbsentFromParts"]] == [0,1,26,27,28,29,30,31]

iris_id = "narcissu-iris/novel"
iris_parts = ["narcissu-iris/nar3_" + str(i).zfill(2) for i in range(9)]
iris = compare(iris_id, iris_parts)
a = "".join(units(iris_id)[0])
b = "".join(x for part in iris_parts for x in units(part)[0])
# Native text units anchor the identical spans first. Diff only changed spans
# at character granularity, avoiding a quadratic 90k-character global matcher.
au = units(iris_id)[0]
bu = [x for part in iris_parts for x in units(part)[0]]
ap = [0]
bp = [0]
for x in au: ap.append(ap[-1] + len(x))
for x in bu: bp.append(bp[-1] + len(x))
iris["normalizedCharacterDifferences"] = []
for tag, ai, aj, bi, bj in difflib.SequenceMatcher(None, au, bu, autojunk=False).get_opcodes():
    if tag == "equal" or a[ap[ai]:ap[aj]] == b[bp[bi]:bp[bj]]:
        continue
    left, right = a[ap[ai]:ap[aj]], b[bp[bi]:bp[bj]]
    for inner, i, ie, j, je in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if inner == "equal": continue
        i1,i2,j1,j2 = ap[ai]+i, ap[ai]+ie, bp[bi]+j, bp[bi]+je
        iris["normalizedCharacterDifferences"].append(
            {"operation": inner, "wholeStart": i1, "wholeEnd": i2, "partsStart": j1, "partsEnd": j2,
             "wholeText": a[i1:i2], "partsText": b[j1:j2],
             "wholeContext": a[max(0,i1-24):min(len(a),i2+24)],
             "partsContext": b[max(0,j1-24):min(len(b),j2+24)]})
iris["conclusion"] = ("The combined script changes native pauses/line segmentation. Its full normalized body "
    "differs from all nine ordered split chapters only in three punctuation/speaker/one-character edits; "
    "no extra scene is present.")
assert len(iris["normalizedCharacterDifferences"]) == 3
assert sum(len(x["wholeText"]) + len(x["partsText"]) for x in iris["normalizedCharacterDifferences"]) == 15

zero = compare("narcissu-zero/4novel",
    ["narcissu-zero/nar4_" + str(i).zfill(2) for i in range(1,11)] + ["narcissu-zero/nar4_ep"])
assert zero["exactSequence"]
zero["conclusion"] = "All 5,736 nonempty text units match the ordered 11 split chapters exactly, including repetition."

product = compare("narcissu-one-two/product", ["narcissu-3rd/product"])
n3_cn = next(v for v in STORIES["narcissu-3rd/product"]["variants"] if v["sourceLocale"] == "zh-CN")
n3_cn_document, n3_cn_source = doc("narcissu-3rd/product", n3_cn)
product["n3ChineseSource"] = {**n3_cn_source, "rawTextEvents": len(n3_cn_document["textEvents"])}
product["openingEvidence"] = raw_rows("narcissu-one-two/product", set(range(8)))
product["conclusion"] = ("This is an extended Japanese Narcissu 3rd author afterword with 204 raw text events, "
    "not the same as the 33-event original N3 Japanese file. Its opening explicitly identifies a patched version. "
    "Keep this native source as distinct provenance if used to improve N3 reading; "
    "never infer bilingual equivalence from the 204-vs-222 lengths.")
assert product["wholeUnits"] == 204 and product["partUnits"] == 33

awaji = []
for s in STORIES.values():
    if s["displayTitle"] != "おまけ" or s["gameId"] == "narcissu-3rd":
        continue
    v = jp_variant(s)
    references = v["references"]
    awaji.append({"canonicalStoryId": s["canonicalStoryId"], "variantId": v["id"],
        "refs": references, "sha256": {key: digest((RESOURCE / references[key]).read_bytes())
            for key in ("source", "plainObject", "script")},
        "textEventCount": v["textEventCount"]})
awaji.sort(key=lambda x: x["canonicalStoryId"])
bonus = {"schema": "narcissu10-awaji-bonus-source-evidence/v1", "canonical": awaji[0],
    "copies": awaji[1:], "samePlainBytes": len({x["sha256"]["plainObject"] for x in awaji}) == 1,
    "sameOriginalBytes": len({x["sha256"]["source"] for x in awaji}) == 1,
    "titleEvidence": raw_rows(awaji[0]["canonicalStoryId"], {0,178}),
    "nativeReferences": [x for x in AUDIT["literalReferences"] if x["to"] == awaji[0]["canonicalStoryId"]],
    "decision": "include-once-as-bundled-narcissu-bonus",
    "readerTitle": "短篇 #062 淡路 SA",
    "localeEvidence": "All available variants contain Japanese; no original Chinese translation is present.",
    "reachabilityLimit": "The archived subutitle_1 wrapper names it via variable-return/call. No current start/menu literal path to that old wrapper was found."}
assert len(awaji) == 4 and bonus["samePlainBytes"] and bonus["sameOriginalBytes"]

# Review suspicious narrative families rather than trusting their old labels.
families = []
for story_id, record in EXCLUDED.items():
    s = STORIES[story_id]
    title = s["displayTitle"]
    classification = None
    conclusion = None
    markers = []
    if title.startswith("オリジナル"):
        classification = "unreferenced-bundled-fiction-draft"
        conclusion = ("Narrative prose about the rain world and characters 郎女/巫女. "
            "The old engine-sample label is factually too broad. It has no exact native script-name incoming reference "
            "in any scanned N10 variant; no basis to present it as a released Narcissu chapter.")
        markers = ["郎女", "巫女", "＞", "まとめ"]
    elif title.startswith("@あかり"):
        classification = "unreferenced-supernatural-fiction-draft"
        conclusion = ("Contains body possession, repeated death/revival and a preparatory-school setting. "
            "Its filename alone does not establish identity with the released Sumire character or chapter. "
            "No exact native script-name incoming reference was found.")
        markers = ["身体", "予備校", "死んだ", "意識の支配", "７Ｆ"]
    elif title == "kosihata":
        classification = "mixed-development-test-container"
        conclusion = ("Contains test snippets and/or another script's draft material. It is not a runtime chapter. "
            "Some copies explicitly identify the bundled fan-club CD short story; other copies reuse Narcissu test fragments.")
        markers = ["テステス", "スクロール", "おかえし", "オリジナルショート", "ここまで"]
    elif "花子シナリオ" in title:
        classification = "unreferenced-bundled-other-character-draft"
        conclusion = ("Complete prose about 篠原花子, 愛衣 and 健士. The same named cast appears inside "
            "the explicitly labelled fan-club CD short-story material in kosihata. "
            "No exact native script-name incoming reference was found.")
        markers = ["篠原花子", "篠原 花子", "健士"]
    elif title in ("ナルキ4_1", "4pl", "nar_a", "prologue", "過去4", "過去42", "[タグ付き]安田台本"):
        classification = "unreferenced-alternate-development-text"
        conclusion = ("Contains real Narcissu-related prose and may differ from released versions. "
            "It must not be counted as empty or proven duplicate. No exact native script-name incoming reference "
            "was found; retain the source as development evidence rather than silently adding an alternative draft to a released route.")
        markers = ["ヒロイン★", "プロット", "仮", "こことか", "とか", "ナルキ"]
    if classification:
        rows = raw_rows(story_id)
        evidence = [row for row in rows if any(marker in row["text"] for marker in markers)][:6]
        _, source = doc(story_id)
        families.append({"storyId": story_id, "source": source, "oldReason": record["oldReason"],
            "reviewedTextClass": classification, "conclusion": conclusion,
            "nativeIncomingLiteralReferenceCount": len(record["nativeIncomingLiteralReferences"]),
            "reachableInStartMenuLiteralGraph": record["reachableFromStartOrMenuNativeLiteralGraph"],
            "rawTextEvents": len(rows), "evidence": evidence or rows[:2],
            "endingEvidence": rows[-2:]})

report = {"schema": "narcissu10-exclusion-content-decisions/v1", "result": "PASS",
    "inputAudit": str(OUT / "exclusion-audit.json"),
    "scope": {"oldExcludedStoryCount": len(EXCLUDED), "allCompiledVariantsIndependentlyScanned": AUDIT["counts"]["compiledVariants"],
        "suspiciousDraftCopiesReviewed": len(families), "archivedNarrativeAddition": bonus["canonical"]["canonicalStoryId"]},
    "limits": [
        "Normalized exact-unit coverage detects differences, not whether a different unit is a new scene.",
        "Native literal graph is an overapproximation for exact-name literals; dynamic string construction and runtime conditions are not evaluated.",
        "Unreferenced development prose is preserved and documented, not claimed to be empty, a released route, or a byte-identical duplicate."],
    "himekoComposite": himeko, "irisComposite": iris, "zeroComposite": zero,
    "extendedN3JapaneseAfterword": product, "awajiBonus": bonus, "draftContentReviews": families}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "exclusion-decisions.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(OUT / "awaji-bonus-evidence.json").write_text(json.dumps(bonus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"result":report["result"], "scope":report["scope"],
    "himekoBodyUnitsCovered":himeko["originalUnitsPresentInParts"],
    "himekoAuthorNotesOnly":len(himeko["originalUnitsAbsentFromParts"]),
    "irisCharacterDiffBlocks":iris["normalizedCharacterDifferences"],
    "zeroExactUnits":zero["wholeUnits"], "awajiAll4CopiesByteIdentical":bonus["sameOriginalBytes"]}, ensure_ascii=False))
