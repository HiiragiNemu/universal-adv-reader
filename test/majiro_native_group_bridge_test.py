"""N:M bridge safeguards. Fixtures have synthetic bytecode offsets and operands."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("majiro_group_bridge",ROOT / "tools/lib/majiro_native_group_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def side(parts, locale, prefix):
    ids = [f"{prefix}-{i}" for i in range(len(parts))]
    proof = [{"previousEventId":ids[i-1],"eventId":ids[i],"joinBefore":"",
              "instructionCodeOffsets":[i*100+50],"voiceCalls":[]} for i in range(1,len(ids))]
    group = {"schema":"majiro-presentation-group/v1","id":prefix,"displayJoinMode":"native-append",
             "sourceEventIds":ids,"visibleEventIdsByLocale":{"zh-CN":ids if locale == "zh-CN" else [],"ja-JP":ids if locale == "ja-JP" else []},
             "joinBeforeByEventId":{identity:"" for identity in ids},"nativeBufferProof":proof}
    return [{"eventId":identity,"kind":"line","nextEventId":ids[i+1] if i+1 < len(ids) else None,
             "source":{"nativeUnit":{"schema":"majiro-display-unit/v1","codeOffset":i*100,
                        "textParts":[{"text":parts[i],"rawText":parts[i],"rawHex":parts[i].encode("utf-8").hex()}],
                        "speakerRaw":None,"boundary":{"control":"p","codeOffset":i*100+50}},
                       **({"presentationGroup":{**group,"position":i}} if len(ids)>1 else {})}}
            for i,identity in enumerate(ids)]


def fixture(cn_parts=None, jp_parts=None, cn_reference=None, jp_reference=None):
    cn_parts = cn_parts or ["「还是说，你才是","想死的那个？」"]
    jp_parts = jp_parts or ["「それとも…お前こそ…死にたかったのか…」"]
    cn_reference = cn_reference or "「还是说……你才是……想死的那个？」"
    jp_reference = jp_reference or "「それとも……お前こそ……死にたかったのか？」"
    source = {"storyId":"narcissu-iris/nar3_08","variantId":"synthetic-n10-bound-translation",
              "scriptSha256":"0"*64,"plainSha256":"1"*64,"translationSource":"synthetic.txt",
              "translationLine":1,"targetCodeOffset":1,"cnText":cn_reference,"jpText":jp_reference,
              "translationRawHex":cn_reference.encode("utf-8").hex(),
              "targetSegments":[{"text":jp_reference,"rawHex":jp_reference.encode("utf-8").hex()}]}
    return (side(cn_parts,"zh-CN","cn"),side(jp_parts,"ja-JP","jp"),[],
            {("narcissu-iris",cn_reference):{jp_reference:[source]}})


def run_fixture(value):
    return bridge.build_native_group_translation_bridges("narcissu-3rd/nar3_08",*value)


class NativeGroupBridgeTests(unittest.TestCase):
    def test_two_to_one_lexical_evidence_preserves_raw_text_hashes_and_records_all_differences(self):
        value = fixture()
        before = json.dumps(value[:3],ensure_ascii=False,sort_keys=True)
        result = run_fixture(value)
        self.assertEqual(result["counts"],{"exactGroupPairs":0,"lexicalGroupPairs":1,"cnNativeEventsCovered":2,"jpNativeEventsCovered":1})
        group = result["groupPairs"][0]
        self.assertEqual(group["cnEventIds"],["cn-0","cn-1"])
        self.assertEqual(group["jpEventIds"],["jp-0"])
        proof = group["proof"]
        self.assertEqual(proof["classification"],"lexical-with-punctuation-variation")
        self.assertFalse(proof["translationQualityAcceptance"])
        for locale in ("cn","jp"):
            native = proof[locale+"NativeBuffer"]
            reference = proof["source"][locale+"Text"]
            self.assertEqual(native["textSha256"],bridge.text_sha(native["text"]))
            reconstructed = native["text"]
            for change in reversed(proof[locale+"PunctuationDifferences"]):
                at = change["nativeOffset"]
                self.assertEqual(reconstructed[at:at+len(change["nativeCharacters"])],change["nativeCharacters"])
                reconstructed = reconstructed[:at]+change["referenceCharacters"]+reconstructed[at+len(change["nativeCharacters"]):]
            self.assertEqual(reconstructed,reference)
            self.assertEqual(len(native["nativeUnits"]),len(group[locale+"EventIds"]))
        self.assertEqual(json.dumps(value[:3],ensure_ascii=False,sort_keys=True),before)

    def test_exact_and_lexical_are_separate_and_not_duplicated(self):
        cn = ["「还是说，你才是","想死的那个？」"]
        jp = ["「それともお前こそ死にたかったのか？」"]
        result = run_fixture(fixture(cn,jp,"".join(cn),"".join(jp)))
        self.assertEqual(result["counts"]["exactGroupPairs"],1)
        self.assertEqual(result["counts"]["lexicalGroupPairs"],0)
        self.assertEqual(len(result["groupPairs"]),1)
        self.assertEqual(result["groupPairs"][0]["proof"]["normalization"],"none")

    def test_words_quotes_brackets_symbols_and_case_are_never_normalized(self):
        value = fixture()
        for replacement in ("想活的那个？」","想死的那个？』","想死的那个？]","想死的那个？★」"):
            mutated = copy.deepcopy(value)
            mutated[0][1]["source"]["nativeUnit"]["textParts"][0]["text"] = replacement
            self.assertEqual(run_fixture(mutated)["groupPairs"],[])
        self.assertNotEqual(bridge.normalize_sentence_punctuation("A long sentence."),bridge.normalize_sentence_punctuation("a long sentence."))
        self.assertEqual(bridge.normalize_sentence_punctuation("「A… B，C？[D]★」"),"「ABC[D]★」")

    def test_short_or_punctuation_only_groups_are_rejected(self):
        result = run_fixture(fixture(["「嗯，再来…","笑一下…」"],["「ああ、じゃあ次は…笑ってくれ…」"],"「嗯，再来……笑一下……」","「ああ、じゃあ次は……笑ってくれ……」"))
        self.assertEqual(result["groupPairs"],[])
        self.assertIn("short-lexical-sequence",[x["reason"] for x in result["rejections"]])
        result = run_fixture(fixture(["「…","…」"],["「……」"],"「……」","「……」"))
        self.assertEqual(result["groupPairs"],[])
        self.assertIn("no-lexical-content",[x["reason"] for x in result["rejections"]])

    def test_every_member_requires_native_pause_continuity_without_choice_clear_or_new_speaker(self):
        value = fixture()
        for operation in ("clear","new-speaker","branch","choice","incomplete"):
            mutated = copy.deepcopy(value)
            events = mutated[0]
            if operation == "clear": events[0]["source"]["nativeUnit"]["boundary"]["control"] = "w"
            elif operation == "new-speaker": events[1]["source"]["nativeUnit"]["speakerRaw"] = {"rawHex":"41"}
            elif operation == "branch": events[0]["nextEventId"] = "different-branch"
            elif operation == "choice": events.insert(1,{"eventId":"choice","kind":"choice"})
            elif operation == "incomplete": events.pop()
            with self.subTest(operation=operation), self.assertRaises(AssertionError):
                run_fixture(mutated)

    def test_existing_anchors_must_not_cross_or_map_a_group_member_outside_the_group(self):
        value = fixture()
        value[1].extend(side(["另一段正文"],"ja-JP","other"))
        value[2].append({"cnEventId":"cn-0","jpEventId":"other-0"})
        result = run_fixture(value)
        self.assertEqual(result["groupPairs"],[])
        self.assertIn("existing-native-anchor-conflict",[x["reason"] for x in result["rejections"]])

    def test_unique_native_text_and_unique_installed_n10_binding_are_required(self):
        for duplicate in ("cn","jp","source"):
            value = fixture()
            if duplicate == "cn":
                value[0].extend(side(["「还是说，你才是想死的那个？」"],"zh-CN","repeat"))
            elif duplicate == "jp":
                value[1].extend(side(["「それとも…お前こそ…死にたかったのか…」"],"ja-JP","repeat"))
            else:
                sources = next(iter(next(iter(value[3].values())).values()))
                sources.append(copy.deepcopy(sources[0]))
            with self.subTest(duplicate=duplicate):
                self.assertEqual(run_fixture(value)["groupPairs"],[])


if __name__ == "__main__":
    unittest.main()
