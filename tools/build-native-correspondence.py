"""Generate hash-bound native correspondence; never edit the resource repository.

Exact whole streams, or equal instruction intervals between unique, monotone
4-instruction anchors establish pairs. Anchors contain NO message placeholders
and at least two substantive instructions. A mapped voice load/call may also
bind the next message across a branch-checked string/call corridor. Other
unequal intervals stay unresolved;
no fuzzy sentence/URL matching, prefix-zipping, or inferred missing translation.
"""
from __future__ import annotations
from collections import Counter
from functools import lru_cache
import argparse
import hashlib
import importlib.util
import json
import struct
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from majiro_native_group_bridge import build_native_group_translation_bridges
from source_bound_bilingual_review import apply_source_bound_review_overrides

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('correspondence_inspection', ROOT / 'tools/inspect-native-variant-correspondence.py')
inspection = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = inspection
spec.loader.exec_module(inspection)
RESOURCE = inspection.RESOURCE
sha = lambda data: hashlib.sha256(data).hexdigest()


def instruction_pairs(cn, jp):
    if cn == jp:
        return [(i, i) for i in range(len(cn))], 'exact-normalized-stream', []
    def windows(tokens):
        result = {}
        for i in range(len(tokens) - 3):
            window = tuple(tokens[i:i + 4])
            if any(token == 'MESSAGE' or token.startswith('CHOICE:') for token in window):
                continue
            substantive = sum(token[:4] not in ('4108', '4208', '2f08') and not token.startswith('PRESENTATION:') for token in window)
            if substantive < 2:
                continue
            result.setdefault(window, []).append(i)
        return result
    left, right = windows(cn), windows(jp)
    anchors = sorted((values[0], right[key][0], 4) for key, values in left.items()
                     if len(values) == 1 and key in right and len(right[key]) == 1)
    # Reject crossed anchors rather than choose an arbitrary longest subsequence.
    prefix, maximum = [], -1
    for _, j, _ in anchors:
        prefix.append(maximum)
        maximum = max(maximum, j)
    suffix, minimum = [], len(jp) + 1
    for _, j, _ in reversed(anchors):
        suffix.append(minimum)
        minimum = min(minimum, j)
    suffix.reverse()
    stable = [anchor for n, anchor in enumerate(anchors) if prefix[n] < anchor[1] < suffix[n]]
    disjoint, ci, ji = [], 0, 0
    for i, j, length in stable:
        if i >= ci and j >= ji:
            disjoint.append((i, j, length))
            ci, ji = i + length, j + length
    pairs, intervals, ci, ji = [], [], 0, 0
    for i, j, length in [*disjoint, (len(cn), len(jp), 0)]:
        if cn[ci:i] == jp[ji:j]:
            pairs.extend((ci + offset, ji + offset) for offset in range(i - ci))
        elif i > ci or j > ji:
            intervals.append({'cnTokenRange': [ci, i], 'jpTokenRange': [ji, j],
                              'cnMessages': cn[ci:i].count('MESSAGE'), 'jpMessages': jp[ji:j].count('MESSAGE'),
                              'classification': 'unresolved-structural-difference-not-confirmed-text-addition'})
        pairs.extend((i + offset, j + offset) for offset in range(length))
        ci, ji = i + length, j + length
    assert len({i for i, _ in pairs}) == len(pairs) == len({j for _, j in pairs})
    assert all(cn[i] == jp[j] for i, j in pairs)
    return pairs, 'exact-intervals-between-unique-native-anchors', intervals



def display_instruction_pairs(cn,jp):
    """Keep every literal native anchor before adding visual-operand equivalence.

    Replacing a background filename by a contract placeholder can remove a
    formerly unique instruction window. The original proof has priority; new
    equivalent intervals must not move, replace, overlap, or cross it.
    """
    def literal(source):
        tokens=list(source['tokens'])
        for operand in source.get('presentationOperands',[]):
            if operand['contract']=='native-a4eb1e4c-background-asset':
                tokens[operand['tokenIndex']]=operand['rawHex']
        return tokens
    c,j=literal(cn),literal(jp)
    base,method,intervals=instruction_pairs(c,j)
    if c==cn['tokens'] and j==jp['tokens']:
        return base,method,intervals,None
    equivalent,_,_=instruction_pairs(cn['tokens'],jp['tokens'])
    left=dict(base);right={j:i for i,j in base}
    added=[(a,z) for a,z in equivalent if a not in left and z not in right
        and not any((a-ca)*(z-ja)<0 for ca,ja in base)]
    merged=sorted(base+added)
    assert len({a for a,_ in merged})==len(merged)==len({z for _,z in merged})
    assert all(cn['tokens'][a]==jp['tokens'][z] for a,z in merged)
    if branch_mapping_failures(cn,jp,merged):
        return base,method,intervals,{'method':'literal-native-anchors-retained','equivalenceRejected':'unproved-control-edge'}
    return merged,method+('-with-nonconflicting-native-visual-operand-contract' if added else ''),intervals,{
        'method':'literal-native-anchors-retained-before-visual-operand-equivalence',
        'literalInstructionPairs':len(base),'addedEquivalentInstructionPairs':added,
        'literalBindingsRetainOrder':True}


def native_tokens(variant):
    result = inspection.canonical(variant)
    plain = Path(result['plainPath']).read_bytes()
    instructions = inspection.native.parse_mjo_instructions(plain)
    instruction_by_offset = {i.codeOffset: i for i in instructions}
    messages = {m['codeOffset']: m for m in result['messages']}
    offsets, index, until = {}, 0, -1
    for instruction in instructions:
        if instruction.codeOffset < until or instruction.opcode == 0x83A:
            continue
        offsets[instruction.codeOffset] = index
        if instruction.codeOffset in messages:
            last = instruction_by_offset[messages[instruction.codeOffset]['segments'][-1]]
            until = last.codeOffset + last.length
        index += 1
    assert index == len(result['tokens'])
    result['offsetToToken'] = offsets
    # Resolve only the simple relative branches needed by this bounded proof.
    # Unsupported tables/branch forms stay explicitly ineligible, not erased.
    branches = []
    for n, instruction in enumerate(instructions):
        encoding = inspection.native._mjo_operand_encoding(instruction.opcode)
        if 'j' not in encoding and 'c' not in encoding:
            continue
        edge = {'opcode': instruction.opcode, 'codeOffset': instruction.codeOffset,
                'sourceToken': offsets.get(instruction.codeOffset), 'supported': False}
        if instruction.opcode in (0x82C, 0x82D, 0x82E) and instruction.length == 6:
            displacement = struct.unpack_from('<i', plain, instruction.fileOffset + 2)[0]
            target = instruction.codeOffset + instruction.length + displacement
            if target in instruction_by_offset:
                # Debug-line markers do not execute a control-flow operation.
                target_instruction = instruction_by_offset[target]
                while target_instruction.opcode == 0x83A:
                    target += target_instruction.length
                    target_instruction = instruction_by_offset.get(target)
                    if target_instruction is None:
                        break
                if target in offsets:
                    edge.update(supported=True, targetCodeOffset=target, targetToken=offsets[target])
        branches.append(edge)
    result['branches'] = branches
    return result


