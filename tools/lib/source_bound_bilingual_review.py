"""Validate frozen bilingual review evidence without inventing native proofs.

A reviewed correspondence is separate from exact instruction equivalence.
There is deliberately no text similarity, positional zip, or offset matching.
Inputs, all gap events, both native fences, and every explicit event list must
match before any review is made available to the read-only display projection.
"""
from __future__ import annotations
from pathlib import Path
from functools import lru_cache
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'tools/data/narcissu3-bilingual-review.json'
STORY_EVIDENCE = {'narcissu-3rd/nard01': ROOT / 'tools/data/nard01-bilingual-review.json'}
SCHEMA = 'source-bound-bilingual-review/v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()


@lru_cache(maxsize=None)
def load_evidence(story_id=None):
    raw = STORY_EVIDENCE.get(story_id, EVIDENCE).read_bytes()
    value = json.loads(raw)
    assert value.get('schema') == SCHEMA and value.get('reviewer') == 'AI' and value.get('humanVerified') is False, 'Review origin is not explicit'
    identities = [story['storyId'] for story in value['stories']]
    assert len(set(identities)) == len(identities), 'Duplicate reviewed story'
    if story_id in STORY_EVIDENCE:
        assert identities == [story_id], 'Story-specific evidence has a different scope'
    return value, hashlib.sha256(raw).hexdigest()


