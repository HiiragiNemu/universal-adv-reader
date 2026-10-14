"""Evidence-bound bilingual N:M display groups; raw events remain editable.

Multiple events require a complete native-proved continuous buffer. N10 patch
translation targets provide the cross-language bridge. Lexical evidence keeps
all quotes, brackets, symbols and case; only the declared sentence punctuation
and whitespace may differ. Such correspondence never certifies translation
quality or byte equality.
"""
from collections import Counter, defaultdict
from hashlib import sha256

SENTENCE_PUNCTUATION = frozenset("、，,。．.？！?!；;：:…‥")
MIN_LEXICAL_CHARACTERS = 8
LOCALES = {"cn":"zh-CN", "jp":"ja-JP"}

def text_sha(text):
    return sha256(text.encode("utf-8")).hexdigest()

def lexical_length(text):
    return sum(char.isalnum() for char in text)

def _ignorable(char):
    return char.isspace() or char in SENTENCE_PUNCTUATION

def normalize_sentence_punctuation(text):
    # Preserve every word, letter, digit, case, quote, bracket and other symbol.
    return "".join(char for char in text if not _ignorable(char))

def punctuation_differences(native, reference):
    assert normalize_sentence_punctuation(native) == normalize_sentence_punctuation(reference)
    def gaps(text):
        result, pending, start, ordinal = [], "", 0, 0
        for at,char in enumerate(text):
            if _ignorable(char):
                if not pending: start = at
                pending += char
            else:
                result.append((ordinal, start if pending else at, pending))
                pending = ""; ordinal += 1
        result.append((ordinal, start if pending else len(text), pending))
        return result
    return [{"retainedCharacterOrdinal": ordinal, "nativeOffset": offset,
             "referenceOffset": other_offset, "nativeCharacters": native_chars,
             "referenceCharacters": reference_chars}
        for (ordinal,offset,native_chars),(_,other_offset,reference_chars)
        in zip(gaps(native),gaps(reference)) if native_chars != reference_chars]

def native_buffer_units(events, language):
    locale = LOCALES[language]
    by_id = {event["eventId"]:event for event in events}
    positions = {event["eventId"]:i for i,event in enumerate(events)}
    result, visited = [], set()
    for event in events:
        if event["eventId"] in visited or event["kind"] != "line" or not event.get("source",{}).get("nativeUnit"):
            continue
        group = event["source"].get("presentationGroup")
        ids = group["sourceEventIds"] if group else [event["eventId"]]
        if group:
            assert group["schema"] == "majiro-presentation-group/v1"
            assert ids[0] == event["eventId"]
            assert all(identity in by_id for identity in ids)
            assert [positions[identity] for identity in ids] == list(range(positions[ids[0]],positions[ids[-1]]+1))
            assert group["visibleEventIdsByLocale"][locale] == ids
        members = [by_id[identity] for identity in ids]
        if group:
            assert len(group.get("nativeBufferProof",[])) == len(ids)-1
            assert group["displayJoinMode"] == "native-append"
            for i,member in enumerate(members):
                other = member["source"]["presentationGroup"]
                assert member["kind"] == "line" and other["id"] == group["id"]
                assert other["sourceEventIds"] == ids and other["position"] == i
                assert other["visibleEventIdsByLocale"][locale] == ids
                if i:
                    previous = members[i-1]
                    native_proof = group["nativeBufferProof"][i-1]
                    assert not member["source"]["nativeUnit"].get("speakerRaw")
                    assert previous["source"]["nativeUnit"]["boundary"]["control"] == "p"
                    assert previous.get("nextEventId") == member["eventId"]
                    assert native_proof["eventId"] == member["eventId"]
                    assert native_proof["previousEventId"] == previous["eventId"]
                    assert native_proof["instructionCodeOffsets"]
                    assert native_proof["joinBefore"] == group.get("joinBeforeByEventId",{}).get(member["eventId"],"")
        joins = {identity:group.get("joinBeforeByEventId",{}).get(identity,"") if group else "" for identity in ids}
        assert all(len(separator) <= 8 and (not separator or separator.isspace()) for separator in joins.values())
        text = "".join((joins[member["eventId"]] if i else "")
            + "".join(part["text"] for part in member["source"]["nativeUnit"]["textParts"])
            for i,member in enumerate(members))
        visited.update(ids)
        if not text.strip():
            continue
        first_name = members[0]["source"]["nativeUnit"].get("speakerRaw")
        result.append({"eventIds":ids,"text":text,"textSha256":text_sha(text),
            "start":positions[ids[0]],"end":positions[ids[-1]],
            "nativeBufferId":group["id"] if group else None,
            "speakerRawHex":first_name["rawHex"] if first_name else None,
            "joinBeforeByEventId":joins,
            "nativeUnitCodeOffsets":[member["source"]["nativeUnit"]["codeOffset"] for member in members],
            "nativeUnits":[{"eventId":member["eventId"],"source":member["source"]["nativeUnit"]} for member in members],
            "nativeBufferProof":group.get("nativeBufferProof",[]) if group else []})
    return result