def voice_bound_body_pairs(cn, jp, ce, je, token_pairs, body_pairs, aliases):
    """A previously proved voice instruction can bind its next message.

    Only an identical voice load/call followed by equal string-load/call
    skeletons qualifies. One additional form permits an integer-load/call
    between that voice and one string-load/call; its integer bytes and every
    call remain exact. No other numeric/control operations are admitted.
    Calls/other operands remain byte-exact. No intervening
    message or branch is accepted, and every script branch edge must retain its
    already-proved source/target mapping without entering the corridor. String
    operands are retained as differing evidence, never rewritten or declared
    semantically equivalent. This is not asset-name or row-position matching.
    """
    events = {'cn': {e['eventId']: e for e in ce if e['kind'] == 'line'},
              'jp': {e['eventId']: e for e in je if e['kind'] == 'line'}}
    paired = {lang: {p[lang + 'EventId'] for p in body_pairs} for lang in ('cn', 'jp')}
    candidates, rejected = [], Counter()
    for alias in aliases:
        if any(alias[lang + 'EventId'] in paired[lang] for lang in ('cn', 'jp')):
            continue
        corridors, ranges = {}, {}
        for lang, source in (('cn', cn), ('jp', jp)):
            event = events[lang].get(alias[lang + 'EventId'])
            cue = next((c for c in (event or {}).get('cues', []) if c['cueId'] == alias[lang + 'CueId']), None)
            if not cue or cue.get('timing') != 'utterance' or cue.get('raw', {}).get('targetEventId') != event['eventId']:
                break
            start = source['offsetToToken'].get(cue['raw']['codeOffset'])
            end = source['offsetToToken'].get(int(event['eventId'][4:], 16))
            if start is None or end is None or start >= end or source['tokens'][end] != 'MESSAGE':
                break
            corridors[lang], ranges[lang] = source['tokens'][start:end], [start, end]
        if len(corridors) != 2:
            rejected['missing-native-utterance-binding'] += 1
            continue
        c, j = corridors['cn'], corridors['jp']
        def shape(xs):
            string_calls = len(xs) >= 2 and len(xs) % 2 == 0 and all(
                t.startswith('0108' if i % 2 == 0 else '1008') for i, t in enumerate(xs))
            integer_call = len(xs) == 6 and all(t.startswith(opcode) for t, opcode in zip(
                xs, ('0108', '1008', '0008', '1008', '0108', '1008')))
            return string_calls or integer_call
        # Integer operands are evidence, not placeholders: any difference rejects.
        skeleton = lambda xs: ['STRING_OPERAND' if t.startswith('0108') else t for t in xs]
        if not (shape(c) and shape(j) and c[:2] == j[:2] and skeleton(c) == skeleton(j)
                and token_pairs.get(ranges['cn'][0]) == ranges['jp'][0]
                and token_pairs.get(ranges['cn'][0] + 1) == ranges['jp'][0] + 1):
            rejected['different-or-intervening-native-instructions'] += 1
            continue
        cb, jb = cn['branches'], jp['branches']
        right = {b['sourceToken']: b for b in jb}
        branch_ok = len(cb) == len(jb) and all(b['supported'] for b in cb + jb)
        for left in cb:
            other = right.get(token_pairs.get(left['sourceToken']))
            branch_ok = branch_ok and bool(other and left['opcode'] == other['opcode']
                and token_pairs.get(left.get('targetToken')) == other.get('targetToken'))
        for lang, edges in (('cn', cb), ('jp', jb)):
            start, end = ranges[lang]
            branch_ok = branch_ok and all(not (start < b.get('targetToken', -1) <= end) for b in edges)
        if not branch_ok:
            rejected['unproved-or-entering-control-edge'] += 1
            continue
        candidates.append({'cnEventId': alias['cnEventId'], 'jpEventId': alias['jpEventId'],
                           'method': 'mapped-native-voice-next-message-branch-checked',
                           'cue': alias, 'tokenRanges': ranges, 'literalInstructionCorridors': corridors,
                           'controlEdges': {'cn': cb, 'jp': jb}})
    # Reject conflicts and crossed order against ALL existing and new pairs.
    unique = {(p['cnEventId'], p['jpEventId']): p for p in candidates}
    proposed = [*body_pairs, *unique.values()]
    cc, jc = Counter(p['cnEventId'] for p in proposed), Counter(p['jpEventId'] for p in proposed)
    co, jo = ({key: i for i, key in enumerate(events[lang])} for lang in ('cn', 'jp'))
    accepted = []
    for pair in unique.values():
        c, j = co[pair['cnEventId']], jo[pair['jpEventId']]
        if cc[pair['cnEventId']] != 1 or jc[pair['jpEventId']] != 1 or any(
                (co[p['cnEventId']] - c) * (jo[p['jpEventId']] - j) < 0 for p in proposed):
            rejected['nonunique-or-crossed-body-binding'] += 1
        else:
            accepted.append(pair)
    return accepted, dict(rejected)


def blank_speaker_whole_stream(cn, jp, ce, je):
    """Prove a WHOLE stream after excluding only explicit blank name messages.

    A removable message is absent from route bodies, contains whitespace only,
    and is immediately followed by a route body MESSAGE (no intervening native
    operation). Every other message must be a body. All remaining instruction
    bytes and resolved branch edges must match exactly. This is not sequence
    similarity, ordinal zipping, or a voice-filename character guess.
    """
    sides = {}
    for lang, source, events in (('cn', cn, ce), ('jp', jp, je)):
        bodies = {int(e['eventId'][4:], 16): e['eventId'] for e in events if e['kind'] == 'line'}
        raw = json.loads(Path(source['scriptPath']).read_bytes())
        texts = {e['codeOffset']: e['text'] for e in raw['textEvents']}
        messages = {m['tokenIndex']: m for m in source['messages']}
        omitted = []
        for token, message in messages.items():
            if message['codeOffset'] in bodies:
                continue
            following = messages.get(token + 1)
            literal = texts[message['codeOffset']]
            if literal.strip() or not following or following['codeOffset'] not in bodies:
                return None
            omitted.append({'tokenIndex': token, 'codeOffset': message['codeOffset'],
                            'literalText': literal, 'segments': message['segments'],
                            'nextBodyEventId': bodies[following['codeOffset']]})
        dropped = {m['tokenIndex'] for m in omitted}
        retained = [i for i in range(len(source['tokens'])) if i not in dropped]
        projection = {token: index for index, token in enumerate(retained)}
        edges = []
        for edge in source['branches']:
            if not edge['supported'] or edge['sourceToken'] not in projection or edge['targetToken'] not in projection:
                return None
            edges.append({'opcode': edge['opcode'], 'source': projection[edge['sourceToken']],
                          'target': projection[edge['targetToken']]})
        body_tokens = {projection[m['tokenIndex']]: bodies[m['codeOffset']]
                       for m in source['messages'] if m['codeOffset'] in bodies}
        if len(body_tokens) != len(bodies):
            return None
        sides[lang] = {'tokens': [source['tokens'][i] for i in retained], 'bodies': body_tokens,
                       'blankSpeakers': omitted, 'controlEdges': edges}
    c, j = sides['cn'], sides['jp']
    if c['tokens'] != j['tokens'] or c['controlEdges'] != j['controlEdges'] or c['bodies'].keys() != j['bodies'].keys():
        return None
    pairs = [{'cnEventId': c['bodies'][i], 'jpEventId': j['bodies'][i], 'canonicalTokenIndex': i} for i in c['bodies']]
    return {'method': 'exact-whole-native-stream-excluding-explicit-blank-speaker-messages',
            'canonicalTokenCount': len(c['tokens']), 'canonicalSha256': sha(json.dumps(c['tokens'], separators=(',', ':')).encode()),
            'blankSpeakers': {k: sides[k]['blankSpeakers'] for k in sides},
            'controlEdges': c['controlEdges'], 'bodyPairs': pairs}


@lru_cache(maxsize=1)
def n3_voice_helper_contract():
    # Closed, byte-guarded native call graph: channel enable/volume and picture
    # position for voice panning. No function contains a text/ctrl instruction.
    # Native call/return structure is unchanged when the label argument differs.
    files = {
        'yazlib': '06d9d5d4f330f6ad342335a069e9ab9cf4b7396ce1e26a4a7fbe9119b1f020ea',
        'pic': '718a416ca226d15e082699b635fa32775fe05f0f411c4f875337ff824d47c8db',
        'config': '2adb35aeb5e3b726fd13f649636c05ef015526839e40b4bc282f56a1f3115602',
    }
    expected = {0x8e803141: ('yazlib',8927,9662),0xca0347cb: ('yazlib',111,188),
        0x5bdc7b32: ('yazlib',8863,8927),0xc686d02b: ('pic',9923,10038),
        0xbf019a9f: ('pic',9655,9923),0xe9654059: ('pic',9089,9655),
        0xa45d2867: ('pic',12376,12788),0x28834106: ('config',49640,51899)}
    content = {}
    for name, digest in files.items():
        relative = 'archive/derived/scripts/narcissu3/scenario.arc.unpacked/' + name + '.plain.mjo'
        raw = (RESOURCE / relative).read_bytes()
        assert sha(raw) == digest, 'Audited voice helper source changed'
        table = dict(struct.unpack_from('<II',raw,28+i*8) for i in range(struct.unpack_from('<I',raw,24)[0]))
        content[name] = (relative,raw,table,inspection.native.parse_mjo_instructions(raw))
    closure = []
    for function,(name,start,end) in expected.items():
        relative,raw,table,instructions = content[name]
        assert table.get(function) == start
        selected = [i for i in instructions if start <= i.codeOffset < end]
        assert selected and selected[-1].opcode == 0x82b
        assert not any(i.opcode in (0x840,0x842) for i in selected)
        calls = [struct.unpack_from('<I',raw,i.fileOffset+2)[0] for i in selected if i.opcode in (0x80f,0x810)]
        assert all(call in expected for call in calls), 'Voice helper call graph changed'
        closure.append({'functionHash':f'{function:08x}','source':relative,'plainSha256':files[name],
                        'codeRange':[start,end],'calls':[f'{call:08x}' for call in calls]})
    return {'method':'closed-native-voice-channel-preparation-graph','functions':closure}