def apply_source_bound_reviews(story_id, cn, jp, ce, je, pairs, group_pairs, *, evidence=None):
    if evidence is None:
        evidence, evidence_sha = load_evidence(story_id)
    else:
        evidence_sha = digest(evidence)
    assert evidence.get('schema') == SCHEMA and evidence.get('reviewer') == 'AI' and evidence.get('humanVerified') is False
    selected = [story for story in evidence['stories'] if story['storyId'] == story_id]
    assert len(selected) <= 1, 'Duplicate reviewed story'
    if not selected:
        return [], None
    review = selected[0]
    actual_hashes = {lang+name: source[name[0].lower()+name[1:]]
                     for lang, source in (('cn', cn), ('jp', jp))
                     for name in ('PlainSha256', 'ScriptSha256')}
    assert review['sourceHashes'] == actual_hashes, f'Reviewed source bytes changed: {story_id}'
    events = {'cn': ce, 'jp': je}
    bodies = {lang: [e for e in stream if e['kind'] == 'line'] for lang, stream in events.items()}
    by_id = {lang: {e['eventId']: e for e in stream} for lang, stream in events.items()}
    positions = {lang: {e['eventId']: i for i, e in enumerate(stream)} for lang, stream in bodies.items()}
    complete_positions = {lang: {e['eventId']: i for i, e in enumerate(stream)} for lang, stream in events.items()}
    pair_set = {(p['cnEventId'], p['jpEventId']) for p in pairs}
    groups = {(tuple(p['cnEventIds']), tuple(p['jpEventIds'])) for p in group_pairs}
    native_covered = {lang: {p[lang+'EventId'] for p in pairs} | {i for g in group_pairs for i in g[lang+'EventIds']} for lang in ('cn', 'jp')}
    used = {'cn': set(), 'jp': set()}
    passage_ids = set()
    output = []

    def boundary(anchor, lang, side):
        if anchor is None:
            assert side == 'before', 'Null ending fence'
            return -1
        if anchor['type'] == 'end':
            assert side == 'after', 'End cannot be a starting fence'
            return len(bodies[lang])
        if anchor['type'] == 'proved-native-pair':
            assert (anchor['cnEventId'], anchor['jpEventId']) in pair_set, 'Review fence lost its native proof'
            return positions[lang][anchor[lang+'EventId']]
        assert anchor['type'] == 'proved-native-group', 'Unknown review fence'
        assert (tuple(anchor['cnEventIds']), tuple(anchor['jpEventIds'])) in groups, 'Review group fence lost its native proof'
        ids = anchor[lang+'EventIds']
        return positions[lang][ids[-1] if side == 'before' else ids[0]]

    for block in review['blocks']:
        ranges = {}
        assert isinstance(block['note'], str) and len(block['note']) > 8, 'Review context is missing'
        for lang in ('cn', 'jp'):
            lo, hi = boundary(block['before'], lang, 'before'), boundary(block['after'], lang, 'after')
            assert lo < hi, 'Reversed native fences'
            ranges[lang] = (lo, hi)
            expected = [e['eventId'] for e in bodies[lang][lo+1:hi] if e['eventId'] not in native_covered[lang]]
            records = block['source'][lang]
            assert expected == [r['eventId'] for r in records], f'Review gap contents changed: {story_id}/{block["id"]}/{lang}'
            for record in records:
                event = by_id[lang][record['eventId']]
                assert event['source']['variantSourceId'] == review[lang+'VariantId'], 'Reviewed source variant mismatch'
                assert digest(event) == record['routeEventSha256'], f'Reviewed event changed: {story_id}/{record["eventId"]}'
        for passage in block['passages']:
            assert re.fullmatch(r'review-[a-zA-Z0-9_-]+', passage['id']) and passage['id'] not in passage_ids, 'Duplicate or invalid passage ID'
            passage_ids.add(passage['id'])
            item = {'id': passage['id'], 'schema': SCHEMA, 'reviewer': 'AI', 'humanVerified': False,
                    'translationQualityVerified': False, 'note': block['note'],
                    'evidenceSha256': evidence_sha, 'contextId': block['id']}
            for lang in ('cn', 'jp'):
                ids = passage[lang+'EventIds']
                assert 0 < len(ids) <= 12 and len(set(ids)) == len(ids), 'Invalid reviewed passage size'
                assert all(i in positions[lang] and i not in used[lang] and i not in native_covered[lang] for i in ids), 'Unknown, duplicate or already native-paired review event'
                indexes = [positions[lang][i] for i in ids]
                assert indexes == list(range(indexes[0], indexes[0] + len(ids))), 'Review passage skips or reorders body events'
                lo, hi = ranges[lang]
                assert lo < indexes[0] <= indexes[-1] < hi, 'Review leaves its native fences'
                # N:M display may not bridge a choice, jump, scene or other
                # non-body event just because its surrounding text is similar.
                all_indexes = [complete_positions[lang][i] for i in ids]
                assert all_indexes == list(range(all_indexes[0], all_indexes[0] + len(ids))), 'Review passage crosses a non-body control event'
                for first, following in zip(ids, ids[1:]):
                    assert by_id[lang][first].get('nextEventId') == following, 'Review passage crosses a non-linear native edge'
                if len(passage['cnEventIds']) > 1 or len(passage['jpEventIds']) > 1:
                    locale = 'zh-CN' if lang == 'cn' else 'ja-JP'
                    for event_id in ids:
                        group = by_id[lang][event_id].get('source', {}).get('presentationGroup')
                        if group:
                            assert set(group['visibleEventIdsByLocale'][locale]).issubset(ids), 'Review passage truncates an original native append buffer'
                used[lang].update(ids)
                item[lang+'EventIds'] = list(ids)
            output.append(item)
    # A source review cannot move or replace even one existing native anchor.
    all_blocks = [([p['cnEventId']], [p['jpEventId']]) for p in pairs
                  if not any(p['cnEventId'] in g['cnEventIds'] and p['jpEventId'] in g['jpEventIds'] for g in group_pairs)]
    all_blocks += [(p['cnEventIds'], p['jpEventIds']) for p in group_pairs]
    all_blocks += [(p['cnEventIds'], p['jpEventIds']) for p in output]
    all_blocks.sort(key=lambda block: positions['cn'][block[0][0]])
    previous = {'cn': -1, 'jp': -1}
    for left, right in all_blocks:
        for lang, ids in (('cn', left), ('jp', right)):
            start, end = positions[lang][ids[0]], positions[lang][ids[-1]]
            assert start > previous[lang], f'Review crosses an existing native correspondence: {story_id}/{lang}/{ids[0]}'
            previous[lang] = end
    return output, {'schema': SCHEMA, 'evidenceSha256': evidence_sha,
                    'reviewer': 'AI', 'humanVerified': False, 'translationQualityVerified': False,
                    'sourceHashes': actual_hashes, 'boundedGaps': len(review['blocks']),
                    'passages': len(output), 'events': {k: len(v) for k, v in used.items()},
                    'nativePairsUnmodified': True, 'rawTextControlAndCueEventsUnmodified': True}


