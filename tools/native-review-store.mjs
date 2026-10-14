import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateNativeTranslationPatch } from '../apps/classic-reader/lib/native-translation-patch.ts';

export const reviewRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
export class NativeReviewError extends Error {
  constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
const fail=(code,message,status)=>{throw new NativeReviewError(code,message,status);};
const inside=(base,value)=>{const full=path.resolve(value);if(!full.startsWith(path.resolve(base)+path.sep))fail('PATH','本地记录路径超出通用工程',400);return full;};
const clean=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||(required&&!value.trim()))fail('INPUT','署名或说明格式错误',400);return value;};
const key=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9]{16,128}$/.test(value))fail('INPUT','操作标识格式错误',400);return value;};
const idPath=(base,id)=>{if(!/^[a-f0-9]{32}$/.test(id))fail('NOT_FOUND','投稿编号不存在',404);return path.join(base,id+'.json');};
const moduleAt=name=>import(/* webpackIgnore: true */ pathToFileURL(path.join(reviewRoot,'tools',name)).href);
async function currentSource(identity,publicRoot){
  const index=JSON.parse(await fs.readFile(path.join(publicRoot,'story_index.json'),'utf8'));
  const entry=index.find(e=>e.source_identity===identity);if(!entry)fail('STORY','剧情不在公开原生目录内',400);
  const {loadNativeRevisionContext}=await moduleAt('read-native-reader-revision.mjs');
  return {entry,...await loadNativeRevisionContext(entry,publicRoot)};
}
async function producer(){return moduleAt('stage-native-reader-revision.mjs');}

/** Private local records, outside public/. No environment-selected remote or
 * credential fallback. API construction always uses the default local store;
 * tests inject a separate directory/public target and mark every receipt. */
