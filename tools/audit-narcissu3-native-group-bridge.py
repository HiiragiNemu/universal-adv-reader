"""Read-only candidate diagnosis of independently proved N:M display grouping."""
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,file)
    result=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
correspondence=module("group_bridge_correspondence",ROOT/"tools/build-native-correspondence.py")
helper=module("group_bridge_helper",ROOT/"tools/lib/majiro_native_group_bridge.py")
candidate=ROOT/"reports/verification/content-repair-20261013/candidate-public"
adapter=json.loads((candidate/"data/legacy-vn/manifests/reader-adapter.json").read_text(encoding="utf-8"))
bridges=correspondence.exact_n10_translation_bridges(adapter)
all_stories = "--all" in sys.argv
identities = ["narcissu-3rd/"+file.name.removesuffix(".routes.json")
    for file in sorted((candidate/"data/legacy-vn/narcissu-3rd").glob("*.routes.json"))] if all_stories else ["narcissu-3rd/nar3_08"]
results=[]
for identity in identities:
    route=json.loads((candidate/("data/legacy-vn/"+identity+".routes.json")).read_text(encoding="utf-8"))
    if not route["chineseVariantId"] or not route["japaneseVariantId"] or route["chineseVariantId"] == route["japaneseVariantId"]:
        continue
    mapping=json.loads((candidate/("data/legacy-vn/"+identity+".alignment.json")).read_text(encoding="utf-8"))
    routes={v["variantId"]:v for v in route["variantRoutes"]}
    cn=[e for s in routes[route["chineseVariantId"]]["sections"] for e in s["events"]]
    jp=[e for s in routes[route["japaneseVariantId"]]["sections"] for e in s["events"]]
    proposal=helper.build_native_group_translation_bridges(identity,cn,jp,mapping["pairs"],bridges)
    results.append({"storyId":identity,"candidateRouteHashes":mapping["hashes"],
        "originalUnpaired":{k:len(v) for k,v in mapping["unpaired"].items()},**proposal})
report={"schema":"native-display-group-translation-bridge-audit/v1","sourceCandidate":str(candidate),
    "status":"read-only-proposals-not-published","normalizationLimit":"Sentence punctuation and whitespace only. Quotes, brackets, words, digits, symbols and case remain exact.",
    "stories":results}
out=ROOT/"reports/verification/content-repair-20261013/narcissu3"/("native-group-bridge-full-audit.json" if all_stories else "native-group-bridge-audit.json")
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"output":str(out),"storyCount":len(results),
    "totals":dict(sum((Counter(r["counts"]) for r in results),Counter())),
    "rejectionReasons":dict(Counter(x["reason"] for r in results for x in r["rejections"])),
    "stories":[{"id":r["storyId"],"counts":r["counts"],
        "examples":[{"cn":g["proof"]["cnNativeBuffer"]["text"],"jp":g["proof"]["jpNativeBuffer"]["text"],
            "cnEventIds":g["cnEventIds"],"jpEventIds":g["jpEventIds"]} for g in r["groupPairs"][:4]] if not all_stories else []}
        for r in results if r["groupPairs"]]},ensure_ascii=False))
