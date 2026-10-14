/** Native Majiro display reconstruction.
 * A display unit ends at an actual page/wait/control boundary, never by text
 * length or by the next sentence's punctuation. Text operands, inline names,
 * ruby bases and every consumed opcode retain their original source identity.
 */
const operandFormats = new Map(Object.entries({
  0x800:'i',0x801:'s',0x802:'fho',0x803:'r',0x80f:'h0a',0x810:'h0a',
  0x829:'t',0x82b:'',0x82c:'j',0x82d:'j',0x82e:'j',0x82f:'',
  0x830:'j',0x831:'j',0x832:'j',0x833:'j',0x834:'ha',0x835:'ha',
  0x836:'t',0x837:'fho',0x838:'j',0x839:'j',0x83a:'l',
  0x83b:'j',0x83c:'j',0x83d:'j',0x83e:'',0x83f:'',
  0x840:'s',0x841:'',0x842:'s',0x843:'j',0x844:'',0x845:'j',
  0x846:'',0x847:'j',0x850:'c',
}).map(([key,value]) => [Number(key),value]));
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
const jpDecoder = new TextDecoder('shift_jis', {fatal:true});
const asciiDecoder = new TextDecoder('utf-8', {fatal:true});
const RUBY_CALL = '100801fd9831000000000200';
// Proper names reuse spellings from the installed Chinese patch. Other entries
// normalize Chinese glyphs or translate explicit role labels. Source-specific
// evidence and the distinction are recorded in narcissu3/speaker-audit.json.
export const NARCISSU_SPEAKER_ZH = Object.freeze({
  'チサト':'千里','カズアキ':'和昭','セツミ':'濑津美','蒔絵':'莳绘',
  '姫子':'姬子','千尋':'千寻','優花':'优花','イリス':'伊丽丝',
  '子供イリス':'小伊丽丝','おっさん兵':'士兵大叔','キャバ嬢Ａ':'陪酒女Ａ',
  'キャバ嬢Ｂ':'陪酒女Ｂ','シスター':'修女','傭兵':'佣兵','医師':'医生',
  '医者':'医生','司祭Ａ':'牧师Ａ','女性貴族':'女性贵族','男性貴族':'男性贵族',
  '店員':'店员','男の子':'男孩子','衛兵':'卫兵','課長':'科长',
  '看護師':'护士','看護士':'护士','麻酔師':'麻醉师','敵':'敌人','敵Ａ':'敌人Ａ',
  '司祭':'牧师','誰か':'陌生人','店の人':'店员','彼氏':'男友','彼女':'女友',
  '依頼主':'委托人','ドライバー':'司机','ヘルパー':'护工','helper':'护工',
  'おっさん兵Ｂ':'士兵大叔Ｂ','おっさんＢ':'大叔Ｂ','おっさんＣ':'大叔Ｃ',
  'おっさんＤ':'大叔Ｄ','おっさんＥ':'大叔Ｅ','看護士＠蒔絵':'护士·莳绘',
  'とも':'智','兵士':'士兵','母親':'母亲','友達':'朋友','子供':'孩子',
  '子供達':'孩子们','全員':'大家','担任':'班主任','多　恵':'多惠',
  'お老奶奶Ｃ★':'老奶奶Ｃ','教師':'教师',
}); 
export function normalizeNarcissuChineseSpeaker(value) {
  const raw=String(value??'').trim();
  const translated=NARCISSU_SPEAKER_ZH[raw]??raw;
  // Render the readable name without decorative stars. Their exact original
  // spelling remains in speakerRaw / translationBindings for native editing.
  return translated.replace(/[★☆]/gu,'').replace(/^女 主角$/u,'女主角');
}
export function parseMajiroInstructions(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length < 32 || !['MajiroObjV1.000','MjPlainBytecode'].includes(asciiDecoder.decode(bytes.slice(0,16)).replace(/\0+$/u,'')))
    throw new TypeError('Native Majiro reader requires a decrypted, complete MJO');
  const sizeOffset = 28 + view.getUint32(24,true)*8;
  if (sizeOffset+4>bytes.length) throw new TypeError('Majiro function table exceeds object');
  const base = sizeOffset+4, size = view.getUint32(sizeOffset,true);
  if (base+size!==bytes.length) throw new TypeError('Majiro code region is incomplete');
  const instructions=[];
  for(let at=base;at<bytes.length;) {
    const start=at;
    const require = n => { if(at+n>bytes.length)throw new TypeError('Truncated Majiro instruction at '+(start-base)); };
    require(2);const opcode=view.getUint16(at,true);at+=2;
    const format=opcode>=0x100&&opcode<0x1b0?'':opcode>=0x1b0&&opcode<=0x320?'fho':operandFormats.get(opcode);
    if(format===undefined)throw new TypeError('Unsupported Majiro opcode '+opcode.toString(16));
    let stringRawHex=null,string=null;const jumps=[];
    for(const type of format) {
      if('irhj0'.includes(type)) {
        require(4); if(type==='j')jumps.push(at-base+4+view.getInt32(at,true)); at+=4;
      } else if('foal'.includes(type)) {require(2);at+=2;}
      else if(type==='s'||type==='t') {
        require(2);const length=view.getUint16(at,true);at+=2;require(length);
        if(type==='s') {
          if(!length||bytes[at+length-1]!==0)throw new TypeError('Unterminated Majiro string');
          const raw=bytes.slice(at,at+length-1);stringRawHex=hex(raw);
          try{string=jpDecoder.decode(raw);}catch{string=null;}
        }
        at+=length;
      } else if(type==='c') {
        require(2);const count=view.getUint16(at,true);at+=2;require(count*4);
        for(let i=0;i<count;i++,at+=4)jumps.push(at-base+4+view.getInt32(at,true));
      }
    }
    instructions.push({opcode,codeOffset:start-base,fileOffset:start,length:at-start,
      hex:hex(bytes.slice(start,at)),stringRawHex,string,jumps});
  }
  const starts=new Set(instructions.map(i=>i.codeOffset));
  for(const instruction of instructions)for(const target of instruction.jumps)
    if(!starts.has(target)&&target!==size)throw new TypeError('Majiro branch targets the middle of an instruction');
  return instructions;
}
const meaningful = instructions => instructions.filter(i=>i.opcode!==0x83a);
const nativeSlot = (instructions,index) => {
  const first=instructions[index],next=instructions[index+1];
  if(first?.opcode!==0x840)return false;
  if(next?.opcode===0x840)return true; // two native text operands before any proc
  // Native name positioning before a ruby-bearing utterance.
  return next?.opcode===0x841 && instructions[index+2]?.opcode===0x800
    && instructions[index+3]?.opcode===0x800
    && instructions[index+4]?.opcode===0x842 && instructions[index+4].string==='o'
    && instructions[index+5]?.opcode===0x840;
};
export function collectMajiroNativeNames(plain,script) {
  const ins=meaningful(parseMajiroInstructions(plain)),byOffset=new Map(
    (script.textEvents??[]).flatMap(e=>e.segments.map(s=>[s.codeOffset,s])));
  const names=new Map();
  ins.forEach((instruction,index)=>{
    if(nativeSlot(ins,index)) {
      const source=byOffset.get(instruction.codeOffset);
      if(source)names.set(instruction.stringRawHex,source.text);
    }
  });
  return names;
}
export function buildMajiroNativeUnits({plain,script,strings,sourceLocale,knownNames=new Map(),localizeNames=false}) {
  const instructions=meaningful(parseMajiroInstructions(plain));
  const textEvents=script.textEvents??[],byOffset=new Map(),stringByOffset=new Map(
    (strings?.strings??[]).map(s=>[s.codeOffset,s.text]));
  textEvents.forEach((event,eventIndex)=>event.segments.forEach((segment,segmentIndex)=>{
    if(byOffset.has(segment.codeOffset))throw new TypeError('Duplicate source text operand');
    byOffset.set(segment.codeOffset,{...segment,eventIndex,segmentIndex});
  }));
  for(const instruction of instructions)if(instruction.opcode===0x840) {
    const s=byOffset.get(instruction.codeOffset);
    if(!s||s.rawHex!==instruction.stringRawHex)throw new TypeError('Majiro script text does not match native bytes');
  }
  const groups=[],consumed=new Set();let pending=null;
  const rubyBindings = new Map(), rubyArguments = new Set();
  instructions.forEach((call,index)=>{
    if(call.hex!==RUBY_CALL)return;
    const args=[];
    for(let at=index-1;at>=0&&args.length<2;at--) {
      const instruction=instructions[at];
      if(instruction.opcode===0x801)args.unshift(at);
      else if(instruction.opcode===0x840||instruction.opcode===0x841
        ||instruction.opcode===0x842&&instruction.string==='n')continue;
      else break;
    }
    if(args.length!==2)throw new TypeError('Unresolved native ruby argument stack');
    rubyBindings.set(index,args);args.forEach(at=>rubyArguments.add(at));
  });
  const cleanName = text => String(text).trim().replace(/^[@＠]/u,'').normalize('NFKC');
  const attestedNames = new Set([...knownNames.values(),...Object.keys(NARCISSU_SPEAKER_ZH),
    ...Object.values(NARCISSU_SPEAKER_ZH),'主角','侍从','兵','其他','老婆婆',''].map(cleanName));
  const start=(instruction)=>pending??={startOffset:instruction.codeOffset,endCodeOffset:instruction.codeOffset,
    parts:[],nativeInstructions:[],controls:[],ruby:[],sourceIndices:[],speaker:null,speakerRaw:null,bodyCodeOffset:null};
  const addInstruction=instruction=>{
    start(instruction);pending.nativeInstructions.push(instruction.codeOffset);
    pending.endCodeOffset=instruction.codeOffset+instruction.length;
  };
  const finish=boundary=>{
    if(!pending)return;
    if(!pending.parts.some(p=>p.kind==='text'||p.kind==='ruby')) {
      pending=null;return;
    }
    const group=pending;pending=null;
    group.text=group.parts.map(p=>p.text).join('');
    group.boundary=boundary;
    group.sourceIndices=[...new Set(group.sourceIndices)];
    group.textIndex=group.sourceIndices.find(i=>textEvents[i].segments.some(s=>s.codeOffset===group.bodyCodeOffset))
      ??group.sourceIndices.at(-1);
    group.speakerIndex=null;
    group.nativeUnit={schema:'majiro-display-unit/v1',codeOffset:group.startOffset,endCodeOffset:group.endCodeOffset,
      bodyCodeOffset:group.bodyCodeOffset,codeOffsets:group.nativeInstructions,
      textEventIndices:group.sourceIndices,
      textParts:group.parts.map(p=>({...p})),speakerRaw:group.speakerRaw,ruby:group.ruby,controls:group.controls,boundary};
    groups.push(group);
  };
  const nameText=(text,rawHex)=>{
    const preserved=knownNames.get(rawHex)??text;
    const clean=String(preserved).trim().replace(/^[@＠]/u,'');
    return localizeNames&&sourceLocale==='zh-CN'?normalizeNarcissuChineseSpeaker(clean):clean;
  };
  for(let i=0;i<instructions.length;i++) {
    const current=instructions[i];
    if(current.opcode===0x840) {
      addInstruction(current);const source=byOffset.get(current.codeOffset);
      if(consumed.has(source.codeOffset))throw new TypeError('Native text operand consumed twice');
      consumed.add(source.codeOffset);pending.sourceIndices.push(source.eventIndex);
      let text=source.text;let inline=null;
      // The ASCII delimiter follows a byte-exact name from the Japanese native
      // name slot. A 0x40 trail byte inside a Shift-JIS character cannot match.
      for(const [raw,name] of knownNames)if(current.stringRawHex.startsWith(raw+'40')) {
        if(!inline||raw.length>inline.raw.length)inline={raw,name};
      }
      // A few CN operands encode both the role label and body as GBK, rather
      // than retaining a CP932 name. Accept only an attested complete label and
      // a byte boundary whose strict GB decoding equals that exact source label.
      if(!inline&&sourceLocale==='zh-CN'&&text.includes('@')) {
        const label=text.slice(0,text.indexOf('@'));
        if(label.trim()&&attestedNames.has(cleanName(label))) {
          const bytes=Uint8Array.from(current.stringRawHex.match(/../gu)??[],byte=>parseInt(byte,16));
          for(let at=0;at<bytes.length;at++)if(bytes[at]===0x40) {
            try {
              if(new TextDecoder('gb18030',{fatal:true}).decode(bytes.slice(0,at))===label) {
                inline={raw:current.stringRawHex.slice(0,at*2),name:label};break;
              }
            } catch { /* A trail byte is not an inline delimiter. */ }
          }
        }
      }
      // Some translated operands omit '@' but retain the exact CP932 bytes
      // of a name from this story's Japanese native name slot before a quote.
      // Decode at that proven byte boundary; do not guess from a short prefix.
      if(!inline&&sourceLocale==='zh-CN')for(const [raw,name] of knownNames) {
        if(!raw||!String(name).trim()||!current.stringRawHex.startsWith(raw))continue;
        try {
          const bytes=Uint8Array.from(current.stringRawHex.match(/../gu)??[],byte=>parseInt(byte,16));
          const decodedPrefix=new TextDecoder('gb18030',{fatal:true}).decode(bytes.slice(0,raw.length/2));
          for(const prefix of new Set([decodedPrefix,String(name)])) {
            const body=text.slice(prefix.length),nativeQuote=body[0]==='「'?'8175':body[0]==='『'?'8177':null;
            // The source decoder already preserves mixed CP932 quote bytes in
            // an otherwise GB body. Re-decoding that body as pure GB would
            // turn the quote itself into mojibake.
            if(text.startsWith(prefix)&&nativeQuote&&current.stringRawHex.slice(raw.length).startsWith(nativeQuote)
              &&(!inline||raw.length>inline.raw.length))inline={raw,name,delimiter:'',body,rawNameText:prefix,
                proof:'same-story-native-JP-name-bytes-before-dialogue-quote'};
          }
        } catch { /* Only the established complete name byte boundary qualifies. */ }
      }
      const cp932Role=sourceLocale==='zh-CN'&&current.string!==null
        && Object.hasOwn(NARCISSU_SPEAKER_ZH,current.string.trim())?current.string:null;
      if(pending.parts.length===0 && !pending.speakerRaw && nativeSlot(instructions,i)
        && (sourceLocale!=='zh-CN'||knownNames.has(current.stringRawHex)||attestedNames.has(cleanName(text))||cp932Role)) {
        pending.speaker=nameText(cp932Role??text,current.stringRawHex);
        pending.speakerRaw={method:'native-name-slot',codeOffset:current.codeOffset,
          rawHex:current.stringRawHex,text,decodedText:knownNames.get(current.stringRawHex)??cp932Role??text};
      } else {
        if(pending.parts.length===0&&!pending.speakerRaw&&inline) {
          const delimiter=inline.delimiter??'@',separator=text.indexOf(delimiter);
          if(delimiter&&separator<0)throw new TypeError('Inline native name delimiter lost during source decoding');
          pending.speaker=nameText(inline.name,inline.raw);
          pending.speakerRaw={method:'native-inline-name-delimiter',codeOffset:current.codeOffset,
            rawHex:inline.raw,text:inline.rawNameText??text.slice(0,separator),decodedText:inline.name,delimiter,
            ...(inline.proof?{proof:inline.proof}: {})};
          text=inline.body??text.slice(separator+1);
        }
        if(pending.bodyCodeOffset===null)pending.bodyCodeOffset=current.codeOffset;
        pending.parts.push({kind:'text',text,codeOffset:source.codeOffset,rawText:source.text,rawHex:source.rawHex,
          textEventIndex:source.eventIndex,segmentIndex:source.segmentIndex});
      }
      continue;
    }
    if(rubyArguments.has(i)) {addInstruction(current);continue;}
    if(rubyBindings.has(i)) {
      const [readingIndex,baseIndex]=rubyBindings.get(i);
      const readingInstruction=instructions[readingIndex],base=instructions[baseIndex],call=current;
      const reading=stringByOffset.get(readingInstruction.codeOffset)??readingInstruction.string;
      const rawBaseText=stringByOffset.get(base.codeOffset)??base.string;
      const baseText=sourceLocale==='zh-CN'&&localizeNames?(NARCISSU_SPEAKER_ZH[rawBaseText]??rawBaseText):rawBaseText;
      if(reading===null||baseText===null)throw new TypeError('Undecodable native ruby operand');
      addInstruction(call);
      if(pending.bodyCodeOffset===null)pending.bodyCodeOffset=base.codeOffset;
      const ruby={kind:'ruby',text:baseText,rawText:rawBaseText,reading,codeOffset:base.codeOffset,
        readingCodeOffset:readingInstruction.codeOffset,callCodeOffset:call.codeOffset,callHex:call.hex,
        baseRawHex:base.stringRawHex,readingRawHex:readingInstruction.stringRawHex};
      pending.ruby.push(ruby);pending.parts.push(ruby);continue;
    }
    if(current.opcode===0x841) {if(pending)addInstruction(current);continue;}
    // ldc operands used by a native text formatting ctrl form a display program;
    // numeric arguments remain in provenance and are never mistaken for text.
    if(current.opcode===0x800) {
      let end=i;while(instructions[end]?.opcode===0x800)end++;
      const ctrl=instructions[end];
      if(ctrl?.opcode===0x842&&['s','o','d','x','z','r'].includes(ctrl.string)) {
        if(pending)for(let n=i;n<=end;n++)addInstruction(instructions[n]);
        if(pending)pending.controls.push({codeOffset:ctrl.codeOffset,value:ctrl.string,
          argumentHex:instructions.slice(i,end).map(q=>q.hex)});
        i=end;continue;
      }
    }
    if(current.opcode===0x842) {
      if(current.string==='p'||current.string==='w') {finish({codeOffset:current.codeOffset,control:current.string});continue;}
      if(pending&&['n','s','o','d','x','z','r'].includes(current.string)) {
        addInstruction(current);pending.controls.push({codeOffset:current.codeOffset,value:current.string});
        if(current.string==='n')pending.parts.push({kind:'linebreak',text:'\n',codeOffset:current.codeOffset});
        continue;
      }
    }
    finish({codeOffset:current.codeOffset,opcode:current.opcode,reason:'native-operation'});
  }
  finish({reason:'end-of-script'});
  if(consumed.size!==byOffset.size)throw new TypeError('Native display units did not preserve all source text operands');
  return groups;
}

