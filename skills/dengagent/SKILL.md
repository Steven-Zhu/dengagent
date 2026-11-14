---
name: dengagent
description: Delegate user-authorized bounded implementation/testing or bulk file work to the locally configured DengAgent worker. Deng and DengAgent are aliases; trigger for “使用 Deng 开发”, “使用 DengAgent 开发”, “用 Deng 做”, or equivalent user requests.
---

# DengAgent

“Deng” and “DengAgent” name the same worker. Treat “使用 Deng 开发” and “使用 DengAgent 开发” identically; the terminal command is `deng`. The user-level installation provides this skill and the global Deng MCP router. Users run `deng init` once to install them and configure a shared connection. Do not require per-project initialization for a new workspace. Legacy project-specific adapters/configurations remain supported. If integration is absent, explain the one-time user setup; do not claim a worker was invoked.

DengAgent is a locally installed worker, not a website to search for. Never search browser history or the public web to locate its console. Obtain a fresh endpoint from the registered tool or installed CLI; never reuse a random-port URL from old messages. If this skill/tool is missing in another chat, check whether the user-level integration was installed and the host refreshed its tools/skills. Report that boundary instead of claiming the App was opened. A connection-refused page is a connection failure, not evidence of a browser safety policy.

Deng uses Pi and its own configured model/API Key. Use the registered Deng MCP tools; do not impersonate the worker or copy credentials into task files.

0. For the global MCP, EVERY tool call (including console, model selection, task reads and controls) must carry `project` as the absolute canonical project path from the current Codex workspace or explicit user choice. Never use the MCP process launch directory, a previous chat’s project, or another request’s mutable selection. If the chat has no project context, ask the user to choose one before executing work. Availability is user-wide; file/command authority remains confined to the selected project and declared task scope. The same task UUID in a different project is not the same task.
1. Agree on the task objective and keep product/architecture decisions explicit. Create a small task JSON in the project with `goal`, `inputs`, `scope`, `acceptance`, optional `budget`, and a stable `request_id`. Do not read/copy entire input sources just to hand them off: reference their project paths.
2. Scope read/write paths and exact command `argv`/`cwd` to the authorized task. In the default macOS mode commands have no network and write only declared task roots. The host mode has no OS sandbox and is reported as such. Fixed acceptance commands and required files define what completion means.
3. Offer the project console as an observation aid, not an execution prerequisite. Prefer `render_console` when available; reuse an existing project view. If it does not render, call `prepare_console` and try opening its fresh `panel_url` in the host browser (Codex: `open_in_codex`, placement="right"). For older integrations use `deng console --config PATH` from the installed CLI or registered repository CLI. Make one reasonable display attempt before submission, then continue authorized backend work even if the Mac is locked, browser control is disabled, no interactive desktop is available, or the host open is queued. Do not require unlocking, UI permission changes, a visible panel, or a browser heartbeat just to submit, wait for, inspect, or verify a backend task. Use `submit_task`, `wait_task`, `get_task`, bounded evidence reads and `verify_delivery` to continue. Briefly report any UI limitation without claiming the console is visible. Check actual visibility/connection only when needed to claim successful display; capability metadata or a queued host open is not proof. If the requested task itself requires GUI interaction, continue independent backend work and ask for user assistance only for that blocked GUI step. Console unavailability alone is not evidence that the worker or engine is unavailable; report backend failures from the corresponding task/tool response.
4. Call `submit_task` once with `task_file`. Reuse its returned ID. Announce the returned `task.model_info.profile` and `task.model_info.model` once. The engine-owned console follows new tasks and pushes public output, tools, changes, tests and usage over SSE without inference or main-model log forwarding. The single model dropdown silently selects the future-task default only: users can change it while a task runs, with no pause and no change to any existing task (including queued tasks). The task's own actual model remains in its start event. `watch.panel_url` points to the same console. Terminal observation remains available. Do not resubmit on a timeout without checking the existing ID/request_id.
5. Keep the main model out of continuous log forwarding. Reference design/code paths instead of copying full sources into the main chat or task goal. Default submit/get/control responses are compact; use get_task_details only for needed goal/history/diagnostic pages (4096 characters/page), and read_events only for a relevant failure slice (start with 10 events). Do not routinely read dependency sources or re-read entire generated files. Keep ordinary logs in the console. At completion, report a short artifact/check summary; use deterministic authorized render/check commands without asking the main model to narrate each step. Prefer `wait_task` with the returned cursor for completion/required input; it ignores ordinary progress logs and costs no inference. A timeout makes no Deng inference request, but receiving it may still cause a main-model turn. Avoid immediate get_task/read_events polling after each timeout. Background host wake is not guaranteed; if unavailable, keep a clear terminal/console handoff or use bounded waits while the user is actively following the work. Query `get_task` for compact progress when needed; `read_events` and `read_artifact` are bounded evidence reads. This release does not automatically wake an idle Codex turn on task completion.
6. A user request to pause/cancel requires `control_task`. The Codex Stop button, closing a viewer, or interrupting your own turn alone does not stop Deng. Report `paused`/`cancelled` only after the actual returned state. A standalone `deng watch` Ctrl+C disconnects observation; `deng run --watch` Ctrl+C requests pause.
7. Prefer `send_input` for a same-scope clarification while running; it persists the revision and uses Pi steering without pausing. Stopped tasks queue input without resuming. Use `control_task(action="resume", input="...")` for an explicitly requested continuation. Resume keeps budgets, prior usage and the original deadline. Scope expansion or a new budget requires a new explicit task. Do not acknowledge unknown usage on the user's behalf without authorization.
8. On completion, report the result summary, actual check coverage, limitations and artifact references. `completed` means fixed checks passed; it does not certify every business requirement. Review as agreed with the user.