export function createNativeReviewStore(options={}){
  const directory=inside(reviewRoot,options.directory??path.join(reviewRoot,'work/native-review-store'));
  const publicRoot=inside(reviewRoot,options.publicRoot??path.join(reviewRoot,'apps/classic-reader/public'));
  const fixture=options.fixture===true;
  if(fixture&&publicRoot===path.join(reviewRoot,'apps/classic-reader/public'))fail('FIXTURE','测试批准只用于隔离语料',400);
  const records=path.join(directory,'records');
  const clock=()=>new Date().toISOString();
  const source=identity=>currentSource(identity,publicRoot);
  const read=async id=>{
    try{const r=JSON.parse(await fs.readFile(idPath(records,id),'utf8'));if(r.schema!=='native-review/v1'||r.id!==id||r.fixture!==fixture||digest(JSON.stringify(r.patch))!==r.patchSha256)fail('CORRUPT','本地投稿记录校验失败');return r;}
    catch(e){if(e.code==='ENOENT')fail('NOT_FOUND','投稿编号不存在',404);throw e;}
  };
  const save=async record=>{
    const file=idPath(records,record.id),temp=file+'.'+randomUUID()+'.tmp';
    await fs.writeFile(temp,json(record),{flag:'wx'});
    try{await fs.rename(temp,file);}catch(e){await fs.unlink(temp);throw e;}
    return read(record.id);
  };
  async function locked(fn){
    await fs.mkdir(records,{recursive:true});const lock=path.join(directory,'.writer-lock');let handle;
    try{handle=await fs.open(lock,'wx');}catch(e){if(e.code==='EEXIST')fail('BUSY','另一项本地操作正在进行，请稍后刷新重试');throw e;}
    try{await handle.writeFile(json({pid:process.pid,at:clock()}));return await fn();}
    finally{await handle.close();await fs.unlink(lock);}
  }
  async function validate(record){
    try{const state=await source(record.patch.storyId);validateNativeTranslationPatch(state.source,record.patch);return state;}
    catch(e){if(e instanceof NativeReviewError)throw e;fail('SOURCE_CONFLICT','原生来源或当前修订已变化，请重新导出补丁：'+e.message);}
  }
  async function list(){
    let names;try{names=await fs.readdir(records);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];for(const name of names.filter(n=>/^[a-f0-9]{32}\.json$/.test(n))){const r=await read(name.slice(0,-5));result.push({id:r.id,version:r.version,status:r.status,storyId:r.patch.storyId,readerId:r.readerId,title:r.title,author:r.author,note:r.note,changes:r.patch.changes.length,createdAt:r.createdAt,updatedAt:r.updatedAt,fixture:r.fixture});}
    return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  async function submit(input){return locked(async()=>{
    if(!input||typeof input!=='object')fail('INPUT','投稿格式错误',400);
    const requestId=key(input.requestId),id=digest(requestId).slice(0,32),author=clean(input.author,80,true),note=clean(input.note??'',2000);
    const intentSha256=digest(JSON.stringify([input.patch,author,note]));
    try{const old=await read(id);if(old.intentSha256!==intentSha256)fail('IDEMPOTENCY','同一投稿标识的内容已变化');return old;}catch(e){if(e.code!=='NOT_FOUND')throw e;}
    const state=await source(input.patch?.storyId);let patch;
    try{patch=validateNativeTranslationPatch(state.source,input.patch);}catch(e){fail('PATCH',e.message,400);}
    if(!patch.changes.length)fail('EMPTY','没有待提交的文本变化',400);
    const rows=new Map(state.source.document.rows.map(r=>[r.key,r])),at=clock();
    const aligned=new Map(state.rows.flatMap(row=>row.nativeKeys.map(key=>[key,row])));
    return save({schema:'native-review/v1',id,version:1,status:'pending',createdAt:at,updatedAt:at,author,note,fixture,
      readerId:state.entry.id,title:state.entry.title_cn||state.entry.title,patch,patchSha256:digest(JSON.stringify(patch)),intentSha256,
      targets:patch.changes.map(c=>({key:c.key,field:c.field,target:rows.get(c.key).target,speakerReason:rows.get(c.key).speakerReason,
        pairing:aligned.get(c.key)?.pairing??'source',originalJapanese:aligned.get(c.key)?.jp?{text:aligned.get(c.key).jp.text,speaker:aligned.get(c.key).jp.speaker??''}:null})),
      decision:null,stage:null,lastError:null,events:[{sequence:1,operationId:requestId,action:'submit',outcome:'saved',at,actor:author,fixture}],
      humanAccepted:false,remotePublished:false});
  });}
  async function act(id,input){return locked(async()=>{
    const record=await read(id),operationId=key(input?.operationId),action=input?.action;
    if(!['approve','reject','stage','install','rollback'].includes(action))fail('ACTION','未知本地操作',400);
    const actor=clean(input.actor,80,true),note=clean(input.note??'',2000);
    if(input.confirm!==id)fail('CONFIRM','请确认当前投稿与所选操作',400);
    const intent=digest(JSON.stringify([action,input.expectedVersion,actor,note,input.confirm]));
    const old=record.events.find(e=>e.operationId===operationId);
    if(old){if(old.intent!==intent)fail('IDEMPOTENCY','同一操作标识已用于其他请求');if(old.outcome==='failed')fail(old.code,old.error);return record;}
    if(input.expectedVersion!==record.version)fail('VERSION','记录已更新，请刷新后重新审核');
    const allowed={approve:['pending'],reject:['pending'],stage:['approved'],install:['staged'],rollback:['installed']};
    if(!allowed[action].includes(record.status))fail('STATE','当前状态不支持此操作');
    const at=clock(),event={sequence:record.events.length+1,operationId,action,actor,note,at,intent,fixture};
    try{
      if(action!=='rollback')await validate(record);
      if(action==='approve'||action==='reject'){
        record.decision={action,actor,note,at,sourceSha256:record.patch.sourceSha256,explicitLocalAction:true,identityVerified:false,fixture};
        record.status=action==='approve'?'approved':'rejected';
      }else{
        if(record.decision?.action!=='approve')fail('APPROVAL','生产操作需要明确的批准记录');
        const p=options.producer??await producer();
        if(action==='stage'){
          const stem=path.join(directory,'artifacts',id);await fs.mkdir(stem,{recursive:true});
          const patchFile=path.join(stem,'patch.json'),bytes=json(record.patch);
          try{await fs.writeFile(patchFile,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(await fs.readFile(patchFile,'utf8')!==bytes)fail('CORRUPT','已保存补丁字节改变');}
          const output=path.join(stem,operationId),stage=await p.stageNativeReaderRevision(patchFile,output,publicRoot);
          record.stage={directory:path.relative(reviewRoot,output).replaceAll('\\','/'),revision:stage.revision,parentRevision:stage.parentRevision,storyId:stage.storyId};record.status='staged';
        }else{
          const stage=inside(directory,path.join(reviewRoot,record.stage.directory));
          const result=await p.installNativeReaderRevision(stage,publicRoot,action==='rollback');
          event.result=result;record.status=action==='install'?'installed':'rolled_back';
        }
      }
      record.lastError=null;event.outcome='succeeded';
    }catch(e){event.outcome='failed';event.code=e.code??'PRODUCTION_FAILED';event.error=e.message;record.lastError={code:event.code,message:event.error,action,at};}
    record.version++;record.updatedAt=clock();record.events.push(event);await save(record);
    if(event.outcome==='failed')fail(event.code,event.error,event.code==='PRODUCTION_FAILED'?500:409);
    return record;
  });}
  return {directory,publicRoot,fixture,list,read,submit,act};
}
