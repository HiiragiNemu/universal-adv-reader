#!/usr/bin/env python3
"""Independently audit installed KANA archives; never import the historic parser.

This scanner opens the original SM2 directories and decodes every member in
memory. It writes only compact evidence and chapter metadata inside this repo.
Source games, source archives, saved games and the resource repo are read-only.
"""
from __future__ import annotations
import argparse
import bisect
import collections
import hashlib
import json
import re
import struct
from pathlib import Path

MARKER = b"SECRETFILTER100a"
ALPHABET = b"G5FXIL094MPRKWCJ3OEBVA7HQ2SU8Y6TZ1ND"
ALPHABET_INDEX = {v: k for k, v in enumerate(ALPHABET)}
MESSAGE_ARGUMENT_BYTES = {1: 4, 4: 1, 7: 1, 8: 4, 9: 1, 10: 4}
TEXT_OPS = {0x15, 0x2B, 0xF7}
SYSTEM_SCRIPTS = {"LOAD", "MAIN", "MUSIC", "OMAKE", "STAFF_C", "STAFF_K", "START", "TITLE"}
NARRATIVE_NAME = re.compile(r"(?:EV[0-9A-Z]+|ED[0-9A-Z]+)")

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def archive_directory(path):
    with path.open("rb") as f:
        header = f.read(32)
        assert header[:8] == b"SM2MPX10", (path, "signature")
        count, end = struct.unpack_from("<II", header, 8)
        table = struct.unpack_from("<I", header, 28)[0]
        assert table == 32 and end == 32 + 20 * count, (path, "directory boundary")
        entries = []
        for ordinal in range(count):
            raw, offset, size = struct.unpack("<12sII", f.read(20))
            name = raw.split(b"\0", 1)[0].decode("ascii")
            assert offset >= end and offset + size <= path.stat().st_size, (path, name)
            entries.append(dict(name=name, offset=offset, size=size, ordinal=ordinal))
    assert len({e["name"].casefold() for e in entries}) == count
    sorted_entries = sorted(entries, key=lambda e: e["offset"])
    assert all(a["offset"] + a["size"] <= b["offset"] for a, b in zip(sorted_entries, sorted_entries[1:]))
    return entries

def executable_material(path):
    data = path.read_bytes()
    hits = list(re.finditer(rb"[A-Z0-9]{2048}\x00", data))
    assert len(hits) == 1, (path, "key table count", len(hits))
    secret = hits[0].group()[:-1]
    sig = bytes.fromhex("81408140814181428145814881498169816a81758176824f82508251825282538254825582568257825882a082a282a4")
    start = data.index(sig)
    assert data.find(sig, start + 1) < 0
    dictionary = data[start:start + 256]
    assert len(dictionary) == 256
    for n in range(128):
        dictionary[n*2:n*2+2].decode("cp932")
    def derive(offset, length):
        return bytes(ALPHABET[(ALPHABET_INDEX[secret[offset+1024+n]] - ALPHABET_INDEX[secret[offset+n]]) % 36] for n in range(length))
    key_size = int(derive(256, 2), 16)
    assert 0 < key_size <= 16
    key = derive(272, key_size)
    return secret, dictionary, key, dict(path=str(path), sha256=digest(data), secretOffset=hits[0].start(), dictionaryOffset=start, key=key.decode("ascii"))

