# 算法架构流程图

使用用户指定的 [live-panel-skill](https://github.com/ythx-101/live-panel-skill) 渲染内核；固定来源和 MIT 许可见 vendor/SOURCE.md。布局为本项目原创，不复制其他产品流程。

在仓库根目录运行：

```bash
npm --prefix app run diagrams:build
npm --prefix app run diagrams:check
```

build.py 维护算法节点、连接和桌面／纵向布局；controller.js 只适配播放、减少动态、后台和离屏暂停。生成文件在 app/public/algorithm-diagrams，尺寸和哈希同步到 UI；不要直接修改生成文件。npm run build 自动检查来源与产物一致。

图是流程说明，不能发出任务、模型或网络请求。前端 AlgorithmFlow 用 sandbox iframe 隔离，通过有来源校验的消息控制播放；图内 CSP 禁止网络连接。按实际容器宽度切换布局，文本步骤和加载失败重试保留在外层。

验证：前端 controller.test.ts 覆盖消息来源、时间连续性、离屏／后台、减少动态与零尺寸保护。浏览器检查实际页面、暂停／恢复、键盘展开、320–1280 窄宽布局及 #stage[data-layout-problems]；截图见 screenshots/algorithm-flow。本次没有运行直接控制 Chrome 的上游视频／120帧脚本，不作该类验证声明。
