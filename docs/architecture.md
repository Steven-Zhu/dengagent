# Execution model and limits

Each project has a single EngineHost, a private Unix socket and a SQLite ledger under `.dengagent`. CLI, MCP and browser clients connect to the same engine. A bounded task specifies input files, read/write roots, exact command argv/cwd, fixed acceptance checks and call/token/duration/repair limits. Completed means the declared acceptance checks passed; it is not an independent semantic-quality certification.

Task submission snapshots the chosen model profile. Default model selection affects only future submissions, including when other tasks are active. Changing an existing stopped task's model requires explicit revision checks, manual pause and a separate explicit resume. Budgets, unknown-usage reservations, scope and original deadlines are not reset. Terminal tasks cannot resume. Engine restart marks unfinished work interrupted; there is no promise of token-level or external-side-effect replay safety.

## Context and usage

Compatible requests reserve serialized context JSON bytes plus overhead before sending; this deliberately conservative reservation is not a tokenizer or currency forecast. Actual provider-reported usage settles the reservation. Missing usage keeps the reservation unknown and stops further automatic dispatch. Explicit user acknowledgement may allow continuation of an eligible stopped task, but does not erase the retained reservation. Provider cancellation cannot retract charges already incurred.

When history grows, deterministic compaction removes older completed assistant/tool groups from the outgoing request. All user instructions and the full ledger remain; tool-call/result pairs stay together. A checkpoint lists recorded file changes and instructs the worker to re-read relevant ranges and avoid replaying commands or treating omitted checks as passed. There is no additional summarizing model call. Extremely large immutable inputs/tool definitions can still exceed the configured context; that is reported as a context limit. Insufficient remaining task allowance is reported separately.

`write_file` and `append_file` accept bounded chunks. Append requires the expected current SHA, retains file mode, checks protected paths and commits by atomic rename. Existing files are not silently overwritten after a stale SHA. Partial tool calls from truncated output are never executed. A bounded repair can ask for smaller chunks using the original remaining call/token/repair limits and deadline. Repeated truncation waits for user input. Tasks never receive automatic extra allowance.

## Files, commands and credentials

File tools resolve paths and reject symlink escapes, out-of-scope locations, the app ledger, current/retired/task credential references and configured protected paths. Command scope uses exact declared argv/cwd. The macOS backend uses `sandbox-exec`, denies network access and limits writes to declared roots and a task scratch directory. It also denies known private locations and credential reads, but is not a complete filesystem read sandbox. A project-root read scope may expose project data; choose scopes deliberately.

If the protected backend cannot start, commands fail. `tools.isolation="host"` is an explicit opt-out with ordinary host permissions; it is intended for controlled fixtures or an externally isolated environment. Windows and protected command execution on non-macOS are not supported release targets. Child processes receive an environment allowlist and scratch HOME/TMP; provider credentials are not inherited.

Keys are local file/environment references, never model input by design. API request bodies and task content are sent to the configured provider when execution is explicitly started. Local model-visible files must not contain secrets. The app does not encrypt its database, inputs or Keys, and does not isolate other programs running as the same user.

## Observers and host integration

The loopback browser console uses a random path, CSP, no CORS, same-origin/CSRF-protected writes and a whitelisted public snapshot. SSE replays events by cursor; it does not invoke a model. `prepare_console` gives the host time to open the panel, after which heartbeat traffic keeps the engine alive. A new engine creates a new URL.

MCP supplies tools, resources and structured results. These do not themselves insert a worker's deltas into the host's native chat flow or wake an idle conversation. The optional native MCP App uses a tool bridge and remains experimental. A browser fallback must be labeled as a browser fallback.

## User-level entry and explicit project routing

The user MCP launches as `deng mcp --global`; no project config is pinned in its registration. Every tool, including task reads/controls and App UI calls, names its absolute project. Calls resolve independently; there is no mutable shared “current project.” Relative/missing projects and mismatched copied configs are rejected. A task ID from another project is not resolved there.

Global settings use a settings-only engine that rejects task submissions. New task projects lazily receive private runtime snapshots under the user settings directory and their own ledger under `<project>/.dengagent`; new projects need no local Codex registration/skill. Existing legacy configs remain overrides until explicitly migrated.

Inheriting engines refresh model/provider/budget defaults before new submissions and catalog reads. Existing tasks retain model/profile/provider-mode/credential and budget snapshots, including on resume. Refresh and explicit project connection saves serialize; explicit project saves detach inheritance. User-wide settings and skills are protected from task file tools and the macOS command sandbox.

See the [Pi capability map](pi-boundary.md) and [delivery/recovery/runtime contracts](delivery-lifecycle.md) for the alpha.13 implementation and verification boundaries.