## Reliable submission and evidence

- Command cwd must be inside a declared read or write scope, including fixed acceptance commands. If only `work`/`outputs` are authorized, choose `cwd: "work"` and adjust argv paths; do not silently broaden scope to `.`. Submission identifies the exact failing cwd field before creating a task.
- New profiles default to low reasoning. Use explicit higher settings only for complex planning. After truncation, recovery lowers effort/output cap and requires the smallest executable slice. NO_PROGRESS stops repeated calls; resume only with a narrowed next step.
- Prefer ordered milestones (one frame, short clip, final render for media). Completion requires declared milestones and final checks.
- `write_files` batches 1–8 scoped/hash-checked writes (default 16000 chars each, 64000 total; configurable via tools.write_chunk_chars / tools.write_batch_chars); preflight is shared, commits are atomic per file, partial results must not be replayed.
- Use `list_files` for scoped directory discovery. `write_file`, `append_file` and edit replacements share the configured tools.write_chunk_chars limit (default 16000 characters). Oversized calls return actual length and a retry hint; split content before retrying, never repeat the same rejected payload. Use the returned current hash for each next chunk; public code output alone is not a file change.
- On `TOOL_PROTOCOL_MISMATCH`, DSML/XML arrived as ordinary text, not a tool call. Never parse it into executable tools or write recovered code on the worker's behalf. Inspect the failure chain; bounded recovery retains the original task and allowances. Start any provider diagnosis with a tiny native read/write/append/finish loop, not a large rendering job. New request IDs create new allowances and must be reported as separate tasks, not described as resume.
- Use `console_status` when diagnosing console display or verifying a display claim; it is not a task admission or execution check. A missing heartbeat or queued host open does not block backend work. A client heartbeat is not pixel verification. Reuse an existing connected view when one is available; avoid repeated open attempts when UI access is unavailable. Deng cannot cancel or deduplicate host-owned queued tabs itself.
- Distinguish command execution from tool transport: `command.completed` and `tool.completed` include actual exit code/signal/timeout. A nonzero exit means a command was executed and failed; do not assume it was never dispatched or automatically replay it. stderr warnings with exit code zero are not command failure.
- Describe progress only from corresponding tool/command events and artifacts. File growth does not prove compilation or rendering. For media, distinguish imports, drawing, encoder configuration, finalization and actual decoding. Fixed checks should verify the promised format/dimensions/frame count; visual correctness needs a separate inspection.
- `usage_accounting` separates settled provider-reported tokens, in-flight reservations and unknown reservations. Accounted usage includes reservations and is not a monetary bill. Never clear unknown usage, increase budgets or issue a provider probe merely to continue debugging without user intent.
- `read_events` accepts at most 100 events per page. Check MCP `isError` and content type before parsing JSON. Retain and report actionable error codes, `last_model_response` and `last_failure_reason`, without sending credentials or raw private payloads.