/** Rebind the installed N10 patch by its explicit native target offsets.
 * A multi-segment translation remains one translation; native line-breaks
 * already inside that translation are never added a second time.
 */
export function localizeMajiroNativeUnit(group,script,sourceLocale) {
  const nativeUnit={...group.nativeUnit};
  const result={text:{[sourceLocale]:group.text},speaker:group.speaker===null?null:{[sourceLocale]:group.speaker},nativeUnit};
  if(script.translation?.alignment!=='exact-bytecode-order')return result;
  const entries=script.translation.entries??[];
  const translations=new Map();
  for(const entry of entries)if(Number.isInteger(entry.target?.codeOffset)) {
    if(translations.has(entry.target.codeOffset))throw new TypeError('Duplicate native translation target');
    translations.set(entry.target.codeOffset,entry);
  }
  const parts=group.nativeUnit.textParts, replacements=new Map(),bindings=[];
  const indices=[...new Set(parts.filter(part=>part.kind==='text').map(part=>part.textEventIndex))];
  for(const index of indices) {
    const source=script.textEvents[index],entry=translations.get(source.codeOffset);
    if(!entry||entry.target.kind!=='message')throw new TypeError('Native body has no exact patch translation target');
    const positions=parts.flatMap((part,i)=>part.kind==='text'&&part.textEventIndex===index?[i]:[]);
    const first=positions[0],last=positions.at(-1),span=parts.slice(first,last+1);
    if(span.some(part=>part.kind!=='linebreak'&&(part.kind!=='text'||part.textEventIndex!==index))
      ||span.map(part=>part.text).join('')!==source.text)
      throw new TypeError('Patch target straddles a native display program');
    const translated=String(entry.displayText??entry.text);
    replacements.set(first,{last,text:translated});
    bindings.push({field:'text',translationLine:entry.line,targetCodeOffset:source.codeOffset,
      sourceTextEventIndex:index,sourceRawHex:entry.rawHex,text:translated});
  }
  let translated='';
  for(let i=0;i<parts.length;i++) {
    const replacement=replacements.get(i);
    if(replacement) {translated+=replacement.text;i=replacement.last;continue;}
    const part=parts[i];
    if(part.kind==='linebreak')translated+=part.text;
    else if(part.kind==='ruby') {
      const entry=translations.get(part.codeOffset);
      if(!entry)throw new TypeError('Native ruby base has no exact patch translation target');
      translated+=String(entry.displayText??entry.text);
      bindings.push({field:'ruby',translationLine:entry.line,targetCodeOffset:part.codeOffset,
        sourceRawHex:entry.rawHex,text:String(entry.displayText??entry.text)});
    } else throw new TypeError('Unbound native translation fragment');
  }
  result.text['zh-CN']=translated;
  if(group.nativeUnit.speakerRaw) {
    const name=group.nativeUnit.speakerRaw;
    if(name.method!=='native-name-slot')throw new TypeError('Inline N10 speaker translation needs an explicit field target');
    const entry=translations.get(name.codeOffset);
    if(!entry||entry.target.kind!=='message')throw new TypeError('Native name has no exact patch translation target');
    const text=normalizeNarcissuChineseSpeaker(entry.displayText??entry.text);
    nativeUnit.speakerDisplayNormalization={source:String(entry.displayText??entry.text),display:text,method:'attested-patch-name-or-role-and-presentation-marker'};
    result.speaker={...result.speaker,'zh-CN':text};
    bindings.push({field:'speaker',translationLine:entry.line,targetCodeOffset:name.codeOffset,
      sourceRawHex:entry.rawHex,text:String(entry.displayText??entry.text)});
  }
  nativeUnit.translationBindings=bindings;
  return result;
}


