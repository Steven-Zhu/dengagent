# Optional native MCP App — experimental

Agent integration currently supports Codex. Other agent integrations are in development. / 目前支持 Codex 接入，其他 Agent 的接入正在开发中。

Deng exposes `ui://dengagent/console-v1.html` with the MCP App MIME type and an optional `render_console` tool descriptor. Clients that do not advertise a compatible UI extension can still read text/browser fallback results. A declared capability or readable resource does **not** prove that the host displayed an App.

The App performs the standard initialize/notification/tool bridge flow and exposes public snapshots, future-model selection and revision-checked task controls. It does not load a CDN, receive provider Keys or connect directly to localhost. Event refreshes use the host tool bridge without worker inference. Its controls cannot expand scope/allowance, acknowledge unknown usage or automatically pause/change/resume task models.

The implementation has protocol/integration tests. User-supplied screenshots on 2026-11-04 show the App rendered inside one Codex desktop installation, including model selection, usage, task events and an upstream HTTP 401 failure. This is user-observed rendering evidence, not a reproduced host compatibility matrix or a successful live-provider task. The host version was not recorded. Embedded rendering depends on the Codex host capabilities; other agent integrations are in development.

User-supplied screenshots on 2026-11-15 additionally show a completed pelican task in an embedded card beside its browser console, and native Codex updates and completion for the DNA project. The [English DNA case](workflow.en.md) publishes the two native-chat images unchanged; the split view containing a full console address is retained only as a local reference. These are observations from the supplied environment, not a cross-host certification.

The embedded App and the browser console are separate views of task state. App snapshots can update inside a tool card; this does not mean worker tokens are written into the host's native assistant-message stream or that an idle chat is automatically awakened. Use the supported `prepare_console` browser path if the host cannot render the App. Connection/Key settings are available in the browser console or CLI, not through this experimental bridge. Private screenshots and console tokens are not included in the repository.

用户截图已显示一套 Codex 桌面环境中的嵌入控制台和任务更新，以及具体已完成任务的界面。DNA 案例另有原生会话的进度与最终修正记录；这些观察不代表各宿主与所有供应商均已验证。嵌入工具卡片的更新不等同于把 Deng 输出写入原生助手消息流。不支持嵌入展示时使用浏览器控制台。

`node scripts/preview-mcp-app.mjs --config /absolute/private-config.json` is a local protocol test host, not proof of native Codex rendering. `scripts/check-codex-app-ui.mjs` can inspect a separately installed Codex app-server; it is optional and host-version dependent, and may write local diagnostics that must not be published without review.

References: [official OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui), [official MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).
