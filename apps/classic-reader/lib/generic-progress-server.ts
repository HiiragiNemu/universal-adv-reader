import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseStoryContent} from './story-parser.ts';
import {parseLegacyVoiceRouteDocument} from './legacy-vn-voice-routing.ts';
import {buildSharedNativeAlignment,mergeNativeAlignedRows,type NativeAlignedRow} from './legacy-vn-alignment.ts';
import {buildParallelNativeAlignment,type NativeCorrespondence} from './legacy-vn-correspondence.ts';
import {readNativeEditSource} from './native-translation-patch.ts';
import {parseNativeRevisionRegistry,readNativeReaderRevision,projectNativeReaderRevisionRows} from './native-reader-revision.ts';
import {GENERIC_PROGRESS_WORKS,nativeCoverage,summarizeGenericProgress,readGenericProgress,type GenericProgressEntry} from './generic-progress.ts';
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
type Entry={id:string;source_identity:string;source_format?:string;title:string;title_jp?:string;category:GenericProgressEntry['category'];path_cn?:string;path_jp?:string;native_sections?:unknown[];sections?:unknown[];native_group_id?:string};
const reader=(root:string)=>(relative:string)=>{const full=path.resolve(root,relative.replace(/^\//,''));if(!full.startsWith(path.resolve(root)+path.sep))throw Error('进度来源越界');return fs.readFile(full,'utf8');};
export async function buildCurrentGenericProgress(publicRoot=path.join(process.cwd(),'public'),adapterPath=path.join(publicRoot,'data/legacy-vn/manifests/reader-adapter.json')){
 const read=reader(publicRoot),adapterRaw=await fs.readFile(adapterPath,'utf8'),adapter=JSON.parse(adapterRaw);
 const index:Entry[]=JSON.parse(await read('story_index.json')),native=index.filter(s=>s.source_format!=='supplemental-text/v1');
 const bundle=JSON.parse(await read('data/legacy-vn/manifest.json')),registryRaw=await read('native-reader-revisions.json'),registry=parseNativeRevisionRegistry(registryRaw);
 const archived=new Map<string,{variants:unknown[]}>(adapter.stories.map((s:{canonicalStoryId:string;readerIdentity?:string;variants:unknown[]})=>[s.readerIdentity??s.canonicalStoryId,s]));
 const included=new Set<string>(adapter.stories.filter((s:{resource?:{reader?:{decision?:string}}})=>s.resource?.reader?.decision==='include').map((s:{canonicalStoryId:string;readerIdentity?:string})=>s.readerIdentity??s.canonicalStoryId));
 if(archived.size!==adapter.stories.length||!adapter.games.length||adapter.stories.reduce((n:number,s:{variants:unknown[]})=>n+s.variants.length,0)!==adapter.counts.variants
  ||native.length!==included.size||new Set(index.map(i=>i.source_identity)).size!==index.length||native.some(i=>!included.has(i.source_identity))||bundle.counts?.stories!==native.length)throw Error('当前目录与原生归档成员不一致');
 let supplementRaw='',supplement:{entries:Array<{id:string;path:string;sha256:string;sourceSha256:string}>}|null=null;
 if(index.some(s=>s.source_format==='supplemental-text/v1')){supplementRaw=await read('data/legacy-vn/manifests/supplemental-texts.json');supplement=JSON.parse(supplementRaw);}
 const entries:GenericProgressEntry[]=[],parse=(s:string)=>parseStoryContent(s,{mergeConsecutiveTextLines:false}).lines;
 for(const item of index){
  if(!(item.category in GENERIC_PROGRESS_WORKS))throw Error('未知作品类别');
  const common={id:item.id,identity:item.source_identity,title:item.title,titleJp:item.title_jp??'',category:item.category,work:GENERIC_PROGRESS_WORKS[item.category],nativeChapters:item.native_sections?.length??item.sections?.length??1,nativeGroupId:item.native_group_id};
  if(item.source_format==='supplemental-text/v1'){
   const source=supplement?.entries.find(e=>e.id===item.id);if(!source||source.path!==item.path_cn||item.path_jp)throw Error('补充资料身份不一致');
   const raw=await read(source.path);if(sha(raw)!==source.sha256)throw Error('补充资料正文改变');
   const rows:NativeAlignedRow[]=parse(raw).map((cn,i)=>({cn,nativeKeys:[item.id+':'+i],cnIndices:[i],jpIndices:[],cnSlot:null,jpSlot:null}));
   entries.push({...common,variants:1,revision:source.sourceSha256,supplemental:true,...nativeCoverage(rows)});continue;
  }
  const original=archived.get(item.source_identity);if(!original||!item.path_jp)throw Error('原生来源缺失');
  const stem=`data/legacy-vn/${item.source_identity}`;
  const [routeRaw,cnRaw,jpRaw,baseRaw]=await Promise.all([read(stem+'.routes.json'),item.path_cn?read(item.path_cn):Promise.resolve(''),read(item.path_jp),read(stem+'.edit-source.json')]);
  const route=parseLegacyVoiceRouteDocument(JSON.parse(routeRaw),item.source_identity);
  const base=await readNativeEditSource(baseRaw,{storyId:item.source_identity,binding:{route:sha(routeRaw),cnText:sha(cnRaw),jpText:sha(jpRaw),adapter:sha(adapterRaw)}});
  let rows=buildSharedNativeAlignment(route,parse(cnRaw),parse(jpRaw));
  if(rows===null){const c=JSON.parse(await read(stem+'.alignment.json')) as NativeCorrespondence;if(c.hashes.route!==sha(routeRaw)||c.hashes.cnText!==sha(cnRaw)||c.hashes.jpText!==sha(jpRaw))throw Error('原生对应版本改变');rows=buildParallelNativeAlignment(route,parse(cnRaw),parse(jpRaw),c);}
  const record=registry.entries[item.source_identity],current=record?await readNativeReaderRevision(await read(record.path),record,base):null;
  if(current)rows=projectNativeReaderRevisionRows(rows,current);
  entries.push({...common,variants:original.variants.length,revision:record?.revision??null,...nativeCoverage(mergeNativeAlignedRows(rows),current?.revision?.translationReview)});
 }
 return summarizeGenericProgress(entries,{sourceRevision:sha(bundle.revision+registryRaw+supplementRaw),adapterSha256:sha(adapterRaw),archive:{games:adapter.games.length,stories:archived.size,visible:native.length,excluded:archived.size-native.length,variants:adapter.counts.variants,textEvents:adapter.counts.textEvents,chineseStories:adapter.counts.chineseStories}});
}
/** Hash-bound generation snapshot: no optimistic first paint and no 30-second
 * recalculation on every API request. Outdated snapshots are never accepted. */
export async function loadCurrentGenericProgress(publicRoot=path.join(process.cwd(),'public')){
 const read=reader(publicRoot);
 try{
  const snapshot=JSON.parse(await read('generic-progress.json'));
  for(const [relative,hash] of Object.entries(snapshot.bindings as Record<string,string>))if(sha(await read(relative))!==hash)throw Error('Progress snapshot binding changed');
  return readGenericProgress(snapshot.progress);
 }catch(error){
  // A new submission may change a revision pointer before the next static build.
  // Recalculate from that actual version, rather than silently using stale data.
  if((error as NodeJS.ErrnoException).code==='ENOENT'||error instanceof Error&&error.message==='Progress snapshot binding changed')return buildCurrentGenericProgress(publicRoot);
  throw error;
 }
}
