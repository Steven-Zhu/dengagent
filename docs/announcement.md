# DengAgent: a local task worker with visible execution and verifiable delivery

[简体中文](announcement.zh-CN.md) · [Repository overview](../README.md) · [Video examples](showcase.md) · [First task](first-task.md)

When using Codex, you can hand your implementation plan to DengAgent and choose the model that carries it out, balancing capability and cost for each task. Configure its model API, authorize files and commands, and follow execution in a live console. When it finishes, review the file changes, acceptance results and delivery manifest.

Currently supports Codex integration. Integrations with other agents are in development. [Integration status](wiki/Integrations.md)

**Delegate the work. Keep the process and the result in view.**

## The workflow

In a configured Codex project, ask:

> Use DengAgent to implement this feature. Define the permitted files and fixed acceptance checks before submitting the task.

Codex submits through MCP. Deng reads and writes authorized files, runs allowed commands and exposes public output, tool activity, changes, checks and recorded usage. You can pause, add a same-scope clarification, resume or cancel. Closing the console does not cancel the task.

Completion includes fixed acceptance results and a SHA-256 manifest of required files. A later delivery check compares the current workspace with that recorded version. Passing a check certifies its configured conditions; review still matters for business behavior and visual quality.

## Why try it

- **Choose the worker's model.** Configure its API URL, model and Key independently of the main assistant. Evaluate actual usage for your tasks; no unmeasured savings or speed improvement is promised.
- **Keep execution in its own task.** The main assistant can scope work and review delivery while a separate console carries the public process. MCP exposes compact task and delivery information.
- **Check what was delivered.** Fixed checks, explicitly protected check files and artifact hashes connect acceptance to a version you can inspect again.
- **Keep boundaries and control.** File/command permissions and token/time allowances remain attached to the task across pause and recovery. Unknown usage or command outcomes require explicit recovery acknowledgments.
- **Set up once across projects.** User-level Codex MCP + skill integration routes every call to an explicit local project. State stays local; model requests go to your chosen provider.

For a complete workflow with English annotations, source screenshots and an English-captioned result, see the [DNA collaboration case](workflow.en.md).

## Get started

DengAgent is MIT-licensed and requires Node.js 24+ and npm 10+. Command isolation has been validated primarily on macOS. Install from npm following the [installation guide](npm-installation.md), then initialize:

```sh
npm install --global dengagent
deng init
```

Configure the worker, reload Codex MCP and start with a small task in a project. [First task](first-task.md) also describes a source-only offline demo with no model requests.

Recorded local verification includes regression tests and three real-provider project runs with media checks. Offline tests and live-project evidence have different scopes; see [verification](verification.md).

Feedback from a first completed task is especially useful: what you delegated, what made progress clear, and which acceptance checks helped you review it.

## Three real output examples

[![Tourbillon concept watch film](media/showcase/tourbillon-poster.jpg)](https://github.com/Steven-Zhu/dengagent/raw/refs/heads/main/docs/media/showcase/tourbillon.mp4)

**Tourbillon — 20 seconds.** An existing procedural watch project re-rendered and checked through Deng, with 1080p H.264 output and locally synthesized audio. The 2.5D artwork is rendered at 720p and upscaled; it is a concept film. [Watch MP4](https://github.com/Steven-Zhu/dengagent/raw/refs/heads/main/docs/media/showcase/tourbillon.mp4).

**Pelican on Two Wheels — 12 seconds.** Python procedural illustration implemented and iterated with Deng: a pelican, bicycle, coastal scene and linked pedal/leg motion, exported at 720p and 30 fps. [Watch MP4](https://github.com/Steven-Zhu/dengagent/raw/refs/heads/main/docs/media/showcase/pelican.mp4).

**Five Moves to Solve — 18 seconds.** An existing state-driven cube project re-rendered through Deng. Its 54 stickers keep stable identities through R, U, F, L and D moves, with a checked solved final state. The starting state was deliberately constructed for five moves. [Watch MP4](https://github.com/Steven-Zhu/dengagent/raw/refs/heads/main/docs/media/showcase/cube.mp4).

These are output examples, not an end-to-end workflow recording or a comparative model benchmark. [Case notes](showcase.md) explain original acceptance and the separately checked distribution copies.