/** A translated name pasted directly before a quote is separable only when a
 * unique native voice load/call in both versions identifies a JP name slot.
 * The text alone, a short string, or a filename prefix never proves a speaker.
 */
export function repairMajiroQuotedSpeakerPrefixes({variants,inputs}) {
  const labels=[...new Set(Object.values(NARCISSU_SPEAKER_ZH))];
  if(!variants.some(v=>v.sourceVariant.sourceLocale==='zh-CN'&&v.sections.some(s=>s.events.some(e=>
    !e.source?.nativeUnit?.speakerRaw&&labels.some(label=>['「','『'].some(mark=>e.text?.['zh-CN']?.startsWith(label+mark)))))))return variants;
  const inputById=new Map(inputs.map(input=>[input.variant.id,input]));
  const nativeById=new Map(inputs.map(input=>[input.variant.id,meaningful(parseMajiroInstructions(input.plain))]));
  const voiceBinding=(variant,event,cue)=>{
    const ins=nativeById.get(variant.variantId),raw=cue.raw,unit=event.source?.nativeUnit;
    if(!unit||cue.kind!=='voice'||cue.timing!=='utterance'||raw?.targetEventId!==event.eventId)return null;
    const at=ins.findIndex(i=>i.codeOffset===raw.codeOffset),load=ins[at],call=ins[at+1];
    if(load?.opcode!==0x801||load.string!==raw.sourceKey||call?.hex!=='1008f0fd2a81000000000100')return null;
    const between=ins.filter(i=>i.codeOffset>=call.codeOffset+call.length&&i.codeOffset<unit.codeOffset);
    if(between.some(i=>i.opcode!==0x800&&!(i.opcode===0x842&&i.string==='o')))return null;
    return {sourceKey:raw.sourceKey,loadCodeOffset:load.codeOffset,loadHex:load.hex,callCodeOffset:call.codeOffset,callHex:call.hex};
  };
  const jp=new Map();
  for(const variant of variants.filter(v=>v.sourceVariant.sourceLocale==='ja-JP'))for(const event of variant.sections.flatMap(s=>s.events))for(const cue of event.cues??[]) {
    const proof=voiceBinding(variant,event,cue);if(!proof)continue;
    if(!jp.has(proof.sourceKey))jp.set(proof.sourceKey,[]);
    jp.get(proof.sourceKey).push({variant,event,cue,proof});
  }
  return variants.map(variant=>{
    if(variant.sourceVariant.sourceLocale!=='zh-CN')return variant;
    const cn=new Map();
    for(const event of variant.sections.flatMap(s=>s.events))for(const cue of event.cues??[]) {
      const proof=voiceBinding(variant,event,cue);if(!proof)continue;
      if(!cn.has(proof.sourceKey))cn.set(proof.sourceKey,[]);
      cn.get(proof.sourceKey).push({event,cue,proof});
    }
    let changed=false;
    const sections=variant.sections.map(section=>({...section,events:section.events.map(event=>{
      const unit=event.source?.nativeUnit,first=unit?.textParts[0];
      if(event.kind!=='line'||unit?.speakerRaw||first?.kind!=='text')return event;
      const candidates=(event.cues??[]).flatMap(cue=>{
        const proof=voiceBinding(variant,event,cue),other=proof?jp.get(proof.sourceKey):null;
        if(!proof||cn.get(proof.sourceKey)?.length!==1||other?.length!==1)return [];
        const name=other[0].event.source?.nativeUnit?.speakerRaw;
        if(name?.method!=='native-name-slot')return [];
        const label=NARCISSU_SPEAKER_ZH[(name.decodedText??name.text).trim()];
        if(!label||!['「','『'].some(mark=>first.text.startsWith(label+mark)))return [];
        return [{label,proof,other:other[0],name}];
      });
      if(candidates.length!==1)return event;
      const {label,proof,other,name}=candidates[0];
      const bytes=Uint8Array.from(first.rawHex.match(/../gu)??[],byte=>parseInt(byte,16));
      let prefixLength=0;
      for(let at=1;at<bytes.length;at++)try {
        if(new TextDecoder('gb18030',{fatal:true}).decode(bytes.slice(0,at))===label){prefixLength=at;break;}
      }catch{/* Only a complete encoded character boundary is admissible. */}
      if(!prefixLength)return event;
      changed=true;
      const {presentationGroup:_oldGroup,...source}=event.source;
      return {...event,speaker:{...event.speaker,'zh-CN':label},text:{...event.text,'zh-CN':event.text['zh-CN'].slice(label.length)},
        source:{...source,nativeUnit:{...unit,
          textParts:[{...first,text:first.text.slice(label.length)},...unit.textParts.slice(1)],
          speakerRaw:{method:'native-inline-name-delimiter',codeOffset:first.codeOffset,rawHex:first.rawHex.slice(0,prefixLength*2),
            text:label,decodedText:label,delimiter:''},
          speakerPrefixProof:{method:'unique-native-voice-and-attested-JP-name-slot',cn:proof,jp:{...other.proof,
            variantId:other.variant.variantId,eventId:other.event.eventId,nameCodeOffset:name.codeOffset,nameRawHex:name.rawHex,
            nameText:name.decodedText??name.text}}}}};
    })}));
    if(!changed)return variant;
    return {...variant,sections:sections.map(section=>({...section,events:attachMajiroPresentationGroups({
      plain:inputById.get(variant.variantId).plain,variant:variant.sourceVariant,
      events:section.events.map(event=>{
        if(!event.source?.presentationGroup)return event;
        const {presentationGroup:_oldGroup,...source}=event.source;return {...event,source};
      }),
    })}))};
  });
}