@lru_cache(maxsize=1)
def n3_background_helper_contract():
    # All transitive native functions for the audited background setter. Its
    # literal bg_#### operand selects a visual asset; no callee can emit a
    # story text or message control instruction.
    hashes={'pic':'718a416ca226d15e082699b635fa32775fe05f0f411c4f875337ff824d47c8db',
        'console':'5115442c2d8ca05a9a073e2b49db7d9b6416a55739b421941d1df72678b4130a',
        'yazlib':'06d9d5d4f330f6ad342335a069e9ab9cf4b7396ce1e26a4a7fbe9119b1f020ea'}
    registry={}
    for name,digest in hashes.items():
        relative='archive/derived/scripts/narcissu3/scenario.arc.unpacked/'+name+'.plain.mjo'
        raw=(RESOURCE/relative).read_bytes()
        assert sha(raw)==digest,'Audited background helper source changed'
        count=struct.unpack_from('<I',raw,24)[0]
        table=[struct.unpack_from('<II',raw,28+i*8) for i in range(count)]
        starts=sorted(set(offset for _,offset in table))
        size=struct.unpack_from('<I',raw,28+count*8)[0]
        instructions=inspection.native.parse_mjo_instructions(raw)
        for function,start in table:
            end=next((offset for offset in starts if offset>start),size)
            registry.setdefault(function,[]).append((relative,digest,raw,start,end,instructions))
    queue=[0xa4eb1e4c];seen=set();closure=[]
    while queue:
        function=queue.pop()
        if function in seen:continue
        seen.add(function)
        assert len(registry.get(function,[]))==1,'Background helper has unresolved native call'
        relative,digest,raw,start,end,instructions=registry[function][0]
        selected=[i for i in instructions if start<=i.codeOffset<end]
        assert selected and selected[-1].opcode==0x82b
        assert not any(i.opcode in (0x840,0x842) for i in selected)
        calls=[struct.unpack_from('<I',raw,i.fileOffset+2)[0] for i in selected if i.opcode in (0x80f,0x810)]
        queue.extend(calls)
        closure.append({'functionHash':f'{function:08x}','source':relative,'plainSha256':digest,
            'codeRange':[start,end],'calls':[f'{call:08x}' for call in calls]})
    assert len(closure)==40
    return {'method':'closed-native-background-asset-setter-graph','literalAssetPattern':'bg_ followed by four ASCII digits',
        'functions':closure}



def relocated_native_block_projection(identity, cn, jp, cn_events, jp_events, pairs):
    """Prove the rest of a chapter after one independently located move.

    The moved units remain source-only in their original positions. This
    projection excludes them solely from the instruction equality comparison;
    it never removes, reorders, or zips narrative events.
    """
    if identity != 'narcissu-3rd/nara03':
        return pairs, None
    guards = {
        'cn': {'plainSha256': 'e751480b97c3dd5787357f2c8c0fef896a89f2437b6699f999bd945a4421673a',
               'scriptSha256': '56d229fb129ec08c4e963e24c33edf1fb25d390d78fea2038c3093de7270ad21'},
        'jp': {'plainSha256': '593fcb46fda34dedd1ebb5007e22c4645addfd5c0e0a8402f65cd064fec4386d',
               'scriptSha256': '071c537747bf4f418b264b1709eda19e333d86cc41db0ae6439a2c2449d8124e'}}
    expected = [
        '01080b006e336b61695f3031393800', '1008f0fd2a81000000000100', 'MESSAGE',
        '420802007000', '420802007700', 'MESSAGE', '420802007000', '420802007700',
        '01080b006e336b61695f3031393900', '1008f0fd2a81000000000100', 'MESSAGE',
        '420802007000', '420802007700']
    definitions = [
        ('cn', cn, cn_events, 8482, [8482, 8708], ['mjo-213d', 'mjo-218b', 'mjo-221f']),
        ('jp', jp, jp_events, 12965, [12965, 13275], ['mjo-32d1', 'mjo-3344', 'mjo-3407'])]
    kept, blocks = {}, {}
    for side, source, events, offset, voice_offsets, event_ids in definitions:
        assert all(source[key] == value for key, value in guards[side].items()), 'Relocated chapter source changed'
        start = source['offsetToToken'][offset]
        end = start + len(expected)
        assert source['tokens'][start:end] == expected, 'Relocated native block changed'
        assert sum(source['tokens'][i:i+len(expected)] == expected
                   for i in range(len(source['tokens'])-len(expected)+1)) == 1, 'Relocated native block is not unique'
        removed = set(range(start, end))
        assert [m['eventId'] for m in source['messages'] if m['tokenIndex'] in removed] == event_ids
        assert not any(edge['sourceToken'] in removed or edge.get('targetToken') in removed
                       for edge in source['branches']), 'A control edge enters or leaves the excluded block'
        source_bodies = {event['eventId']: event for event in events if event['kind'] == 'line'}
        voices = [{'eventId': event['eventId'], 'cueId': cue['cueId'], 'mediaId': cue['mediaId'],
                   'codeOffset': cue['raw']['codeOffset'], 'raw': cue['raw']}
                  for event in events for cue in event.get('cues', [])
                  if cue['kind'] == 'voice' and source['offsetToToken'].get(cue.get('raw', {}).get('codeOffset')) in removed]
        assert [voice['codeOffset'] for voice in voices] == voice_offsets
        assert [voice['eventId'] for voice in voices] == [event_ids[0], event_ids[2]]
        kept[side] = [i for i in range(len(source['tokens'])) if i not in removed]
        blocks[side] = {'tokenRange': [start, end], 'startCodeOffset': offset, 'eventIds': event_ids,
            'voices': voices, 'nativeUnits': [
                {'eventId': key, 'text': ''.join(part['text'] for part in source_bodies[key]['source']['nativeUnit']['textParts']),
                 'textSha256': sha(''.join(part['text'] for part in source_bodies[key]['source']['nativeUnit']['textParts']).encode()),
                 'nativeUnit': source_bodies[key]['source']['nativeUnit']}
                for key in event_ids]}
    assert [v['mediaId'] for v in blocks['cn']['voices']] == [v['mediaId'] for v in blocks['jp']['voices']]
    projected = {side: [source['tokens'][i] for i in kept[side]] for side, source in [('cn', cn), ('jp', jp)]}
    assert projected['cn'] == projected['jp'], 'Remaining native streams are not identical'
    proposed = list(zip(kept['cn'], kept['jp']))
    assert set(pairs) <= set(proposed), 'Relocation proof conflicts with a retained native anchor'
    assert not branch_mapping_failures(cn, jp, proposed), 'Remaining native control graph is not equal'
    return proposed, {
        'method': 'hash-bound-relocated-native-block-with-identical-remaining-instruction-stream',
        'sourceGuards': guards, 'relocatedBlocks': blocks, 'relocatedNativeTokens': expected,
        'excludedOnlyFromCorrespondenceProjection': True, 'nativeSourceOrderPreserved': True,
        'allPreviousNativePairsRetained': True, 'remainingControlGraphProved': True,
        'remainingNativeTokenCount': len(proposed),
        'remainingNativeTokensSha256': sha(json.dumps(projected['cn'], separators=(',', ':')).encode()),
        'addedNativeInstructionPairs': len(proposed)-len(pairs)}


