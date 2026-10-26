import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
 READER_FONT_PREFERENCES_STORAGE_KEY, parseReaderFontPreferences,
 parseReaderFontRuntimeSnapshot, initializeReaderFonts, getReaderFontRuntimeSnapshot,
 getReaderFontRuntimeServerSnapshot, enableReaderFontBundle, disableReaderFontBundle,
 restoreSystemReaderFonts, subscribeReaderFontRuntime,
} from './reader-fonts.ts';

test('native face matching defaults on for both languages; explicit off is retained', () => {
 for(const raw of [null, '{broken', 'null', '[]'])
  assert.deepEqual(parseReaderFontPreferences(raw),{chineseEnabled:true,japaneseEnabled:true});
 assert.deepEqual(parseReaderFontPreferences('{"chineseEnabled":false,"japaneseEnabled":true}'),{chineseEnabled:false,japaneseEnabled:true});
 assert.deepEqual(parseReaderFontPreferences('{"chineseEnabled":"false","japaneseEnabled":false}'),{chineseEnabled:true,japaneseEnabled:false});
});

test('SSR snapshot has no activated font policy or downloaded-face claim', () => {
 const state=parseReaderFontRuntimeSnapshot(getReaderFontRuntimeServerSnapshot());
 assert.equal(state.bundles.chinese.status,'idle');
 assert.equal(state.bundles.japanese.status,'idle');
 assert.deepEqual(parseReaderFontRuntimeSnapshot('{invalid'),state);
});

test('native matching is local, ignores inherited download preference, and language toggles stay isolated', async () => {
 const keys=['window','document','fetch','FontFace','caches'] as const;
 const original=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const values=new Map<string,string>([['magi-reader-font-preferences-v1','{"chineseEnabled":true,"japaneseEnabled":true}']]);
 const dataset:Record<string,string>={readerFontChinese:'ready',readerFontJapanese:'ready'};
 const reads:string[]=[];let requests=0,notifications=0;
 const unexpected=()=>{requests++;throw Error('Native matching must not load web fonts');};
 const mocks={window:{localStorage:{getItem:(key:string)=>{reads.push(key);return values.get(key)??null;},setItem:(key:string,value:string)=>values.set(key,value)}},document:{documentElement:{dataset}},fetch:unexpected,FontFace:unexpected,caches:{open:unexpected}};
 for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:mocks[key]});
 const unsubscribe=subscribeReaderFontRuntime(()=>notifications++);
 try {
  await initializeReaderFonts();
  assert.deepEqual(reads,[READER_FONT_PREFERENCES_STORAGE_KEY]);
  assert.equal(dataset.readerFontChinese,undefined);assert.equal(dataset.readerFontJapanese,undefined);
  assert.equal(dataset.nativeFontChinese,'on');assert.equal(dataset.nativeFontJapanese,'on');
  disableReaderFontBundle('japanese');
  assert.equal(dataset.nativeFontJapanese,'off');assert.equal(dataset.nativeFontChinese,'on');
  let state=parseReaderFontRuntimeSnapshot(getReaderFontRuntimeSnapshot());
  assert.equal(state.bundles.japanese.status,'idle');assert.equal(state.bundles.chinese.status,'ready');
  assert.equal(await enableReaderFontBundle('japanese'),true);
  restoreSystemReaderFonts();
  assert.equal(dataset.nativeFontChinese,'off');assert.equal(dataset.nativeFontJapanese,'off');
  assert.deepEqual(JSON.parse(values.get(READER_FONT_PREFERENCES_STORAGE_KEY)!),{chineseEnabled:false,japaneseEnabled:false});
  assert.equal(requests,0);assert.ok(notifications>=4);
 } finally {
  unsubscribe();for(const key of keys){const saved=original.get(key);if(saved)Object.defineProperty(globalThis,key,saved);else Reflect.deleteProperty(globalThis,key);}
 }
});

test('settings and source-scoped styles describe actual local game faces', () => {
 const settings=readFileSync('components/ReaderFontSettings.tsx','utf8');
 const css=readFileSync('app/reader/native-game-fonts.css','utf8');
 const layout=readFileSync('app/layout.tsx','utf8');
 assert.match(settings,/原作字体（本机匹配）/u);
 assert.match(settings,/SimHei/u);assert.match(settings,/YouYuan/u);assert.match(settings,/MS Gothic/u);
 assert.match(settings,/CNFont\.ttf/u);assert.doesNotMatch(settings,/下载并启用|腾祥/u);
 assert.match(css,/data-native-font-profile='system'/u);assert.match(css,/data-native-font-chinese='on'/u);
 assert.doesNotMatch(css,/@font-face|url\(/u);assert.doesNotMatch(layout,/preload[^\n]+fonts/u);
});
