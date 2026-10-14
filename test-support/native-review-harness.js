import { classicModules } from './classic-module-loader.js';

// Execute declarations extracted from the actual component. Only React's
// state/ref plumbing and the transport are controlled; no callback is copied.
export function createReviewHarness({ initialRecord=null, request=async()=>({items:[]}), search='' }={}) {
  const modules=classicModules(),file='components/GenericNativeReview.tsx';
  const state={selected:initialRecord,items:[],confirmed:false,busy:false,loading:false,error:'',actor:'fixture-reviewer',note:'controlled callback test'};
  const changes=[];
  const setters=Object.fromEntries(['selected','items','confirmed','busy','loading','error'].map(key=>[
    'set'+key[0].toUpperCase()+key.slice(1),value=>{state[key]=value;changes.push({key,value});},
  ]));
  const bindings={...setters,initialRecord,useRef:value=>({current:value}),useCallback:fn=>fn,nativeReviewRequest:request,window:{location:{search}}};
  const callbacks=modules.fragments(file,['live','lifetime','detail','list','pendingAction','confirmation','refresh','open','mountSession'],bindings);
  return {state,changes,...callbacks,render(overrides={}) {
    return modules.fragments(file,['confirmCurrent','act'],{...bindings,...callbacks,...state,...overrides});
  }};
}

export function controlledTransport() {
  const calls=[];
  const request=(url,method='GET',payload,signal)=>new Promise((resolve,reject)=>calls.push({url,method,payload,signal,resolve,reject}));
  return {calls,request};
}