def native_display_tokens(variant, events):
    """Hash-bound display/selection spans; resolve branches before projection.

    Selection labels are data arguments to the proven menu function $57f252db.
    The call and argument count stay in the token. Each returned case integer
    and both native control edges must be mapped before options can be paired.
    """
    result = inspection.canonical(variant)
    plain = Path(result['plainPath']).read_bytes()
    instructions = inspection.native.parse_mjo_instructions(plain)
    by_offset = {i.codeOffset: i for i in instructions}
    units = [e for e in events if e['kind'] == 'line' and e.get('source', {}).get('nativeUnit')]
    selections = [e for e in events if e['kind'] == 'choice' and e.get('source', {}).get('nativeSelection')]
    if not units:
        return native_tokens(variant)
    spans, consumed = {}, set()
    for event in units + selections:
        unit = event['source'].get('nativeUnit') or event['source']['nativeSelection']
        start, end = unit['codeOffset'], unit['endCodeOffset']
        assert start in by_offset and start < end and start not in spans
        actual = [i.codeOffset for i in instructions if start <= i.codeOffset < end and i.opcode != 0x83A]
        assert actual == unit['codeOffsets'], 'Native display/selection span is not bytecode contiguous'
        assert not any(inspection.native._mjo_operand_encoding(by_offset[o].opcode) in ('j','c') for o in actual)
        text = {o for o in actual if by_offset[o].opcode == 0x840}
        assert not text & consumed
        consumed |= text
        if event['kind'] == 'choice':
            call = by_offset[unit['callCodeOffset']]
            raw_call = plain[call.fileOffset:call.fileOffset + call.length].hex()
            assert call.opcode == 0x80f and raw_call == unit['callHex'] and raw_call[4:12] in ('db52f257','e8c27928')
            debug_count = 2 if raw_call[4:12] == 'db52f257' else 0
            assert struct.unpack_from('<H', plain, call.fileOffset + 10)[0] == len(unit['options']) + debug_count
            assert all(by_offset[o].opcode == 0x801 for o in actual[:-1]) and actual[-1] == call.codeOffset
            assert [o['caseValue'] for o in unit['options']] == list(range(1, len(unit['options']) + 1))
            assert [o['codeOffset'] for o in unit['options']] == list(reversed(actual[:len(actual)-1-debug_count]))
            for option in unit['options']:
                operand = by_offset[option['codeOffset']]
                raw = plain[operand.fileOffset + 4:operand.fileOffset + operand.length - 1].hex()
                assert raw == option['rawHex'], 'Selection label bytes mismatch'
        spans[start] = event, end
    assert consumed == {i.codeOffset for i in instructions if i.opcode == 0x840}, 'Uncovered native text'
    ordered = sorted((start, end) for start, (_, end) in spans.items())
    assert all(a[1] <= b[0] for a,b in zip(ordered, ordered[1:])), 'Native spans overlap'
    tokens, offsets, messages, choices, branches = [], {}, [], [], []
    until = -1
    for instruction in instructions:
        if instruction.opcode == 0x83A:
            continue
        if instruction.codeOffset < until:
            offsets[instruction.codeOffset] = len(tokens)-1
            continue
        offsets[instruction.codeOffset] = len(tokens)
        if instruction.codeOffset in spans:
            event, until = spans[instruction.codeOffset]
            if event['kind'] == 'line':
                messages.append({'tokenIndex':len(tokens),'codeOffset':int(event['eventId'][4:],16),
                                 'unitStart':instruction.codeOffset,'eventId':event['eventId'],
                                 'segments':event['source']['nativeUnit']['codeOffsets']})
                tokens.append('MESSAGE')
            else:
                choices.append({'tokenIndex':len(tokens), 'event':event})
                tokens.append('CHOICE:' + event['source']['nativeSelection']['callHex'])
            continue
        encoding = inspection.native._mjo_operand_encoding(instruction.opcode)
        if encoding == 'j':
            target = instruction.codeOffset+instruction.length+struct.unpack_from('<i',plain,instruction.fileOffset+2)[0]
            branches.append({'opcode':instruction.opcode,'codeOffset':instruction.codeOffset,
                             'sourceToken':len(tokens),'targetCodeOffset':target,'supported':target in by_offset})
            tokens.append(f'{instruction.opcode & 255:02x}{instruction.opcode >> 8:02x}:RELATIVE_BRANCH')
        else:
            if encoding == 'c':
                branches.append({'opcode':instruction.opcode,'codeOffset':instruction.codeOffset,
                                 'sourceToken':len(tokens),'supported':False})
            tokens.append(plain[instruction.fileOffset:instruction.fileOffset+instruction.length].hex())
    for edge in branches:
        if not edge['supported']:
            continue
        target = edge['targetCodeOffset']
        while target in by_offset and by_offset[target].opcode == 0x83A:
            target += by_offset[target].length
        edge.update(targetCodeOffset=target,targetToken=offsets.get(target))
        edge['supported'] = edge['targetToken'] is not None and not any(start < target < end for start,(_,end) in spans.items())
    # Allow exact debug-line target resolution in later case proofs.
    for instruction in reversed(instructions):
        if instruction.opcode == 0x83A:
            following = instruction.codeOffset + instruction.length
            if following in offsets:
                offsets[instruction.codeOffset] = offsets[following]
    # ctrl o consumes exactly two coordinates. Their values change cursor
    # positioning, not narrative identity. The actual bytes remain in this proof
    # and the native source; neither operands nor messages are removed/reordered.
    # Reference: AtomCrafty/MajiroTools, Table-of-opcodes, ctrl o(x,y).
    presentation_operands = []
    real = [i for i in instructions if i.opcode != 0x83A]
    for at, ctrl in enumerate(real):
        if ctrl.opcode != 0x842 or plain[ctrl.fileOffset+4:ctrl.fileOffset+ctrl.length-1] != b'o' or at < 2:
            continue
        args = real[at-2:at]
        if any(i.opcode != 0x800 for i in args):
            continue
        for position, operand in enumerate(args):
            token = offsets[operand.codeOffset]
            if tokens[token] == 'MESSAGE':
                continue
            raw = plain[operand.fileOffset:operand.fileOffset+operand.length].hex()
            assert tokens[token] == raw
            tokens[token] = f'PRESENTATION:ctrl-o-coordinate:{position}'
            presentation_operands.append({'tokenIndex':token,'codeOffset':operand.codeOffset,'rawHex':raw,
                'consumerCodeOffset':ctrl.codeOffset,'contract':'ctrl-o-x-y-coordinate','position':position})
    for at, operand in enumerate(real[:-1]):
        if operand.opcode != 0x801:
            continue
        call = real[at+1]
        call_hex = plain[call.fileOffset:call.fileOffset+call.length].hex()
        contract = None
        if call_hex == '3508a73c2ef60100':
            contract = 'syscall-f62e3ca7-Sound1-string-asset'
        elif variant['id'].startswith('mjo/narcissu3/') and call_hex == '10084131808e000000000100':
            n3_voice_helper_contract()
            contract = 'native-8e803141-voice-channel-label'
        elif variant['id'].startswith('mjo/narcissu3/') and call_hex in ('10084c1eeba4000000000100','10084c1eeba4000000000200'):
            label=plain[operand.fileOffset+4:operand.fileOffset+operand.length-1]
            if len(label)==7 and label.startswith(b'bg_') and label[3:].isdigit():
                n3_background_helper_contract()
                contract='native-a4eb1e4c-background-asset'
        token = offsets[operand.codeOffset]
        if contract is None or tokens[token] == 'MESSAGE' or tokens[token].startswith('CHOICE:'):
            continue
        raw = plain[operand.fileOffset:operand.fileOffset+operand.length].hex()
        assert tokens[token] == raw
        tokens[token] = 'PRESENTATION:' + contract
        presentation_operands.append({'tokenIndex':token,'codeOffset':operand.codeOffset,'rawHex':raw,
            'consumerCodeOffset':call.codeOffset,'consumerHex':call_hex,'contract':contract})
    result.update(tokens=tokens,messages=messages,selections=choices,offsetToToken=offsets,branches=branches,
                  presentationOperands=presentation_operands,
                  nativeDisplayUnitCount=len(units),canonicalSha256=sha(json.dumps(tokens,separators=(',',':')).encode()))
    return result


