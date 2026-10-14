#!/usr/bin/env python3
"""Audit installed Narcissu archives and EVB patches against preserved corpus.
Reads inputs only; writes an evidence JSON, never extracts/duplicates media.
"""
from __future__ import annotations
import argparse, collections, hashlib, json, pathlib, sys, time
sys.dont_write_bytecode = True

def sha(data): return hashlib.sha256(data).hexdigest()
def read_json(p): return json.loads(p.read_text(encoding="utf-8-sig"))
def digest_file(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(4*1024*1024),b""): h.update(chunk)
    return h.hexdigest()
def audit(resource, install, patch_root):
    sys.path.insert(0,str(resource/"tools"))
    import archive_unpack as arc, enigma_extract as evb
    adapter=read_json(resource/"manifests/generated/reader-adapter.json")
    selection=read_json(resource/"manifests/generated/reader-selection.json")
    variants_by_source=collections.defaultdict(list)
    for story in adapter["stories"]:
        for variant in story["variants"]:
            for key in ("source","rawSource"):
                source=variant.get("references",{}).get(key)
                if source:
                    variants_by_source[source.replace("\\","/").casefold()].append(
                        {"storyId":story["canonicalStoryId"],"variantId":variant["id"],
                         "script":variant["references"].get("script"),
                         "reader":story["resource"]["reader"]})
    report={"schema":"narcissu-installed-content-audit/v1","generatedAt":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
            "inputRoot":str(install),"patchRoot":str(patch_root),"resourceRoot":str(resource),
            "method":"Read each archive table; byte-compare every script/source member and every EVB virtual file; retain all entries in inventory. No media copied.",
            "patches":[],"archives":[],"scriptMembers":[],"issues":[]}
    def record_script(source_label,entry_name,payload,candidates):
        candidates=list(dict.fromkeys(candidates))
        matches=[]
        for candidate in candidates:
            old=resource/candidate
            if old.is_file() and old.stat().st_size==len(payload) and old.read_bytes()==payload:
                matches.append(candidate)
        refs=[]
        for match in matches: refs.extend(variants_by_source.get(match.casefold(),[]))
        row={"source":source_label,"name":entry_name,"bytes":len(payload),"sha256":sha(payload),
             "byteEqualCorpusPaths":matches,"adapterReferences":refs}
        report["scriptMembers"].append(row)
        if not matches: report["issues"].append({"kind":"unarchived-or-changed-script","source":source_label,"entry":entry_name})
        # Text DLL mapping inputs may be sources of translations rather than MJO references.
        if entry_name.lower().endswith(".mjo") and not refs:
            report["issues"].append({"kind":"script-not-referenced-by-adapter","source":source_label,"entry":entry_name,"matches":matches})
    text_suffixes={".mjo",".txt",".env"}
    for exe in sorted(patch_root.rglob("*.exe")):
        relative=exe.relative_to(patch_root)
        game=relative.parts[0]
        data=exe.read_bytes()
        archived_input=resource/"archive/inputs/patches"/relative
        magic=evb._find_magic(data)
        errors=[]
        for mode,parser in (("modern",evb._parse_modern),("legacy",evb._parse_legacy)):
            try:
                virtual=parser(data,magic)
                if not virtual: raise ValueError("Empty EVB")
                break
            except Exception as exc: errors.append(str(exc))
        else: raise ValueError(errors)
        p={"source":str(exe),"bytes":len(data),"sha256":sha(data),"tableMode":mode,
           "archivedInputByteEqual":archived_input.is_file() and archived_input.read_bytes()==data,"files":[]}
        seen=set()
        for item in virtual:
            if item.path.casefold() in seen: raise ValueError("Duplicate EVB member")
            seen.add(item.path.casefold())
            payload,method=evb._extract_payload(data,item)
            rel=f"archive/raw/patches/{game}/{item.path}"
            old=resource/rel
            equal=old.is_file() and old.read_bytes()==payload
            p["files"].append({"path":item.path,"bytes":len(payload),"sha256":sha(payload),"corpusPath":rel,"byteEqual":equal,**method})
            if not equal: report["issues"].append({"kind":"patch-vfs-difference","source":str(exe),"entry":item.path})
            if pathlib.Path(item.path).suffix.lower() in text_suffixes:
                record_script(str(exe),item.path,payload,[rel])
            if item.path.lower().endswith(".arc") and equal:
                archive=arc.parse_archive(old)
                a={"source":str(exe)+"!/"+item.path,"sha256":sha(payload),"format":archive.format,
                   "entryCount":len(archive.entries),"entries":[{"name":e.name,"offset":e.offset,"bytes":e.size} for e in archive.entries]}
                report["archives"].append(a)
                for entry in archive.entries:
                    if pathlib.Path(entry.name).suffix.lower() in text_suffixes:
                        record_script(a["source"],entry.name,payload[entry.offset:entry.offset+entry.size],
                          [f"archive/raw/patch-archives/{game}/{item.path}.unpacked/{entry.name}"])
        p["fileCount"]=len(p["files"])
        report["patches"].append(p)
    for archive_path in sorted(install.rglob("*.arc")):
        relative=archive_path.relative_to(install)
        archive=arc.parse_archive(archive_path)
        a={"source":str(archive_path),"bytes":archive_path.stat().st_size,"sha256":digest_file(archive_path),
           "format":archive.format,"entryCount":len(archive.entries),
           "entries":[{"name":e.name,"offset":e.offset,"bytes":e.size} for e in archive.entries]}
        report["archives"].append(a)
        with archive_path.open("rb") as f:
            for entry in archive.entries:
                if pathlib.Path(entry.name).suffix.lower() in text_suffixes:
                    f.seek(entry.offset);payload=f.read(entry.size)
                    candidates=[f"archive/raw/{prefix}/{relative.as_posix()}.unpacked/{entry.name}"
                                for prefix in ("narcissu10-original","narcissu10-original-ja-JP")]
                    record_script(str(archive_path),entry.name,payload,candidates)
    excluded=[]
    for record in selection["records"]:
        if record["decision"]=="exclude":
            excluded.append({key:record.get(key) for key in ("canonicalStoryId","gameId","resourceClass","entryReachable","preferredTextEventCount","reasonCode","replacementStoryIds","sourcePaths")})
    report["excludedRecords"]=excluded
    report["summary"]={"patchExecutables":len(report["patches"]),"patchExecutablesByteEqual":sum(p["archivedInputByteEqual"] for p in report["patches"]),
      "patchVirtualFiles":sum(p["fileCount"] for p in report["patches"]),"patchVirtualFilesByteEqual":sum(f["byteEqual"] for p in report["patches"] for f in p["files"]),
      "archives":len(report["archives"]),"archiveMembers":sum(a["entryCount"] for a in report["archives"]),
      "scriptAndTextMembers":len(report["scriptMembers"]),"scriptAndTextMembersByteEqual":sum(bool(s["byteEqualCorpusPaths"]) for s in report["scriptMembers"]),
      "excludedRecords":len(excluded),"issues":len(report["issues"])}
    report["result"]="PASS" if not report["issues"] else "REVIEW_REQUIRED"
    return report
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--resource",type=pathlib.Path,default=pathlib.Path(r"D:\PROGETTO\narcissu-kana-research"))
    p.add_argument("--install",type=pathlib.Path,default=pathlib.Path(r"A:\Narcissu 10th Anniversary Anthology Project"))
    p.add_argument("--patch",type=pathlib.Path,default=pathlib.Path(r"A:\N10 ver1.1补丁"))
    p.add_argument("--report",type=pathlib.Path,required=True)
    args=p.parse_args()
    r=audit(args.resource,args.install,args.patch)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(r,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"result":r["result"],**r["summary"],"issuesPreview":r["issues"][:20]},ensure_ascii=False))
if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
