# Delivery, recovery and runtime upgrades

## Final delivery

Milestones are ordered historical observations with timestamps, file hashes and an artifact version. Rechecks add history and report their latest outcome; they do not erase past stage evidence. A pass does not certify a later edit. Every declared stage must have passed at least once before a candidate is submitted.

Final acceptance independently hashes all `acceptance.required_files` with streaming SHA-256, runs the fixed commands, then rehashes the same files. A change during this window invalidates the attempt. The resulting delivery ID binds task, file/version manifest, protected check dependencies and commands. Required files must exist before final acceptance; build them with authorized commands first.

`acceptance.protected_files` is an explicit list of regular, read-scoped check scripts or dependencies. Submission snapshots it; file tools and the macOS write sandbox prohibit editing it, and final checks verify its hashes. Other files remain editable according to scope. This is not an automatic dependency graph or a claim that every imported check dependency is frozen.

`get_task` includes the delivery ID and file count. `verify_delivery` / `deng delivery TASK_ID` compares the current workspace with the recorded manifest without inference. A later modification returns `valid:false`; the original certificate remains a record of the earlier version. `completed` certifies the configured checks, not general semantic quality. The workspace is not an immutable artifact store.

## Durable side effects

SQLite journals each model reservation, dispatch, provider request ID when supplied, settlement or unknown outcome. Related task, operation and event updates commit in one transaction. Restart classifies unresolved calls as unknown and retains their reservations; they are no longer displayed as active requests. Explicit acknowledgment permits continuation within the original allowance and deadline; it never deletes those reservations.

Command journals record intent, startup PID and known exit/signal/timeout. Unresolved unsafe commands require a separate `allow_unknown_commands` acknowledgment. `replay_safe:true` must be explicitly authorized by the task author for a deterministic operation. The worker cannot grant this property to itself. A recorded exit is evidence even if the final conversation checkpoint was lost. Ordinary failed commands are returned to Pi for bounded correction, not automatically rerun.

## Long commands

A declared command can specify `timeout_ms` (100–3600000 ms). Its actual allowance is capped by `tools.max_command_timeout_ms` (default 600000) and the remaining original task deadline. Commands without an override retain `tools.command_timeout_ms` (default 120000). Runtime arguments cannot change the frozen timeout or replay policy. Cancellation terminates the process group; output remains bounded and UTF-8 safe.

```json
{"argv":["python3","render.py","--final"],"cwd":"work","timeout_ms":360000,"replay_safe":true}
```

## Identity and upgrades

The engine health endpoint reports loaded version, protocol, build hash, PID and workspace. The hash covers runtime source and UI files and is captured when that code is loaded. An alpha.13 MCP process keeps the standard SDK transport; each business operation loads a fresh standard Node Worker module graph. Updating installed files therefore refreshes business code on the same MCP connection. Newly added tool schemas still require the host to refresh its tool inventory.

Clients compare protocol, loaded build and configuration. Read operations and explicit pause/cancel can reach an older active engine. Mutations that need new code return `ENGINE_UPGRADE_PENDING` without stopping work. Once idle, the client shuts down that engine and starts the installed build, preserving the database, settings, credentials and task snapshots. A newer incompatible protocol or unidentified legacy engine returns a specific reconnect instruction instead of guessing.

Connections predating alpha.13 need one host MCP refresh to acquire this new loader. Reinstalling cannot replace JavaScript already resident in those old processes. `runtime_status` and `deng doctor` expose the actual loaded build; matching package version text alone is insufficient.

A restarted engine issues a fresh console URL. Obtain it from `prepare_console` and navigate the existing project panel to that URL. A queued panel-opening request or a UI heartbeat alone is not pixel verification. Reusing an old random URL cannot reconnect to a different engine.

## Input and progress

First input contains a path/size/hash manifest with a shared 12000-character inline budget (`tools.input_inline_chars`). Larger references are read on demand. Subsequent resume/steering messages contain undelivered revisions and bounded execution facts; they do not reinject immutable file text. Conservative serialized-byte reservation is not actual token measurement.

Different scoped read observations receive a finite discovery window (`tools.max_discovery_calls`, default 12). Repeated identical tool/code/argument failures are summarized with corrective hints and stopped by the original no-progress limit. File changes advance an execution observation, never a semantic quality score; only final checks authorize completion.
