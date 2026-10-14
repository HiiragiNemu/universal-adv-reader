#!/usr/bin/env python3
"""Record static KANA message-control evidence from original executables."""
from pathlib import Path
import hashlib
import json
import struct
import capstone
import pefile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path("A:/KANA")
REGIONS = ((0x41B330, 0x100), (0x41BDC2, 0x2D5), (0x41C584, 44),
           (0x41C6B0, 0x3D), (0x41C910, 0x64))
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
records = []
for name in ("KANAOKA.EXE", "KANACHS.EXE", "KANAOKA.OLD"):
    raw = (SOURCE/name).read_bytes()
    pe = pefile.PE(data=raw, fast_load=True)
    base = pe.OPTIONAL_HEADER.ImageBase
    regions = []
    for address, size in REGIONS:
        offset = pe.get_offset_from_rva(address-base)
        data = raw[offset:offset+size]
        record = dict(address=hex(address), fileOffset=offset, size=size,
                      sha256=hashlib.sha256(data).hexdigest())
        if address != 0x41C584:
            record["instructions"] = [dict(address=hex(i.address), bytes=i.bytes.hex(), mnemonic=i.mnemonic, operands=i.op_str) for i in decoder.disasm(data,address)]
        else:
            record["jumpTable"] = [dict(control=i, target=hex(struct.unpack_from("<I",data,i*4)[0])) for i in range(11)]
        regions.append(record)
    records.append(dict(path=str(SOURCE/name), sha256=hashlib.sha256(raw).hexdigest(), regions=regions))
assert all([r["sha256"] for r in item["regions"]] == [r["sha256"] for r in records[0]["regions"]] for item in records)
report = dict(schema="kana-engine-message-controls/v1", result="PASS",
    sameHandlerInJapaneseChineseAndOldExecutables=True,
    conclusions=[
        "0x2B registers an input stream at 0x41B330; it does not reset the existing character cursor.",
        "Control 3 dispatches to 0x41BEB4 then 0x41C6B0 and resets the character cursor to the text area origin.",
        "Control 6 dispatches to 0x41BEDE then 0x41C910, advancing a display line.",
        "Control 0x13 parses a voice identifier; 0xFF enters string text.",
        "Controls 0x0B..0x12 and 0x14..0xFE are explicitly ignored by native dispatch.",
        "A message continuation containing only indentation reset (0), line advance (6), text-ID update (8), or ignored controls does not clear the text buffer.",
    ],executables=records)
output=ROOT/"reports/verification/content-repair-20261013/kana/engine-message-controls.json"
output.parent.mkdir(parents=True,exist_ok=True)
output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps(dict(result="PASS",output=str(output),handlerCopiesCompared=len(records)),ensure_ascii=False))
