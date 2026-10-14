import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),app='apps/classic-reader/';
const dir=path.join(root,'reports/verification/reader-inheritance-20261012/atom12'),candidate=path.join(root,'work/reader-inheritance-20261012/native-edit-candidate/public');
if(fs.existsSync(path.join(dir,'manifest.json')))throw Error('Retain atom12 baseline');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const replace=(s,a,b)=>{if(!s.includes(a)||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Changed anchor: '+a.slice(0,100));return s.replace(a,b);};
const newFiles=['tools/build-native-edit-sources.mjs','tools/apply-native-reader-patch.mjs',app+'lib/native-translation-patch.ts'];
const changes=new Map(newFiles.map(file=>[file,fs.readFileSync(path.join(root,file))]));
let page=read(app+'app/reader/[id]/page.tsx');
page=replace(page,"import { triggerUtf8Download } from '@/lib/browser-download';",`import { triggerUtf8Download } from '@/lib/browser-download';
import { loadNativeEditSource, createNativeTranslationPatch, importNativeTranslationPatch,
  type LoadedNativeEditSource } from '@/lib/native-translation-patch';`);
page=replace(page,'  const [editedCnLines, setEditedCnLines] = useState<StoryLine[]>([]);',`  const [editedCnLines, setEditedCnLines] = useState<StoryLine[]>([]);
  const [nativeEditState, setNativeEditState] = useState<{ route: LegacyVoiceRouteDocument | null; cnRaw: string; jpRaw: string;
    source: LoadedNativeEditSource | null; error: string }>({ route: null, cnRaw: '', jpRaw: '', source: null, error: '' });
  const nativeEditSourceRef = useRef<LoadedNativeEditSource | null>(null);`);
page=replace(page,'    if (!isEditMode || isLocal) return;',"    if (!isEditMode || isLocal || id.startsWith('legacy-')) return;");
page=replace(page,'  const displayedCnLines =',`  useEffect(() => {
    const route = legacyVoiceRoute, cnRaw = cnSource?.raw ?? '', jpRaw = jpSource?.raw ?? '';
    const binding = { route, cnRaw, jpRaw };
    if (!route || !jpSource) { setNativeEditState({ ...binding, source: null, error: '' }); return; }
    const controller = new AbortController();
    setNativeEditState({ ...binding, source: null, error: '' });
    void loadNativeEditSource(route, cnRaw, jpRaw, controller.signal)
      .then(source => { if (!controller.signal.aborted) setNativeEditState({ ...binding, source, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setNativeEditState({ ...binding, source: null,
        error: error instanceof Error ? error.message : '原生编辑来源加载失败' }); });
    return () => controller.abort();
  }, [legacyVoiceRoute, cnSource, jpSource]);
  const currentNativeEditSource = nativeEditState.route === legacyVoiceRoute
    && nativeEditState.cnRaw === (cnSource?.raw ?? '') && nativeEditState.jpRaw === (jpSource?.raw ?? '') ? nativeEditState.source : null;
  nativeEditSourceRef.current = currentNativeEditSource;
  const nativeEditRowsByKey = useMemo(() => new Map(currentNativeEditSource?.document.rows.map(row => [row.key, row]) ?? []), [currentNativeEditSource]);

  const displayedCnLines =`);
page=replace(page,'  const downloadTranslation = () => {',`  const downloadNativePatch = () => {
    try {
      if (!currentNativeEditSource) throw Error(nativeEditState.error || '原生编辑来源准备中');
      if (nativeAlignmentState.error) throw Error(nativeAlignmentState.error);
      const patch = createNativeTranslationPatch(currentNativeEditSource, editedCnLines);
      triggerUtf8Download(JSON.stringify(patch, null, 2) + '\\n', id + '_native-translation.patch.json');
      setEditMessage(\`已下载原生翻译补丁：\${patch.changes.length} 个文本字段；原作指令、分支和媒体保持只读\`);
    } catch (error) { setEditMessage(error instanceof Error ? error.message : '原生补丁生成失败'); }
  };

  const downloadTranslation = () => {
    if (currentLegacyVoiceRoutePath) { downloadNativePatch(); return; }`);
page=replace(page,'    if (!file) return;\n    try {\n      const source = await readScenarioFile(file);',`    if (!file) return;
    const nativeSourceAtStart = currentNativeEditSource;
    try {
      const source = await readScenarioFile(file);
      if (currentLegacyVoiceRoutePath) {
        if (!nativeSourceAtStart || nativeEditSourceRef.current !== nativeSourceAtStart) throw Error('原生编辑来源准备中或剧情已切换');
        if (!nativeAlignmentState.rows || nativeAlignmentState.error) throw Error(nativeAlignmentState.error || '原作事件尚未就绪');
        const next = importNativeTranslationPatch(nativeSourceAtStart, JSON.parse(source.raw), nativeAlignmentState.rows);
        setEditedCnLines(next); setMode(jpEventLines.length > 0 ? 'split' : 'cn');
        setEditMessage('已按原生事件与源哈希导入翻译补丁；空字幕、空姓名与选项文本保留');
        return;
      }`);
page=replace(page,'  const submitToCloud = async () => {',`  const submitToCloud = async () => {
    if (currentLegacyVoiceRoutePath) { setEditMessage('通用工程尚未指定远端与投稿后端；请下载原生翻译补丁交付'); return; }`);
page=replace(page,'                    上传 JSON / TXT',"                    {currentLegacyVoiceRoutePath ? '导入原生补丁 JSON' : '上传 JSON / TXT'}");
page=replace(page,'                      accept=".json,.txt"','                      accept={currentLegacyVoiceRoutePath ? \'.json\' : \'.json,.txt\'}');
page=replace(page,'                    下载当前进度（UTF-8）',"                    {currentLegacyVoiceRoutePath ? '下载原生翻译补丁（JSON）' : '下载当前进度（UTF-8）'}");
const toolsStart=page.indexOf('                <div\n                  data-scenario-json-tools="true"');
const toolsEnd=page.indexOf('                <div className="magi-proofreading-fields',toolsStart);
if(toolsStart<0||toolsEnd<0)throw Error('Missing JSON tool panel');
page=page.slice(0,toolsStart)+`                {currentLegacyVoiceRoutePath ? <div data-native-edit-tools="true" className="magi-proofreading-json-tools mt-3">
                  <p className="magi-proofreading-help">原作事件键、版本与源哈希绑定。仅独立的原作姓名字段开放角色名编辑；IKURA 姓名包含在正文前缀中。音频 ID、时长、分支及指令只读。</p>
                  <p className="magi-proofreading-help">补丁可导回本页；本地应用工具生成新的 ADV JSON 派生文件，原游戏脚本不被覆盖。</p>
                  {!currentNativeEditSource && <p role={nativeEditState.error ? 'alert' : 'status'} className="magi-proofreading-alert">{nativeEditState.error || '正在核对原生编辑来源…'}</p>}
                </div> : (<>
`+page.slice(toolsStart,toolsEnd)+`                </>)}

`+page.slice(toolsEnd);
page=replace(page,'                  {proofreadingConfigLoading ? (',`                  {currentLegacyVoiceRoutePath ? (
                    <p className="magi-proofreading-alert">通用工程尚未指定远端与投稿后端；当前使用本地原生翻译补丁，不连接旧项目投稿服务。</p>
                  ) : proofreadingConfigLoading ? (`);
page=replace(page,`                  编辑模式保留未合并的逐事件行；标题、分支、位置与动作信息不会被
                  TXT 或 JSON 下载改写。请定期下载 TXT 备份。`, `                  {currentLegacyVoiceRoutePath ? '请定期下载原生翻译补丁备份；原始 CN / JP 文本仍可从页首下载。'
                    : '编辑模式保留逐事件行；请定期下载 TXT 备份。'}`);
page=replace(page,'                  setEditedLines={setEditedCnLines}',`                  setEditedLines={setEditedCnLines}
                  nativeSpeakerEditable={currentLegacyVoiceRoutePath ? nativeEditRowsByKey.get(nativePresentationState.rows?.[index]?.nativeKeys[0] ?? '')?.allowed.includes('speaker') ?? false : undefined}`);
page=replace(page,'  editedLines: StoryLine[];','  editedLines: StoryLine[];\n  nativeSpeakerEditable?: boolean;');
page=replace(page,'  editedLines,\n  setEditedLines,','  editedLines,\n  nativeSpeakerEditable,\n  setEditedLines,');
page=replace(page,'                aria-label={`第 ${index + 1} 行角色名`}',`                aria-label={\`第 \${index + 1} 行角色名\`}
                readOnly={nativeSpeakerEditable === false}
                title={nativeSpeakerEditable === false ? '原作没有独立的可写姓名字段；含姓名的 IKURA 正文可直接编辑' : undefined}`);
const speakerHandler="                onChange={event => {\n                  const value = event.target.value;\n                  setEditedLines(previous => {\n                    const next = [...previous];\n                    const basis = next[editIndex] || row.cn || row.jp || {\n                      speaker: '旁白',\n                      text: '',\n                    };\n                    next[editIndex] = { ...basis, speaker: value };";
page=replace(page,speakerHandler,speakerHandler.replace('                  const value', '                  if (nativeSpeakerEditable === false) return;\n                  const value'));
changes.set(app+'app/reader/[id]/page.tsx',page);
let materializer=read('tools/materialize-classic-reader-data.mjs');
materializer=replace(materializer,"import { buildGenericSearchIndex } from './build-generic-search-index.mjs';","import { buildGenericSearchIndex } from './build-generic-search-index.mjs';\nimport { buildNativeEditSources } from './build-native-edit-sources.mjs';");
materializer+='\nconst nativeEditBuild = await buildNativeEditSources(publicRoot);\nconsole.log(JSON.stringify({ nativeEdit: nativeEditBuild.counts }));\n';
changes.set('tools/materialize-classic-reader-data.mjs',materializer);
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const sourceFiles=walk(candidate).filter(f=>f.endsWith('.edit-source.json'));if(sourceFiles.length!==200)throw Error('Need all200 edit sources');
for(const f of sourceFiles)changes.set(app+'public/'+path.relative(candidate,f).replaceAll('\\','/'),fs.readFileSync(f));
const hash=b=>createHash('sha256').update(b).digest('hex'),entries=[];
for(const [file,content]of changes){const active=path.join(root,file),existed=!newFiles.includes(file)&&fs.existsSync(active),baseline=existed?fs.readFileSync(active):null;
  const modified=Buffer.isBuffer(content)?content:Buffer.from(baseline?.includes(Buffer.from('\r\n'))?content.replaceAll('\n','\r\n'):content);
  for(const [role,bytes]of[['baseline',baseline],['modified',modified]])if(bytes){const p=path.join(dir,role,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}
  entries.push({file,existed,baselineSha256:baseline?hash(baseline):null,modifiedSha256:hash(modified)});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({schema:1,atom:'atom12',target:'root',entries},null,2));
for(const entry of entries){const active=path.join(root,entry.file);if(entry.existed&&hash(fs.readFileSync(active))!==entry.baselineSha256)throw Error('Preserve concurrent edit');fs.mkdirSync(path.dirname(active),{recursive:true});fs.copyFileSync(path.join(dir,'modified',entry.file),active);}
console.log('Promoted ATOM12: '+entries.length+' files including native source producer, patch API, CLI and actual page wiring');
