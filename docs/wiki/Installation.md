# Installation

[Wiki home](Home.md) · [中文安装](Getting-Started.md)

DengAgent currently supports Codex integration. Integrations with other agents are in development.

Use Node.js 24+ and npm 10+, then run:

```sh
npm install --global dengagent
deng init
```

Configure your model API base URL, model and Key, reload Codex MCP, and start a small task in a project. User-level setup is shared across local projects.

To upgrade:

```sh
npm install --global dengagent@latest
deng init
```

Existing task settings and allowances remain attached to the submitted tasks. See [installation details](../npm-installation.md), the [first-task guide](../first-task.md) and the [English case study](../workflow.en.md).
