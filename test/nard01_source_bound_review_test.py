"""Exact nard01 pair quarantine; four reviews, never a fifth equivalence."""
from pathlib import Path
import copy
import hashlib
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/lib'))
from source_bound_bilingual_review import (
    apply_source_bound_reviews, apply_source_bound_review_overrides, digest, load_evidence,
)

PUBLIC = ROOT / 'apps/classic-reader/public/data/legacy-vn'
IDENTITY = 'narcissu-3rd/nard01'
FOUR = [
    (['mjo-37d', 'mjo-3d8'], ['mjo-3d7']),
    (['mjo-42f'], ['mjo-450']),
    (['mjo-4b7'], ['mjo-500']),
    (['mjo-520'], ['mjo-569']),
]
PENDING = {'cn': ['mjo-582', 'mjo-5fd'], 'jp': ['mjo-5e7', 'mjo-673', 'mjo-6df']}


def fixture(identity):
    route = json.loads((PUBLIC / (identity + '.routes.json')).read_bytes())
    alignment = json.loads((PUBLIC / (identity + '.alignment.json')).read_bytes())
    sources = {lang: {name: alignment['proof'][lang+name[0].upper()+name[1:]]
                     for name in ('plainSha256', 'scriptSha256')} for lang in ('cn', 'jp')}
    streams = {lang: [e for v in route['variantRoutes']
                      if v['variantId'] == route['chineseVariantId' if lang == 'cn' else 'japaneseVariantId']
                      for section in v['sections'] for e in section['events']] for lang in ('cn', 'jp')}
    pairs = copy.deepcopy(alignment['pairs'])
    # After installation reconstruct only explicitly recorded original pairs,
    # never guess their language partners from positions or similar text.
    quarantine = alignment['proof'].get('sourceBoundPairQuarantine')
    if quarantine:
        pairs += [{k: p[k] for k in ('cnEventId', 'jpEventId')}
                  for p in quarantine['retractedPairs'] + quarantine['bufferClosurePairs']]
        order = {e['eventId']: i for i, e in enumerate(streams['cn'])}
        pairs.sort(key=lambda p: order[p['cnEventId']])
    return [identity, sources['cn'], sources['jp'], streams['cn'], streams['jp'], pairs, alignment.get('groupPairs', [])]


