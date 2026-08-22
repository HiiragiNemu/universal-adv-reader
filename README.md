# Universal ADV Reader

独立的通用 ADV 在线阅读器与接入基线。

这个仓库与资源归档仓库分离：

- 本仓库：Reader 外壳、AdvIR、适配器/媒体解析器接口、稳定深链和跨站桥接。
- `D:\PROGETTO\narcissu-kana-research`：原始归档、提取结果、逆向证据和后续的游戏格式适配产物。
- `magi-reader`：只读架构参考；本仓库没有复制或修改其源码。

## 当前阶段

已实现的目标：

- 作品无关的 `adv-story/v1` 中间表示；
- `corpusId + adapterId + sourceFormat` 精确选择适配器，禁止轮流试读；
- 稳定的 `canonicalStoryId / sectionId / eventId / variantId` 定位；
- 文本、选项、分支以及图像/音频 cue 的统一事件模型；
- 媒体 resolver 注册表；
- 所有剧情都可展开语音路由面板，未解析 cue 也保留可见槽位；
- 深链与 `MessagePort` App Bridge provider；
- 无框架依赖的可运行 Web Reader；
- `classic` 继承版与 `next` 迁移候选双外壳，共用同一 ReaderSession / AdvIR / media / bridge；
- 十周年版 `narcissu-himeko/himeko_ep00` 的日文、中文对照与英文三版本；
- 该剧情的 13 条逻辑文本、22 个日英语音文件、背景图、BGM 与音效精确路由。

当前首个 Majiro 生产切片直接读取 `narcissu-kana-research` 的已验证产物。KANA、Narcissu 3 与十周年版其余剧情沿用同一生产导入边界继续接入。

## 运行

需要 Node.js 22 或更新版本，不需要安装第三方依赖。

```powershell
npm run check
npm run serve
```

然后打开：

```text
http://127.0.0.1:4173/apps/web/
```

开发服务器把相邻的 `D:\PROGETTO\narcissu-kana-research` 以 `/corpus/` 只读挂载；也可用 `ADV_CORPUS_REPOSITORY` 指定同一仓库的实际位置。大体积图像和音频不会复制进本仓库。

## 目录

```text
apps/web                 可运行 Reader 外壳
contracts                JSON Schema
packages/contracts       AdvIR 与清单验证
packages/core            适配器、媒体解析器、阅读会话
packages/bridge          稳定深链与 MessagePort 协议
packages/adapters        预规范化 AdvIR 参考适配器
packages/ui-shell        classic / next 共享外壳合同
tools/import-narcissu10  只读导入首个十周年版生产剧情
docs                     架构和接入说明
test                     Node 内建测试
```

## 许可

当前仓库标记为 `UNLICENSED`，在明确开源或商业许可策略前不附加许可证。
