import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewHarness, controlledTransport } from '../test-support/native-review-harness.js';

const record=(id,version=1)=>({id,version,status:'pending'});
const setup=(initialRecord=null)=>{
  const transport=controlledTransport();
  return {...transport,h:createReviewHarness({initialRecord,request:transport.request})};
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

for(const ids of [['a','b'],['b','a']])for(const order of [[0,1],[1,0]]) {
  test(`actual open latest intent wins ${ids.join('→')}, responses ${order.map(i=>ids[i]).join('→')}`,async()=>{
    const {h,calls}=setup(),pending=ids.map(id=>h.open(id));
    assert.equal(calls[0].signal.aborted,true);assert.equal(h.state.loading,true);assert.equal(h.state.selected,null);
    calls[order[0]].resolve({record:record(ids[order[0]])});await pending[order[0]];
    assert.equal(h.state.loading,order[0]===0);assert.equal(h.state.selected?.id??null,order[0]===1?ids[1]:null);
    calls[order[1]].resolve({record:record(ids[order[1]])});await pending[order[1]];
    assert.equal(h.state.selected.id,ids[1]);assert.equal(h.state.loading,false);
    assert.deepEqual(h.changes.filter(x=>x.key==='selected'&&x.value).map(x=>x.value.id),[ids[1]]);
  });
}

test('same ID reload uses generation, not ID equality, and stale failures/finalizers leave latest loading intact',async()=>{
  const {h,calls}=setup();const first=h.open('a'),second=h.open('a');
  calls[0].reject(Error('old detail failure'));await first;
  assert.equal(h.state.error,'');assert.equal(h.state.loading,true);
  calls[1].resolve({record:record('a',2)});await second;assert.equal(h.state.selected.version,2);
  const third=h.open('a'),fourth=h.open('a');calls[3].resolve({record:record('a',4)});await fourth;
  calls[2].resolve({record:record('a',3)});await third;assert.equal(h.state.selected.version,4);
});

test('read intent synchronously revokes old confirmation, hides old actions and binds explicit consent to ID/version/generation',async()=>{
  const {h,calls}=setup(record('a'));h.render().confirmCurrent(true);const old=h.render();
  const read=h.open('b');assert.equal(h.state.selected,null);assert.equal(h.state.confirmed,false);assert.equal(h.confirmation.current,null);
  old.confirmCurrent(true);await old.act('approve');assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
  calls[0].resolve({record:record('b',7)});await read;
  await old.act('approve');await h.render().act('approve');assert.equal(calls.length,1);
  h.render().confirmCurrent(true);await h.render({actor:'   '}).act('approve');assert.equal(calls.length,1);
  h.detail.current.version=8;await h.render().act('approve');assert.equal(calls.length,1);h.detail.current.version=7;
  const click=h.render(),action=click.act('approve');await click.act('approve');
  assert.equal(calls.length,2);assert.equal(h.state.confirmed,false);assert.equal(h.state.busy,true);
  assert.equal(calls[1].url,'/api/native-reviews/b');assert.equal(calls[1].payload.confirm,'b');assert.equal(calls[1].payload.expectedVersion,7);assert.ok(calls[1].payload.operationId);
  calls[1].resolve({record:record('b',8)});await tick();calls[2].resolve({items:[]});await action;
  assert.equal(h.state.selected.version,8);assert.equal(h.state.busy,false);assert.equal(h.state.confirmed,false);
  await click.act('approve');assert.equal(calls.length,3);
});

test('same-ID refresh revokes checked consent and unchecked stale handler never dispatches',async()=>{
  const {h,calls}=setup(record('a'));h.render().confirmCurrent(true);const old=h.render();h.render().confirmCurrent(false);
  await old.act('approve');assert.equal(calls.length,0);
  h.render().confirmCurrent(true);const checked=h.render(),p=h.open('a');await checked.act('approve');
  calls[0].resolve({record:record('a',2)});await p;await checked.act('approve');assert.equal(calls.length,1);assert.equal(h.state.confirmed,false);
});

test('current detail error and external abort leave no actionable old record',async()=>{
  const {h,calls}=setup(record('a'));const p=h.open('b');calls[0].reject(Error('current unavailable'));await p;
  assert.equal(h.state.selected,null);assert.equal(h.state.loading,false);assert.equal(h.state.error,'current unavailable');
  const c=new AbortController(),q=h.open('c',c.signal);c.abort();calls[1].resolve({record:record('c')});await q;
  assert.equal(h.state.selected,null);assert.equal(h.state.loading,false);assert.equal(h.state.error,'');
  await h.open('d',c.signal);assert.equal(calls.length,2);
});

for(const outcome of ['success','failure'])test(`write ${outcome} cannot replace newer selection or erase its confirmation/error`,async()=>{
  const {h,calls}=setup(record('a'));h.render().confirmCurrent(true);const write=h.render().act('approve'),read=h.open('b');
  calls[1].resolve({record:record('b',4)});await read;
  // UI keeps its existing write-busy fence. A selection made before a write
  // completes still must survive even if the transport ignores cancellation.
  h.state.error='new selection message';
  if(outcome==='success'){calls[0].resolve({record:record('a',2)});await tick();assert.equal(calls.length,3);calls[2].resolve({items:[]});}
  else calls[0].reject(Error('old write failed'));
  await write;assert.equal(h.state.selected.id,'b');assert.equal(h.state.selected.version,4);assert.equal(h.state.error,'new selection message');assert.equal(h.state.busy,false);
  assert.equal(calls.filter(c=>c.method==='GET'&&c.url.endsWith('/a')).length,0);
});

for(const timing of ['during-recovery','after-recovery'])test(`failed write reread ${timing} never steals B or publishes A error`,async()=>{
  const {h,calls}=setup(record('a'));h.render().confirmCurrent(true);const write=h.render().act('approve');
  calls[0].reject(Error('write conflict'));await tick();assert.equal(calls[1].url,'/api/native-reviews/a');
  if(timing==='after-recovery')calls[1].resolve({record:record('a',2)});
  const read=h.open('b');calls[2].resolve({record:record('b',5)});await read;
  if(timing==='during-recovery')calls[1].resolve({record:record('a',2)});
  await write;assert.equal(h.state.selected.id,'b');assert.equal(h.state.error,'');assert.equal(h.state.busy,false);assert.equal(h.state.confirmed,false);
});

test('same-target failed write rereads current version, retains failure and requires new explicit confirmation',async()=>{
  const {h,calls}=setup(record('a'));h.render().confirmCurrent(true);const write=h.render().act('approve');calls[0].reject(Error('version conflict'));
  await tick();calls[1].resolve({record:record('a',2)});await write;
  assert.equal(h.state.selected.version,2);assert.equal(h.state.error,'version conflict');assert.equal(h.state.confirmed,false);assert.equal(h.state.busy,false);
  await h.render().act('approve');assert.equal(calls.length,2);
});

test('list generations and late list errors neither restore stale items nor clear detail errors',async()=>{
  const {h,calls}=setup(),old=h.refresh(),latest=h.refresh();calls[1].resolve({items:[record('b')]});await latest;
  calls[0].resolve({items:[record('a')]});await old;assert.equal(h.state.items[0].id,'b');
  const list=h.refresh(),detail=h.open('b');calls[3].reject(Error('detail failed'));await detail;
  calls[2].reject(Error('old list failed'));await list;assert.equal(h.state.error,'detail failed');
  const good=h.refresh();calls[4].resolve({items:[]});await good;assert.equal(h.state.error,'detail failed');
});

for(const outcome of ['success','failure'])test(`unmount aborts all channels; late ${outcome} and finalizers make no state updates`,async()=>{
  const {h,calls}=setup(record('a'));const cleanup=h.mountSession();h.render().confirmCurrent(true);
  const write=h.render().act('approve'),read=h.open('b');cleanup();const count=h.changes.length;
  assert.ok(calls.every(c=>c.signal.aborted));
  if(outcome==='success'){calls[0].resolve({items:[]});calls[1].resolve({record:record('a',2)});calls[2].resolve({record:record('b')});}
  else for(const c of calls)c.reject(Error('late failure'));
  await Promise.all([write,read]);await tick();assert.equal(h.changes.length,count);assert.equal(calls.length,3);
  await h.open('c');await h.refresh();await h.render().act('approve');assert.equal(calls.length,3);
});

test('effect cleanup/remount invalidates old writes without clearing new write busy state',async()=>{
  const {h,calls}=setup(record('a'));const dispose=h.mountSession();h.render().confirmCurrent(true);const old=h.render().act('approve');dispose();
  const disposeAgain=h.mountSession();h.render().confirmCurrent(true);const current=h.render().act('approve');
  assert.equal(calls.length,4);calls[1].resolve({record:record('a',20)});await old;
  assert.equal(h.state.busy,true);assert.equal(h.state.selected.version,1);assert.ok(h.pendingAction.current);
  calls[0].resolve({items:[record('old-list')]});calls[2].resolve({items:[]});calls[3].resolve({record:record('a',2)});
  await tick();calls[4].resolve({items:[]});await current;assert.equal(h.state.selected.version,2);assert.equal(h.state.busy,false);disposeAgain();
});