/** A pause does not clear Majiro's message buffer. Preserve pause events but
 * join proven buffer continuations for reading. A new native name, paragraph
 * break, wipe, branch or unrecognised call is an explicit barrier.
 * Opcode reference: AtomCrafty/MajiroTools, Table-of-opcodes, ctrl p / ctrl w.
 */
export function attachMajiroPresentationGroups({plain,events,variant}) {
  const instructions=meaningful(parseMajiroInstructions(plain));
  const byOffset=new Map(instructions.map((x,i)=>[x.codeOffset,i]));
  const indexAt=offset=>byOffset.get(offset)??instructions.findIndex(x=>x.codeOffset>=offset);
  const connections=new Map();
  for(let index=1;index<events.length;index++) {
    const previous=events[index-1],current=events[index];
    const a=previous.source?.nativeUnit,b=current.source?.nativeUnit;
    if(previous.kind!=='line'||current.kind!=='line'||!a||!b
      ||a.boundary.control!=='p'||b.speakerRaw||previous.nextEventId!==current.eventId)continue;
    const gap=instructions.slice(indexAt(a.endCodeOffset),indexAt(b.codeOffset));
    let linebreaks=0,valid=true;const calls=[];
    for(let i=0;i<gap.length;i++) {
      const instruction=gap[i];
      if(instruction.opcode===0x841)continue;
      if(instruction.opcode===0x842&&['p','n','N'].includes(instruction.string)) {
        if(instruction.string!=='p')linebreaks++;
        continue;
      }
      const call=gap[i+1];
      if(instruction.opcode===0x801&&call?.opcode===0x810
        &&['1008f0fd2a81000000000100','10084131808e000000000100'].includes(call.hex)) {
        calls.push({argumentCodeOffset:instruction.codeOffset,argumentRawHex:instruction.stringRawHex,
          callCodeOffset:call.codeOffset,callHex:call.hex});
        i++;continue;
      }
      valid=false;break;
    }
    const trailing=(previous.text?.[variant.sourceLocale??'und']??'').match(/\n+$/u)?.[0].length??0;
    if(!valid||linebreaks+trailing>1)continue;
    connections.set(current.eventId,{previousEventId:previous.eventId,joinBefore:linebreaks?'\n':'',
      instructionCodeOffsets:gap.map(x=>x.codeOffset),voiceCalls:calls});
  }
  let chain=[];
  const finish=()=>{
    if(chain.length<2){chain=[];return;}
    const ids=chain.map(event=>event.eventId),locales=['zh-CN','ja-JP'];
    const visible=Object.fromEntries(locales.map(locale=>[locale,chain.filter(event=>String(event.text?.[locale]??'').trim()).map(event=>event.eventId)]));
    const first=Object.fromEntries(locales.map(locale=>[locale,visible[locale][0]??null]));
    const id='majiro-buffer-'+variant.id+'/'+ids[0];
    const joinBeforeByEventId=Object.fromEntries(ids.map((id,index)=>[id,index?connections.get(id).joinBefore:'']));
    const proof=chain.slice(1).map(event=>({eventId:event.eventId,...connections.get(event.eventId)}));
    chain.forEach((event,position)=>{
      event.source={...event.source,presentationGroup:{schema:'majiro-presentation-group/v1',id,
        displayJoinMode:'native-append',position,sourceEventIds:ids,visibleEventIdsByLocale:visible,
        firstVisibleEventIdByLocale:first,speaker:{'zh-CN':'','ja-JP':'',...chain[0].speaker},joinBeforeByEventId,
        allowFollowingVoiceCues:true,nativeBufferProof:proof}};
    });
    chain=[];
  };
  for(const event of events) {
    if(event.kind!=='line'){finish();continue;}
    if(chain.length&&!connections.has(event.eventId))finish();
    chain.push(event);
  }
  finish();return events;
}

