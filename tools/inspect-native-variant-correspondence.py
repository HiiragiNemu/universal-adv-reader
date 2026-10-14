"""Read-only native bytecode comparison; writes evidence only in this project.

No sentence/array-index/URL matching: a message pair is established here only
when the entire instruction stream is equal after replacing published message
spans and ignoring the native parser's debug-line opcode. All other instruction
bytes (including branch operands) must be exactly equal. Different streams are
left unresolved, not silently aligned by an approximate sequence matcher.
"""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
RESOURCE = Path('D:/PROGETTO/narcissu-kana-research')
PARSER = RESOURCE / 'tools/script_extract.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('readonly_native_parser', PARSER)
native = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = native
spec.loader.exec_module(native)
sha = lambda data: hashlib.sha256(data).hexdigest()


def canonical(variant):
    plain_path = RESOURCE / variant['references']['plainObject']
    script_path = RESOURCE / variant['references']['script']
    plain, script_bytes = plain_path.read_bytes(), script_path.read_bytes()
    script = json.loads(script_bytes)
    instructions = native.parse_mjo_instructions(plain)
    source_events = script['textEvents']
    extracted = native.extract_mjo_text_events(instructions)
    assert [[s['codeOffset'] for s in e['segments']] for e in source_events] == [
        [s['codeOffset'] for s in e['segments']] for e in extracted
    ], 'published message span differs from actual native bytecode'
    by_offset = {instruction.codeOffset: instruction for instruction in instructions}
    spans = {event['codeOffset']: (event, by_offset[event['segments'][-1]['codeOffset']]) for event in source_events}
    tokens, messages = [], []
    skip_until = -1
    for instruction in instructions:
        if instruction.codeOffset < skip_until:
            continue
        if instruction.codeOffset in spans:
            event, last = spans[instruction.codeOffset]
            messages.append({'tokenIndex': len(tokens), 'codeOffset': instruction.codeOffset,
                             'eventIndex': len(messages), 'segments': [s['codeOffset'] for s in event['segments']]})
            tokens.append('MESSAGE')
            skip_until = last.codeOffset + last.length
        elif instruction.opcode != 0x83A:  # parser mnemonic: line (debug source line)
            tokens.append(plain[instruction.fileOffset:instruction.fileOffset + instruction.length].hex())
    return {'tokens': tokens, 'messages': messages,
            'plainPath': str(plain_path), 'plainSha256': sha(plain),
            'scriptPath': str(script_path), 'scriptSha256': sha(script_bytes),
            'canonicalSha256': sha(json.dumps(tokens, separators=(',', ':')).encode())}


def main():
    adapter_path = RESOURCE / 'manifests/generated/reader-adapter.json'
    adapter_bytes = adapter_path.read_bytes()
    adapter = json.loads(adapter_bytes)
    entries = json.loads((ROOT / 'apps/classic-reader/public/story_index.json').read_text(encoding='utf-8'))
    stories = {story['canonicalStoryId']: story for story in adapter['stories']}
    results = []
    for entry in entries:
        route_path = ROOT / 'apps/classic-reader/public/data/legacy-vn' / (entry['source_identity'] + '.routes.json')
        route = json.loads(route_path.read_bytes())
        if route['chineseVariantId'] == route['japaneseVariantId']:
            continue
        story = stories[entry['source_identity']]
        variants = {v['id']: v for v in story['variants']}
        cn_variant, jp_variant = variants[route['chineseVariantId']], variants[route['japaneseVariantId']]
        assert cn_variant['references']['baseStringReference'] == jp_variant['references']['source']
        cn, jp = canonical(cn_variant), canonical(jp_variant)
        exact = cn['tokens'] == jp['tokens']
        pairs = []
        if exact:
            jp_by_token = {m['tokenIndex']: m for m in jp['messages']}
            pairs = [{'cnCodeOffset': message['codeOffset'], 'jpCodeOffset': jp_by_token[message['tokenIndex']]['codeOffset'],
                      'cnTextEventIndex': message['eventIndex'], 'jpTextEventIndex': jp_by_token[message['tokenIndex']]['eventIndex'],
                      'canonicalTokenIndex': message['tokenIndex']} for message in cn['messages']]
        cn_events = {e['eventId'] for s in route['variantRoutes'] if s['variantId'] == route['chineseVariantId'] for section in s['sections'] for e in section['events'] if e['kind'] == 'line'}
        jp_events = {e['eventId'] for s in route['variantRoutes'] if s['variantId'] == route['japaneseVariantId'] for section in s['sections'] for e in section['events'] if e['kind'] == 'line'}
        mapped_bodies = [{'cnEventId': f"mjo-{pair['cnCodeOffset']:x}", 'jpEventId': f"mjo-{pair['jpCodeOffset']:x}"}
                         for pair in pairs if f"mjo-{pair['cnCodeOffset']:x}" in cn_events and f"mjo-{pair['jpCodeOffset']:x}" in jp_events]
        results.append({'storyId': entry['source_identity'], 'routePath': str(route_path), 'exactInstructionStructure': exact,
                        'cn': {key: value for key, value in cn.items() if key not in ('tokens', 'messages')},
                        'jp': {key: value for key, value in jp.items() if key not in ('tokens', 'messages')},
                        'tokenCounts': [len(cn['tokens']), len(jp['tokens'])], 'messageCounts': [len(cn['messages']), len(jp['messages'])],
                        'messagePairs': pairs, 'nativeBodyPairs': mapped_bodies,
                        'unmatchedNativeBodies': {'cn': sorted(cn_events - {p['cnEventId'] for p in mapped_bodies}),
                                                  'jp': sorted(jp_events - {p['jpEventId'] for p in mapped_bodies})}})
    report = {'schema': 1, 'status': 'evidence_only_not_runtime_correspondence_manifest',
              'algorithm': __doc__, 'parserPath': str(PARSER), 'parserSha256': sha(PARSER.read_bytes()),
              'adapterPath': str(adapter_path), 'adapterSha256': sha(adapter_bytes),
              'counts': {'parallelStories': len(results), 'exactInstructionStreams': sum(r['exactInstructionStructure'] for r in results),
                         'completeNativeBodyBijections': sum(r['exactInstructionStructure'] and not any(r['unmatchedNativeBodies'].values()) for r in results)},
              'stories': results}
    output = ROOT / 'reports/verification/reader-inheritance-20261012/atom09/parallel-native-structure.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'counts': report['counts'], 'report': str(output),
                      'unresolved': [{'storyId': r['storyId'], 'tokens': r['tokenCounts'], 'messages': r['messageCounts'], 'exact': r['exactInstructionStructure']} for r in results if not r['exactInstructionStructure']]}, ensure_ascii=False))


if __name__ == '__main__':
    main()
