# Agent 接入状态 / Agent integrations

[Wiki 首页](Home.md) · [开始使用](Getting-Started.md)

**目前支持 Codex 接入，其他 Agent 的接入正在开发中。**

Currently supports Codex integration. Integrations with other agents are in development.

## 在 Codex 中怎么用

1. 先和 Codex 确定需求、设计方案与验收标准。
2. 明确让 Codex 使用 Deng 执行；Codex 通过 Deng MCP 提交任务。
3. 在 Deng 控制台看公开输出、工具操作、命令结果和任务状态。
4. 执行结束后，由 Codex 检查产物与固定验收结果，再核对交付清单。

安装向导提供用户级 Codex MCP 与 skill 接入。具体步骤见[安装指南](../npm-installation.md)和[第一次任务](../first-task.md)。

## Codex 会显示什么

Codex 会展示主助手的设计说明、工具调用及返回的任务信息。Deng 的连续执行输出主要显示在独立控制台；嵌入式工具卡片的展示取决于 Codex 宿主是否支持对应界面。当前没有将 Deng 输出逐 token 写入 Codex 原生助手消息流的能力，也不保证后台完成会自动唤醒空闲会话。

[DNA 协作实例](../workflow.md) 包含用户提供的真实 Codex 会话截图，展示方案、交接、进度和最终修正；附录另有独立 Deng 控制台画面。两类界面分别标注来源。

## 其他 Agent

其他 Agent 的接入正在开发中，尚未提供可按正式支持方式使用的接入流程，也没有承诺上线日期。底层使用 MCP 不代表已经支持所有 MCP 宿主。

CLI 是直接操作 Deng 的工具，不等同于新增一种 Agent 接入。平台隔离、供应商接口和嵌入界面属于不同维度，分别见[执行机制](../architecture.md)、[模型配置](../configuration.md)和[嵌入界面说明](../mcp-app.md)。
