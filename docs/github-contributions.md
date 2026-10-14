# GitHub 投稿与本机审核

本项目的公开仓库为 https://github.com/HiiragiNemu/universal-adv-reader ，正式阅读站为 https://universal-adv-reader.pages.dev/apps/web 。GitHub Issues 提供投稿账号、持久化编号和讨论记录；审核、安装及发布保持维护者明确操作，不运行 GitHub Actions，不在浏览器保存维护者令牌。

## 读者提交

在原生剧情页打开“协助汉化”，修改中文正文、允许修改的说话人或选项。原生控制流、音频身份和来源哈希保持只读。

“导出修改补丁”只生成设备上的 JSON，不上传。需要公开投稿时，勾选可以公开的确认，点击“生成 GitHub 投稿草稿”，然后打开草稿，在 GitHub 登录、检查内容并点击提交。生成草稿不是提交成功；只有 GitHub 给出 Issue 编号才算投稿。

小补丁直接进入预填草稿。较大补丁不会被截断进 URL，而是导出完整 JSON；在 Issue 附上文件，或把内容粘贴到保留的原生补丁代码块中。不要附上存档、游戏安装包、个人路径清单或凭据。继续编辑后旧草稿会失效，必须重新确认，避免投稿旧文本。

中文资料中没有原生可写绑定的段落，可在 Issue 说明资料标题、章节、原文与建议修改；不要伪造游戏原生补丁。

## 维护者导入

使用有权访问本仓库的 GitHub CLI 登录。在工程根目录执行：

```powershell
npm run review:github -- --issue 123
```

命令只从固定仓库读取指定的开放 Issue；校验编号、GitHub 来源、账号、原生补丁结构、当前来源哈希、字段身份及修改前值后，保存到本机待审队列。不评论或关闭 Issue，不批准、不安装、不部署。

大型附件先由维护者从对应 Issue 保存到本机，再明确指定：

```powershell
npm run review:github -- --issue 123 --patch 'D:\Downloads\universal-adv-revision.json'
```

这个入口记录文件哈希并保留 Issue 来源，但不会把人工选择的附件宣称为 API 已验证的附件；维护者需要核对附件和 Issue 对应关系。重复导入相同内容会返回同一记录；Issue 或补丁变化形成新的导入身份。来源过期或修改前值不一致会拒绝，不自动重定位到新正文。

在本机 `http://127.0.0.1:4176/review/submissions` 查看差异，明确批准后生成修订，再分别确认安装或回滚。安装后的源码/文本、索引和进度一起提交到本仓库 `main`，检查工作区干净，然后运行：

```powershell
git push origin main
npm run publish:cloudflare
```

自动测试通过、GitHub Issue 被提交、维护者批准、站点部署、用户人工验收是不同状态。站点不会把投稿自动标为已校对；只有明确确认的译文才能更新该状态。

## 安全边界

本机审核数据只在忽略的 `work/native-review-store` 下保存。公网不映射 `/api/native-reviews`，不暴露批准、安装或回滚接口。GitHub 负责其网站的登录与 Issue 权限；阅读器不自行冒充 OAuth 登录，也不把本机手填署名当成已验证账号。公开 Issue 的内容属于不可信输入，仅 JSON 数据参与本机来源验证，永远不执行 Issue 中的命令或链接。
