# Recovery and diagnostics / 恢复与诊断

Alpha.9 addresses the execution and observability defects reproduced from the alpha.8 handoff. The supplied installed runtime files matched the development baseline. Incoming reports and raw event histories stay in a private work directory; only a reduced synthetic protocol fixture is committed.

本版针对交接中的执行和可观测性问题修复。交接安装源码与开发基线一致；公开源码只保留缩减且脱敏的协议夹具，不包含原始任务、日志、私有路径或动画源码。

## Native tools, not text / 原生工具与普通文本

Deng executes only schema-validated native tool calls from the provider adapter. If ordinary text contains a DSML marker, the complete response is rejected with `TOOL_PROTOCOL_MISMATCH`; even a native call in that same response is blocked. Truncated responses likewise cannot execute partial tool calls.

只执行经过 schema 和权限校验的原生工具调用。普通文本出现 DSML 标记时，整条响应的工具都不执行；不会把这些文字解析成命令或文件写入。残缺的截断调用同样不执行。

The public output can remain visible for diagnosis. Only a `file.changed` event with the new hash proves a file write. All write/append/edit replacement chunks default to 16000 characters, configurable with tools.write_chunk_chars; choose smaller chunks for a constrained output allowance. Directory discovery uses `list_files`, not an undeclared shell command.

公开输出可供诊断，但只有文件变更事件和新哈希证明落盘。单次写入、追加、替换默认上限统一为 16000 字符，可通过 tools.write_chunk_chars 配置，输出受限时仍需更小。目录查看使用受限 `list_files`，不扩大命令白名单。

## Bounded recovery / 有界恢复

`OUTPUT_TRUNCATED`, `TOOL_PROTOCOL_MISMATCH` and `MISSING_FINISH_TASK` retain their failure class, response summary and a bounded recovery history. Repair consumes the existing `max_repair_rounds`, call/token allowances and original deadline. Non-truncation protocol failures get at most one automatic repair; unknown usage prevents automatic repair. Repeated failure enters `waiting_input`. The existing task ID, confirmed file hashes and checkpoints are preserved.

截断、协议异常和未调用 finish_task 均保留具体原因及恢复链。恢复消耗原修复轮次、调用和 token 额度，沿用原期限。非截断协议异常最多自动修复一次；未知用量会阻止自动恢复，反复失败后进入等待补充。不会新建任务来掩盖消耗，也不自动重放命令。

Pause and cancel abort in-flight model/process work. Resuming is explicit and never resets budgets or clears unknown usage without a separate acknowledgment. Acknowledged unknown reservations remain accounted for. An interrupted command may have side effects; inspect its evidence before explicitly authorizing any replay.

暂停或取消会中断在途模型与进程。继续需要明确操作，保留预算；未知用量须另行确认，预留不被扣除。中断命令可能已有副作用，不能因工具返回错误便认为它没执行。

## Safe diagnostics / 安全诊断

`model.response` and `last_model_response` expose HTTP status, selected strict-format correlation IDs, finish reason, output cap, text/tool counts and native SSE channel counts. They do not store raw requests, arbitrary response headers or error bodies. The worker's final `error.code` retains known upstream/budget/protocol failures. A text-channel fixture diagnoses a specific path; it does not prove whether a real provider or Pi caused the original malformed response.

诊断仅记录 HTTP 状态、限定格式的关联 ID、结束原因、输出上限及文本/工具计数；不记录原始请求、任意头或错误响应正文。真实事件缺少原始 SSE，因此不能断言原问题由供应商还是 Pi 引起。认证失败也不能仅凭 401 归因于 Key。

## Command and usage evidence / 命令与用量

`COMMAND_CWD_SCOPE` identifies `scope.commands[i].cwd` or `acceptance.commands[i].cwd` before task creation. It never expands read/write scope.

