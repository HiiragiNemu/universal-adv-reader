"""Import supplied Chinese source editions separately from native game scripts.
No translation, original-file mutation, archive replacement, or remote operation.
"""
from pathlib import Path
import json,re,hashlib,sys,subprocess,unicodedata,html
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(r'D:\CG\narcissus\文本')
CONFIG=[
 ('novel1','水仙1 轻小说版.txt','水仙花 · 轻小说','片冈とも 著；陆怡帆 译；盆栽 录入、校对','小说版本，独立于游戏剧本。',44),
 ('novel1-alt','水仙1 轻小说版 (另一版本).txt','水仙花 · 轻小说（另一整理版）','原文件署名保留','同一小说的另一文本整理版本，不计为新增游戏剧情。',49),
 ('novel2-imperfect','水仙2 轻小说版 (有瑕疵).txt','第二卷文本 · 原整理本有瑕疵','原文件署名保留','按原文件名称归档；内容含 SIDE 2nd 转录与后记，不据此认定为完整小说第二卷。',9),
 ('1980','片岡とも 1980 濑津美原型的故事.txt','相关短文 · 1980','片冈とも；转载说明及原文署名保留','相关短文，不计为游戏章节；原文件的介绍作为来源说明保留。',1),
 ('1993','1993.txt','短篇 · 1993（文本整理版）','原文件署名保留','与游戏附加短篇分开保留的中文整理版本。',1),
 ('himeko','姬子终章.txt','姬子终章（文本整理版）','Narcissu 贴吧 50kg 翻译','中文文本整理版，保留原文件分段，不生成日文。',13),
 ('one','Narcissu -1st-.txt','Narcissu 1st（文本整理版）','百度贴吧「沙发的均势」整理；原文汉化署名保留','游戏正文及汉化后记的文本整理版，不与原生游戏章节重复计数。',4),
 ('two','Narcissu -SIDE 2nd-.txt','Narcissu SIDE 2nd（文本整理版）','原文件署名保留','依照文本原有章节/片段标题整理；与原生脚本版本分开保留。',1),
 ('iris','Narcissu 3rd 小小的伊丽丝.txt','小小的伊丽丝（文本整理版）','原文件署名保留','原中文整理本；第九章第二部分保留为同一作品的续节。',1),
 ('bride','Narcissu 3rd 死神的新娘.txt','死神的新娘（文本整理版）','Phantasya Palace；原文件署名保留','原整理本的编号保留于来源记录，正文不显示编目代码；不推测已丢失的字体颜色与说话人。',28),
]
def digest(b):return hashlib.sha256(b).hexdigest()
def read_original(p):
 b=p.read_bytes()
 for enc in ['utf-8-sig','gb18030']:
  try:return b,b.decode(enc).replace('\r\n','\n').replace('\r','\n'),enc
  except UnicodeDecodeError:pass
 raise ValueError('Unsupported source encoding '+str(p))
def heading_spans(code,lines,start):
 marks=[];seen=set()
 for i,line in enumerate(lines):
  t=line.strip();n=unicodedata.normalize('NFKC',t);line_no=i+1
  if line_no<start or len(t)>90:continue
  is_heading=False
  if code.startswith('novel1'):is_heading=bool(re.match(r'^(?:序章|第[一二三四五六七八九十]+章|终章|后记)',n))
  elif code=='one':is_heading=bool(re.match(r'^(?:序章$|第[一二三四五六七八九十]+章|chapter\d+)',n,re.I)) or n in ['■　关于中文化','■　制作后记']
  elif code=='iris':is_heading=bool(re.match(r'^Chapter\d+',n,re.I))
  elif code=='bride':is_heading=bool(re.match(r'^(?:序章|终章|第[一二三四五六七八九十]+[话話])[：:]',n))
  elif code=='himeko':is_heading=bool(re.match(r'^【[^】]{1,12}】$',n)) or n.startswith('■ narcissu sidestory')
  elif code in ['two','novel2-imperfect']:is_heading=bool(re.match(r'^(?:[□■]?序章|[□■]?姬子\d{2}|[□■]?终章|[★☆])',n)) or n in ['15岁的夏天','制服小店10','最后']
  elif code=='1980':is_heading=n.startswith('■1980')
  if is_heading:
   token=re.sub(r'\s','',n)
   if code.startswith('novel1') and token in seen:continue
   seen.add(token);marks.append((i,t))
 if code=='bride':
  # The supplied transcription omits the sixth heading but retains chapter ids.
  first=next((i for i,l in enumerate(lines) if re.match(r'^\[0-6-\d+\]',l.strip())),None)
  if first is not None and not any('第六' in t for _,t in marks):marks.append((first,'第六话 · 旁观者（原整理本编号段）'))
 if not marks:marks=[(0,dict((c,t) for c,_,t,*_ in CONFIG)[code])]
 elif marks[0][0]>0 and any(t.strip() for t in lines[:marks[0][0]]):marks.insert(0,(0,'卷首 · 来源与整理说明'))
 marks.sort()
 return [(a,title,marks[k+1][0] if k+1<len(marks) else len(lines)) for k,(a,title) in enumerate(marks)]
def paragraph_blocks(code, segment):
 # These two supplied editions use physical newlines, not blank lines, as
 # paragraph boundaries. Preserve those explicit source boundaries instead of
 # collapsing an entire chapter into one narration/editing cell. Other source
 # editions use blank-separated paragraphs with meaningful intra-paragraph wraps.
 if code in {'novel1', 'himeko'}:
  return [line for line in segment.split('\n') if line.strip()]
 return [block for block in re.split(r'\n\s*\n', segment) if block.strip()]