/** Recover the menu function's actual argument order and native case targets.
 * menu.mjo $57f252db reads option zero from local argument offset -4; the
 * final two caller operands are the source line/file. Thus option #1 is the
 * last label pushed. Cases compare the returned integer, not the label text.
 */
export function wireMajiroNativeBranches({plain,strings,sourceLocale,events,groups,variant}) {
  const instructions=meaningful(parseMajiroInstructions(plain));
  const byOffset=new Map(instructions.map((x,i)=>[x.codeOffset,i]));
  const indexAt=offset=>byOffset.get(offset)??instructions.findIndex(x=>x.codeOffset>=offset);
  const labels=new Map((strings?.strings??[]).map(s=>[s.codeOffset,s.text]));
  const bytes=plain instanceof Uint8Array?plain:new Uint8Array(plain);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const selections=[];
  for(let i=0;i<instructions.length;i++) {
    const call=instructions[i];
    const menu=({db52f257:{debugArguments:2},e8c27928:{debugArguments:0}})[call.hex.slice(4,12)];
    if(call.opcode!==0x80f||!menu)continue;
    const count=view.getUint16(call.fileOffset+10,true);
    const args=instructions.slice(i-count,i);
    if(count<menu.debugArguments+2||args.length!==count||args.some(x=>x.opcode!==0x801))
      throw new TypeError('Unsupported native selection argument expression');
    const options=args.slice(0,count-menu.debugArguments).reverse();
    const head=instructions[i+1];
    if(head?.opcode!==0x830)throw new TypeError('Selection has no native case dispatcher');
    let at=indexAt(head.jumps[0]);const cases=[];
    const visited=new Set();
    while(at>=0&&!visited.has(at)) {
      visited.add(at);const constant=instructions[at],condition=instructions[at+1];
      if(constant?.opcode!==0x800||condition?.opcode!==0x831)break;
      const value=view.getInt32(constant.fileOffset+2,true);
      const begin=instructions[at+2];
      if(!begin)throw new TypeError('Missing native selection arm');
      cases.push({caseValue:value,conditionCodeOffset:condition.codeOffset,
        armCodeOffset:begin.codeOffset,nextCaseCodeOffset:condition.jumps[0]});
      at=indexAt(condition.jumps[0]);
    }
    if(cases.length===options.length-1&&at>=0&&cases.every(x=>x.caseValue<options.length)) {
      cases.push({caseValue:options.length,dispatchKind:'default',conditionCodeOffset:null,
        armCodeOffset:instructions[at].codeOffset,nextCaseCodeOffset:null});
    }
    if(cases.length!==options.length||cases.some(x=>x.caseValue<1||x.caseValue>options.length)
      ||new Set(cases.map(x=>x.caseValue)).size!==cases.length)
      throw new TypeError('Selection arms differ from native option operand count');
    const choiceId='mjo-choice-'+call.codeOffset.toString(16);
    const nativeSelection={schema:'majiro-native-selection/v1',codeOffset:args[0].codeOffset,
      endCodeOffset:call.codeOffset+call.length,callCodeOffset:call.codeOffset,callHex:call.hex,
      codeOffsets:[...args.map(x=>x.codeOffset),call.codeOffset],caseEdges:cases,
      options:options.map((x,index)=>({caseValue:index+1,codeOffset:x.codeOffset,rawHex:x.stringRawHex,text:labels.get(x.codeOffset)??x.string})),
      debugOperands:args.slice(count-menu.debugArguments).map(x=>({codeOffset:x.codeOffset,rawHex:x.stringRawHex,text:labels.get(x.codeOffset)??x.string}))};
    selections.push({eventId:choiceId,kind:'choice',choices:[],source:{engine:'majiro',
      variantSourceId:variant.id,scriptPath:variant.references.script,nativeSelection}});
  }
  if(!selections.length)return events;
  const positions=new Map(events.map((event,i)=>[groups[i].startOffset,event.eventId]));
  for(const event of selections)positions.set(event.source.nativeSelection.codeOffset,event.eventId);
  const nextEvent=start=>{
    let at=indexAt(start);
    const visited=new Set();
    while(at>=0&&at<instructions.length&&!visited.has(at)) {
      visited.add(at);const instruction=instructions[at];
      if(positions.has(instruction.codeOffset))return positions.get(instruction.codeOffset);
      if(instruction.opcode===0x82b)return 'end-001';
      if(instruction.opcode===0x82c) {at=indexAt(instruction.jumps[0]);continue;}
      if(['j','c'].includes(operandFormats.get(instruction.opcode)))return null;
      at++;
    }
    return 'end-001';
  };
  for(const selection of selections) {
    const native=selection.source.nativeSelection;
    selection.choices=native.options.map(option=>{
      const arm=native.caseEdges.find(x=>x.caseValue===option.caseValue);
      const target=nextEvent(arm.armCodeOffset);
      if(!target)throw new TypeError('Native choice target cannot be resolved to a display event');
      return {choiceId:selection.eventId+'-case-'+option.caseValue,
        label:{[sourceLocale]:String(option.text??'')},nextEventId:target,
        source:{nativeCaseValue:option.caseValue,operandCodeOffset:option.codeOffset,
          branchConditionCodeOffset:arm.conditionCodeOffset,branchArmCodeOffset:arm.armCodeOffset,rawHex:option.rawHex}};
    });
  }
  for(let i=0;i<events.length;i++) {
    const boundary=groups[i].nativeUnit.boundary.codeOffset??groups[i].nativeUnit.endCodeOffset;
    const target=nextEvent(boundary);
    if(target&&target!==events[i].eventId)events[i].nextEventId=target;
  }
  return [...events,...selections].sort((a,b)=>
    (a.source.nativeUnit?.codeOffset??a.source.nativeSelection.codeOffset)
    -(b.source.nativeUnit?.codeOffset??b.source.nativeSelection.codeOffset));
}
