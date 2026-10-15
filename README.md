# Universal ADV Reader

通用 ADV 双语阅读、原生章节导航、语音播放和文本修订项目。正式界面是 `apps/classic-reader`，不是为单一游戏重建的阅读器。`AdvIR`、适配器、媒体解析、稳定深链与跨站桥接继续采用作品无关的协议；目前接入 Majiro、IKURA 以及中文 TXT 资料。

**公共网站：** https://universal-adv-reader.pages.dev/apps/web  
**公开源码与投稿：** https://github.com/HiiragiNemu/universal-adv-reader

仓库为 public；`package.json` 中的 `private: true` 仅防止误发布到 npm。仓库级 GitHub Actions 已关闭，代码同步、Cloudflare Git 云构建和保留的直接发布工具均不依赖 Actions。

## 当前内容与校对口径

当前索引收录 202 个游戏脚本，展开为 255 个原生章节／片段、20 张作品／阶段卡；另有 10 个来源版本的 121 个中文资料篇目，共 323 个索引条目。518 条归档、1,207 个源版本属于研究归档口径，不代表 518 篇独立公开剧情。

当前阅读投影为 84,311 个中文段落／选项，其中 84,175 个已校对、136 个站长补译待校对，涉及 7 个游戏脚本。原汉化组译文及站长提供的中文资料按已校对统计，补译逐段标为“站长补译 · 待校对”；跨章中文直接显示，中文独有资料不伪造日文。动态计数以实际索引和版本绑定的进度快照为准，不以 README 数字替代运行时校验。

## 本地开发

需要 Node.js 24 或更新版本。依赖在本项目独立安装，不再联接其他 Reader 的 `node_modules`。

```powershell
npm --prefix apps/classic-reader ci
npm run serve:classic
```

本机入口为 `http://127.0.0.1:4176/apps/web`。默认只读挂载相邻的 `../narcissu-kana-research`；也可以通过 `ADV_CORPUS_REPOSITORY` 指定资源研究仓目录。不要把原始安装包、存档或临时 RAMDISK 当作可覆盖的发布目录。

公开源码不包含第三方字体二进制、游戏安装包或原始音视频。完整的保真测试和媒体发布需要另外准备有权使用的资源；缺少这些输入时应明确报错，不下载未知替代品、不假报通过。现有部署机器保留这些输入，不受 Git 忽略规则影响。必要历史基准已整理到 `test-support/fixtures`，记录来源和 SHA-256，不再依赖维护者私有报告目录或另一 UI 仓库的绝对路径。

当前锁定 Next.js 16.4.0、React 19.3.0、Wrangler 4.150.0，并修复本轮审计发现的间接依赖漏洞。锁文件是复现依据，不通过安装浮动 latest 隐式升级其他项目。

## Cloudflare 公共发布：不使用 GitHub Actions

日常网站构建新增 Cloudflare 原生 Git 模式：`main` 的提交由 Cloudflare 拉取，使用嵌套依赖锁安装、校验云端输入、执行根／应用测试、TypeScript 与依赖审计，再生成静态网站。无需站长电脑在线，无需 GitHub Actions，也不向 GitHub 提交字体或游戏音频二进制。

Cloudflare 项目构建设置：

| 设置 | 值 |
|---|---|
| Git 仓库 / 生产分支 | `HiiragiNemu/universal-adv-reader` / `main` |
| 构建命令 | `npm run build:cloudflare:git` |
| 输出目录 | `work/cloudflare-app/out` |
| 根目录 | 仓库根目录 |
| 环境变量 | `NODE_VERSION=24.19.0`, `SKIP_DEPENDENCY_INSTALL=1`, `NODE_OPTIONS=--max-old-space-size=6144` |

原站 `universal-adv-reader.pages.dev` 创建为 Direct Upload，Cloudflare 不允许原地增加 Git source。迁移候选 `universal-adv-reader-git` 用于先验证原生 Git 构建；同名重建及旧固定版本链接失效需要单独确认，在切换前原正式项目不删除。实际服务版本与构建模式以站点 `release.json` 的 `gitRevision`、`sourceDirty`、`delivery` 为准，不把候选成功冒充正式域名完成切换。