def native_choice_pairs(cn, jp, token_pairs, body_pairs):
    """Pair option labels only through their integer case and mapped targets."""
    japanese = {choice['tokenIndex']: choice['event'] for choice in jp.get('selections', [])}
    event_pairs = {p['cnEventId']:p['jpEventId'] for p in body_pairs}
    event_pairs['end-001'] = 'end-001'
    candidates = []
    for choice in cn.get('selections', []):
        other = japanese.get(token_pairs.get(choice['tokenIndex']))
        if other:
            candidates.append((choice['event'], other))
            event_pairs[choice['event']['eventId']] = other['eventId']
    accepted = []
    for left, right in candidates:
        c, j = left['source']['nativeSelection'], right['source']['nativeSelection']
        if c['callHex'] != j['callHex'] or len(c['options']) != len(j['options']):
            continue
        options = []
        for option in c['options']:
            value = option['caseValue']
            cb = next((x for x in c['caseEdges'] if x['caseValue'] == value), None)
            jb = next((x for x in j['caseEdges'] if x['caseValue'] == value), None)
            cchoice = next((x for x in left['choices'] if x['choiceId'] == left['eventId'] + '-case-' + str(value)), None)
            jchoice = next((x for x in right['choices'] if x['choiceId'] == right['eventId'] + '-case-' + str(value)), None)
            if not cb or not jb or not cchoice or not jchoice:
                break
            if cb.get('dispatchKind') != jb.get('dispatchKind') or any(
                    (cb[field] is None) != (jb[field] is None) or
                    cb[field] is not None and token_pairs.get(cn['offsetToToken'].get(cb[field])) != jp['offsetToToken'].get(jb[field])
                    for field in ('conditionCodeOffset','armCodeOffset','nextCaseCodeOffset')):
                break
            if event_pairs.get(cchoice['nextEventId']) != jchoice['nextEventId']:
                break
            options.append({'cnChoiceId':cchoice['choiceId'],'jpChoiceId':jchoice['choiceId'],
                            'caseValue':value,'cnTargetEventId':cchoice['nextEventId'],'jpTargetEventId':jchoice['nextEventId']})
        if len(options) == len(c['options']):
            accepted.append({'cnEventId':left['eventId'],'jpEventId':right['eventId'],'options':options,
                             'method':'native-menu-call-return-value-and-mapped-case-edges'})
    return accepted


def branch_mapping_failures(cn,jp,pairs):
    mapping=dict(pairs)
    inverse={j:i for i,j in pairs}
    failed=[]
    for left,right,projection in ((cn,jp,mapping),(jp,cn,inverse)):
        edges={b['sourceToken']:b for b in right['branches']}
        for edge in left['branches']:
            if edge['sourceToken'] not in projection:
                continue
            other=edges.get(projection[edge['sourceToken']])
            if not (edge['supported'] and other and other['supported'] and edge['opcode']==other['opcode']
                    and projection.get(edge.get('targetToken'))==other.get('targetToken')):
                failed.append({'codeOffset':edge['codeOffset'],'sourceToken':edge['sourceToken']})
    return failed



def exact_n10_translation_bridges(adapter):
    """Read already explicit bilingual patch targets, with native byte binding."""
    bridges = {}
    for story in adapter['stories']:
        if story['gameId'] not in ('narcissu-iris','narcissu-one-two') or story['resource']['reader']['decision'] != 'include':
            continue
        variant = next(v for v in story['variants'] if v['id'] == story['preferredVariantId'])
        script_bytes = (RESOURCE / variant['references']['script']).read_bytes()
        script = json.loads(script_bytes)
        translation = script.get('translation') or {}
        if translation.get('alignment') != 'exact-bytecode-order':
            continue
        plain = (RESOURCE / variant['references']['plainObject']).read_bytes()
        instructions = [i for i in inspection.native.parse_mjo_instructions(plain) if i.opcode != 0x83A]
        by_offset = {i.codeOffset:i for i in instructions}
        names = set()
        for at, instruction in enumerate(instructions[:-1]):
            if instruction.opcode == 0x840 and instructions[at+1].opcode == 0x840:
                names.add(instruction.codeOffset)
        messages = {e['codeOffset']:e for e in script['textEvents']}
        for entry in translation['entries']:
            target = entry.get('target') or {}
            if target.get('kind') != 'message' or target['codeOffset'] in names:
                continue
            message = messages[target['codeOffset']]
            assert message['text'] == target['sourceText']
            for segment in message['segments']:
                native = by_offset[segment['codeOffset']]
                assert native.opcode == 0x840
                assert plain[native.fileOffset+4:native.fileOffset+native.length-1].hex() == segment['rawHex']
            cn_text, jp_text = str(entry.get('displayText',entry['text'])).strip(), target['sourceText'].strip()
            if not cn_text or not jp_text:
                continue
            proof = {'storyId':story['canonicalStoryId'],'variantId':variant['id'],
                     'scriptPath':variant['references']['script'],'scriptSha256':sha(script_bytes),'plainSha256':sha(plain),
                     'translationSource':translation['source'],'translationLine':entry['line'],
                     'targetCodeOffset':target['codeOffset'],'cnText':cn_text,'jpText':jp_text,
                     'translationRawHex':entry['rawHex'],'targetSegments':message['segments']}
            key = story['gameId'], cn_text
            bridges.setdefault(key,{}).setdefault(jp_text,[]).append(proof)
    return bridges


def bridge_native_intervals(identity, cn, jp, ce, je, pairs, bridges):
    """Exact translation targets disambiguate native intervals, never replace text.

    Both N3 bodies and the N10 bilingual target must be individually unique.
    All existing instruction anchors and all new anchors must retain order.
    Once these content/byte anchors are fixed, ONLY byte-identical normalized
    instruction intervals between them can add neighbouring correspondence.
    """
    chapter = identity.split('/')[-1]
    game = 'narcissu-iris' if chapter.startswith('nar3_') else 'narcissu-one-two' if chapter.startswith(('nar1_','nar2_')) else None
    if game is None:
        return pairs, [], []
    def bodies(events, source):
        texts = {e['eventId']:''.join(p['text'] for p in e['source']['nativeUnit']['textParts']).strip()
                 for e in events if e['kind']=='line' and e.get('source',{}).get('nativeUnit')}
        tokens = {m['eventId']:m['tokenIndex'] for m in source['messages']}
        return texts, Counter(texts.values()), tokens
    ct, cc, ci = bodies(ce,cn)
    jt, jc, ji = bodies(je,jp)
    mapping = dict(pairs); inverse = {j:i for i,j in pairs}
    japanese = {text:event for event,text in jt.items() if jc[text] == 1 and ji[event] not in inverse}
    candidates = []
    for event,text in ct.items():
        if cc[text] != 1 or ci[event] in mapping:
            continue
        matches = [(other,source[0]) for other,source in bridges.get((game,text),{}).items()
                   if len(source) == 1 and other in japanese]
        if len(matches) != 1:
            continue
        other, source = matches[0]
        jp_event = japanese[other]
        candidates.append((ci[event],ji[jp_event],{'cnEventId':event,'jpEventId':jp_event,
            'method':'exact-installed-N10-bilingual-native-target-bridge','source':source}))
    proposed = pairs + [(c,j) for c,j,_ in candidates]
    cn_counts, jp_counts = Counter(c for c,_ in proposed), Counter(j for _,j in proposed)
    accepted = [(c,j,proof) for c,j,proof in candidates
                if cn_counts[c] == 1 and jp_counts[j] == 1
                and not any((pc-c)*(pj-j)<0 for pc,pj in proposed)]
    if not accepted:
        return pairs, [], []
    anchors = sorted(pairs + [(c,j) for c,j,_ in accepted])
    expanded, intervals = [], []
    previous_cn = previous_jp = -1
    for c,j in [*anchors,(len(cn['tokens']),len(jp['tokens']))]:
        cstart, jstart = previous_cn+1, previous_jp+1
        if cn['tokens'][cstart:c] == jp['tokens'][jstart:j]:
            added = [(cstart+k,jstart+k) for k in range(c-cstart)]
            expanded.extend(added)
            if added and any(cn['tokens'][a]=='MESSAGE' for a,_ in added):
                intervals.append({'cnTokenRange':[cstart,c],'jpTokenRange':[jstart,j],
                    'method':'exact-native-interval-between-byte-and-translation-target-anchors',
                    'canonicalSha256':sha(json.dumps(cn['tokens'][cstart:c],separators=(',',':')).encode())})
        if c < len(cn['tokens']):
            expanded.append((c,j))
        previous_cn, previous_jp = c,j
    assert len({c for c,_ in expanded}) == len(expanded) == len({j for _,j in expanded})
    assert all(cn['tokens'][c] == jp['tokens'][j] for c,j in expanded)
    return expanded, [proof for _,_,proof in accepted], intervals