## Connection settings

Users can edit API URL, model ID, private Key and advanced limits through `deng console` for global settings or `deng configure` from any directory. Global settings affect future tasks in inheriting projects; existing task snapshots keep their original model/Key. `deng configure --project PATH` creates/edits an explicit project override, including when opened through that project’s console. A project override is preserved rather than overwritten by global changes. Legacy config paths still work with `deng configure --config PATH`. Settings can also be edited through the browser console's “连接设置” form in a terminal. Obtain a fresh console URL first. Have users enter actual Keys directly in the password field or hidden terminal prompt; never ask them to paste a Key into chat, task input or argv. Public `configure --show` metadata reports presence only.

Blank Key preserves the current credential. A new destination requires a new Key or the user's explicit permission to reuse the old one. Saves are rejected during active/queued work and affect only future tasks, preserving existing task snapshots. Never automatically pause/resume work to make a save possible. Opening and saving settings do not call a model. The optional “测试连接” / `configure --probe` makes one potentially billable request and requires explicit user intent; do not test automatically merely because settings were changed.

If a task stops for context limits or repeated output truncation, inspect its error and retained files. Do not blindly resubmit or increase its allowance. Bounded recovery and compaction preserve original limits; irreducible inputs may need a narrower explicit task.

## Model controls

- `get_models` lists configured profiles, future-task default and unfinished tasks' own models. `get_task` includes the task's requested model, public endpoint, model history and last provider-reported model ID when supplied. Distinguish requested ID from the provider's reported alias; it is not independent verification of a provider's underlying weights.
- User requests such as “以后用 worker” call `set_model(model="worker")` for future tasks. Existing tasks keep their own model snapshots. This choice persists across engine restarts, without editing provider credentials or making a model request.
- For a particular task, use `set_model(model="profile-or-model-id", task_id="...", expected_revision=...)`. A running or stopping task rejects this operation. **Never automatically pause or resume a task merely because the user asks to switch its model.** The user must explicitly request pause first (CLI `pause` or `control_task(action="pause")`), wait for confirmed stop, then choose a model. Keep it stopped until the user explicitly requests resume. An explicit combined user instruction to pause, switch and resume authorizes those separate steps, in that order.
- An unlisted model ID uses the current selected profile's endpoint; specify `profile` to choose another configured endpoint/credential. Do not invent support, remote availability or prices. An unavailable ID fails on the next explicitly started run. Choosing a model never discovers endpoints or copies credentials to new endpoints.
- Terminal chooser: `deng model --config PATH` chooses the future default; add `--task TASK_ID` for a stopped task. Numbered choices come from configured profiles. Noninteractive invocation lists metadata and exits. `deng models` always lists only.
- Switching preserves conversation checkpoints, task scope, fixed acceptance, usage, reservations and original deadline. It neither clears unknown usage nor increases budgets. The selected model executes only on a future task or explicit task resume (queued work continues normally).

Task example (replace paths/commands with the real project task):

```json
{
  "goal": "Implement the behavior in the supplied design and pass its fixed tests",
  "inputs": ["docs/feature-design.md"],
  "scope": {
    "read": ["."],
    "write": ["src"],
    "commands": [{"argv": ["node", "--test", "test/feature.test.mjs"], "cwd": "."}]
  },
  "acceptance": {
    "commands": [{"argv": ["node", "--test", "test/feature.test.mjs"], "cwd": "."}],
    "required_files": ["src/feature.mjs"]
  },
  "request_id": "feature-implementation-v1"
}
```

## Delivery and runtime checks

- Declare bounded `timeout_ms` and `replay_safe` per exact command when appropriate; the worker cannot raise them. Long renders can exceed the 120-second default within the product ceiling and original task deadline.
- Milestones are historical observations. Final acceptance binds `required_files` to a streaming SHA-256 manifest; use `protected_files` for read-only check dependencies and `verify_delivery` to detect later edits.
- `runtime_status` reports loaded MCP business and engine build IDs. Active older engines remain running; idle ones upgrade with records preserved. Pre-alpha.13 MCP connections need one host refresh. Refresh a changed console URL in its existing panel.
- Unknown command outcomes require their own explicit acknowledgment, separate from unknown usage. Never select either on the user’s behalf.