def key_stream(secret, initial, length):
    key = initial
    out = bytearray()
    for block in range((length + len(key) - 1) // len(key)):
        base = (block % 64) * 16
        key = bytes(ALPHABET[(ALPHABET_INDEX[x] + ALPHABET_INDEX[secret[base+i]]) % 36] for i, x in enumerate(key))
        out.extend(key)
    return bytes(out[:length])

def decode_segment(raw, encoding, dictionary):
    out, i = [], 0
    while i < len(raw):
        value = raw[i]
        if value == 0x7F:
            assert i + 1 < len(raw)
            literal, i = raw[i+1:i+2], i+2
            out.append(literal.decode(encoding, errors="backslashreplace"))
            continue
        if value == 0x5C and i + 1 < len(raw):
            i += 1
            value = raw[i]
        if value > 0x80:
            assert i + 1 < len(raw)
            literal, i = raw[i:i+2], i+2
            out.append(literal.decode(encoding, errors="backslashreplace"))
        else:
            assert value < 128, ("invalid dictionary index", value)
            out.append(dictionary[2*value:2*value+2].decode("cp932"))
            i += 1
    return "".join(out)

def parse_message(operand, encoding, dictionary):
    if not operand:
        return None
    i, segments, controls, voices = 1, [], [], []
    while i < len(operand):
        command = operand[i]
        i += 1
        if command in (0xFF, 0x13):
            end = operand.index(0, i)
            raw = operand[i:end]
            if command == 0xFF:
                segments.append(dict(operandOffset=i, rawHex=raw.hex(), text=decode_segment(raw, encoding, dictionary)))
            else:
                voices.append(raw.decode("ascii"))
            i = end + 1
        else:
            length = MESSAGE_ARGUMENT_BYTES.get(command, 0)
            assert i + length <= len(operand)
            controls.append(dict(command=command, rawHex=operand[i:i+length].hex()))
            i += length
    if not segments and not voices:
        return None
    return dict(kind="message", channel=operand[0], text="".join(s["text"] for s in segments), voices=voices, segments=segments, controls=controls)

def decode_member(raw, secret, dictionary, key, encoding):
    assert raw.endswith(MARKER)
    stream = key_stream(secret, key, len(raw)-len(MARKER))
    outer = bytes(a^b for a,b in zip(raw[:-len(MARKER)], stream)) + MARKER
    assert bytes(a^b for a,b in zip(outer[:-len(MARKER)], stream)) + MARKER == raw
    header_length = struct.unpack_from("<I", outer, 0)[0]
    content_type = int.from_bytes(outer[4:6], "big")
    xor_byte = outer[6]
    encoded = outer[8:-len(MARKER)]
    if content_type == 0x9597:
        plain = bytes(((x >> 2) | (x << 6)) & 255 for x in encoded)
        assert bytes(((x << 2) | (x >> 6)) & 255 for x in plain) == encoded
    elif content_type in (0x89CE, 0x97D1):
        mask = xor_byte if content_type == 0x89CE else 255
        plain = bytes(x ^ mask for x in encoded)
        assert bytes(x ^ mask for x in plain) == encoded
    else:
        raise AssertionError(("unknown content transform", hex(content_type)))
    vm = outer[:8] + plain
    assert 8 <= header_length <= len(vm) and (header_length-8)%4 == 0
    pointers = struct.unpack_from("<" + "I"*((header_length-8)//4), vm, 8)
    bytecode = vm[header_length:]
    instructions, events, cross, offset = [], [], [], 0
    while offset < len(bytecode):
        if bytecode[offset] == 0 and not bytecode[offset:].strip(b"\0"):
            break
        assert offset+2 <= len(bytecode)
        opcode, length = bytecode[offset:offset+2]
        header = 2
        if length & 128:
            assert offset+3 <= len(bytecode)
            length, header = ((length & 127)<<8) | bytecode[offset+2], 3
        assert header <= length <= len(bytecode)-offset, (offset,length)
        operand = bytecode[offset+header:offset+length]
        ordinal = len(instructions)
        instructions.append(dict(offset=offset, opcode=opcode, length=length, operand=operand))
        event = None
        if opcode == 0x2B:
            event = parse_message(operand, encoding, dictionary)
        elif opcode == 0xF7:
            raw_text = operand.split(b"\0",1)[0]
            event = dict(kind="title", text=raw_text.decode(encoding), rawHex=raw_text.hex())
        elif opcode == 0x15:
            assert len(operand) >= 18
            raw_text = operand[18:].split(b"\0",1)[0]
            event = dict(kind="localized-label", text=raw_text.decode(encoding), rawHex=raw_text.hex())
        if event is not None:
            events.append(dict(instructionIndex=ordinal, instructionOffset=offset, opcode=opcode, **event))
        if opcode in (1,2):
            target, sep, tail = operand.partition(b"\0")
            assert sep and not tail
            cross.append(dict(instructionIndex=ordinal, kind="load-script" if opcode==1 else "call-script", target=target.decode("ascii")))
        offset += length
    assert set(pointers) <= {r["offset"] for r in instructions} | {offset}
    return dict(bytecode=bytecode, instructions=instructions, events=events, cross=cross, pointers=pointers, padding=len(bytecode)-offset)

def event_signature(event):
    return event["instructionIndex"], event["kind"], event["text"]

def first_title_boundary(decoded):
    values = [r["instructionIndex"] for r in decoded["cross"] if r["kind"]=="load-script" and r["target"].casefold()=="title"]
    return min(values, default=len(decoded["instructions"]))

def body_title(title):
    # Keep the native spelling; callers may separate the stage for navigation.
    return title.strip()

def main(args):
    resource, source, output = Path(args.resource), Path(args.source), Path(args.output)
    root = Path(__file__).resolve().parents[1]
    output = output.resolve()
    assert output.is_relative_to(root), "Audit output must stay in reader repository"
    secret, dictionary, key, exe = executable_material(source/"KANAOKA.EXE")
    inventories, scans, failures = {}, {}, []
    for archive_name in ("ISC","ISF","DATA","GGD","GGD1","VOICE","WMSC","SE"):
        entries = archive_directory(source/archive_name)
        inventories[archive_name] = dict(path=str(source/archive_name), size=(source/archive_name).stat().st_size, entryCount=len(entries), extensions=dict(collections.Counter(Path(e["name"]).suffix.upper() for e in entries)), entries=entries)
    assert {e["name"] for e in inventories["ISC"]["entries"]} == {e["name"] for e in inventories["ISF"]["entries"]}
    for archive_name, locale, encoding in (("ISC","zh-CN","gb18030"),("ISF","ja-JP","cp932")):
        blob = (source/archive_name).read_bytes()
        inventories[archive_name]["sha256"] = digest(blob)
        for member in inventories[archive_name]["entries"]:
            name, start, size = member["name"], member["offset"], member["size"]
            raw = blob[start:start+size]
            script = Path(name).stem
            decoded = decode_member(raw,secret,dictionary,key,encoding)
            derived_path = resource/f"archive/derived/ikura-scripts/{archive_name}.unpacked/{script}.script.json"
            historical = read_json(derived_path)
            historical_events = [e for e in decoded["events"] if e["kind"] != "localized-label"]
            old_offsets = [e["instructionOffset"] for e in historical["textEvents"]]
            new_offsets = [e["instructionOffset"] for e in historical_events]
            historical_bytecode = resource/"archive/derived/ikura-scripts"/historical["bytecode"]
            archived_member = resource/f"archive/raw/kana/{archive_name}.unpacked/{name}"
            record = dict(locale=locale, archive=archive_name, member=name, sha256=digest(raw),
                decodedBytecodeSha256=digest(decoded["bytecode"]), memberSize=size,
                instructionCount=len(decoded["instructions"]), pointerCount=len(decoded["pointers"]),
                paddingBytes=decoded["padding"], textEventCount=len(historical_events),
                visibleTextEventCount=sum(bool(e["text"].strip()) for e in historical_events),
                labelCount=sum(e["kind"]=="localized-label" for e in decoded["events"]),
                archivedMemberEqual=archived_member.read_bytes()==raw,
                historicBytecodeEqual=historical_bytecode.read_bytes()==decoded["bytecode"],
                historicEventOffsetsEqual=old_offsets==new_offsets)
            if not all(record[k] for k in ("archivedMemberEqual","historicBytecodeEqual","historicEventOffsetsEqual")):
                failures.append(dict(script=script,locale=locale,checks=record))
            scans[(script,locale)] = dict(decoded=decoded, record=record)

    selection = read_json(resource/"manifests/generated/reader-selection.json")
    decisions = {r["displayTitle"]:r for r in selection["records"] if r["gameId"]=="kana-okaeri"}
    title_nodes = {r["canonicalStoryId"]:r for r in read_json(resource/"manifests/generated/bilingual-titles.json")["nodes"] if r["type"]=="story"}
    plan, script_reports, all_main_targets = [], [], []
    for script in sorted(k[0] for k in scans if k[1]=="ja-JP"):
        jp = scans[(script,"ja-JP")]["decoded"]
        cn = scans[(script,"zh-CN")]["decoded"]
        assert [x["opcode"] for x in jp["instructions"]] == [x["opcode"] for x in cn["instructions"]], script
        jp_positions={x["offset"]:i for i,x in enumerate(jp["instructions"])}
        cn_positions={x["offset"]:i for i,x in enumerate(cn["instructions"])}
        assert [jp_positions.get(x,len(jp["instructions"])) for x in jp["pointers"]] == [cn_positions.get(x,len(cn["instructions"])) for x in cn["pointers"]]
        nontext_diffs=[i for i,(a,b) in enumerate(zip(jp["instructions"],cn["instructions"])) if a["opcode"] not in TEXT_OPS and a["operand"]!=b["operand"]]
        assert not nontext_diffs, (script,"non-text language difference",nontext_diffs[:5])
        boundary=first_title_boundary(jp)
        late=[e for e in jp["events"] if e["instructionIndex"]>=boundary]
        narrative=bool(NARRATIVE_NAME.fullmatch(script))
        assert narrative or script in SYSTEM_SCRIPTS, ("unclassified script",script)
        if narrative:
            assert decisions[script]["decision"]=="include"
            # Anything past the TITLE transfer needs a concrete exclusion reason.
            assert all(e["kind"]=="message" and re.search(r"(?:ＧＤＩ|ＧＤＬ|GDI|GDL).*内部.*エラー",e["text"]) for e in late), (script,"non-diagnostic late text")
        jp_map={e["instructionIndex"]:e for e in jp["events"]}
        cn_map={e["instructionIndex"]:e for e in cn["events"]}
        report=dict(scriptId=script, canonicalStoryId=f"kana-okaeri/{script.lower()}", decision=decisions[script]["decision"],
            classification="narrative" if narrative else "engine/system/credits",
            normalInstructionBoundary=boundary, japanese=scans[(script,"ja-JP")]["record"],chinese=scans[(script,"zh-CN")]["record"],
            nonTextOperandDifferenceCount=len(nontext_diffs),
            nativeTitleCount=sum(e["kind"]=="title" and e["instructionIndex"]<boundary for e in jp["events"]),
            omittedAfterTitle=[dict(instructionIndex=e["instructionIndex"],kind=e["kind"],japaneseText=e["text"],reason="engine-error-handler") for e in late],
            crossScriptTransfers=jp["cross"])
        if script == "MAIN":
            all_main_targets=jp["cross"]
        if narrative:
            titles=[e for e in jp["events"] if e["kind"]=="title" and e["instructionIndex"]<boundary]
            visible=[e for e in jp["events"] if e["instructionIndex"]<boundary and e["text"].strip()]
            prelude=not titles or any(e["kind"]!="title" and e["instructionIndex"]<titles[0]["instructionIndex"] for e in visible)
            starts=([0] if prelude else [])+[e["instructionIndex"] for e in titles]
            if not starts: starts=[0]
            sections=[]
            for number,start in enumerate(starts):
                stop=starts[number+1] if number+1<len(starts) else boundary
                is_title=jp_map.get(start,{}).get("kind")=="title"
                fallback=title_nodes[f"kana-okaeri/{script.lower()}"]["title"]
                names={"ja-JP":body_title(jp_map[start]["text"]),"zh-CN":body_title(cn_map[start]["text"])} if is_title else fallback
                events=[e for e in visible if start<=e["instructionIndex"]<stop]
                assert events, (script,"empty native section",start)
                section_id=f"native-title-{start}" if is_title else "native-opening"
                sections.append(dict(sectionId=section_id, legacySectionId="main", order=number+1,
                    title=names, titleKind="native-title-opcode" if is_title else "inherited-opening-title",
                    sourceInstructionStart=start,sourceInstructionEndExclusive=stop,
                    japaneseOffset=jp["instructions"][start]["offset"],chineseOffset=cn["instructions"][start]["offset"],
                    firstEventId=f"ikura-{events[0]['instructionOffset']:x}",
                    firstTextInstructionIndex=events[0]["instructionIndex"],
                    firstJapaneseTextIndex=sum(1 for e in visible if e["instructionIndex"]<start and e["kind"]!="localized-label"),
                    japaneseMessageCount=sum(e["kind"]=="message" and e["text"].strip()!="" for e in events),
                    chineseMessageCount=sum(e["kind"]=="message" and e["text"].strip()!="" and start<=e["instructionIndex"]<stop for e in cn["events"]),
                    choiceLabelCount=sum(e["kind"]=="localized-label" for e in events),
                    japaneseCharacterCount=sum(len(e["text"]) for e in events),
                    chineseCharacterCount=sum(len(e["text"]) for e in cn["events"] if start<=e["instructionIndex"]<stop),
                    nativeTitleRawHex={"ja-JP":jp_map[start].get("rawHex"),"zh-CN":cn_map[start].get("rawHex")} if is_title else None))
            plan.append(dict(scriptId=script,canonicalStoryId=f"kana-okaeri/{script.lower()}", normalInstructionBoundary=boundary,
                originalSectionId="main", nativeTitleCount=len(titles), hasUntitledOpening=prelude, sections=sections))
        script_reports.append(report)

    sequence=[]
    for transfer in all_main_targets:
        target=transfer["target"].upper()
        if target in decisions and NARRATIVE_NAME.fullmatch(target) and target not in sequence:
            sequence.append(target)
    plan.sort(key=lambda r:sequence.index(r["scriptId"]) if r["scriptId"] in sequence else 999)
    nonempty_cn=sum(sum(bool(e["text"].strip()) for e in scans[(s["scriptId"],"zh-CN")]["decoded"]["events"] if e["instructionIndex"]<s["normalInstructionBoundary"]) for s in plan)
    nonempty_jp=sum(sum(bool(e["text"].strip()) for e in scans[(s["scriptId"],"ja-JP")]["decoded"]["events"] if e["instructionIndex"]<s["normalInstructionBoundary"]) for s in plan)
    counts=dict(scriptMembersPerLanguage=len(inventories["ISC"]["entries"]), bilingualScriptMembers=len(scans),
        narrativeScripts=len(plan),excludedScripts=len(SYSTEM_SCRIPTS),
        bilingualInstructions=sum(v["record"]["instructionCount"] for v in scans.values()),
        bilingualTextEvents=sum(v["record"]["textEventCount"] for v in scans.values()),
        narrativeNativeTitleEvents=sum(s["nativeTitleCount"] for s in plan),narrativeNativeSections=sum(len(s["sections"]) for s in plan),
        scriptsContainingMultipleNativeTitles=sum(s["nativeTitleCount"]>1 for s in plan),
        japaneseNarrativeVisibleTextAndChoiceUnits=nonempty_jp,chineseNarrativeVisibleTextAndChoiceUnits=nonempty_cn,
        japaneseTextEvents=sum(v["record"]["textEventCount"] for (s,l),v in scans.items() if l=="ja-JP"),
        chineseTextEvents=sum(v["record"]["textEventCount"] for (s,l),v in scans.items() if l=="zh-CN"),
        sourceArchiveComparisonFailures=len(failures))
    assert len(plan)==52 and len(scans)==120
    summary=dict(schema="kana-independent-completeness-audit/v1",result="PASS" if not failures else "SOURCE-DIFFERENCE",
        sourceRoot=str(source),resourceRoot=str(resource),executable=exe,counts=counts,
        method="Independent SM2 directory scan, independent SecretFilter/VM decoding, raw instruction extent and bilingual nontext-operand comparison. Historic parser outputs are comparison subjects only.",
        conclusions=dict(truncatedNarrativeAfterFirstTitleTransfer=0,additionalNativeSections=counts["narrativeNativeSections"]-len(plan),
            rawMembersMissingFromArchive=0,rawInstructionOrEventOffsetsMissingFromHistoricExtraction=0),
        failures=failures,excludedScripts=[dict(scriptId=s,reason=decisions[s]["reasonCode"],japaneseEvents=[dict(kind=e["kind"],text=e["text"]) for e in scans[(s,"ja-JP")]["decoded"]["events"]]) for s in sorted(SYSTEM_SCRIPTS)],
        scripts=script_reports)
    chapter_plan=dict(schema="kana-native-chapter-plan/v1",sourceRoot=str(source),counts=counts,
        navigationOrderEvidence="First explicit narrative call/load occurrence in the original MAIN instruction stream; includes alternative branches, not a claim of one linear playthrough.",
        nativeMainFirstOccurrenceOrder=sequence,mainCrossScriptTransfers=all_main_targets,scripts=plan)
    write_json(output/"independent-audit.json",summary)
    write_json(output/"archive-directories.json",inventories)
    write_json(output/"chapter-plan.json",chapter_plan)
    print(json.dumps(dict(result=summary["result"],counts=counts,paths=[str(output/f) for f in ("independent-audit.json","archive-directories.json","chapter-plan.json")]),ensure_ascii=False,indent=2))

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",default="A:/KANA")
    ap.add_argument("--resource",default="D:/PROGETTO/narcissu-kana-research")
    ap.add_argument("--output",default=str(Path(__file__).resolve().parents[1]/"reports/verification/content-repair-20261013/kana"))
    main(ap.parse_args())
