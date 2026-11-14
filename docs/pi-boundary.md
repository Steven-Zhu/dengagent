# Pi and Deng responsibilities (alpha.13)

The installed dependencies are `@earendil-works/pi-agent-core` and `pi-ai` 1.3.0. Deng does not import Pi's higher-level coding-agent application. Pi Core supplies scheduling and extension points; it does not supply Deng's task authorization, durable execution journal or final-delivery contract.

| Deng integration | Pi interface / responsibility | Deng code retained and why | Verification |
| --- | --- | --- | --- |
| Agent execution | `Agent`, sequential tool scheduling, native parameter validation, standard message/tool/turn events | `engine.mjs` binds task state, stop controls and acceptance; no second general agent loop | engine, recovery, guardrail tests |
| Provider streaming | Pi AI `stream`, model serialization and SSE parsing | `model.mjs` admits each call, resolves credentials, sets `maxRetries:0`, guards a second fetch, records dispatch and provider usage; no custom SSE parser | provider and model-settings tests |
| Request compatibility | Pi AI payload and stream callbacks | `model-options.mjs` supplies configured vendor thinking/effort flags; raw usage presence distinguishes omitted usage from zero. These product requirements are not replaced by Pi's normalized zero values | request-body, fragmented-stream and missing-usage fixtures |
| Live conversation | Pi's canonical state and message events | Persist its state without rewriting every turn | transcript and contextfix regressions |
| Context projection | Pi `transformContext` | `runtime.mjs` calls one deterministic `context.mjs` adapter for the outgoing view. Full audit history stays intact. Pi Core supplies a hook, not task-specific compaction | ordinary/DeepSeek policy, reasoning and tool-pair tests |
| Request preparation | Evaluated `prepareRequest` | Kept system/tool serialization with Pi. Compaction through preparation fed temporary checkpoints back into the active loop in the migration fixture; `transformContext` passed both model families | provider compaction fixtures |
| New user instruction | Pi `steer` and standard user-message consumption | `send_input` persists an input revision, then queues steering. Stopped tasks queue it without resuming. Recovery resends only undelivered revisions | steering, resume and MCP App tests |
| Interrupted transcript | Pi accepts restored initial messages | One `restoreHistory` adapter repairs only complete tool groups at a run/recovery boundary; live history is not repeatedly sanitized | recovery and protocol fixtures |
| File/command tools | Pi dispatches tools and validates parameter schemas | Deng keeps scope, current hashes, atomic writes, sandboxing, exact commands, protected check files and effect journals. Pi Core has no equivalent secure file-tool implementation; importing the whole coding-agent package without equivalence proof is deferred | tools, security and process tests |

`finishTurn` ends a candidate or input request; Deng's bounded repair remains a task policy. It cannot increase the original allowance. Provider retries are disabled; every dispatched inference has a durable call ID, conservative token reservation and settlement/unknown outcome. A database transaction cannot guarantee exactly-once network or command effects.

All alpha.11 contextfix.1–4 changes included in alpha.12 are retained: current read/execution evidence, bounded MCP summaries and admission diagnostics, 16M future default, unlimited call-count defaults, and system/tool/reasoning projection safeguards. Explicit old task settings stay frozen.
