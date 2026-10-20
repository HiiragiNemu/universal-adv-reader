import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {classicApp,classicModules,ts} from '../test-support/classic-module-loader.js';

const file=path.join(classicApp,'app/reader/[id]/page.tsx');
const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let button;
function visit(node){
 if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='button'
   &&node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(tree)==='data-voice-panel-toggle'))button=node;
 ts.forEachChild(node,visit);
}
visit(tree);
assert(button,'Actual reader header voice toggle must be present');

test('header voice toggle keeps its expanded/collapsed semantics without fixed color utilities',()=>{
 for(const theme of ['light','paper','green','dark','frost'])for(const expanded of [true,false]){
  let next,stops=0;
  const {render}=classicModules(theme).compile(`export const render=()=>(${button.getText(tree)});`,file,{
   voicePanelExpanded:expanded,effectiveLegacyVoiceError:null,legacyVoiceRouteLoading:false,
   legacyVoiceSummary:{resolvedLines:308,totalLines:1227,cueCount:308},detachedLegacyVoiceCues:[],
   setVoicePanelExpanded:fn=>{next=fn(expanded);},voicePlaybackController:{stop(){stops++;}},Music2:()=>null,
  });
  const element=render();
  assert.equal(element.props['aria-pressed'],expanded);assert.equal(element.props['aria-expanded'],expanded);
  assert.equal(element.props['data-voice-panel-toggle'],'true');
  assert(!/\b(?:bg-|text-(?:white|gray|sky)|hover:bg-)/.test(element.props.className));
  assert.match(element.props.className,/px-3 py-1\.5 text-xs font-bold/);
  element.props.onClick();assert.equal(next,!expanded);assert.equal(stops,expanded?1:0);
 }
});

test('voice toggle theme correction changes only its paint using existing palette tokens',()=>{
 const css=fs.readFileSync(path.join(classicApp,'app/reader/reader-current-refinements.css'),'utf8');
 const blocks=[...css.matchAll(/([^{}]+data-voice-panel-toggle[^{}]+)\{([^{}]+)\}/g)];
 assert.equal(blocks.length,2);
 for(const [,selector,body]of blocks){
  assert(selector.includes(".magi-reader-root .magi-reader-header [data-voice-panel-toggle='true']"));
  const declarations=body.trim().split(';').map(s=>s.trim()).filter(Boolean);
  assert.equal(declarations.length,3);
  for(const d of declarations)assert.match(d,/^(?:color|background|border-color): var\(--magi-tool-[\w-]+\) !important$/);
 }
 assert(blocks[1][1].includes("[aria-pressed='true']"));
 assert(blocks[1][1].includes(':hover'));assert(blocks[1][1].includes(':focus-visible'));
});