def find_native_group_translation_bridges(identity, cn_events, jp_events, pairs, bridges, *, mode="exact"):
    assert mode in ("exact","sentence-punctuation","lexical-with-punctuation-variation")
    chapter = identity.split("/")[-1]
    game = "narcissu-iris" if chapter.startswith("nar3_") else "narcissu-one-two" if chapter.startswith(("nar1_","nar2_")) else None
    if game is None:
        return {"groups":[],"rejections":[],"counts":{"cnNativeBuffers":0,"jpNativeBuffers":0,"groupPairs":0,"cnNativeEventsCovered":0,"jpNativeEventsCovered":0}}
    norm = (lambda text:text) if mode == "exact" else normalize_sentence_punctuation
    cn_units,jp_units = native_buffer_units(cn_events,"cn"),native_buffer_units(jp_events,"jp")
    cc,jc = Counter(norm(unit["text"]) for unit in cn_units),Counter(norm(unit["text"]) for unit in jp_units)
    jt = {norm(unit["text"]):unit for unit in jp_units if jc[norm(unit["text"])] == 1}
    source_index = defaultdict(lambda:defaultdict(list))
    for (source_game,cn_text),japanese in bridges.items():
        if source_game != game:
            continue
        for jp_text,sources in japanese.items():
            source_index[norm(cn_text)][norm(jp_text)].extend(sources)
    cn_positions = {event["eventId"]:i for i,event in enumerate(cn_events)}
    jp_positions = {event["eventId"]:i for i,event in enumerate(jp_events)}
    candidates,rejections = [],[]
    for left in cn_units:
        key = norm(left["text"])
        if not key or cc[key] != 1:
            continue
        matches = [(jt[jp_text],sources[0]) for jp_text,sources in source_index.get(key,{}).items()
            if len(sources) == 1 and jp_text in jt]
        if len(matches) != 1:
            continue
        right,source = matches[0]
        if len(left["eventIds"]) == len(right["eventIds"]) == 1:
            continue
        if min(lexical_length(left["text"]),lexical_length(right["text"])) == 0:
            rejections.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],"reason":"no-lexical-content"})
            continue
        if mode != "exact" and min(lexical_length(left["text"]),lexical_length(right["text"])) < MIN_LEXICAL_CHARACTERS:
            rejections.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],
                "cnText":left["text"],"jpText":right["text"],"reason":"short-lexical-sequence",
                "cnLexicalCharacters":lexical_length(left["text"]),"jpLexicalCharacters":lexical_length(right["text"]),
                "minimumLexicalCharactersPerLocale":MIN_LEXICAL_CHARACTERS})
            continue
        if any(identity in right["joinBeforeByEventId"] and separator != right["joinBeforeByEventId"][identity]
               for identity,separator in left["joinBeforeByEventId"].items()):
            rejections.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],"reason":"locale-event-id-separator-conflict"})
            continue
        if left["speakerRawHex"] != right["speakerRawHex"]:
            rejections.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],"reason":"native-speaker-differs"})
            continue
        cn_ids,jp_ids = set(left["eventIds"]),set(right["eventIds"])
        conflict = any(
            (pair["cnEventId"] in cn_ids) != (pair["jpEventId"] in jp_ids)
            or cn_positions[pair["cnEventId"]] < left["start"] and jp_positions[pair["jpEventId"]] >= right["start"]
            or cn_positions[pair["cnEventId"]] > left["end"] and jp_positions[pair["jpEventId"]] <= right["end"]
            for pair in pairs)
        if conflict:
            rejections.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],"reason":"existing-native-anchor-conflict"})
            continue
        proof = {"method":"exact-installed-N10-native-translation-on-complete-display-buffers" if mode == "exact"
                    else "lexical-with-punctuation-variation",
            "classification":"exact-native-display-text" if mode == "exact" else "lexical-with-punctuation-variation",
            "normalization":"none" if mode == "exact" else "declared-sentence-punctuation-and-whitespace-only",
            "cnNativeBuffer":left,"jpNativeBuffer":right,"source":source,
            "n10ReferenceTextSha256":{"cn":text_sha(source["cnText"]),"jp":text_sha(source["jpText"])},
            "n10TranslationOperandSha256":sha256(bytes.fromhex(source["translationRawHex"])).hexdigest(),
            "n10JapaneseOperandSha256":sha256(b"".join(bytes.fromhex(part["rawHex"]) for part in source["targetSegments"])).hexdigest(),
            "nativeEventIdsArePreserved":True,"existingAnchorsRetainOrder":True,
            "completeNativeBuffers":True,"uniqueInEachNativeChapterAndN10Binding":True,
            "translationQualityAcceptance":False}
        if mode != "exact":
            proof["minimumLexicalCharactersPerLocale"] = MIN_LEXICAL_CHARACTERS
            proof["lexicalCharacters"] = {"cn":lexical_length(left["text"]),"jp":lexical_length(right["text"])}
            proof["allowedIgnoredCharacters"] = "".join(sorted(SENTENCE_PUNCTUATION))
            proof["cnPunctuationDifferences"] = punctuation_differences(left["text"],source["cnText"])
            proof["jpPunctuationDifferences"] = punctuation_differences(right["text"],source["jpText"])
        candidates.append({"cnEventIds":left["eventIds"],"jpEventIds":right["eventIds"],"proof":proof})
    accepted = []
    for candidate in candidates:
        left,right=candidate["proof"]["cnNativeBuffer"],candidate["proof"]["jpNativeBuffer"]
        conflict = any(other is not candidate and (
            bool(set(candidate["cnEventIds"]) & set(other["cnEventIds"]))
            or bool(set(candidate["jpEventIds"]) & set(other["jpEventIds"]))
            or (left["start"]-other["proof"]["cnNativeBuffer"]["start"])
               *(right["start"]-other["proof"]["jpNativeBuffer"]["start"]) < 0)
            for other in candidates)
        if conflict:
            rejections.append({"cnEventIds":candidate["cnEventIds"],"jpEventIds":candidate["jpEventIds"],"reason":"proposed-group-overlap-or-order-conflict"})
        else:
            accepted.append(candidate)
    return {"groups":accepted,"rejections":rejections,
        "counts":{"cnNativeBuffers":len(cn_units),"jpNativeBuffers":len(jp_units),
            "groupPairs":len(accepted),"cnNativeEventsCovered":sum(len(g["cnEventIds"]) for g in accepted),
            "jpNativeEventsCovered":sum(len(g["jpEventIds"]) for g in accepted)}}

