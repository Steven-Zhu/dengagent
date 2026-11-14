# Documentation / 文档导航

[English overview](../README.md) · [中文介绍](../README.zh-CN.md)

Currently supports Codex integration; other agent integrations are in development. Start with installation, then follow the guide for your workflow. English and Chinese introductions describe the same feature set; reference guides use English with bilingual troubleshooting and launch material.

目前支持 Codex 接入，其他 Agent 的接入正在开发中。先完成安装，再按使用场景阅读。中英文首页保持能力和安装步骤一致；参考文档以英文为主，排错、演示与发布准备提供双语说明。

| Goal / 目标 | Guide / 文档 |
| --- | --- |
| Browse the Wiki / 浏览 Wiki | [Wiki](wiki/Home.md) · [Integration status / 接入状态](wiki/Integrations.md) |
| Follow a real collaboration / 查看真实协作 | [English case](workflow.en.md) · [中文实例](workflow.md) |
| See real outputs / 查看真实成品 | [Video examples / 视频案例](showcase.md) |
| Try a small first task / 完成第一个小任务 | [First task](first-task.md) |
| Read the release introduction / 阅读发布介绍 | [English](announcement.md) · [简体中文](announcement.zh-CN.md) |
| Install, upgrade, diagnose an old launcher / 安装与升级 | [npm installation](npm-installation.md) |
| Configure once, migrate a legacy project / 全局接入与迁移 | [Global integration](global-integration.md) |
| Tune context, reasoning and task allowance / 调整上下文与思考 | [Model settings](model-settings.md) |
| Set API URL, model and Key / 配置模型与凭证 | [Configuration](configuration.md) |
| Inspect work and control tasks / 查看与控制任务 | [Console](console.md) |
| Diagnose 401, missing setup and usage / 常见故障 | [Troubleshooting](troubleshooting.md) |
| Diagnose protocol recovery and process outcomes / 协议恢复与执行结果 | [Recovery and diagnostics](recovery.md) |
| Review Pi reuse and product contracts / Pi 分工与交付契约 | [Pi capability map](pi-boundary.md) · [Delivery and lifecycle](delivery-lifecycle.md) |
| Understand the worker and its limits / 架构与边界 | [Architecture](architecture.md) |
| Understand embedded UI support / 嵌入控制台能力 | [MCP App status](mcp-app.md) |
| Run checks and understand evidence / 验证范围 | [Verification](verification.md) |
| Contribute or ask for help / 参与和反馈 | [Contributing](../CONTRIBUTING.md) · [Support](../SUPPORT.md) |
| Review planned work / 后续计划 | [Roadmap](../ROADMAP.md) |
| Record a walkthrough or use existing media / 录制流程与使用素材 | [Demo plan](demo-plan.md) · [Media guide](media/README.md) |
| Prepare the GitHub repository / GitHub 上线准备 | [GitHub launch](github-launch.md) |
| Package a release / 打包和发布 | [Releasing](releasing.md) |
| Review licensing and disclosures / 协议与声明 | [License rationale](licensing.md) · [Security](../SECURITY.md) |

Documentation changes should update both README files when they affect installation, product claims, compatibility or credential behavior. Run `npm run check:docs` to check local Markdown/HTML file links, image references and the shared README document destinations. This does not test external websites, render Mermaid, or prove prose equivalence.

涉及安装、产品能力、兼容性和凭证行为的文档修改，需要同步两份 README。`npm run check:docs` 检查本地 Markdown / HTML 文件链接、图片引用，以及两种语言首页共同引用的文档；它不验证外部网页、Mermaid 渲染或两份正文的语义一致性。
