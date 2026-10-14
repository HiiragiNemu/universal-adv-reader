# Cloudflare Direct Upload 发布与维护

## 独立项目及权限

实现目录是 `D:\PROGETTO\universal-adv-reader`。Cloudflare 资源只使用 `universal-adv-reader`（主站）、`universal-adv-media-a`／`universal-adv-media-b`（常规静态资源）、`universal-adv-large-media`（超限原始音频 Worker）及 `universal-adv-media`（其专用 R2 桶）。不复用或修改魔纪 Reader、AIO、L2D、3Dviewer 的服务或口令。

运行时原始资源来自相邻 `../narcissu-kana-research`，可用 `ADV_CORPUS_REPOSITORY` 指定。本机已有依赖已从其他项目的目录联接改为物理独立安装。使用 Node.js 24、`npm --prefix apps/classic-reader ci` 复现锁定依赖；使用已有 Wrangler 登录或正常 `wrangler login`，不读取和复制凭据文件。

## 日常更新

```powershell
Set-Location -LiteralPath 'D:\PROGETTO\universal-adv-reader'
npm run publish:cloudflare
```

主链依次运行根测试、应用测试、TypeScript、生产依赖漏洞审计、静态构建、独立本机浏览器验收、直接上传、完整页面 HEAD 检查、媒体原始字节与超限文件 Range 抽样、缓存和权限检查，以及公网浏览器回归。任一阶段失败即报错，不把部署成功等同于所有验收通过。

媒体新增或变化时运行 `npm run publish:cloudflare -- --media`。这会重新审计引用，构建媒体清单并上传发生变化的资源；已有相同哈希的 R2 对象和相同根哈希的静态分片不重复部署。首次迁移到另一台机器需要资源仓输入，并执行带 `--media` 的准备流程。