`config/cloudflare` 保存可复现的公开媒体映射和已发布界面资产的完整 SHA-256。构建只接受精确字节，缺少资产或源不符时失败，不借用本机研究目录、不降级成缺字字体。媒体仍由现有静态分片及 R2 提供，不因普通代码／正文更新而重复上传。

保留的 `npm run publish:cloudflare` 是迁移前维护／应急直传链，执行本机和公网真实浏览器验收；它不是 Git 云构建的前置步骤。Cloudflare 云端的测试与构建通过不等于 iOS 真机或人工全文验收。完整操作、媒体更新和回退边界见 [Cloudflare 部署说明](docs/cloudflare-deployment.md)。

### 本地功能与公网功能

公共站保留五主题、搜索、目录、双语阅读、语音、浏览器内文本编辑、补丁导入和导出，以及打开本地文件。选择的本地文件不上传，公共静态入口不把文件名放入 URL。

本机工程保留审核队列、批准、显式安装和回滚。公共站不暴露这些基于本机文件系统的写接口。在线投稿使用 GitHub Issues：用户明确同意公开后生成草稿，再在 GitHub 登录、检查并提交；只有获得 Issue 编号才算投稿成功。导出或生成草稿不表示已上传。站长导入时校验当前原生来源与修改前值，投稿不会自动批准或覆盖正文。详见 [投稿与审核](docs/github-contributions.md)。

## 部署布局

主站以静态页面、JSON、搜索块与字节不变的剧情数据发布。常规媒体拆分为两个静态资源项目，保持原 URL 对应和原始音质；超过 Pages 单文件限制的 11 份去重音频由专用 R2 桶及只读 Worker 提供，支持 Range、HEAD、ETag 与 CORS。

所有公开剧情页和可变索引要求重新验证缓存，带哈希的 JS/CSS 长期缓存。`release.json` 公开本次构建 ID、来源代码和内容哈希、Git HEAD 以及工作区是否含未提交修改，防止用旧提交号冒充最新未提交代码。

本项目与 `magi-reader`、资源研究仓、AIO、L2D、3Dviewer 的部署和写入边界分离。唯一工程远端为 `HiiragiNemu/universal-adv-reader`；不向资源研究仓推送 UI，也不解档或覆盖其他仓库。

## 目录与历史夹具

- `apps/classic-reader`：当前正式 UI、本机 API 及独立依赖。
- `packages/contracts`、`packages/core`、`packages/bridge`、`packages/adapters`：通用 AdvIR、适配器、媒体解析及桥接。
- `tools/build-cloudflare-pages.mjs`、`tools/deploy-cloudflare.mjs`：构建投影和直接上传。
- `tools/cloudflare`：静态协议投影、媒体 Worker、真实浏览器与公网验证。
- `test-support/fixtures`：25 份独立测试基准及逐文件来源哈希；不是已通过测试的代用品。
- `apps/web`、原 `npm run serve`：隔离的无框架历史回归夹具，不是当前正式目录。
- `reports/handoff`、`reports/verification`：本地交接与验证证据；不批量公开内部报告或浏览器资料。
- `work/`：可重建的构建产物、媒体硬链接、上传回执，不提交 Git。

`tools/materialize-classic-reader-data.mjs` 的旧全量物化入口可能清空目标目录。已有修订和审核记录未保护前不得在活跃数据目录直接运行；先生成候选并校验差异。

## 来源与许可

Classic UI 继承了现有 `magi-reader` 实现和材质，不宣称整个仓库是未复制 UI 的 clean-room 项目。来源边界见 [NOTICE](NOTICE.md)。游戏素材、原作文字和汉化文本保留各自归属和署名。本项目继续标记 `UNLICENSED`，不擅自为第三方素材重新授予开源许可。
