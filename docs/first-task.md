# Your first task / 第一次任务

[English overview](../README.md) · [中文介绍](../README.zh-CN.md) · [Installation](npm-installation.md)

Start with a small, checkable change in a disposable project. The video examples show possible outputs; a small code change is a quicker first experience.

建议从一个临时项目中的小改动开始，先体验“提交 → 观察 → 验收”。视频案例用于了解产物，首次运行可以选择更快完成的代码任务。

## Option A: try the execution path without a model / 先看离线闭环

From the source repository root, with Node.js 24+ and npm 10+:

```sh
npm ci
npm run demo
```

Dependency installation may access the package registry. The demo itself uses a deterministic **offline fixture**: it creates a temporary project, writes a small function, runs a real fixed test and stops its demo engine. No provider credentials or model requests are used, and your normal connection is not edited. The terminal prints where the temporary output is kept. This checks the execution path, not model quality. The command is for a source checkout, not the globally installed npm package.

依赖安装可能访问包注册表。演示本身使用明确标注的**离线夹具**：创建临时项目、写入一个小函数、执行真实固定测试、关闭演示引擎；不需要模型 Key，不发起模型请求，也不修改你的日常连接。终端会显示临时产物位置。这条命令用于源码仓库，不用于全局安装包。

## Option B: delegate a real task / 交办真实任务

Install the downloaded package as described in [installation](npm-installation.md), run `deng init`, configure a compatible model connection, and reload Codex MCP. This setup is user-level and only needed once.

按[安装说明](npm-installation.md) 安装准确候选包，运行 `deng init` 配置兼容模型连接，重载 Codex MCP。用户级接入只需一次。

In a temporary Node project with a `src` and a `test` directory, give Codex this request:

> Use DengAgent to implement `sum(a, b)` in `src/sum.mjs`, exporting it as a named function. Before submitting, create `test/sum.test.mjs` as a fixed check for `sum(20, 22) === 42` and `sum(-3, 3) === 0`. Permit Deng to write only `src`, allow only `node --test test/sum.test.mjs`, protect the test file and require `src/sum.mjs` in acceptance. Open the project console and submit. After completion, inspect the test result and verify the delivery manifest.

在临时 Node 项目中准备 `src` 与 `test` 目录，然后给 Codex 这段要求：

> 使用 Deng 开发：在 `src/sum.mjs` 导出命名函数 `sum(a, b)`。提交前先创建固定检查 `test/sum.test.mjs`，检查 `sum(20, 22) === 42` 和 `sum(-3, 3) === 0`。Deng 只允许写 `src`，只允许运行 `node --test test/sum.test.mjs`，将测试文件加入保护范围，验收要求包含 `src/sum.mjs`。打开项目控制台并提交；完成后检查测试结果，再核对交付清单。

The main assistant prepares the check; Deng implements the function within the allowed scope. A real task uses your configured provider and may incur charges. Avoid submitting the three rendering projects as a first task: their original scripts, dependencies and task scopes are not distributed by this guide.

主助手先准备检查，Deng 在授权范围内实现函数。真实任务会使用已配置供应商并可能计费；三个视频的完整原工程与任务范围不随本指南分发，首次体验使用上述小项目即可。

## What to inspect / 看什么

1. The console names the intended project and shows the task running. / 控制台对应正确项目，并显示任务开始执行。
2. The only implementation change is within the authorized directory. / 实现文件位于授权目录。
3. The fixed test actually ran and passed. / 固定检查真实执行并通过。
4. The recorded delivery matches the files you review. If using CLI, run `deng delivery TASK_ID` from the project or supply its absolute `--project` path. / 核对交付记录与当前文件一致；CLI 可在项目中运行 `deng delivery TASK_ID`，或传入绝对 `--project` 路径。

For 401 errors, old launchers or a missing console, use [troubleshooting](troubleshooting.md). For interruptions or unknown outcomes, use [recovery](recovery.md).
