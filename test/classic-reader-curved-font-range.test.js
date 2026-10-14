import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { classicApp, classicModules, ts } from '../test-support/classic-module-loader.js';
const pin='56309ca742130e36d8d10fdb4f72de2a04cda02a';
const pageFile=path.join(classicApp,'app/reader/[id]/page.tsx');
const sourceFile=file=>{
  return fs.readFileSync(path.join(classicApp, '../../test-support/fixtures/upstream', file));
};
function sliderFragment(bindings){
  const code=fs.readFileSync(pageFile,'utf8'),tree=ts.createSourceFile(pageFile,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let slider;
  const attr=(node,name)=>node.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.getText(tree)===name);
  const visit=node=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(tree)==='input'&&attr(node,'aria-label')?.initializer?.getText(tree)==='"调整阅读字号"')slider=node;ts.forEachChild(node,visit);};visit(tree);
  assert.ok(slider);assert.equal(attr(slider,'ref')?.initializer?.expression?.getText(tree),'fontRangeRef');
  let display=false,dialog=false;
  for(let parent=slider.parent;parent;parent=parent.parent)if(ts.isJsxElement(parent)){
    const opening=parent.openingElement;
    display ||= attr(opening,'id')?.initializer?.getText(tree)==='"magi-reader-display"';
    dialog ||= opening.tagName.getText(tree)==='FloatingWindow';
  }
  assert.equal(display,true);assert.equal(dialog,false);
  return classicModules().compile(`export const slider=()=>(${slider.getText(tree)});`,pageFile,bindings).slider();
}

function fixture({theme='frost',narrow=false,curved=true,blocked=false}={}){
  const modules=classicModules(theme),preferencesFile=path.join(classicApp,'lib/reader-display-preferences.ts');
  const stored=new Map(),listeners=new Map(),actions=[];
  const window={
    localStorage:{getItem:key=>{if(blocked)throw Error('storage disabled');return stored.get(key)??null;},setItem:(key,value)=>{if(blocked)throw Error('storage disabled');stored.set(key,value);}},
    addEventListener(name,fn,options){assert.ok(!listeners.has(name));listeners.set(name,{fn,options});},
    removeEventListener(name,fn,capture){assert.equal(listeners.get(name)?.fn,fn);assert.equal(capture,true);listeners.delete(name);},
    dispatchEvent(event){actions.push(['store-change',event.type]);return true;},
    matchMedia:()=>({matches:narrow}),
  };
  const preferences=modules.compile(fs.readFileSync(preferencesFile,'utf8'),preferencesFile,{window});
  preferences.updateReaderDisplayPreferences({fontSizePx:15,textWidthPx:768,showLineBreaks:false,fontControlOpen:true,rulerEnabled:false,showVoiceButtons:false});
  const initial=preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot());
  const rootBox={left:30,top:20,width:narrow?390:1280,height:narrow?760:900};
  let inputBox={left:rootBox.left+rootBox.width-260,top:rootBox.top+rootBox.height-80,width:220,height:24};
  const root={getBoundingClientRect:()=>rootBox},captured=new Set();
  const input={min:'12',max:'22',closest:selector=>{assert.equal(selector,'#magi-reader-display');return root;},
    getBoundingClientRect:()=>({...inputBox,right:inputBox.left+inputBox.width,bottom:inputBox.top+inputBox.height}),
    focus:options=>actions.push(['focus',options]),setPointerCapture:id=>{captured.add(id);actions.push(['capture',id]);},
    hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>{captured.delete(id);actions.push(['release',id]);},
  };
  class ElementFixture {constructor(exclusion=null){this.exclusion=exclusion;}closest(selector){assert.equal(selector,'.magi-floating-window,[role="dialog"]');return this.exclusion;}}
  const lens=modules.load('lib/curved-range.ts').lensSourcePoint;
  let effect,ref={current:input};
  const hook=modules.fragments('lib/use-curved-font-range.ts',['useCurvedFontRange'],{
    useRef:()=>ref,useEffect:fn=>{effect=fn;},lensSourcePoint:lens,updateReaderDisplayPreferences:preferences.updateReaderDisplayPreferences,
    window,Element:ElementFixture,getComputedStyle:element=>{assert.equal(element,root);return{filter:curved?`url("#magi-${['dark','frost'].includes(theme)?'night':'reader'}-tube-curve")`:'none'};},
    matchMedia:()=>({matches:narrow}),
  }).useCurvedFontRange;
  assert.equal(hook(),ref);const cleanup=effect();
  function emit(name,options={}){
    const event={pointerId:7,pointerType:'mouse',button:0,target:new ElementFixture(),clientX:inputBox.left+110,clientY:inputBox.top+12,
      prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...options};
    listeners.get(name)?.fn(event);return event;
  }
  function visible(progress){
    const target={x:inputBox.left+8+progress*(inputBox.width-16),y:inputBox.top+inputBox.height/2};
    let point={...target};
    if(curved)for(let i=0;i<30;i++){const p=lens(point.x,point.y,rootBox,narrow?38:50);point.x-=p.x-target.x;point.y-=p.y-target.y;}
    return{clientX:point.x,clientY:point.y};
  }
  return{emit,visible,ref,input,rootBox,captured,actions,listeners,cleanup,initial,preferences,stored,
    value:()=>preferences.parseReaderDisplayPreferences(preferences.getReaderDisplayPreferencesSnapshot()),
    moveInput:next=>{inputBox={...inputBox,...next};},toggleCurve:value=>{curved=value;},setNarrow:value=>{narrow=value;},ElementFixture};
}