def apply_source_bound_review_overrides(story_id, cn, jp, ce, je, pairs, group_pairs, *, evidence=None):
    """Quarantine only frozen pairs, then use the unchanged review protections.

    An original pair can leave display solely to close a real append buffer.
    Such a pair remains source evidence, not a new reviewed constraint. Pending
    passages never enter native coverage or the reviewed display projection.
    """
    frozen, evidence_sha = load_evidence(story_id) if evidence is None else (evidence, digest(evidence))
    assert frozen.get('schema') == SCHEMA and frozen.get('reviewer') == 'AI' and frozen.get('humanVerified') is False
    selected = [s for s in frozen['stories'] if s['storyId'] == story_id]
    assert len(selected) <= 1, 'Duplicate reviewed story'
    review = selected[0] if selected else None
    quarantine = review.get('nativePairRetractions') if review else None
    if not quarantine:
        output, proof = apply_source_bound_reviews(story_id, cn, jp, ce, je, pairs, group_pairs, evidence=evidence)
        return pairs, output, proof, None, []

    # This is an exact, independently frozen correction, not a general option
    # to ignore existing anchors or rematch a story by text/position.
    assert story_id in STORY_EVIDENCE, 'Native pair overrides require an exact scoped evidence file'
    assert quarantine['schema'] == 'source-bound-native-pair-retraction/v1'
    actual_hashes = {lang+name: source[name[0].lower()+name[1:]]
                     for lang, source in (('cn', cn), ('jp', jp))
                     for name in ('PlainSha256', 'ScriptSha256')}
    assert review['sourceHashes'] == actual_hashes, 'Quarantined source bytes changed'
    assert digest(pairs) == quarantine['expectedPairsSha256'], 'Native pair baseline changed'
    blocks = [b for b in review['blocks'] if b['id'] == quarantine['contextId']]
    assert len(review['blocks']) == len(blocks) == 1, 'Quarantine must have one exact context'
    block = blocks[0]
    retracted, closures = quarantine['pairs'], quarantine['bufferClosurePairs']
    assert len(retracted) == 6 and len(closures) == 1, 'Quarantine scope changed'
    original = {(p['cnEventId'], p['jpEventId']) for p in pairs}
    removed = {(p['cnEventId'], p['jpEventId']) for p in retracted + closures}
    assert len(original) == len(pairs) and len(removed) == len(retracted) + len(closures), 'Duplicate quarantine pair'
    assert removed <= original, 'Quarantine pair is not an original pair'
    events = {'cn': ce, 'jp': je}
    by_id = {lang: {e['eventId']: e for e in stream} for lang, stream in events.items()}
    pending_specs = block['pendingPassages']
    assert len(pending_specs) == 1, 'Pending source scope changed'
    for anchor in (block['before'], block['after']):
        assert anchor['type'] == 'proved-native-pair', 'Quarantine requires retained native pair fences'
        key = (anchor['cnEventId'], anchor['jpEventId'])
        assert key in original and key not in removed, 'Quarantine fence lost its native pair'
    for lang, stream in events.items():
        positions = {e['eventId']: i for i, e in enumerate(stream)}
        source_ids = [r['eventId'] for r in block['source'][lang]]
        removed_ids = [p[lang+'EventId'] for p in retracted + closures]
        assert source_ids == removed_ids and len(set(source_ids)) == len(source_ids), 'Quarantine source membership changed'
        lo, hi = (positions[block[side][lang+'EventId']] for side in ('before', 'after'))
        bounded = stream[lo+1:hi]
        assert lo < hi and [e['eventId'] for e in bounded] == source_ids, 'Quarantine crosses its exact native interval'
        assert all(e['kind'] == 'line' for e in bounded), 'Quarantine crosses non-body control'
        assert all(a.get('nextEventId') == b['eventId'] for a, b in zip(bounded, bounded[1:])), 'Quarantine crosses a non-linear edge'
        assert not any(set(g[lang+'EventIds']) & set(source_ids) for g in group_pairs), 'Quarantine touches an existing native group pair'
        for record in retracted + closures:
            event = by_id[lang][record[lang+'EventId']]
            assert event['source']['variantSourceId'] == review[lang+'VariantId'], 'Quarantined source variant changed'
            assert digest(event) == record[lang+'RouteEventSha256'], 'Quarantined original event changed'
        context = block['contextSource'][lang]
        assert [r['eventId'] for r in context] == [block[a][lang+'EventId'] for a in ('before', 'after')], 'Quarantine context fence changed'
        for record in context:
            assert digest(by_id[lang][record['eventId']]) == record['routeEventSha256'], 'Quarantine fence event changed'
        pending_ids = [i for p in pending_specs for i in p[lang+'EventIds']]
        for anchor in closures:
            event = by_id[lang][anchor[lang+'EventId']]
            group = event['source'].get('presentationGroup')
            assert group and group['displayJoinMode'] == 'native-append', 'Closure pair is not required by an original append buffer'
            members = group['visibleEventIdsByLocale']['zh-CN' if lang == 'cn' else 'ja-JP']
            assert set(members) <= set(pending_ids), 'Pending source truncates an original append buffer'
            assert set(members) & {p[lang+'EventId'] for p in retracted}, 'Closure does not touch a retracted buffer member'
            assert anchor[lang+'EventId'] in pending_ids, 'Closure pair must stay unreviewed'

    retained = [dict(p) for p in pairs if (p['cnEventId'], p['jpEventId']) not in removed]
    assert digest(retained) == quarantine['expectedRetainedPairsSha256'], 'Retained native pairs changed'
    output, proof = apply_source_bound_reviews(story_id, cn, jp, ce, je, retained, group_pairs, evidence=evidence)
    assert len(output) == 4, 'Only four frozen correspondences have been reviewed'
    pending = []
    for spec in pending_specs:
        assert re.fullmatch(r'pending-[a-zA-Z0-9_-]+', spec['id']), 'Invalid pending review identity'
        assert isinstance(spec['note'], str) and len(spec['note']) > 8, 'Pending review reason is missing'
        item = {'id': spec['id'], 'schema': 'source-bound-bilingual-review-pending/v1',
                'reviewer': 'AI', 'humanVerified': False, 'translationQualityVerified': False,
                'correspondenceVerified': False, 'contextId': block['id'], 'evidenceSha256': evidence_sha, 'note': spec['note']}
        for lang in ('cn', 'jp'):
            ids = spec[lang+'EventIds']
            assert 0 < len(ids) <= 12 and len(set(ids)) == len(ids), 'Invalid pending source list'
            indexes = [next((i for i, e in enumerate(events[lang]) if e['eventId'] == event_id), -1) for event_id in ids]
            assert indexes[0] >= 0 and indexes == list(range(indexes[0], indexes[0]+len(ids))), 'Pending source skips or crosses a control event'
            assert all(by_id[lang][a].get('nextEventId') == b for a, b in zip(ids, ids[1:])), 'Pending source crosses a non-linear edge'
            for event_id in ids:
                group = by_id[lang][event_id]['source'].get('presentationGroup')
                if group:
                    assert set(group['visibleEventIdsByLocale']['zh-CN' if lang == 'cn' else 'ja-JP']) <= set(ids), 'Pending source truncates an original append buffer'
            item[lang+'EventIds'] = list(ids)
        pending.append(item)
    for lang in ('cn', 'jp'):
        reviewed_ids = [i for p in output for i in p[lang+'EventIds']]
        pending_ids = [i for p in pending for i in p[lang+'EventIds']]
        source_ids = [r['eventId'] for r in block['source'][lang]]
        assert reviewed_ids + pending_ids == source_ids, 'Reviewed and pending source must partition the exact quarantine interval'
        assert len(set(reviewed_ids + pending_ids)) == len(source_ids), 'Reviewed and pending source overlap'
    proof = dict(proof, nativePairsUnmodified=False, retainedNativePairsUnmodified=True,
                 retractedNativePairs=len(retracted), bufferClosurePairs=len(closures),
                 pendingPassages=len(pending), pendingEvents={lang: sum(len(p[lang+'EventIds']) for p in pending) for lang in ('cn', 'jp')})
    quarantine_proof = {'schema': quarantine['schema'], 'evidenceSha256': evidence_sha,
                        'contextId': block['id'], 'sourceHashes': actual_hashes,
                        'before': block['before'], 'after': block['after'],
                        'expectedPairsSha256': quarantine['expectedPairsSha256'],
                        'expectedRetainedPairsSha256': quarantine['expectedRetainedPairsSha256'],
                        'retractedPairs': retracted, 'bufferClosurePairs': closures,
                        'bufferClosurePairsAreSourceEvidenceOnly': True,
                        'retainedNativePairsUnmodified': True, 'rawTextControlAndCueEventsUnmodified': True}
    return retained, output, proof, quarantine_proof, pending
