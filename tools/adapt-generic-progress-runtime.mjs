import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'reports/verification/reader-inheritance-20261012/atom16');
const saved=JSON.parse(fs.readFileSync(path.join(dir,'baseline-index.json'),'utf8'));
const read=f=>fs.readFileSync(path.join(dir,'baseline',f),'utf8').replaceAll('\r\n','\n');
const changes=new Map(),app='apps/classic-reader/';
const one=(s,a,b)=>{if(s.indexOf(a)<0||s.indexOf(a)!==s.lastIndexOf(a))throw Error('Changed anchor: '+a);return s.replace(a,b);};
const between=(s,start,end,value)=>{const a=s.indexOf(start),b=s.indexOf(end,a+start.length);if(a<0||b<0)throw Error('Missing range '+start);return s.slice(0,a)+value+'\n\n'+s.slice(b);};
for(const f of saved.filter(f=>f.includes('/app/api/')&&f.endsWith('/route.ts'))){
  let s=read(f);const methods=[...s.matchAll(/export async function (GET|POST|PATCH|DELETE)\(/g)].map(m=>m[1]);
  s=s.replace(/export async function (GET|POST|PATCH|DELETE)\(/g,'async function retainedReader$1(');
  if(f.endsWith('/proofreading/machine-status/route.ts')){
    s="import { buildCurrentGenericProgress } from '@/lib/generic-progress-server';\n"+s;
    s+='\n// Generic runtime exports: original review implementation remains above.\nexport const dynamic = \'force-dynamic\';\nexport async function GET() {\n  try { return Response.json(await buildCurrentGenericProgress(), { headers: { \'Cache-Control\': \'no-store\' } }); }\n  catch (error) { console.error(\'Generic progress source mismatch\', error); return Response.json({error:\'本地原生进度暂不可用，请检查目录、事件对应与修订版本。\'}, {status:503,headers:{\'Cache-Control\':\'no-store\'}}); }\n}\n';
  }else{
    s="import { genericBackendResponse } from '@/lib/generic-backend';\n"+s;
    s+='\n// Generic runtime exports: retained Reader handlers require a separate generic backend.\n'+methods.map(m=>`export async function ${m}() { return genericBackendResponse(${f.endsWith('/proofreading/config/route.ts')?'true':'false'}); }`).join('\n')+'\n';
  }
  changes.set(f,s);
}
for(const f of saved.filter(f=>(f.includes('/app/review/')||f.includes('/app/proofreading/'))&&f.endsWith('/page.tsx'))){
  let s=read(f);const progress=f.includes('machine-translations')||f.includes('exedra-localization');const component=progress?'GenericProgressReview':'GenericBackendStatus';
  s=one(s,"'use client';",`'use client';\n\nimport ${component} from '@/components/${component}';`);
  s=s.replace(/export default function ([A-Za-z]+Page)\(/,'function retainedReader$1(');
  s+=`\n// Generic runtime default: the original reusable interface remains above.\nexport default function GenericPage() { return <${component} />; }\n`;
  changes.set(f,s);
}
let s=read(app+'app/page.tsx');
s=one(s,"import { loadStoryIndex } from '@/lib/story-index';","import { loadStoryIndex } from '@/lib/story-index';\nimport { readGenericProgress, type GenericProgress } from '@/lib/generic-progress';");
s=between(s,'type ProofreadingStatus = {','const CATEGORY_CONFIG:','type ProofreadingStatus = GenericProgress;');
s=s.replaceAll("'human-cn'","'with-cn'").replaceAll("'machine-verified'","'without-cn'").replaceAll("'machine-unverified'","'needs-review'");
s=s.replace("label: '人工汉化'","label: '有中文'").replace("label: '机翻已校对'","label: '无中文'").replace("label: '机翻未校对'","label: '中文待核对'");
s=between(s,'const categorySourceFilterProgressForStories = (','const categorySourceProgressText = (',`const categorySourceFilterProgressForStories = (
  stories: readonly Story[], sourceStatusKnown: boolean,
): CategorySourceFilterProgress => {
  const progress = emptyCategorySourceFilterProgress(sourceStatusKnown);
  for (const story of stories) {
    progress.all.value += storyProgress(story); progress.all.maximum += 100; progress.all.chapters += 1;
    for (const filter of ['with-cn','without-cn','needs-review'] as const) {
      progress[filter].maximum += 1; progress[filter].chapters += 1;
      if (filter === 'without-cn' ? !story.has_cn : story.has_cn) progress[filter].value += 1;
    }
  }
  return progress;
};`);
s=between(s,'const categorySourceProgressText = (','const translationProgressStatus = ',`const categorySourceProgressText = (
  filter: CategorySourceFilter, metric: CategorySourceProgressMetric, percent: number,
): string => {
  const label = CATEGORY_SOURCE_FILTERS.find(option => option.value === filter)?.label ?? filter;
  if (!metric.available) return label + '数据尚未加载。';
  if (filter === 'all') return '中文槽位覆盖 ' + percent + '%，按 ' + metric.chapters + ' 个公开章节等权聚合；不是人工审核进度。';
  return label + '占比 ' + percent + '%，' + metric.value + '/' + metric.maximum + ' 个公开章节；存在中文不等于译文质量已核对。';
};`);
s=between(s,'const storyMatchesCategorySourceFilter = (','const storyMatchesCategorySourceFilters = (',`const storyMatchesCategorySourceFilter = (story: Story, filter: CategorySourceFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'without-cn') return !story.has_cn;
  return Boolean(story.has_cn);
};`);
s=one(s,'.then(response => response.ok ? response.json() as Promise<ProofreadingStatus> : null)',".then(async response => { if (!response.ok) throw Error('通用进度 HTTP ' + response.status); return readGenericProgress(await response.json()); })");
s=between(s,'  const enrichedStories = useMemo(() => {','  useEffect(() => {\n    if (enrichedStories.length === 0)',`  const enrichedStories = useMemo(() => {
    const progress = new Map(proofreadingStatus?.entries.map(entry => [entry.id,entry]) ?? []);
    return stories.map(story => {
      const current = progress.get(story.id);
      return { ...story, has_cn: current?.hasChinese ?? story.has_cn,
        percent: current?.coveragePercent ?? story.percent,
        source_unverified: current?.hasChinese ?? story.has_cn, human_verified: false };
    });
  }, [proofreadingStatus, stories]);`);
s=between(s,'  const manualClosedCount =','  const renderMobileReviewButton = (',`  const manualRemainingCount = proofreadingStatus?.needsReview ?? 0;`);
s=one(s,'const completionPercent = groupSourceCompletionPercent(group.items);','const completionPercent = avgPercent;');
s=one(s,'const completionPercent = storySourceCompletionPercent(story);','const completionPercent = progress;');
s=s.replace("'--magi-folder-translated-progress-end': `${groupSourceProgress.translatedPercent}%`","'--magi-folder-translated-progress-end': `${avgPercent}%`");
s=s.replace("'--magi-folder-translated-progress-end': `${!story.source_unverified || story.human_verified ? progress : 0}%`","'--magi-folder-translated-progress-end': `${progress}%`");
s=s.replaceAll('人工／核验完成 ${completionPercent}% · 文本覆盖 ${avgPercent}%','中文槽位覆盖 ${avgPercent}% · 人工核对待完成').replaceAll('人工／核验完成 ${completionPercent}% · 文本覆盖 ${progress}%','中文槽位覆盖 ${progress}% · 人工核对待完成');
s=between(s,"    const progressBasis = option.value === 'all'",'    return {\n      enabled,',"    const progressBasis = option.value === 'all' ? 'native-slot-percent-average' : 'native-story-share';");
s=s.replaceAll('魔法纪录人工校验总览','Narcissu／加奈 中文覆盖总览');
s=between(s,'                        总计 {proofreadingStatus.total} 部，','                      </p>\n                      <p className="magi-home-review-scope',`                        公开 {proofreadingStatus.total} 篇，有中文 <strong>{proofreadingStatus.withChinese}</strong> 篇，无中文 <strong>{proofreadingStatus.withoutChinese}</strong> 篇；中文待核对 <strong>{proofreadingStatus.needsReview}</strong> 篇。`);
s=between(s,'                        来源待核验清单已标记','                      </p>\n                    </div>',`                        归档 {proofreadingStatus.archive.stories} 篇、{proofreadingStatus.archive.variants} 个版本；中文槽位 {proofreadingStatus.chineseRows}/{proofreadingStatus.rows}（含选项）。未证实跨版本对应仍保留原文；有中文不等于人工审核完成。`);
s=s.replaceAll('校验进度','中文槽位覆盖').replaceAll('Math.round((manualClosedCount / proofreadingStatus.total) * 100)','proofreadingStatus.coveragePercent').replaceAll('(manualClosedCount / proofreadingStatus.total) * 100','proofreadingStatus.coveragePercent');
s=s.replaceAll('只看来源待核验剧情','只看中文待核对剧情').replaceAll('管理待核验标记','查看覆盖与待核对清单').replaceAll('来源待核验','中文待核对').replaceAll('人工校验清单读取失败','通用覆盖清单读取失败');
s=s.replaceAll('人工翻译 ${selectedCategorySummary.counts', '有中文 ${selectedCategorySummary.counts').replaceAll('机翻待校对 ${selectedCategorySummary.counts','中文待核对 ${selectedCategorySummary.counts').replaceAll('机翻已校对 ${selectedCategorySummary.counts','无中文 ${selectedCategorySummary.counts');
s=s.replaceAll('data-stat="human">人工','data-stat="human">有中文').replaceAll('data-stat="verified">已校','data-stat="verified">无中文');
// No remote destination is guessed. Reuse the existing action appearance.
s=one(s,'                关于\n              </button>','                关于\n              </button>\n              <Link href="/proofreading/status" data-generic-revisions-link className="magi-home-review-action rounded-lg border px-3 py-2 text-xs font-black">修订与投稿</Link>');
changes.set(app+'app/page.tsx',s);
let about=read(app+'components/AboutModal.tsx');
about=between(about,'const LINKS = [','export default function AboutModal',`const LINKS = [
  { href: '/', icon: '目录', iconClass: 'from-[#12b7f5] to-[#0084d1]', title: 'Narcissu／加奈 作品目录', subtitle: '公开剧情与三部作品筛选' },
  { href: '/review/machine-translations', icon: '进度', iconClass: 'from-[#f59e0b] to-[#d97706]', title: '中文覆盖与待核对', subtitle: '按实际原生事件、作品和版本统计，不冒认人工验收' },
  { href: '/proofreading/status', icon: '帮助', iconClass: 'from-[#06b6d4] to-[#0891b2]', title: '汉化修订与投稿帮助', subtitle: '原生补丁、版本化 TXT、检索及本地回滚' },
  { href: '/native-reader-revisions.json', icon: '版本', iconClass: 'from-[#8b5cf6] to-[#7c3aed]', title: '本地修订索引', subtitle: '原始资源保留，独立修订按版本追溯' },
  { href: 'https://search.bilibili.com/all?keyword=MadeInMagius', icon: 'B站', iconClass: 'from-[#fb7299] to-[#e04b76]', title: 'Reader UI 作者 MadeInMagius', subtitle: '继承的 UI 作者署名与动态' },
];`);
about=about.replace('title="我的其他工具和动态"','title="通用阅读器 · 关于与帮助"').replace('SYS://MAGIREADER.LINKS','SYS://ADVREADER.HELP');changes.set(app+'components/AboutModal.tsx',about);
for(const f of ['tools/verify-reader-inheritance-atom.mjs','tools/rollback-reader-optics-foundation.mjs'])changes.set(f,one(read(f),"'atom14', 'atom15']","'atom14', 'atom15', 'atom16']"));
for(const [f,value]of changes){const active=path.join(root,f),before=fs.readFileSync(path.join(dir,'baseline',f));if(!fs.readFileSync(active).equals(before))throw Error('Concurrent change: '+f);const bytes=Buffer.from(before.includes(Buffer.from('\r\n'))?value.replaceAll('\n','\r\n'):value);const candidate=path.join(dir,'modified',f);fs.mkdirSync(path.dirname(candidate),{recursive:true});fs.writeFileSync(candidate,bytes);}
for(const [f]of changes)fs.copyFileSync(path.join(dir,'modified',f),path.join(root,f));
console.log('Promoted '+changes.size+' baseline-guarded runtime adaptations');
