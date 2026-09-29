# FedAgent Studio 前端

联邦 Agent 平台的交互原型，基于 React 19 + TypeScript 6 + Vite 8。

```bash
npm install
npm run dev:demo
```

打开 <http://127.0.0.1:8880/>。

提交前运行：

```bash
npm run check
```

页面包括：

- 首页
- 联邦任务（列表 / 新建 / 详情：概览、进度、产出、配置）
- 应用（列表 / 详情：试用、内容、接入）
- 基础管理：参与方、数据集、算法、模型接口

任务运行、指标、各方上传的内容和任务产出都是前端模拟生成的示例数据，未连接后端。数据集上传检查和导出 JSON 是真实执行的。

项目介绍、使用流程和架构见根目录 [README](../README.md)，代码结构见 [开发说明](../docs/DEVELOPMENT.md)。