def product_shared_branch_bridge(identity, cn, jp, ce, je, adapter):
    """A later native JP revision proves shared product material, never replaces base JP.

    The added CN menu changes case values. Byte-guarded semantic case labels
    establish scope; complete equal native instruction intervals bind CN to
    the installed N10 revision. Only identical, unique Japanese wording from
    that revision may bridge back to the original N3 Japanese variant.
    """
    if identity != 'narcissu-3rd/product':
        return [], None
    assert cn['plainSha256'] == 'b1f73937c259b1d2d073efa20ff8d11aab63637358c34df3b610ddf288c25e24'
    assert jp['plainSha256'] == '2080f3ae48d6c4e4cf365aef05df76001ea1e72f04a658a4d5176483243203d6'
    story = next(s for s in adapter['stories'] if s['canonicalStoryId'] == 'narcissu-one-two/product')
    variant = next(v for v in story['variants'] if v['id'] == story['preferredVariantId'])
    plain = (RESOURCE / variant['references']['plainObject']).read_bytes()
    assert sha(plain) == 'd1251433eada2fb581c57bedbdfec7a6533f56f273026e5a4d1ec5126ebaccca'
    script_bytes = (RESOURCE / variant['references']['script']).read_bytes()
    script = json.loads(script_bytes)
    real = [i for i in inspection.native.parse_mjo_instructions(plain) if i.opcode != 0x83a]
    where = {i.codeOffset:at for at,i in enumerate(real)}
    reference_events = []
    # This guarded object has plain narration messages only. Reconstruct each
    # source segment plus its final proc, checking every byte and intervening
    # newline. No name/ruby/branch inference is admitted for this reference.
    for message in script['textEvents']:
        start = where[message['segments'][0]['codeOffset']]
        last = where[message['segments'][-1]['codeOffset']]
        end = last + 1
        while end < len(real) and real[end].opcode == 0x841:
            end += 1
        selected = real[start:end]
        for instruction in selected:
            assert instruction.opcode in (0x840,0x841,0x842)
            if instruction.opcode == 0x842:
                assert plain[instruction.fileOffset:instruction.fileOffset+instruction.length].hex() == '420802006e00'
        assert [i.codeOffset for i in selected if i.opcode == 0x840] == [s['codeOffset'] for s in message['segments']]
        for segment in message['segments']:
            instruction = real[where[segment['codeOffset']]]
            assert plain[instruction.fileOffset+4:instruction.fileOffset+instruction.length-1].hex() == segment['rawHex']
        reference_events.append({'eventId':f"mjo-{message['codeOffset']:x}",'kind':'line',
            'referenceMessage':message,
            'source':{'nativeUnit':{'codeOffset':selected[0].codeOffset,
                'endCodeOffset':selected[-1].codeOffset+selected[-1].length,
                'codeOffsets':[i.codeOffset for i in selected]}}})
    assert len(reference_events) == 204
    ref = native_display_tokens(variant,reference_events)
    selection = {lang:source['selections'][0]['event']['source']['nativeSelection']
                 for lang,source in (('cn',cn),('jp',jp))}
    assert [(o['caseValue'],o['text'].strip()) for o in selection['cn']['options']] == [
        (1,'汉化后记（果断先看这个吧）'),(2,'关于水仙３'),(3,'其他'),
        (4,'１９９３（可能会影响到你的心情）'),(5,'再见')]
    assert [(o['caseValue'],o['text']) for o in selection['jp']['options']] == [(1,'ナルキ３について'),(2,'その他'),(3,'さよなな')]
    def token_at(source,offset):
        return source['offsetToToken'][min(o for o in source['offsetToToken'] if o >= offset)]
    def case_range(source,lang,value):
        edge = next(e for e in selection[lang]['caseEdges'] if e['caseValue'] == value)
        return [token_at(source,edge['armCodeOffset']),token_at(source,edge['nextCaseCodeOffset'])]
    ranges = [
        {'name':'introduction','cn':[cn['messages'][0]['tokenIndex'],cn['offsetToToken'][399]],
            'jp':[jp['messages'][0]['tokenIndex'],jp['offsetToToken'][453]],
            'ref':[ref['messages'][0]['tokenIndex'],ref['offsetToToken'][514]]},
        {'name':'about-narcissu-3','cn':case_range(cn,'cn',2),'jp':case_range(jp,'jp',1),
            'ref':[token_at(ref,640),token_at(ref,2934)],'cnCase':2,'jpCase':1,'referenceCase':1},
        {'name':'other','cn':case_range(cn,'cn',3),'jp':case_range(jp,'jp',2),
            'ref':[token_at(ref,2954),token_at(ref,3866)],'cnCase':3,'jpCase':2,'referenceCase':2},
    ]
    # Validate the reference's original case dispatch directly, including the
    # integer operand, bne.case and start of the corresponding branch.
    for value,condition in ((1,630),(2,2944)):
        at = where[condition]
        assert real[at].opcode == 0x831 and real[at-1].opcode == 0x800
        assert struct.unpack_from('<i',plain,real[at-1].fileOffset+2)[0] == value
    assert next(i for i in real if i.codeOffset == 602).opcode == 0x80f
    assert plain[real[where[602]].fileOffset:real[where[602]].fileOffset+12].hex() == '0f08e8c27928000000000400'
    bodies = {lang:{e['eventId']:e for e in events if e['kind']=='line'}
              for lang,events in (('cn',ce),('jp',je),('ref',reference_events))}
    def text_of(lang,event):
        e=bodies[lang][event]
        return e['referenceMessage']['text'] if lang=='ref' else ''.join(p['text'] for p in e['source']['nativeUnit']['textParts'])
    norm = lambda text:''.join(text.split())
    pairs,proofs = [],[]
    cn_reference_tokens=list(cn['tokens'])
    # The N10 reference uses its own native library version. Where the asset
    # bytes already agree, require their original bytes instead of applying
    # the N3-only presentation contract to that independent reference.
    for operand in cn.get('presentationOperands',[]):
        if operand['contract']=='native-a4eb1e4c-background-asset':
            cn_reference_tokens[operand['tokenIndex']]=operand['rawHex']
    menu_targets={'cn':399,'jp':453,'ref':514}
    exit_targets={'cn':17855,'jp':3706,'ref':20752}
    for scope in ranges:
        ca,cz=scope['cn'];ra,rz=scope['ref'];ja,jz=scope['jp']
        assert cn_reference_tokens[ca:cz] == ref['tokens'][ra:rz], 'Product revision native interval changed'
        edges={}
        for lang,source in (('cn',cn),('jp',jp),('ref',ref)):
            lo,hi=scope[lang]
            scoped=[e for e in source['branches'] if lo<=e['sourceToken']<hi]
            assert all(e['supported'] and e['opcode']==0x82c and e['targetCodeOffset'] in
                (menu_targets[lang],exit_targets[lang]) for e in scoped)
            edges[lang]=[{**e,'targetRole':'menu' if e['targetCodeOffset']==menu_targets[lang] else 'exit'} for e in scoped]
        assert [e['targetRole'] for e in edges['cn']] == [e['targetRole'] for e in edges['ref']]
        cm={m['tokenIndex']-ca:m['eventId'] for m in cn['messages'] if ca<=m['tokenIndex']<cz}
        rm={m['tokenIndex']-ra:m['eventId'] for m in ref['messages'] if ra<=m['tokenIndex']<rz}
        assert cm.keys()==rm.keys()
        jids=[m['eventId'] for m in jp['messages'] if ja<=m['tokenIndex']<jz]
        rc=Counter(norm(text_of('ref',event)) for event in rm.values())
        jc=Counter(norm(text_of('jp',event)) for event in jids)
        ref_by_text={norm(text_of('ref',event)):(cm[offset],event) for offset,event in rm.items()}
        records=[]
        for event in jids:
            text=text_of('jp',event);key=norm(text)
            if rc[key]!=1 or jc[key]!=1 or sum(char.isalnum() for char in key)<8:
                continue
            chinese,reference=ref_by_text[key]
            record={'cnEventId':chinese,'jpEventId':event,
                'referenceEventId':reference,'method':'identical-Japanese-text-through-branch-checked-N10-native-revision',
                'normalization':'whitespace-only','jpText':text,'referenceText':text_of('ref',reference),
                'jpTextSha256':sha(text.encode()),'referenceTextSha256':sha(text_of('ref',reference).encode()),
                'cnNativeUnit':bodies['cn'][chinese]['source']['nativeUnit'],
                'jpNativeUnit':bodies['jp'][event]['source']['nativeUnit'],
                'referenceRawMessage':bodies['ref'][reference]['referenceMessage']}
            records.append(record);pairs.append({'cnEventId':chinese,'jpEventId':event})
        proofs.append({'scope':scope,'controlEdges':edges,
            'exactCNReferenceTokenSha256':sha(json.dumps(cn_reference_tokens[ca:cz],separators=(',',':')).encode()),
            'pairs':records})
    corder={e:i for i,e in enumerate(bodies['cn'])};jorder={e:i for i,e in enumerate(bodies['jp'])}
    pairs.sort(key=lambda p:corder[p['cnEventId']])
    assert len({p['cnEventId'] for p in pairs}) == len(pairs) == len({p['jpEventId'] for p in pairs})
    assert all(jorder[a['jpEventId']]<jorder[z['jpEventId']] for a,z in zip(pairs,pairs[1:]))
    return pairs,{'method':'original-menu-cases-and-installed-native-revision-reference',
        'referenceVariantId':variant['id'],'referenceScriptPath':variant['references']['script'],
        'referencePlainSha256':sha(plain),'referenceScriptSha256':sha(script_bytes),
        'referenceIsNotPublishedAsN3Japanese':True,'scopes':proofs,
        'preservedCNOnlyCaseValues':[1,4],'originalJapaneseVariantIsPreserved':True}