test('curved coordinate mapper and actual hook inherit pinned bytes and bind only the floating font input',()=>{
  for(const name of ['lib/curved-range.ts','lib/use-curved-font-range.ts'])assert.ok(fs.readFileSync(path.join(classicApp,name)).equals(sourceFile(name)),name);
  const source=fs.readFileSync(pageFile,'utf8');assert.match(source,/import \{ useCurvedFontRange \} from '@\/lib\/use-curved-font-range';/);
  const ref={current:null},bound=classicModules().fragments('app/reader/[id]/page.tsx',['fontRangeRef'],{useCurvedFontRange:()=>ref});assert.equal(bound.fontRangeRef,ref);
  const slider=sliderFragment({fontRangeRef:ref,READER_FONT_SIZE_MIN:12,READER_FONT_SIZE_MAX:22,fontSize:17,updateReaderDisplayPreferences(){}});
  assert.equal(slider.props.ref,ref);assert.equal(slider.props.type,'range');assert.equal(slider.props.step,'1');assert.equal(slider.props['aria-valuetext'],'17 像素');
  assert.equal((source.match(/ref=\{fontRangeRef\}/g)??[]).length,1);
});

test('lens inverse uses exact sRGB neutral offset and mobile/desktop displacement scales',()=>{
  const {lensSourcePoint}=classicModules().load('lib/curved-range.ts'),box={left:100,top:200,width:1000,height:500};
  for(const scale of [38,50]){
    const center=lensSourcePoint(600,450,box,scale);assert.ok(Math.abs(center.x-(600+scale/510))<1e-10);assert.ok(Math.abs(center.y-(450+scale/510))<1e-10);
    const start=lensSourcePoint(100,200,box,scale),end=lensSourcePoint(1100,700,box,scale);
    assert.ok(Math.abs(start.x-(100+scale*(38/255-.5)))<1e-10);assert.ok(Math.abs(start.y-(200+scale*(38/255-.5)))<1e-10);
    assert.ok(Math.abs(end.x-(1100+scale*(218/255-.5)))<1e-10);assert.ok(Math.abs(end.y-(700+scale*(218/255-.5)))<1e-10);
  }
  const filters=fs.readFileSync(path.join(classicApp,'components/TubeOpticalFilters.tsx'),'utf8');
  assert.match(filters,/colorInterpolationFilters="sRGB"/);assert.match(filters,/in2="lens" scale=\{scale\}/);
  assert.match(fs.readFileSync(path.join(classicApp,'lib/tube-lens.ts'),'utf8'),/matches \? 38 : 50/);
});

