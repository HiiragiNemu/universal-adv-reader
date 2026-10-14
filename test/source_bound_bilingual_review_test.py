from pathlib import Path
import copy
import json
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/lib'))
from source_bound_bilingual_review import apply_source_bound_reviews, load_evidence

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/classic-reader/public/data/legacy-vn'

def fixture(identity):
    route = json.loads((PUBLIC / (identity + '.routes.json')).read_bytes())
    alignment = json.loads((PUBLIC / (identity + '.alignment.json')).read_bytes())
    sources = {lang: {name:alignment['proof'][lang+name[0].upper()+name[1:]] for name in ('plainSha256','scriptSha256')}
               for lang in ('cn','jp')}
    streams = {lang:[e for v in route['variantRoutes'] if v['variantId']==route['chineseVariantId' if lang=='cn' else 'japaneseVariantId'] for section in v['sections'] for e in section['events']] for lang in ('cn','jp')}
    return [identity,sources['cn'],sources['jp'],streams['cn'],streams['jp'],alignment['pairs'],alignment.get('groupPairs',[])]

class SourceBoundReviewTests(unittest.TestCase):
    def setUp(self):
        self.evidence = copy.deepcopy(load_evidence()[0])
        self.args = fixture('narcissu-3rd/nar3_04')

    def invoke(self):
        return apply_source_bound_reviews(*self.args,evidence=self.evidence)

    def test_entire_explicit_corpus_keeps_raw_events_control_cues_and_native_pairs(self):
        total = 0; covered={'cn':0,'jp':0}
        for story in self.evidence['stories']:
            args = fixture(story['storyId']); before=copy.deepcopy(args)
            result,proof=apply_source_bound_reviews(*args,evidence=self.evidence)
            self.assertEqual(args,before)
            self.assertFalse(proof['humanVerified']);self.assertFalse(proof['translationQualityVerified'])
            self.assertEqual(proof['reviewer'],'AI');self.assertTrue(proof['nativePairsUnmodified'])
            total+=len(result)
            for lang in covered:covered[lang]+=proof['events'][lang]
        self.assertEqual(total,342);self.assertEqual(covered,{'cn':378,'jp':353})

    def test_unselected_chapter_is_unchanged(self):
        args=fixture('narcissu-3rd/nard14');before=copy.deepcopy(args)
        self.assertEqual(apply_source_bound_reviews(*args,evidence=self.evidence),([],None))
        self.assertEqual(args,before)

    def test_reject_changed_native_bytes(self):
        self.args[1]['plainSha256']='0'*64
        with self.assertRaisesRegex(AssertionError,'bytes changed'):self.invoke()

    def test_reject_changed_event_text_or_control(self):
        target=next(e for e in self.args[3] if e['eventId']=='mjo-7477')
        target['source']['nativeUnit']['textParts'][0]['text']='changed'
        with self.assertRaisesRegex(AssertionError,'event changed'):self.invoke()

    def test_reject_event_dropped_from_the_full_bounded_gap(self):
        self.evidence['stories'][0]['blocks'][0]['source']['jp'].pop()
        with self.assertRaisesRegex(AssertionError,'gap contents changed'):self.invoke()

    def test_reject_unproved_fence(self):
        self.evidence['stories'][0]['blocks'][0]['before']['jpEventId']='mjo-8dd7'
        with self.assertRaisesRegex(AssertionError,'fence lost'):self.invoke()

    def test_reject_duplicate_passage(self):
        block=self.evidence['stories'][0]['blocks'][0]
        block['passages'].append(copy.deepcopy(block['passages'][0]))
        with self.assertRaisesRegex(AssertionError,'Duplicate'):self.invoke()

    def test_reject_duplicate_event_even_with_new_passage_id(self):
        block=self.evidence['stories'][0]['blocks'][0]
        block['passages'][1]['cnEventIds']=block['passages'][0]['cnEventIds'][:]
        with self.assertRaisesRegex(AssertionError,'duplicate'):self.invoke()

    def test_reject_crossed_passages(self):
        passages=self.evidence['stories'][0]['blocks'][0]['passages']
        passages[0]['jpEventIds'],passages[1]['jpEventIds']=passages[1]['jpEventIds'],passages[0]['jpEventIds']
        with self.assertRaisesRegex(AssertionError,'crosses'):self.invoke()

    def test_reject_nonconsecutive_group(self):
        self.evidence['stories'][0]['blocks'][0]['passages'][0]['cnEventIds']=['mjo-7477','mjo-74d3']
        with self.assertRaisesRegex(AssertionError,'skips'):self.invoke()

    def test_reject_mislabeled_human_verification(self):
        self.evidence['humanVerified']=True
        with self.assertRaises(AssertionError):self.invoke()

    def test_reject_unknown_source_variant(self):
        self.evidence['stories'][0]['cnVariantId']='different-version'
        with self.assertRaisesRegex(AssertionError,'variant mismatch'):self.invoke()

if __name__=='__main__':unittest.main()