def encode(s):return s.replace('\\','\\\\').replace('\n','\\n')
def main():
 if len(sys.argv)!=2:raise SystemExit('Usage: python tools/import-narcissu-supplemental-texts.py CANDIDATE_PUBLIC')
 dst=Path(sys.argv[1]).resolve()
 if not dst.is_relative_to(ROOT) or dst==ROOT/'apps/classic-reader/public':raise ValueError('Use a data candidate inside this checkout')
 indexpath=dst/'story_index.json';index=json.loads(indexpath.read_text('utf-8'))
 if any(s.get('source_format')=='supplemental-text/v1' for s in index):raise ValueError('Do not duplicate an existing import')
 sources=[];entries=[];rawmap={}
 for order,(code,filename,title,credit,note,start) in enumerate(CONFIG):
  original,text,encoding=read_original(SOURCE/filename);h=digest(original);lines=text.split('\n');rawmap[filename]=h
  original_rel=f'data/legacy-vn/supplement-sources/{h}.txt';file=dst/original_rel;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(original)
  spans=heading_spans(code,lines,start);source_entries=[];covered=[]
  for ordinal,(lo,chapter,hi) in enumerate(spans):
   segment='\n'.join(lines[lo:hi]);blocks=paragraph_blocks(code,segment)
   if not blocks:continue
   stem=f'{code}-{ordinal+1:03d}';identity='narcissu-texts/'+stem;storyid='legacy-narcissu-texts-'+stem
   rel=f'/data/legacy-vn/{identity}_cn.txt';header=f'--- Start: {stem}.txt Section 1 ---';output=[header];paragraphs=[]
   for block in blocks:
    # Lossless original bytes above retain every code and line. Presentation only
    # removes a clearly marked transcription id, never its associated text.
    display=block.strip();codes=re.findall(r'\[\d+-\d+-\d+\]',display)
    if code=='bride':display=re.sub(r'(?m)^\s*\[\d+-\d+-\d+\]\s*','',display)
    speaker='旁白';body=display
    if code=='iris':
     m=re.match(r'^([^：:\n]{1,12})[：:]\s*(.+)$',display,re.S)
     if m and not re.match(r'Chapter|http',m[1],re.I):speaker,body=m.groups()
    if not body.strip():continue
    output.append(speaker+': '+encode(body));paragraphs.append({'ordinal':len(output)-1,'sourceCodes':codes,'original':block,'speaker':speaker,'text':body})
   raw=('\n'.join(output)+'\n').encode('utf-8');file=dst/rel.lstrip('/');file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw)
   entry={'id':storyid,'category':'supplement_story','folder':title,'title':chapter,'title_cn':chapter,'title_jp':'','nav_title_cn':chapter,'nav_title_jp':'','percent':100,'has_cn':True,'has_jp':False,'path_cn':rel,'filename_cn':chapter+'.txt','source_identity':identity,'source_format':'supplemental-text/v1','source_count':1,'source_unverified':False,'human_verified':True,'native_group_id':'supplement-'+code,'native_group_order':order,'native_story_order':ordinal,'sections':[header],'supplement_source':{'filename':filename,'title':title,'credit':credit,'note':note,'sha256':h,'original_path':'/'+original_rel,'original_encoding':encoding,'start_line':lo+1,'end_line':hi}}
   index.append(entry);record={'id':storyid,'identity':identity,'path':rel,'sha256':digest(raw),'sourceSha256':h,'startLine':lo+1,'endLine':hi,'title':chapter,'paragraphs':paragraphs};entries.append(record);source_entries.append(storyid);covered.extend(range(lo,hi))
  nonempty={i for i,l in enumerate(lines) if l.strip()}
  assert nonempty.issubset(set(covered)),filename
  sources.append({'id':code,'filename':filename,'sha256':h,'bytes':len(original),'encoding':encoding,'title':title,'credit':credit,'note':note,'originalPath':'/'+original_rel,'characters':len(text),'sourceLines':len(lines),'entries':source_entries,'allNonemptySourceLinesPreserved':True})
 archives=[]
 for archive in SOURCE.glob('*.rar'):
  listing=subprocess.run([r'C:\Program Files\7-Zip\7z.exe','l','-slt','-sccUTF-8',str(archive)],capture_output=True,check=True).stdout.decode('utf-8')
  members=re.findall(r'^Path = (.+)$',listing,re.M)[1:]
  for member in members:
   member=member.strip();name=Path(member.replace('\\','/')).name
   if name not in rawmap:raise ValueError('Unreviewed extra archive member '+member)
   contents=subprocess.run([r'C:\Program Files\7-Zip\7z.exe','x','-so',str(archive),member],capture_output=True,check=True).stdout
   if digest(contents)!=rawmap[name]:raise ValueError('Archive member differs from loose source '+member)
  archives.append({'filename':archive.name,'sha256':digest(archive.read_bytes()),'members':len(members),'byteIdenticalToLooseSources':True,'importedAgain':False})
 manifest={'schema':'supplemental-chinese-texts/v1','sourceRoot':str(SOURCE),'policy':'original-reviewed-author-pending/v1','sources':sources,'entries':entries,'archives':archives,'counts':{'sourceFiles':len(sources),'chapters':len(entries),'nativeGameScriptsAdded':0}}
 f=dst/'data/legacy-vn/manifests/supplemental-texts.json';f.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
 encoded=json.dumps(index,ensure_ascii=False,indent=2)+'\n';indexpath.write_text(encoded,encoding='utf-8',newline='\n');(dst/'apps/web/story_index.json').write_text(encoded,encoding='utf-8',newline='\n')
 print(json.dumps({'sources':len(sources),'chapters':len(entries),'bySource':[{s['filename']:len(s['entries'])} for s in sources],'archives':archives},ensure_ascii=False))
if __name__=='__main__':main()
