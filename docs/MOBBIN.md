# Mobbin 使用与 MCP 接入

复核时间：2026-10-07。产品参考及页面对应关系见 [UI-REFERENCES.md](./UI-REFERENCES.md)。

## 已完成的接入

本机已配置官方远程 MCP `https://api.mobbin.com/mcp`，用户明确允许后完成 OAuth，CLI 返回 `Successfully logged in.`。配置名称为 `mobbin`，保存在本机 `~/.codex/config.toml`，授权凭据由 Codex 管理。没有在项目里保存令牌或浏览器 Cookie。

已验证服务器状态为 OAuth 授权，列出 `search_sections`、`search_flows`、`search_screens` 三个工具；实际完成 11 次 `search_flows` 调用并下载参考图。检索没有使用 Deep Search，按官方计费规则消耗 0 AI credits。本次没有调用项目里的 David AI。

当前聊天启动时的工具列表不会因为添加配置立即更新；本次通过 Codex app-server 的 MCP 工具调用接口验证和检索。后续本地聊天加载该配置后可直接使用；若界面仍未显示 Mobbin，先在设置中刷新 MCP，必要时重启 Codex。不要因此重复添加同名服务器。此本机配置不代表 ChatGPT 网页或云端任务也已连接。[Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)、[app-server 文档](https://learn.chatgpt.com/docs/app-server)。

在另一台机器上配置时：

```bash
codex mcp add mobbin --url https://api.mobbin.com/mcp
codex mcp login mobbin
codex mcp get mobbin
```

`add` 可能自动发起授权；已经登录成功就不必再 `login`。浏览器授权完成后，应同时确认 CLI 成功和实际搜索成功。Pro 可以使用 MCP；REST API 的 API key 属于另一种接入方式，目前仅 Team／Enterprise 可用，Pro 不需要为此升级。[Mobbin 接入概览](https://docs.mobbin.com/overview)、[Codex 配置指南](https://docs.mobbin.com/mcp/clients/codex-cli)。

## 在网页上寻找参考

1. 进入应用库，选择 **Web**。我们研究的是操作型 Web 应用；Sites 更适合官网、营销页。
2. 先按产品类别缩小范围，优先 AI、开发工具、生产力和数据分析相关产品；再搜索具体产品或功能。
3. 用 **Screens** 看布局，按页面类型和 UI Elements 寻找表格、筛选、表单、标签页、对话框等；用 **Flows** 看配置、运行、比较、发布的顺序。筛选项随入口变化，以实际面板为准。
4. 打开产品后切换 Screens／Flows，进入流程查看连续截图；有 Prototype 时沿热点检查前后状态。截图代表 Mobbin 收录版本，不等于该产品今天的所有功能。
5. 需要本地逐图比较时，在流程更多操作里选择 **Download all screens**。本次已实际导出 Braintrust 的 10 张创建实验截图。ZIP 文件的存储顺序可能不是流程顺序，应按文件名末尾序号数值排序；MCP 图按 `position` 排序。
6. 推荐用 Save 将参考按我们的页面归入集合，例如“任务配置”“运行与错误”“结果比较”“应用发布与试用”。本次已建立本地参考包，未代为创建网页收藏集合。

每个参考记录四件事：要解决的问题、具体流程 URL、关键截图序号、如何适配联邦场景。不要只收藏一张好看的首页。

## MCP 怎么搜索

| 工具 | 用途 | 本项目优先用法 |
|---|---|---|
| `search_flows` | 完整用户流程 | 先找创建实验、运行详情、发布 Agent、比较数据 |
| `search_screens` | 单页及布局 | 表格筛选、空状态、详情面板；显式写 `mode: "standard"` |
| `search_sections` | 官网区块 | 研究营销网站的 About、Pricing、Footer 等区块；应用筛选栏、侧边导航用 Screens／Flows 查看 |

工具的具体字段以服务器当前 schema 为准。本次 `search_screens` schema 的 `mode` 默认值是 `deep`，因此普通检索务必明确传 `standard`。页面上的 Standard 与 Deep 也要区分。[官方工具说明](https://docs.mobbin.com/mcp/features)。

本次工具调用保持统一的 `task_intent` 和 `output_destination`，检索平台为 `web`。意图只描述界面需求，不发送项目文件、真实参与方数据、内部任务记录或密钥。

可复用的查询：

```text
Braintrust creating an experiment
Braintrust experiments and eval details
LangSmith run detail tracing input output
LangSmith comparing a prompt
ElevenLabs publishing an agent
ElevenLabs preview an agent
Linear my issues
Amplitude comparing data
OpenAI Platform Chat
```

品牌词是检索线索，不能当作严格过滤器：一次 Braintrust 查询返回了 Adaline，OpenAI 评测查询返回了 Vapi。写结论前核对 `app_name`、流程标题、原图和 `mobbin_url`；指定品牌没有合适结果时换词或进网页产品目录，不用其他品牌的图冒充。

检索结果中的低清预览用于判断相关性；需要保存原图时使用工具返回的高分辨率 `image_url`。这些图链接有效期约 30 天，长期记录用稳定的 `mobbin_url` 和 screen ID；本次提交的来源清单不含临时下载 URL。[图片说明](https://docs.mobbin.com/mcp/features)。

## 额度与维护

Standard Search、浏览、保存、下载不扣 AI credits；一次成功的 Deep Search 扣 5。Pro 每月 300 credits；官方目前处于 2026-10-05 开始的额度 beta，超额政策可能变化，需要深度检索时先复核账号页面。本次没有使用深度检索。[官方额度说明](https://docs.mobbin.com/ai-credits)。

MCP 当前按用户限制为每 60 秒 60 个请求，遇到 429 遵循 `Retry-After` 并降低并发；不要通过重复授权解决限流。[官方限流说明](https://docs.mobbin.com/rate-limits)。

遇到 401／授权失效，用 `codex mcp login mobbin` 重新授权；检查 Pro 是否属于当前登录账号。若以后不需要本机连接，可先 `codex mcp logout mobbin`，再 `codex mcp remove mobbin`，并在 Mobbin 账号连接设置复核授权。删除本机配置与服务端撤销授权分别处理。

本地原图目录为仓库 `.references/mobbin/`（Git 忽略），其中 `manifest.json` 记录来源、顺序和 SHA-256。可提交的同份清单是 [ui-reference-manifest.json](./ui-reference-manifest.json)。换机器时依据稳定流程 URL 在有权限的 Mobbin 账号下重新导出；项目构建和部署不依赖这些图或 Mobbin 登录。