class Nard01ReviewTests(unittest.TestCase):
    def setUp(self):
        self.args = fixture(IDENTITY)
        self.evidence = copy.deepcopy(load_evidence(IDENTITY)[0])

    @property
    def story(self):
        return self.evidence['stories'][0]

    @property
    def block(self):
        return self.story['blocks'][0]

    def invoke(self):
        return apply_source_bound_review_overrides(*self.args, evidence=self.evidence)

    def event(self, lang, identity):
        return next(e for e in self.args[3 if lang == 'cn' else 4] if e['eventId'] == identity)

    def test_four_reviews_and_independent_pending_source_preserve_input(self):
        before = copy.deepcopy((self.args, self.evidence))
        pairs, reviewed, proof, quarantine, pending = self.invoke()
        self.assertEqual((self.args, self.evidence), before)
        self.assertEqual(len(self.args[5]), 344)
        self.assertEqual(len(pairs), 337)
        self.assertEqual([(p['cnEventIds'], p['jpEventIds']) for p in reviewed], FOUR)
        self.assertEqual(len(pending), 1)
        self.assertEqual({lang: pending[0][lang+'EventIds'] for lang in ('cn', 'jp')}, PENDING)
        self.assertEqual(proof['events'], {'cn': 5, 'jp': 4})
        self.assertEqual(proof['pendingEvents'], {'cn': 2, 'jp': 3})
        self.assertEqual(proof['retractedNativePairs'], 6)
        self.assertEqual(proof['bufferClosurePairs'], 1)
        self.assertFalse(proof['nativePairsUnmodified'])
        self.assertTrue(proof['retainedNativePairsUnmodified'])
        self.assertTrue(quarantine['bufferClosurePairsAreSourceEvidenceOnly'])
        for passage in reviewed + pending:
            self.assertEqual(passage['reviewer'], 'AI')
            self.assertFalse(passage['humanVerified'])
            self.assertFalse(passage['translationQualityVerified'])
        self.assertFalse(pending[0]['correspondenceVerified'])
        for lang, stream in [('cn', self.args[3]), ('jp', self.args[4])]:
            covered = {p[lang+'EventId'] for p in pairs} | {i for p in reviewed for i in p[lang+'EventIds']}
            self.assertEqual([e['eventId'] for e in stream if e['kind'] == 'line' and e['eventId'] not in covered], PENDING[lang])
            self.assertEqual(len(covered) + len(PENDING[lang]), 344)

    def test_default_file_hash_is_not_canonical_json_digest(self):
        data, file_sha = load_evidence(IDENTITY)
        self.assertEqual(file_sha, hashlib.sha256((ROOT/'tools/data/nard01-bilingual-review.json').read_bytes()).hexdigest())
        self.assertNotEqual(file_sha, digest(data))
        result = apply_source_bound_review_overrides(*self.args)
        self.assertTrue(all(p['evidenceSha256'] == file_sha for p in result[1] + result[4]))

    def test_all_existing_342_reviews_remain_identical(self):
        old, sha = load_evidence()
        self.assertNotIn(IDENTITY, [s['storyId'] for s in old['stories']])
        count = 0
        for story in old['stories']:
            args = fixture(story['storyId']); before = copy.deepcopy(args)
            expected = apply_source_bound_reviews(*args)
            pairs, passages, proof, quarantine, pending = apply_source_bound_review_overrides(*args)
            self.assertEqual(args, before)
            self.assertEqual(pairs, args[5]); self.assertEqual((passages, proof), expected)
            self.assertIsNone(quarantine); self.assertEqual(pending, [])
            self.assertTrue(all(p['evidenceSha256'] == sha for p in passages))
            count += len(passages)
        self.assertEqual(count, 342)

    def test_direct_review_cannot_replace_native_pairs(self):
        with self.assertRaisesRegex(AssertionError, 'gap contents changed'):
            apply_source_bound_reviews(*self.args, evidence=self.evidence)

    def test_changed_baseline_is_rejected(self):
        self.args[5].pop()
        with self.assertRaisesRegex(AssertionError, 'baseline changed'): self.invoke()

    def test_changed_source_bytes_are_rejected(self):
        self.args[1]['plainSha256'] = '0'*64
        with self.assertRaisesRegex(AssertionError, 'bytes changed'): self.invoke()

    def test_changed_variant_is_rejected(self):
        self.story['cnVariantId'] = 'another-variant'
        with self.assertRaisesRegex(AssertionError, 'variant changed'): self.invoke()

    def test_changed_cue_is_rejected(self):
        self.event('cn', 'mjo-42f')['cues'][0]['raw']['targetEventId'] = 'mjo-4b7'
        with self.assertRaisesRegex(AssertionError, 'event changed'): self.invoke()

    def test_changed_name_slot_is_rejected(self):
        self.event('jp', 'mjo-500')['source']['nativeUnit']['speakerRaw']['rawHex'] = '00'
        with self.assertRaisesRegex(AssertionError, 'event changed'): self.invoke()

    def test_changed_native_boundary_is_rejected(self):
        self.event('cn', 'mjo-37d')['source']['nativeUnit']['boundary']['control'] = 'n'
        with self.assertRaisesRegex(AssertionError, 'event changed'): self.invoke()

    def test_changed_native_edge_is_rejected(self):
        self.event('cn', 'mjo-37d')['nextEventId'] = 'mjo-42f'
        with self.assertRaisesRegex(AssertionError, 'non-linear'): self.invoke()

    def test_changed_retained_fence_is_rejected(self):
        self.event('cn', 'mjo-31d')['nextEventId'] = 'mjo-3d8'
        with self.assertRaisesRegex(AssertionError, 'fence event changed'): self.invoke()

    def test_fence_may_not_be_quarantined(self):
        self.block['before'].update(cnEventId='mjo-37d', jpEventId='mjo-3d7')
        with self.assertRaisesRegex(AssertionError, 'fence lost'): self.invoke()

    def test_existing_native_group_may_not_be_removed(self):
        self.args[6].append({'cnEventIds':['mjo-37d'], 'jpEventIds':['mjo-3d7']})
        with self.assertRaisesRegex(AssertionError, 'group pair'): self.invoke()

    def test_pending_buffer_may_not_be_truncated(self):
        self.block['pendingPassages'][0]['jpEventIds'].pop()
        with self.assertRaisesRegex(AssertionError, 'append buffer'): self.invoke()

    def test_pending_and_reviewed_may_not_overlap(self):
        self.block['pendingPassages'][0]['cnEventIds'].insert(0, 'mjo-520')
        with self.assertRaisesRegex(AssertionError, 'partition'): self.invoke()

    def test_no_fifth_review_for_untranslated_russia_reply(self):
        self.block['passages'].append({'id':'review-nard01-false-fifth', 'cnEventIds':PENDING['cn'], 'jpEventIds':PENDING['jp']})
        with self.assertRaisesRegex(AssertionError, 'Only four'): self.invoke()

    def test_no_arbitrary_buffer_closure_anchor(self):
        self.story['nativePairRetractions']['bufferClosurePairs'][0].update(cnEventId='mjo-684', jpEventId='mjo-76a')
        with self.assertRaises(AssertionError): self.invoke()

    def test_crossed_review_is_rejected(self):
        self.block['passages'][1]['jpEventIds'] = ['mjo-500']
        with self.assertRaises(AssertionError): self.invoke()

    def test_missing_reviewed_event_is_rejected(self):
        self.block['passages'][0]['cnEventIds'] = ['mjo-37d']
        with self.assertRaisesRegex(AssertionError, 'partition'): self.invoke()

    def test_false_human_status_is_rejected(self):
        self.evidence['humanVerified'] = True
        with self.assertRaises(AssertionError): self.invoke()


if __name__ == '__main__':
    unittest.main()
