# 界面检查脚本

无头 Chrome + DevTools 协议，不依赖测试框架，只需要 Node.js 22+ 和 Chrome。改了页面之后用它们截图、扫可访问性和断行，桌面和手机都要看。

| 脚本 | 做什么 | 用法 |
|---|---|---|
| `cdp.mjs` | 按清单截图（整页或视口，可以先执行一段页面脚本） | `node cdp.mjs shots.json`，输出到 `CDP_OUT`（默认 `/tmp/fedagent-shots`） |
| `a11y.mjs` | 逐页检查可访问性：没有名字的按钮和链接、没有标签的输入框、重复 id、点击区域太小、对比度、横向溢出、标题层级 | `node a11y.mjs`，结果写到 `OUT`（默认 `/tmp/fedagent-audit/a11y.json`） |
| `wrap.mjs` | 在多个宽度下找断行不当的文字：短文字被折成两行、长文字最后一行只剩一两个字 | `node wrap.mjs`，结果写到 `OUT`（默认 `/tmp/fedagent-audit/wrap.json`） |
| `summary.py` | 汇总上面两个的结果，过滤已核实的误报 | `python3 summary.py a11y.json wrap.json` |
| `feedback.mjs` | 确认、失败、焦点、长内容和减少动态的浏览器回归（响应夹具，不修改数据库） | `node feedback.mjs`，仅允许本地 BASE；需一个含工作区数据的数学任务及应用作只读模板，正式预检用其实际绑定；CDP_OUT 指定证据目录 |
| `participants.mjs` | 信息分区、折叠、连接命令／复制、加载重试与一次性令牌展示（响应夹具） | `node participants.mjs`，真实参与方＋浏览器客户端夹具；不签发真实令牌或调用模型；CDP_OUT 指定证据目录 |
| `motion.mjs` | 页面／标签动效、快速切换、草稿和编辑状态保留、折叠中间帧、减少动态与焦点 | `node motion.mjs`；只读现有任务／应用，拦截全部写请求；支持线上 BASE，本地另用前端通知夹具检查 Toast |
| `select.mjs` | 选择菜单、键盘／焦点、筛选、占位／禁用／空值、长菜单与表格事件及标签指示条 | `node select.mjs`；本地响应夹具；线上 `SELECT_FIXTURES=0`，禁止业务写入与模型调用 |
| `config.mjs` | 可用参与方／空态与失效草稿／限宽／摘要旁重置、三分区／轮次菜单／静默恢复、任务逐行配置、ⓘ真实悬停／键盘／触屏／关闭、无重排、运行方式、模型搜索／空状态／焦点恢复 | `node config.mjs`；本地响应夹具；线上 `CONFIG_FIXTURES=0`；禁止业务写入与模型调用 |
| `task-form.mjs` | 静默恢复、字段原位错误／焦点／键盘、短促开始反馈、减少动态、后端配置错误定位；阻止业务写入 | `node task-form.mjs`；线上只读，本地补充预检响应夹具；CDP_OUT指定证据目录 |
| `task-flow.mjs` | 本地真接口、假模型、runner 的配置 → 完成 → 发布 → 对比 | `node task-flow.mjs`；仅允许 localhost／127.0.0.1；核对 fake 接口，只清理自己创建的任务／应用并逐项保留原有记录 |
| `medical-flow.mjs` | 公开病例的浏览器上传／错误／模板 → runner 两轮 → 发布 → 结构化试用／JSON错误 → 实际格式导出 | `node medical-flow.mjs`；仅允许本地假模型。`MEDICAL_DATA_DIR` 指向包含 medqa-group-1/2.jsonl 的目录，来源见 docs/medical-data-manifest.json；只删除本次任务／应用／上传数据集，保留原有资源 |
| `real-data-flow.mjs` | C、H两方新题库各1题／2轮真实运行→发布→试用→清理自己记录 | 只有明确安排真实模型验证时运行：`REAL_MODEL_VERIFY=1 node real-data-flow.mjs`；约$0.1–0.2，不得作为普通UI回归自动调用；失败未完成任务不会强删，owned.json保留核验ID |
| `real-medical-flow.mjs` | 两方公开医疗病例各2条／2轮→发布→对比→单次调用／导出→清理自己记录 | 仅显式安排时用 `REAL_MODEL_VERIFY=1 node real-medical-flow.mjs`；预计$0.3–1，保留真实数据；未完成任务不强删，owned.json保存本次ID |
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