`command.completed` includes `command_code`, `signal`, `timed_out`, `truncated`, `executed` and `replay_safe: false`. Nonzero exit and timeout are tool errors; exit zero with stderr warning remains a successful process result. Fixed acceptance still runs its original checks.

`usage.tokens` retains backward-compatible allowance accounting. `usage_accounting` separates `settled_tokens`, `in_flight_reserved_tokens`, `unknown_reserved_tokens` and `accounted_tokens`. Consoles label these separately; neither reported tokens nor reservations are a currency bill.

cwd 校验指出具体字段，不授权整个项目来绕过问题。进程结果和 MCP 工具传输分开呈现。两种控制台区分已报告 token、请求中预留和待确认预留，不把 unknown reservation 称为实际生成或付费消耗。

## Console confirmation / 控制台连接确认

`render_console` prepares the resource; a declared capability alone is not rendering proof. The initialized App reports a session heartbeat and visibility through `console_snapshot`. `console_status` exposes recent client acknowledgments (10-second lifetime), browser stream connection and a stable console ID for that engine. This proves client execution, not pixels. A host's queued tab opening is outside Deng's control; inspect/reuse an existing view before opening a fallback.

嵌入 App 初始化后报告会话心跳和可见性，宿主可查询状态。心跳不是像素验证，queued 也不是已显示。宿主管理的标签页排队无法由 Deng 直接取消或去重，编排方应先查找并复用已有视图。

## Optional native-media preflight / 可选原生媒体预检

```sh
node scripts/verify-macos-media.mjs --out /absolute/private-report.json
```

This opt-in macOS check uses a disposable project and the same write/network sandbox. It compares the system Swift shim with the toolchain path discovered on that machine, checks framework imports, PNG readback and exactly two H.264 frames with finalization, codec/dimensions/duration and actual decoding. It makes no model request and does not continue a user's animation task.

该预检仅在临时项目执行，使用相同沙箱，不调用模型或继续原动画。必须按本机发现的工具链路径设置白名单，不能复制另一台机器的路径或偷偷替换已授权命令。

On the local macOS x64 verification host, the system shim produced xcrun cache warnings but all three phases passed; the discovered direct toolchain passed without those warnings. This does not establish behavior on the reported arm64 host, all Swift versions, or general media workloads. Isolation was not loosened to suppress a warning.

本机 x64 环境中，系统入口有缓存警告但三阶段通过，工具链入口没有该警告。不能外推到故障发生的 arm64 机器或完整动画；未为消除警告放宽沙箱。

## Alpha.11 execution safeguards

- New profiles use enabled/low. Explicit higher planning settings remain supported. Old task snapshots are preserved.
- After OUTPUT_TRUNCATED, the same task enters a minimal-executable-slice strategy: effective low effort and output cap `min(original cap, 8192)`. The recovery instruction asks for a single runnable function/frame and an authorized check. Neither deadlines nor call/token budgets increase.
- `budget.max_no_progress_calls` defaults to 4. A changed file, a previously unseen successful command result or a passed milestone advances progress. Distinct reads/listings/searches can advance a bounded discovery window (default 12 observations); duplicate observations, failed commands and identical writes/results do not. `NO_PROGRESS` stops in `waiting_input` before another provider request; explicitly resuming requires narrowed input.
- DeepSeek thinking/tool history is compacted by whole chains between user messages. Every retained tool call/result pair and its reasoning block is preserved. There is no synthetic tool call insertion. Invalid pending/orphan tool histories fail before dispatch as `CONTEXT_PROTOCOL_INVALID`.
- `model.request` records only structural diagnostics (counts, recent roles, caps and effective effort), never credentials, arguments, message bodies or reasoning. `model.response` records returned text/tool field counts. These help separate upstream text protocol output from native tool events; they do not prove a particular upstream service is compatible.
- Tool validation errors returned to the model/checkpoint exclude the `Received arguments` echo and are capped at 600 characters. The original assistant tool call remains in the local ledger as execution evidence.
- Native DSML/XML text is still rejected, never extracted and executed. Repeated protocol failure stops after the existing single automatic protocol repair.