test('actual pointer hook maps 40 theme-viewport-effect-read/edit cases through the existing persistent preferences',()=>{
  let cases=0,updates=0;
  for(const theme of ['light','paper','green','dark','frost'])for(const narrow of [false,true])for(const curved of [false,true])for(const mode of ['read','edit']){
    const f=fixture({theme,narrow,curved});
    assert.equal(f.listeners.size,4);assert.deepEqual(f.listeners.get('pointerdown').options,{capture:true,passive:false});
    for(const [i,progress]of[0,.25,.5,.75,1].entries()){
      const event=f.emit(i?'pointermove':'pointerdown',{...f.visible(progress),pointerType:mode==='edit'?'touch':'mouse'});
      assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(f.value().fontSizePx,Math.round(12+progress*10));updates++;
    }
    f.emit('pointerup');assert.equal(f.captured.size,0);assert.deepEqual(f.value(),{...f.initial,fontSizePx:22});
    assert.equal(JSON.parse(f.stored.get('magi-reader-display-preferences-v1')).fontSizePx,22);
    f.cleanup();assert.equal(f.listeners.size,0);cases++;
  }
  assert.equal(cases,40);assert.equal(updates,200);
});

test('window/dialog overlays, secondary mouse buttons, out-of-range points and hidden controls retain their own input',()=>{
  const f=fixture({curved:false});
  for(const exclusion of [{className:'magi-floating-window'},{role:'dialog'}]){
    const event=f.emit('pointerdown',{...f.visible(.5),target:new f.ElementFixture(exclusion)});assert.equal(event.prevented,false);
  }
  for(const patch of [{button:2},{clientX:-500,clientY:0},{clientX:500,clientY:-500}])assert.equal(f.emit('pointerdown',patch).prevented,false);
  f.moveInput({width:0});assert.equal(f.emit('pointerdown').prevented,false);
  f.ref.current=null;assert.equal(f.emit('pointerdown').prevented,false);
  assert.deepEqual(f.value(),f.initial);f.cleanup();
});

test('drag ownership, clamped endpoints, cancel and effect teardown retain pointer lifecycle',()=>{
  const f=fixture({curved:false});
  assert.equal(f.emit('pointermove',{...f.visible(.8)}).prevented,false);
  f.emit('pointerdown',{...f.visible(.5),pointerType:'pen'});assert.ok(f.captured.has(7));
  assert.deepEqual(f.actions.find(a=>a[0]==='focus'),['focus',{preventScroll:true}]);
  assert.equal(f.emit('pointermove',{pointerId:8,...f.visible(1)}).prevented,false);assert.equal(f.value().fontSizePx,17);
  f.emit('pointermove',{clientX:100000});assert.equal(f.value().fontSizePx,22);
  f.emit('pointermove',{clientX:-100000});assert.equal(f.value().fontSizePx,12);
  f.emit('pointercancel',{pointerId:8});assert.ok(f.captured.has(7));
  f.emit('pointercancel');assert.equal(f.captured.size,0);assert.equal(f.emit('pointermove',{...f.visible(.5)}).prevented,false);
  f.cleanup();assert.equal(f.listeners.size,0);assert.equal(f.actions.filter(a=>a[0]==='capture').length,1);assert.equal(f.actions.filter(a=>a[0]==='release').length,1);
});

test('actual hook re-reads dragged input geometry, viewport scale and curve setting instead of caching an old hit region',()=>{
  const f=fixture({curved:true});f.emit('pointerdown',{...f.visible(.25)});assert.equal(f.value().fontSizePx,15);
  f.moveInput({left:80,top:100,width:300});f.setNarrow(true);f.emit('pointermove',{...f.visible(.75)});assert.equal(f.value().fontSizePx,20);
  f.toggleCurve(false);f.emit('pointermove',{...f.visible(.5)});assert.equal(f.value().fontSizePx,17);
  f.emit('pointerup');f.cleanup();
});

test('real input change handler preserves keyboard/accessibility path and settings when storage is blocked',()=>{
  for(const blocked of [false,true]){
    const f=fixture({blocked});
    const slider=sliderFragment({fontRangeRef:f.ref,READER_FONT_SIZE_MIN:12,READER_FONT_SIZE_MAX:22,fontSize:15,updateReaderDisplayPreferences:f.preferences.updateReaderDisplayPreferences});
    for(const value of ['12','18','22']){slider.props.onChange({target:{value}});assert.equal(f.value().fontSizePx,Number(value));}
    assert.deepEqual(f.value(),{...f.initial,fontSizePx:22});assert.equal(f.captured.size,0);f.cleanup();
  }
});