def build_native_group_translation_bridges(identity, cn_events, jp_events, pairs, bridges):
    """Stable integration API. No caller needs to read an audit artifact."""
    exact = find_native_group_translation_bridges(identity,cn_events,jp_events,pairs,bridges,mode="exact")
    lexical = find_native_group_translation_bridges(identity,cn_events,jp_events,pairs,bridges,
        mode="lexical-with-punctuation-variation")
    exact_keys = {(tuple(group["cnEventIds"]),tuple(group["jpEventIds"])) for group in exact["groups"]}
    candidates = exact["groups"] + [group for group in lexical["groups"]
        if (tuple(group["cnEventIds"]),tuple(group["jpEventIds"])) not in exact_keys]
    rejected = exact["rejections"] + lexical["rejections"]
    accepted = []
    for group in candidates:
        cn,jp = group["proof"]["cnNativeBuffer"],group["proof"]["jpNativeBuffer"]
        if any(other is not group and (
            set(group["cnEventIds"]).intersection(other["cnEventIds"])
            or set(group["jpEventIds"]).intersection(other["jpEventIds"])
            or (cn["start"]-other["proof"]["cnNativeBuffer"]["start"])
               *(jp["start"]-other["proof"]["jpNativeBuffer"]["start"]) < 0)
            for other in candidates):
            rejected.append({"cnEventIds":group["cnEventIds"],"jpEventIds":group["jpEventIds"],
                "reason":"exact-and-lexical-group-overlap-or-order-conflict"})
        else:
            accepted.append(group)
    accepted.sort(key=lambda group:group["proof"]["cnNativeBuffer"]["start"])
    return {"groupPairs":accepted,"rejections":rejected,"counts":{
        "exactGroupPairs":sum(group["proof"]["classification"] == "exact-native-display-text" for group in accepted),
        "lexicalGroupPairs":sum(group["proof"]["classification"] == "lexical-with-punctuation-variation" for group in accepted),
        "cnNativeEventsCovered":sum(len(group["cnEventIds"]) for group in accepted),
        "jpNativeEventsCovered":sum(len(group["jpEventIds"]) for group in accepted)}}
