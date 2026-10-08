# 界面检查脚本

无头 Chrome + DevTools 协议，不依赖测试框架，只需要 Node.js 22+ 和 Chrome。改了页面之后用它们截图、扫可访问性和断行，桌面和手机都要看。

| 脚本 | 做什么 | 用法 |
|---|---|---|
| `cdp.mjs` | 按清单截图（整页或视口，可以先执行一段页面脚本） | `node cdp.mjs shots.json`，输出到 `CDP_OUT`（默认 `/tmp/fedagent-shots`） |
| `a11y.mjs` | 逐页检查可访问性：没有名字的按钮和链接、没有标签的输入框、重复 id、点击区域太小、对比度、横向溢出、标题层级 | `node a11y.mjs`，结果写到 `OUT`（默认 `/tmp/fedagent-audit/a11y.json`） |
| `wrap.mjs` | 在多个宽度下找断行不当的文字：短文字被折成两行、长文字最后一行只剩一两个字 | `node wrap.mjs`，结果写到 `OUT`（默认 `/tmp/fedagent-audit/wrap.json`） |
| `summary.py` | 汇总上面两个的结果，过滤已核实的误报 | `python3 summary.py a11y.json wrap.json` |
| `feedback.mjs` | 确认、失败、焦点、长内容和减少动态的浏览器回归（响应夹具，不修改数据库） | `node feedback.mjs`，仅允许本地 BASE；需已有一个任务和应用作只读模板；CDP_OUT 指定证据目录 |
| `participants.mjs` | 信息分区、折叠、连接命令／复制、加载重试与一次性令牌展示（响应夹具） | `node participants.mjs`，连接本地内置示例；不签发真实令牌或调用模型；CDP_OUT 指定证据目录 |
| `motion.mjs` | 页面／标签动效、快速切换、草稿和编辑状态保留、折叠中间帧、减少动态与焦点 | `node motion.mjs`；只读现有任务／应用，拦截全部写请求；支持线上 BASE，本地另用前端通知夹具检查 Toast |
| `docshots.json` | 文档里的 14 张截图（`docs/screenshots/`） | `CDP_OUT=../../docs/screenshots node cdp.mjs docshots.json` |

环境变量：

- `BASE`：平台地址，默认 `http://127.0.0.1:8880/`（本地开发）；部署的平台是 `http://100.111.198.54:8880/`。
- `WAIT`：打开页面后等多少毫秒，默认 1300。经 Tailscale 访问部署的平台时页面要先读数据，用 `WAIT=4000`，不然会扫到"正在读取…"。
- `CHROME_PATH`：Chrome 的路径，默认 macOS 上的 Google Chrome。
- `CDP_PORT`、`CDP_PROFILE`：几个脚本并行跑时各用一个端口和配置目录。
- `DEV_FIXTURES=0`：`motion.mjs` 检查本地生产预览时关闭 Vite 源码导入的前端通知夹具；例如 `BASE=http://127.0.0.1:8881/ DEV_FIXTURES=0 node motion.mjs`。线上自动不使用该夹具。

说明：

- 扫描的页面清单在 `lib.mjs` 的 `ROUTES`。任务和应用的详情页用平台上已有的数据（优先一个已完成的任务）；没有任务、应用，或者开了访问令牌读不到时，跳过这些页面。截图清单里的地址可以写 `{task}`、`{app}`。
- 每打开一页先清掉浏览器存储（新建任务的草稿、访问令牌），页面之间互不影响。
- 已核实的误报写在 `summary.py` 开头；上传框提示"…；不超过 20 MB"在 600px 宽时于"；"处换行，是正常的断行。
- `summary.py` 发现新增问题或缺少报告时退出码为 1；无新增问题为 0，便于部署检查使用。
- 页面检查和截图会等待主内容加载；30 秒内没有显示时失败，不把加载页或白屏当成通过。截图也使用 `WAIT`，单张可用清单中的 `wait` 覆盖。
- 本机装了 front-end-quality-check 技能时，还可以跑它的质量门禁（`ui-quality-gate.mjs`）；要在仓库根目录下运行，检测器才会读 `.impeccable/config.json` 里登记的例外。
