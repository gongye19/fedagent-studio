# Federation Studio 前端

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

- 总览
- 联邦任务（新建 / 详情）
- 洞见库（试用 / 接入）
- 参与方与数据
- 模型接口

任务运行、准确率、trace 和洞见库都是前端模拟生成的示例数据，未连接后端。题库上传检查和导出 JSON 是真实执行的。

项目介绍、使用流程和架构见根目录 [README](../README.md)，代码结构见 [开发说明](../docs/DEVELOPMENT.md)。
