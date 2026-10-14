import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'reports/verification/reader-inheritance-20261012/atom13');
const pin = '56309ca742130e36d8d10fdb4f72de2a04cda02a';
if (fs.existsSync(path.join(dir,'manifest.json'))) throw Error('Preserve recorded ATOM13 baseline');
const source = file => {
  const r = spawnSync('git',['-C','D:/magia/MyProducts/magi-reader','show',`${pin}:website/${file}`]);
  if(r.status !== 0) throw Error(String(r.stderr)); return r.stdout;
};
const read = file => fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const replace = (s,a,b) => { if(!s.includes(a)||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Changed anchor '+a.slice(0,100));return s.replace(a,b); };
const app = 'apps/classic-reader/', changes = new Map();
const inherited = source('app/reader/reader-stacked-alignment.css');
changes.set(app+'app/reader/reader-stacked-alignment.css', inherited);
const compact = prefix => `${prefix} .magi-reader-voice-unavailable {
    display: inline-flex; width: 24px; min-width: 24px; height: 24px; min-height: 24px;
    padding: 0; align-items: center; justify-content: center;
  }
  ${prefix} [data-voice-unavailable-label] { display: none; }
  ${prefix} [data-voice-unavailable-mark] { display: inline; }`;
changes.set(app+'app/reader/native-stacked-alignment.css',`@layer reader-visual-revision {
  /* Native routes retain explicit unresolved voice slots and untranslated rows.
     Their structure differs from Reader's voice button, not its three columns. */
  html body #magi-reader-display .magi-bilingual-pair > [lang] > [data-voice-slot] {
    grid-column: 1 !important; grid-row: 1 !important; min-width: 0;
  }
  html body #magi-reader-display [data-voice-unavailable-mark] { display: none; }
  @media (max-width: 767px) {
    ${compact('html body #magi-reader-display .magi-bilingual-pair')}
  }
  ${compact('html body #magi-reader-display .magi-bilingual-pair-stacked')}
}
`);
let page = read(app+'app/reader/[id]/page.tsx');
page = replace(page,"import ReaderFontSettings from '@/components/ReaderFontSettings';", "import ReaderFontSettings from '@/components/ReaderFontSettings';\nimport '@/app/reader/reader-stacked-alignment.css';\nimport '@/app/reader/native-stacked-alignment.css';");
page = replace(page,'className={`min-h-11 rounded-lg border px-2 py-2 text-[10px] font-semibold opacity-55 ${','className={`magi-reader-voice-unavailable min-h-11 rounded-lg border px-2 py-2 text-[10px] font-semibold opacity-55 ${');
page = replace(page,"            {voiceRouteError ? '路由异常' : '无对应语音'}", "            <span data-voice-unavailable-mark aria-hidden=\"true\">—</span>\n            <span data-voice-unavailable-label>{voiceRouteError ? '路由异常' : '无对应语音'}</span>");
page = replace(page,"            title={voiceRouteError || '原作脚本没有为这一行提供语音提示'}", "            aria-label={voiceRouteError ? '路由异常：' + voiceRouteError : '无对应语音'}\n            title={voiceRouteError || '原作脚本没有为这一行提供语音提示'}");
page = replace(page,'<div className="flex-1 border-b border-dashed border-black/5 py-1 text-xs italic opacity-20">','<div data-reader-text-cell="cn-empty" className="flex-1 border-b border-dashed border-black/5 py-1 text-xs italic opacity-20">');
page = replace(page,'<div className="flex-1 py-1 text-xs italic opacity-20">…</div>','<div data-reader-text-cell="jp-empty" className="flex-1 py-1 text-xs italic opacity-20">…</div>');
changes.set(app+'app/reader/[id]/page.tsx',page);
let voice = read(app+'components/voice/VoicePlayButton.tsx');
// Inherit the pinned presentation only. Keep the native sourceUrl validation,
// per-source controller selection, onClick and lifecycle from ATOM08 intact.
const pinnedVoice = source('components/voice/VoicePlayButton.tsx').toString('utf8');
const pinnedClass = pinnedVoice.match(/className=\{`(magi-reader-voice-button[^`]+)`\}/)?.[1];
if(!pinnedClass)throw Error('Pinned voice appearance missing');
voice = replace(voice,'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-wait ${className}',pinnedClass);
voice = replace(voice,'<span className="inline-flex flex-col items-start gap-1">','<span className="inline-flex self-start flex-col items-start gap-0.5">');
voice = voice.replaceAll('h-4 w-4','h-3.5 w-3.5');
changes.set(app+'components/voice/VoicePlayButton.tsx',voice);
for(const file of ['tools/verify-reader-inheritance-atom.mjs','tools/rollback-reader-optics-foundation.mjs'])changes.set(file,replace(read(file),"'atom11', 'atom12']","'atom11', 'atom12', 'atom13']"));
const newFiles=['test-support/css-dom-contract.js','test/classic-reader-stacked-alignment.test.js','tools/inherit-reader-stacked-alignment.mjs'];
for(const file of newFiles)changes.set(file,fs.readFileSync(path.join(root,file)));
const hash=b=>createHash('sha256').update(b).digest('hex'),entries=[];
for(const [file,value]of changes){
  const active=path.join(root,file),existed=!newFiles.includes(file)&&fs.existsSync(active),baseline=existed?fs.readFileSync(active):null;
  const modified=Buffer.isBuffer(value)?value:Buffer.from(baseline?.includes(Buffer.from('\r\n'))?value.replaceAll('\n','\r\n'):value);
  for(const [role,bytes]of[['baseline',baseline],['modified',modified]])if(bytes){const p=path.join(dir,role,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}
  entries.push({file,existed,baselineSha256:baseline?hash(baseline):null,modifiedSha256:hash(modified)});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({schema:1,atom:'atom13',target:'root',entries},null,2));
fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify({pin,cssSource:'website/app/reader/reader-stacked-alignment.css',cssSha256:hash(inherited),nativeAdaptation:'Unresolved voice slot and missing-language placeholders retain the same column contract',browserGeometry:'pending',userAccepted:false},null,2));
for(const entry of entries){const active=path.join(root,entry.file);if(entry.existed&&hash(fs.readFileSync(active))!==entry.baselineSha256)throw Error('Preserve concurrent edit');fs.mkdirSync(path.dirname(active),{recursive:true});fs.copyFileSync(path.join(dir,'modified',entry.file),active);}
console.log('ATOM13 scoped inheritance: '+entries.length+' paths');