当前本机网络需要代理时，仅在当前 PowerShell 窗口设置：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
npm run publish:cloudflare
```

不需要代理时不要设置。浏览器验收使用独立临时 Edge 配置，不连接正在使用的浏览器；其他浏览器路径可通过 `ADV_BROWSER_EXECUTABLE` 指定。本机生产验证端口默认 4181，可用 `ADV_VERIFY_PORT` 改变；端口已被占用时停止，不关闭占用者。

## 为什么不消耗 GitHub Actions

所有构建和验收在本机执行，Wrangler 把预构建文件直接上传 Cloudflare。没有 Actions workflow，没有通过推送触发云端构建，也没有连接 Cloudflare Git 构建；GitHub 代码同步与网站部署分开。此保证指 GitHub Actions 运行额度，不表示 Cloudflare 存储和请求量永远零费用；R2 和大音频 Worker 仍按账户自身配额／套餐计量。

站长于 2026-10-15 明确授权后，创建公开仓库 `HiiragiNemu/universal-adv-reader` 并绑定为本机 `origin`；默认分支为 `main`，仓库级 Actions 已关闭。当前工程正常提交推送，不强推、不覆写历史，不改动已归档的 `narcissu-kana-research` 或其他 Reader 仓库。正式发布前确认本机提交与 `origin/main` 一致、工作区干净；发布后检查 `release.json` 的 `gitRevision` 和 `sourceDirty=false`，再读回 GitHub 与公网版本。

## 内容、缓存与版本一致性

构建保留原始公开剧情、native IDs、分支、字幕、选项和修订。仅在构建投影中将两个清单的本机根目录替换成公开描述；进度内部快照经过所有 SHA-256 绑定验证后，向浏览器提供其 API 载荷而非存储外层。

`work/cloudflare-app` 是源代码的受控构建投影，不是新的实现工程。不会搬走本机 API。Windows Next 静态导出中错误嵌套的 RSC 文件生成字节一致的扁平别名；不改 node_modules，不关闭预取掩盖 404。

主站页面和可变数据使用 `max-age=0, must-revalidate`，带内容哈希的 JS/CSS 使用一年 immutable 缓存。每次发布前后核对内容清单和来源哈希；公开 `release.json` 中 `sourceDirty=true` 表示构建含未提交代码，不用旧 HEAD 冒充已提交的新版本。普通刷新即能重新验证最新内容，无需清空本地编辑、主题或阅读记录。

24,714 个当前媒体引用总计约 5.36 GB；常规媒体 A/B 分片保持小于各自 20,000 文件和 25 MiB 单文件限制。22 个超限 URL 对应 11 份字节相同可去重音频，存于 R2；Worker 提供 GET、HEAD、OPTIONS、单范围 Range、ETag、CORS。只允许内容哈希音频键，不提供桶列表、上传、删除或任意转发接口。未降低音质。

实际边缘测试中，Pages 常规媒体对 Range 请求返回完整文件（200），并非 206。检查器因此校验这些样本的完整长度和 SHA-256，而不是只校验前 32 字节；R2 超限音频仍严格要求 206 与正确 Content-Range。另发现部分 OGG 在这种响应下出现时长估算错误及定位回到零的问题。公共播放器对确实没有可定位范围的音频，在同一已激活 Audio 元素中使用原始编码字节的有界 Blob 传输，保留当前播放位置、暂停状态、原始 cue 和资源 URL；上限 25 MiB，失败不打断原有可播放流，停止／切篇会取消读取并释放 Blob。支持 Range 的音频不做这次读取，超限音频继续走 R2。浏览器另行检验实际播放和定位；不转码、不降低音质，也不为每个小语音额外引入 Worker 调用。

上传后除 no-cache 读取外，公网门禁还等待普通 GET 的版本、进度和配置切换到当前构建。曾实际出现上传读回已是新版、随后普通 GET 短暂返回上一版的情况；普通读取现在复用最多八次的有界只读重试。旧版本不会被视为通过，永久版本不符仍失败；此步骤不会重新上传，也不为掩盖失败而更换 URL 或加入缓存绕过参数。

构建回执包含应用、根 packages/tools、依赖锁、配置及媒体清单的完整输入指纹，并为每个部署输出保存 SHA-256。新增、删除、同大小改写以及构建后修改暂存输出均会阻止发布，必须重新构建。已提交版本号与 dirty 状态独立保存，不能把同一构建内容误标为另一个 Git 提交。

## 正文搜索故障恢复

搜索清单的 408、429、5xx、网络中断或超时最多尝试三次，退避等待可被页面切换立即取消；正常响应只请求一次。403 等权限错误、无效清单和剧情目录 SHA-256 不一致仍然直接报错，不能用空索引伪装成功。持续失败后可在原页面点击“重试正文搜索”，保留当前关键词、语言和模式，不刷新整页或清除阅读／编辑记录。清单异步就绪时只重放当前请求，不回放旧关键词。标题搜索不依赖正文索引，故障时仍然可用。

本机和公网发布门禁均运行独立浏览器故障注入，验证单次 503 自动恢复、三次失败后的原页重试、快速切换关键词不显示旧结果，以及标题搜索降级。故障仅在隔离浏览器中模拟，不修改生产服务。

## 扩展界面验收

`node tools/cloudflare/verify-expanded-matrix.mjs` 检查五主题 × 桌面／窄屏 × 首页／正文／编辑／设置，共 40 个组合；默认检查正式站，可通过 `ADV_TEST_BASE` 指向本机生产预览。它读取当前构建回执核对版本，保存各组合截图、可见性、视口边界及横向溢出，并检查设置页脚文字和缩放把手保留间距。它不等于 iOS 真机或人工内容验收。

设置窗口原先的 28px 右边距处于 CSS 层内，被未分层的全局 padding 简写覆盖成 12.8px，导致页脚文字与 24px 缩放把手重叠约 11.2px。修复只提升该预留边距的级联优先级，不删除把手、缩放、拖动、主题或页脚文案。常规本机／公网发布门禁均包含五主题窄屏的实际文字边界回归。

## 公网与本机功能边界

公网提供阅读、搜索、五主题、语音、浏览器内编辑及导入／导出。打开本地文件仅在浏览器读取；静态 `/reader/local?local=1` 不泄露原文件名。导出测试使用独立虚构文本，不污染实际正文。

编辑资料未完成加载时，首次点击“协助汉化”显示“准备编辑”，加载完成自动进入，第二次点击可取消；切换剧情不继承前一篇的请求。校对列表的 `?edit=1` 链接会在对应原生资料就绪后进入编辑。失败提示在阅读界面可见，不再隐藏在尚未打开的编辑面板里。

审核、批准、安装、回滚等本机文件系统操作只在本机执行。公网 `/api/native-reviews` 不存在。在线投稿采用 GitHub Issues，由 GitHub 处理账号与持久化；原生编辑页在用户同意公开后生成草稿，必须到 GitHub 再确认提交。本机 `npm run review:github -- --issue NUMBER` 只导入来源验证通过的待审记录，绝不自动应用。完整流程见 [GitHub 投稿说明](github-contributions.md)。站点未发布 `.git`、环境文件、原始安装 EXE、存档、内部报告、浏览器配置或源映射。

## 排障及回退

`reports/verification/cloudflare-20261014` 保存具体检查、构建、上传与公网回执。`work/cloudflare/build-receipt.json` 为当前构建清单；`work/cloudflare/site-deployment.json` 记录正式和不可变地址；`work/cloudflare/media-deployment.json` 记录媒体根哈希。只有实际命令成功并读回一致才视为发布成功。

发布链锁 `work/cloudflare/release.lock` 和上传锁 `work/cloudflare/deploy.lock` 防止并行构建／覆盖。发现锁时先核实记录的进程是否仍在运行，不直接删锁或启动第二个上传。现有上传失败后可以重试，由哈希检查跳过已完成资源。

主站上传成功后立即写入 `work/cloudflare/site-upload.json`，再分别核对固定版本和正式地址。短暂的 522／503、网络错误或旧版本传播会执行有上限的退避重试；403 等权限错误直接失败，最终不一致仍不得标为成功。重试只针对读取，不重复远端写操作。上传已完成但回读中断时，可执行：

```powershell
node tools/deploy-cloudflare.mjs --verify-only
```

该命令要求当前输入、输出和已记录上传身份全部相符，不上传第二个版本。代码或正文已经变化则拒绝复用旧回执，改用完整 `npm run publish:cloudflare`。

需要回退时，在 Cloudflare Pages 对这个独立项目选择先前已验收的 production deployment 进行 rollback；不回滚原始游戏，不重写 Git 历史，也不关闭其他项目。正文或媒体已更新时，应同时核对匹配的清单／分片，而不是只回退页面壳。

## 官方参考

- Cloudflare Direct Upload：https://developers.cloudflare.com/pages/get-started/direct-upload/
- Pages 缓存和路由：https://developers.cloudflare.com/pages/configuration/serving-pages/
- R2 Worker API：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Next.js Windows RSC 导出问题：https://github.com/vercel/next.js/issues/92339
- Tailwind 源文件显式检测：https://tailwindcss.com/docs/detecting-classes-in-source-files