def generate(output_root, public=None):
    public = public or ROOT / 'apps/classic-reader/public'
    adapter_path = public / 'data/legacy-vn/manifests/reader-adapter.json'
    if not adapter_path.is_file():
        adapter_path = RESOURCE / 'manifests/generated/reader-adapter.json'
    adapter_bytes = adapter_path.read_bytes()
    adapter = json.loads(adapter_bytes)
    by_story = {s.get('readerIdentity', s['canonicalStoryId']): s for s in adapter['stories']}
    translation_bridges = exact_n10_translation_bridges(adapter)
    entries = json.loads((public / 'story_index.json').read_bytes())
    summary = []
    for entry in entries:
        if entry.get('source_format') == 'supplemental-text/v1':
            # Supplied Chinese documents have no Majiro/IKURA event stream.
            # Their paragraph/source hashes are audited by the text importer;
            # do not invent Japanese variants or native correspondence files.
            assert entry.get('path_cn') and not entry.get('path_jp'), entry['source_identity']
            continue
        identity = entry['source_identity']
        route_relative = 'data/legacy-vn/' + identity + '.routes.json'
        route_bytes = (public / route_relative).read_bytes()
        route = json.loads(route_bytes)
        # A single-language release and a shared bilingual source both use
        # native event identity directly; neither needs a cross-version sidecar.
        if not route.get('chineseVariantId') or not route.get('japaneseVariantId') or route['chineseVariantId'] == route['japaneseVariantId']:
            continue
        variants = {v['id']: v for v in by_story[identity]['variants']}
        cn_variant, jp_variant = variants[route['chineseVariantId']], variants[route['japaneseVariantId']]
        assert cn_variant['references']['baseStringReference'] == jp_variant['references']['source']
        routes = {v['variantId']: v for v in route['variantRoutes']}
        def events(variant):
            return [e for section in variant['sections'] for e in section['events']]
        ce, je = events(routes[route['chineseVariantId']]), events(routes[route['japaneseVariantId']])
        cn, jp = native_display_tokens(cn_variant,ce), native_display_tokens(jp_variant,je)
        pairs, method, intervals, visual_equivalence = display_instruction_pairs(cn, jp)
        if identity == 'narcissu-3rd/product':
            # Added menu cases invalidate global dispatch ordinals. Shared
            # content uses the independent, byte-guarded case proof below.
            pairs, method = [], 'revised-native-menu-requires-independent-case-proof'
        pairs, bridge_proofs, bridge_intervals = bridge_native_intervals(identity, cn, jp, ce, je, pairs, translation_bridges)
        if bridge_proofs:
            method += '-with-exact-N10-native-translation-bridge'
        pairs, relocation_proof = relocated_native_block_projection(identity, cn, jp, ce, je, pairs)
        if relocation_proof:
            method += '-with-proved-native-block-relocation'
        branch_failures = branch_mapping_failures(cn,jp,pairs) if cn.get('nativeDisplayUnitCount') else []
        if branch_failures:
            pairs = []
            method += '-rejected-unproved-control-edge'
        elif cn.get('nativeDisplayUnitCount'):
            method = 'native-display-units-and-resolved-control-graph/' + method
        token_pairs = dict(pairs)
        jp_messages = {m['tokenIndex']: m for m in jp['messages']}
        message_pairs = {m['codeOffset']: jp_messages[token_pairs[m['tokenIndex']]]['codeOffset']
                         for m in cn['messages'] if m['tokenIndex'] in token_pairs}
        cb, jb = {e['eventId']: e for e in ce if e['kind'] == 'line'}, {e['eventId']: e for e in je if e['kind'] == 'line'}
        body_pairs = [{'cnEventId': f'mjo-{c:x}', 'jpEventId': f'mjo-{j:x}'} for c, j in message_pairs.items()
                      if f'mjo-{c:x}' in cb and f'mjo-{j:x}' in jb]
        # Aliases are the SAME mapped native instruction + asset, not a URL set.
        def cues(event_list, source):
            return [(source['offsetToToken'].get(cue.get('raw', {}).get('codeOffset')), event['eventId'], cue)
                    for event in event_list for cue in event.get('cues', []) if cue['kind'] == 'voice']
        jc = {}
        for token, event, cue in cues(je, jp):
            jc.setdefault(token, []).append((event, cue))
        aliases = []
        for token, event, cue in cues(ce, cn):
            if token is None or token not in token_pairs:
                continue
            candidates = jc.get(token_pairs[token], [])
            if len(candidates) != 1:
                continue
            other_event, other = candidates[0]
            if cue['mediaId'] == other['mediaId']:
                aliases.append({'cnCueId': cue['cueId'], 'jpCueId': other['cueId'], 'cnEventId': event,
                                'jpEventId': other_event, 'mediaId': cue['mediaId'], 'occurrenceId': f'{identity}:instruction:{token}'})
        voice_pairs, voice_rejections = voice_bound_body_pairs(cn, jp, ce, je, token_pairs, body_pairs, aliases)
        if voice_pairs:
            order = {event: i for i, event in enumerate(cb)}
            body_pairs.extend({k: pair[k] for k in ('cnEventId', 'jpEventId')} for pair in voice_pairs)
            body_pairs.sort(key=lambda pair: order[pair['cnEventId']])
        # Promote only the user-reported, independently audited chapter in this
        # bounded batch. Other stories are not silently reclassified by this rule.
        whole_body_proof, whole_added = None, 0
        if not cn.get('nativeDisplayUnitCount') and identity == 'narcissu-3rd/nar2_12':
            whole_body_proof = blank_speaker_whole_stream(cn, jp, ce, je)
            if whole_body_proof:
                proposed = [{k: p[k] for k in ('cnEventId', 'jpEventId')} for p in whole_body_proof['bodyPairs']]
                assert all(p in proposed for p in body_pairs), 'Whole proof conflicts with retained pairs'
                whole_added = len(proposed) - len(body_pairs)
                body_pairs = proposed
        revision_pairs, revision_proof = product_shared_branch_bridge(identity, cn, jp, ce, je, adapter)
        if revision_proof:
            assert not body_pairs, 'Revised product cases must not inherit global ordinal pairs'
            body_pairs = revision_pairs
            method += '-with-native-revision-and-identical-Japanese-text-bridge'
        group_bridge = build_native_group_translation_bridges(identity, ce, je, body_pairs, translation_bridges)
        group_pairs = group_bridge['groupPairs']
        body_pairs, reviewed_passages, review_proof, quarantine_proof, pending_reviews = apply_source_bound_review_overrides(
            identity, cn, jp, ce, je, body_pairs, group_pairs)
        choice_pairs = native_choice_pairs(cn, jp, token_pairs, body_pairs)
        unpaired_choices = {lang: [e['eventId'] for e in events if e['kind'] == 'choice' and e['eventId'] not in {p[lang + 'EventId'] for p in choice_pairs}] for lang, events in (('cn', ce), ('jp', je))}
        covered = {lang: {p[lang+'EventId'] for p in body_pairs} | {event for g in group_pairs for event in g[lang+'EventIds']} | {event for g in reviewed_passages for event in g[lang+'EventIds']} for lang in ('cn','jp')}
        unpaired = {lang: sorted(set(bodies) - covered[lang]) for lang,bodies in (('cn',cb),('jp',jb))}
        record = {'schema': 'native-story-correspondence/v1', 'storyId': identity,
                  'cnVariantId': route['chineseVariantId'], 'jpVariantId': route['japaneseVariantId'],
                  'hashes': {'route': sha(route_bytes), 'cnText': sha((public / entry['path_cn'].lstrip('/')).read_bytes()),
                             'jpText': sha((public / entry['path_jp'].lstrip('/')).read_bytes())},
                  'proof': {'method': method, 'adapterSha256': sha(adapter_bytes), 'parserSha256': sha(inspection.PARSER.read_bytes()),
                            'cnPlainSha256': cn['plainSha256'], 'jpPlainSha256': jp['plainSha256'],
                            'cnScriptSha256': cn['scriptSha256'], 'jpScriptSha256': jp['scriptSha256'],
                            'initialUnresolvedIntervals': intervals, 'branchMappingFailures': branch_failures,
                            'instructionAnchorPolicy': {'fourInstructionUniqueNativeWindows': True,
                                'crossedAnchorsRejected': True, 'onlyIdenticalBoundedIntervalsExpanded': True},
                            'presentationOperands': {'cn': cn.get('presentationOperands', []), 'jp': jp.get('presentationOperands', [])},
                            'nativeDisplayUnits': {'cn': cn.get('nativeDisplayUnitCount'), 'jp': jp.get('nativeDisplayUnitCount')}},
                  'pairs': body_pairs, 'groupPairs': group_pairs, 'reviewedPassages': reviewed_passages, 'choicePairs': choice_pairs, 'unpairedChoices': unpaired_choices, 'cueAliases': aliases, 'unpaired': unpaired,
                  'semanticTextAdditions': [], 'semanticTextDeletions': [],
                  'unpairedClassification': 'unverified-correspondence-or-speaker-body-grouping; not presumed missing translation'}
        if any(p['contract'] == 'native-8e803141-voice-channel-label' for side in ('cn','jp')
               for p in record['proof']['presentationOperands'][side]):
            record['proof']['voiceChannelHelperContract'] = n3_voice_helper_contract()
        if visual_equivalence:
            record['proof']['visualOperandEquivalence']=visual_equivalence
        if any(p['contract']=='native-a4eb1e4c-background-asset' for side in ('cn','jp') for p in record['proof']['presentationOperands'][side]):
            record['proof']['backgroundHelperContract']=n3_background_helper_contract()
        if revision_proof:
            record['proof']['nativeRevisionBranchBridge'] = revision_proof
        if relocation_proof:
            record['proof']['nativeBlockRelocation'] = relocation_proof
        record['proof']['nativeGroupBridgeCounts'] = group_bridge['counts']
        if review_proof:
            record['proof']['sourceBoundBilingualReview'] = review_proof
        if quarantine_proof:
            record['proof']['sourceBoundPairQuarantine'] = quarantine_proof
            record['pendingReviewPassages'] = pending_reviews
        record['proof']['nativeGroupBridgeRejections'] = group_bridge['rejections']
        if bridge_proofs:
            record['proof']['exactN10TranslationBridges'] = bridge_proofs
            record['proof']['bridgeBoundNativeIntervals'] = bridge_intervals
        if voice_pairs:
            record['proof']['voiceBoundMessagePairs'] = voice_pairs
        if whole_body_proof:
            record['proof']['blankSpeakerWholeStream'] = whole_body_proof
        output = output_root / 'data/legacy-vn' / (identity + '.alignment.json')
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
        summary.append({'storyId': identity, 'method': method, 'sourceBodies': {'cn': len(cb), 'jp': len(jb)},
                        'pairedBodies': len(body_pairs), 'pairedNativeEvents': {k:len(v) for k,v in covered.items()},
                        'groupPairs': len(group_pairs), 'groupBridgeCounts': group_bridge['counts'],
                        'reviewedPassages': len(reviewed_passages),
                        'reviewedNativeEvents': {lang: sum(len(p[lang+'EventIds']) for p in reviewed_passages) for lang in ('cn','jp')},
                        'unpairedBodies': {k: len(v) for k, v in unpaired.items()},
                        'cueAliases': len(aliases), 'fullyPaired': not any(unpaired.values()) and not any(unpaired_choices.values()),
                        'pairedChoiceEvents': len(choice_pairs), 'unpairedChoices': {k:len(v) for k,v in unpaired_choices.items()},
                        'voiceBoundPairs': len(voice_pairs), 'voiceBoundRejections': voice_rejections,
                        'exactN10TranslationBridgePairs': len(bridge_proofs),
                        'nativeRevisionBranchBridgePairs': len(revision_pairs),
                        'relocatedSourceBodies': {k: len(relocation_proof['relocatedBlocks'][k]['eventIds']) if relocation_proof else 0 for k in ('cn', 'jp')},
                        'wholeBodyBlankSpeakerPairsAdded': whole_added})
    report = {'schema': 1, 'stories': summary, 'counts': {'stories': len(summary), 'fullyPairedStories': sum(s['fullyPaired'] for s in summary),
              'pairedBodies': sum(s['pairedBodies'] for s in summary),
              'groupPairs': sum(s['groupPairs'] for s in summary),
              'reviewedPassages': sum(s['reviewedPassages'] for s in summary),
              'reviewedNativeEvents': {k:sum(s['reviewedNativeEvents'][k] for s in summary) for k in ('cn','jp')},
              'pairedNativeEvents': {k:sum(s['pairedNativeEvents'][k] for s in summary) for k in ('cn','jp')},
              'unpairedBodies': {k: sum(s['unpairedBodies'][k] for s in summary) for k in ('cn', 'jp')},
              'cueAliases': sum(s['cueAliases'] for s in summary), 'voiceBoundPairs': sum(s['voiceBoundPairs'] for s in summary),
              'wholeBodyBlankSpeakerPairsAdded': sum(s['wholeBodyBlankSpeakerPairsAdded'] for s in summary),
              'exactN10TranslationBridgePairs': sum(s['exactN10TranslationBridgePairs'] for s in summary),
              'nativeRevisionBranchBridgePairs': sum(s['nativeRevisionBranchBridgePairs'] for s in summary),
              'confirmedSemanticAdditions': 0, 'confirmedSemanticDeletions': 0}}
    return report


if __name__ == '__main__':
    arguments = argparse.ArgumentParser()
    arguments.add_argument('--public', type=Path)
    arguments.add_argument('--output', type=Path, required=True)
    arguments.add_argument('--report', type=Path, required=True)
    args = arguments.parse_args()
    output, report_path = args.output.resolve(), args.report.resolve()
    assert output.is_relative_to(ROOT) and report_path.is_relative_to(ROOT), 'Outputs stay in the generic project'
    public = args.public.resolve() if args.public else None
    assert public is None or public.is_relative_to(ROOT), 'Candidate input stays in the generic project'
    report = generate(output, public)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report['counts']))