## Bounded file batches and staged checks

`write_files` accepts 1–8 entries, by default at most 16000 characters per file and 64000 total (tools.write_chunk_chars / tools.write_batch_chars). Each entry has `path`, `content`, optional `expected_sha256` and `mode` (`replace` or `append`). It checks scope, canonical aliases, current hashes and output sizes for every entry before writing. Each file replacement is atomic; the whole batch is not a filesystem transaction. If an external change interrupts later commits, the result identifies committed entries; re-read remaining files and never replay the whole batch. Single-file and batch entries use the same configured chunk limit. Size errors provide the actual length, current limit and a recovery hint without echoing source content.

A task may declare ordered `milestones`, each with a unique `name`, immutable `required_files` and exact `commands`. Use `check_milestone` alone. Commands require the same scoped cwd validation and OS sandbox as other execution. `finish_task` is refused until all declared stages pass, then normal final acceptance runs. A successful early stage records historical evidence; it is not a guarantee that later edits preserved it. Recheck essential invariants in final acceptance.

For media, request a single frame first, a short clip second and the final render last. This reduces time spent polishing a source file that has never been executed.

## Completion observation

MCP `wait_task(project, task_id, after_seq=0, timeout_ms=25000)` waits on local store notifications. It returns completion, failure, pause/cancel or required input. Text/tool/usage logs alone do not wake it. Keep its returned cursor to suppress delivered notifications; a timeout has `notification: null` and makes no model call. Disconnecting observation never stops the task. The host endpoint is `/tasks/:id/wait?after=CURSOR&timeout=MS`.

This is bounded long polling, not a promise of waking a closed Codex chat. Host-level background wake integration is still required for fully automatic reactivation. No email, Slack or other external notification is sent.

## contextfix.2 MCP response contract and migration

Default MCP submit/get/control/set-model task responses now use `deng.task-summary.v1`, bounded to 4096 UTF-8 bytes per task. IDs, status, revision, counts of changed files/checks/milestones, usage/accounting, effective budget, bounded actionable errors and result/detail references remain. CLI, HTTP views and console SSE retain their existing views. Consumers needing goal/checkpoints/model/recovery history must explicitly call `get_task_details` (up to 4096 characters per page) and use the returned hash/revision to detect changes during reassembly. Raw provider transcripts and credentials are not exposed by that details view. `read_events` remains an explicit diagnostic operation.

Submit records requested/effective budget and which requested fields were clipped by the configured ceiling; historical tasks have no inferred resolution metadata. `configure --show` exposes differences between current settings and the new-profile recommendations. Apply `configure --recommended` only when the user wants those changes; installing a package preserves existing settings and old task snapshots.

Rejected model admission records its reason, remaining allowance, UTF-8 byte measurements and required reserve where available. The estimator remains a conservative UTF-8 byte upper bound, not a tokenizer. The contextfix.1 latest-read/execution evidence protections, system tool declarations, native tool pairing and unknown-usage reservations are retained. No byte/4 heuristic or automatic budget increase is used. Large mandatory reasoning chains may still refuse admission with unused cumulative allowance: this release makes the cause visible; it does not claim that the estimator or provider compatibility problem is fully solved.

Completion observation continues to use local notification events and bounded 25-second waits. Console SSE, MCP notifications and scheduling the Codex model are different mechanisms. No automatic Codex wake capability has been verified; this release does not add an unverified notification bridge or extend blocking wait time. A timeout is free of Deng inference, but processing it may still cost a supervising-model turn.

Alpha.13 journals model and command effects, retains historical milestone observations, uses Pi steering for same-scope input, and sends only undelivered input revisions on resume. Separate explicit acknowledgments apply to unknown usage and unsafe command outcomes. See [delivery and lifecycle](delivery-lifecycle.md) and the [Pi capability map](pi-boundary.md).
