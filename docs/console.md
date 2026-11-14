# Local live console

Agent integration currently supports Codex. Other agent integrations are in development. / 目前支持 Codex 接入，其他 Agent 的接入正在开发中。

Call MCP `prepare_console` or run `deng console --config /absolute/private-config.json`. Open the newly returned URL, confirm **已连接 · 实时推送**, then submit work. One engine owns one reusable console URL. Preparing allows a ten-minute opening grace; connected heartbeat traffic keeps the engine alive. Restarting the engine changes the random URL.

The console follows new tasks, replays history through SSE, and reconnects by task/event cursor. It displays public text, tool actions, changed files, test output and recorded usage. Scrolling back pauses visual following; the new-event button returns to the latest output. Viewing does not call a model. Closing the panel does not stop work. `observe TASK_ID` can open a task-specific observer.

The model dropdown changes the future-task default only. It does not change a queued/running/stopped task, stop work or call a model. Existing task model changes require a separate explicit manual pause/change/resume operation through CLI/MCP.

**连接设置** edits the existing connection profile, API base URL, model, Key and advanced limits. Blank Key retains the credential. Save is idle-only and affects future tasks. Destination changes require a new Key or explicit reuse. Opening/saving makes zero model calls; the optional test requires its own permission for one potentially billable request. See [configuration](configuration.md).

Pause/resume/cancel are real task controls with revision checks. They cannot grant scope or reset budgets. Separate unchecked acknowledgment boxes appear for unknown model usage and command outcomes; the user must inspect and explicitly select them before resuming. The boxes reset after resume or task changes. Review the current error before resuming a task waiting for input; a context limit may require splitting inputs or an explicit suitable model change rather than pressing continue again.

The server binds only to `127.0.0.1`, serves a random path, applies CSP/no-store headers, and rejects foreign origins and invalid write tokens. Public snapshots exclude profile credentials and the private conversation checkpoint. Do not publish a console URL or expose its port publicly. Use a fresh URL after disconnection; do not guess old paths.

This browser panel is the supported live view. Native host chat-message streaming and automatic idle-chat wakeup are not implemented. The [native MCP App](mcp-app.md) is an experimental separate integration.

The clarification form uses Pi steering at the next safe turn. It does not pause a running request or resume stopped work. The activity label distinguishes model generation, command execution and final acceptance. A delivery ID identifies the checked file version; historical milestones are labeled accordingly. See [delivery and lifecycle](delivery-lifecycle.md).
