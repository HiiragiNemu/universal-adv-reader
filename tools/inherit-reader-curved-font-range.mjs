import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'reports/verification/reader-inheritance-20261012/atom15');
if(fs.existsSync(path.join(dir,'manifest.json')))throw Error('Preserve ATOM15 baseline');
const pin='56309ca742130e36d8d10fdb4f72de2a04cda02a',app='apps/classic-reader/';
const source=file=>{const r=spawnSync('git',['-C','D:/magia/MyProducts/magi-reader','show',`${pin}:website/${file}`]);if(r.status!==0)throw Error(String(r.stderr));return r.stdout;};
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const replace=(s,a,b)=>{if(!s.includes(a)||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Changed anchor: '+a);return s.replace(a,b);};
const changes=new Map();
for(const file of ['lib/curved-range.ts','lib/use-curved-font-range.ts']){
  if(fs.existsSync(path.join(root,app+file)))throw Error('Preserve existing module');
  changes.set(app+file,source(file));
}
let page=read(app+'app/reader/[id]/page.tsx');
page=replace(page,"import ReaderFontSettings from '@/components/ReaderFontSettings';","import ReaderFontSettings from '@/components/ReaderFontSettings';\nimport { useCurvedFontRange } from '@/lib/use-curved-font-range';");
page=replace(page,'  const readerDocumentRef = useRef<HTMLDivElement>(null);','  const readerDocumentRef = useRef<HTMLDivElement>(null);\n  const fontRangeRef = useCurvedFontRange();');
page=replace(page,'                <input\n                  className="magi-reader-font-ruler-input"','                <input\n                  ref={fontRangeRef}\n                  className="magi-reader-font-ruler-input"');
changes.set(app+'app/reader/[id]/page.tsx',page);
for(const file of ['tools/verify-reader-inheritance-atom.mjs','tools/rollback-reader-optics-foundation.mjs'])changes.set(file,replace(read(file),"'atom13', 'atom14']","'atom13', 'atom14', 'atom15']"));
const introduced=['test/classic-reader-curved-font-range.test.js','tools/inherit-reader-curved-font-range.mjs'];
for(const file of introduced)changes.set(file,fs.readFileSync(path.join(root,file)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),entries=[];
for(const[file,content]of changes){
  const active=path.join(root,file),existed=!introduced.includes(file)&&fs.existsSync(active),before=existed?fs.readFileSync(active):null;
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(before?.includes(Buffer.from('\r\n'))?content.replaceAll('\n','\r\n'):content);
  for(const[role,value]of[['baseline',before],['modified',bytes]])if(value){const target=path.join(dir,role,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);}
  entries.push({file,existed,baselineSha256:before?hash(before):null,modifiedSha256:hash(bytes)});
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({schema:1,atom:'atom15',target:'root',entries},null,2));
fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify({pin,modules:entries.filter(e=>e.file.includes('/lib/')).map(e=>({file:e.file,sha256:e.modifiedSha256,byteExact:true})),scope:'Existing floating font slider ref only; settings keyboard input and persisted preferences retained',userAccepted:false},null,2));
for(const entry of entries){const active=path.join(root,entry.file);if(entry.existed&&hash(fs.readFileSync(active))!==entry.baselineSha256)throw Error('Preserve concurrent change');fs.mkdirSync(path.dirname(active),{recursive:true});fs.copyFileSync(path.join(dir,'modified',entry.file),active);}
console.log('ATOM15 promoted '+entries.length+' scoped files');
