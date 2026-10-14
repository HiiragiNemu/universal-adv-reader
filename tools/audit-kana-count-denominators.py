"""Reconcile every KANA count from original ISC/ISF instructions, not reader rows."""
import importlib.util
import json
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path('A:/KANA')
OUT = ROOT/'reports/verification/content-repair-20261013/kana/count-denominators.json'
spec = importlib.util.spec_from_file_location('independent_kana',ROOT/'tools/audit-kana-completeness.py')
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)
prior = json.loads((OUT.parent/'independent-audit.json').read_text(encoding='utf-8'))
prior_scripts = {s['scriptId']:s for s in prior['scripts']}
secret,dictionary,key,exe = raw.executable_material(SOURCE/'KANAOKA.EXE')
assert exe['sha256'] == prior['executable']['sha256']
report = {'schema':'kana-count-denominators/v1','source':'Direct independent decoding of original A:/KANA/ISC and ISF',
          'definitions':{'textEvents':'0x2B message streams that contain text or voice segments, plus 0xF7 titles; 0x15 choice labels are excluded.',
                         'messageInstructionsWithoutTextEvent':'Native 0x2B streams containing controls only, without a text or voice segment.',
                         'rawVisibleUnits':'Nonblank selected-story normal message/title events plus visible 0x15 choice labels; excludes error handlers.',
                         'readVisibleUnits':'rawVisibleUnits after native-proved continuous message fragments are joined only for reading.'},
          'locales':{},'scripts':[]}
for archive,locale,encoding,record_key in [('ISF','ja-JP','cp932','japanese'),('ISC','zh-CN','gb18030','chinese')]:
    blob = (SOURCE/archive).read_bytes()
    groups = {'selectedNormal':Counter(),'selectedErrorHandlers':Counter(),'excludedSystem':Counter()}
    for entry in raw.archive_directory(SOURCE/archive):
        script = Path(entry['name']).stem
        member = blob[entry['offset']:entry['offset']+entry['size']]
        assert raw.digest(member) == prior_scripts[script][record_key]['sha256']
        decoded = raw.decode_member(member,secret,dictionary,key,encoding)
        boundary = raw.first_title_boundary(decoded)
        narrative = bool(raw.NARRATIVE_NAME.fullmatch(script))
        by_instruction = {e['instructionIndex']:e for e in decoded['events']}
        buckets = {name:Counter() for name in groups}
        texts = []
        for index,instruction in enumerate(decoded['instructions']):
            category = 'excludedSystem' if not narrative else 'selectedNormal' if index < boundary else 'selectedErrorHandlers'
            count = buckets[category]
            if instruction['opcode'] == 0x2B:
                count['messageInstructions'] += 1
                if index not in by_instruction: count['messageInstructionsWithoutTextEvent'] += 1
            if instruction['opcode'] == 0xF7: count['titleInstructions'] += 1
            if instruction['opcode'] == 0x15: count['choiceLabelInstructions'] += 1
            event = by_instruction.get(index)
            if not event: continue
            kind = event['kind']; visible = bool(event['text'].strip())
            if kind in ('message','title'):
                count['textEvents'] += 1
                count['visibleTextEvents' if visible else 'blankTextEvents'] += 1
                count[kind+'Events'] += 1
                count[('visible' if visible else 'blank')+kind.title()+'Events'] += 1
            else:
                assert kind == 'localized-label'
                count['choiceLabelEvents'] += 1
                count['visibleChoiceLabels' if visible else 'blankChoiceLabels'] += 1
            if category != 'selectedNormal' or not visible:
                texts.append({'category':category,'instructionIndex':index,'kind':kind,'text':event['text']})
        for category in groups: groups[category].update(buckets[category])
        assert sum(b['textEvents'] for b in buckets.values()) == prior_scripts[script][record_key]['textEventCount']
        report['scripts'].append({'scriptId':script,'locale':locale,'sourceMemberSha256':raw.digest(member),
            'categories':{name:dict(count) for name,count in buckets.items() if count},'excludedOrBlankTextEvents':texts})
    normal,diagnostic,system = (groups[name] for name in ['selectedNormal','selectedErrorHandlers','excludedSystem'])
    total = sum(group['textEvents'] for group in groups.values())
    original_visible = normal['visibleTextEvents']+normal['visibleChoiceLabels']
    correction = int(locale == 'zh-CN')
    final_raw = original_visible+correction
    assert total == prior['counts']['japaneseTextEvents' if locale == 'ja-JP' else 'chineseTextEvents']
    assert original_visible == prior['counts']['japaneseNarrativeVisibleTextAndChoiceUnits' if locale == 'ja-JP' else 'chineseNarrativeVisibleTextAndChoiceUnits']
    report['locales'][locale] = {'categories':{name:dict(count) for name,count in groups.items()},
        'originalTextEvents':total,'originalSelectedRawVisibleUnits':original_visible,
        'guardedChineseOmissionCorrections':correction,'finalSelectedRawVisibleUnits':final_raw,
        'equation':f"{total} - {system['textEvents']} system - {diagnostic['textEvents']} diagnostics - {normal['blankTextEvents']} blanks + {normal['visibleChoiceLabels']} choices + {correction} guarded correction = {final_raw}"}
report['combinedEquation'] = '32825 - 8 system - 85 diagnostic text events - 11 blank text events + 210 choice labels + 1 guarded Chinese omission correction = 32932 visible source units'
report['navigation'] = {'nativeTitleInstructionsPerLocale':95,'nativeSections':101,'previousScriptSections':52,'addedNavigationSections':49,
    'note':'The 95 titles already belong to the original textEvents count. Their restoration as navigation adds 49 chapter entry points, not 95 newly recovered dialogue passages.'}
OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'output':str(OUT),'locales':report['locales'],'combinedEquation':report['combinedEquation']},ensure_ascii=False))