T78：`resource-flow.mjs`在仓库根目录运行，验证任务内真实文件上传／错误／自动选择、我的／公用切换保留、正式自有输入要求、两轮runner→发布→试用、资源复用／重置／焦点／窄屏和本地模型接入。默认仅本地假模型；真实模型必须显式设置`REAL_MODEL_VERIFY=1`及服务器BASE，约$0.1–0.2。输入来自仓库真实AIME24前两题，通过名字及原始哈希识别本轮资源，逐项保留原有ID并只清理自己的记录；未结束任务保留检查，owned.json记录ID。public范围全选已同步公共lib，config.mjs沿用旧交互检查并适配资源入口。可访问性扫描等待配置预检和颜色过渡完成，避免读取过渡中间色。


T81：`agent-flow.mjs`先通过界面登记独立Agent，验证能力、两类任务选择、配置测试／刷新恢复／配置失效、桌面手机、两轮共享产出、发布／invoke／导出，最后逐项清理本次资源与报告。先在独立进程启动`fedagent agent-serve --model fake:fake --store /tmp/自己的联调目录`，默认9020回环端口；本地缺医疗输入时从`.references/medical`公开数据导入，线上仅复用已有数据。线上运行必须`REAL_MODEL_VERIFY=1 BASE=http://100.111.198.54:8880/ AGENT_URL=http://127.0.0.1:9020`，实际请求来自服务器而非浏览器本机。预计US$0.4–1.2；失败时未结束任务保留排查，不删除其他人的资源。测试报告的DELETE只清理同编号的联调运行记录，模型调用账本保留。

T81更新旧脚本：resource-flow移除平台／客户端与来源菜单；task-flow、medical-flow显式执行配置测试；feedback仅用通过报告夹具，不发真实模型请求。motion导航预期为七项；lib加入LLM／Agent归属页，可访问性覆盖三类入口。


`agent-ui.mjs`为只读验收：桌面／手机的三类资源、Agent接入窗口、当前协议下载、上传移除客户端、公用LLM取消返回与空Agent引导，拦截全部写请求。`agent-resume.mjs`只用于已明确授权的真实医疗验证恢复，必须提供本轮OWNED_FILE并设置REAL_MODEL_VERIFY=1；只续跑这些ID，发布／调用／导出后清理本轮资源，失败保留检查点，不重建已完成的FoT任务。

T82：`medical-agents.mjs`验证FoT原生LLM路径和两份医疗数据分别绑定两个独立医疗API的路径，包含界面登记／自动能力检查、主动完整步骤测试、两轮任务、经验导出及两个原API加载最终经验后继续诊断。默认本地9031／9032，先分别启动`fedagent medical-serve --platform-model fake:fake --store <独立目录> --port <端口>`；本地数据目录FEDAGENT_DATA_DIR应与开发平台一致，测试明确设置FEDAGENT_FAKE_ENDPOINT=1。线上需REAL_MODEL_VERIFY=1，KEEP_AGENTS=1保留团队服务登记，BASE使用实验室地址。Agent登记地址AGENT_A_URL／AGENT_B_URL供平台访问；DIRECT_AGENT_A／B可使用仅监听回环的SSH转发供本机验证原API。预计US$0.5–2，测试报告不代表准确率提升。ONLY_ALGORITHM用于只补测失败的单条流程；脚本仅清理自身任务／应用／数据／报告，原资源逐项保留。medical-flow仍覆盖上传错误与结构化应用，需已启动医疗服务；agent-flow仍测试可选自有FoT执行。
