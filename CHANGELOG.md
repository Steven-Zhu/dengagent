# Changelog

## 1.0.0 — First public release

- Codex integration with independently configured worker models, explicit scopes, task allowances and observable execution.
- Fixed acceptance, protected check files, artifact manifests and recovery with retained original budgets and deadlines.
- Include the installed UI guidance fix: console display is an observation aid and does not block authorized backend execution.
- Publish bilingual case studies, annotated workflow graphics and installation guides.
- Update Hono dependencies to patched compatible versions and remove the reported dependency advisories.
- Make CLI regression tests version-independent and wait for the real child exit after PTY EOF, preserving the original timeout.


## 0.2.0-alpha.13 — Product contracts and Pi integration

- Bind final acceptance to streaming artifact manifests and explicit protected check files; preserve milestones as historical evidence.
- Journal model/command dispatch and settlement atomically, classify crash leftovers as unknown, and require separate explicit acknowledgments.
- Support authorized bounded long-command timeouts, constrained by the original task deadline and product ceiling.
- Compare normalized raw requests for idempotency before resolving mutable defaults, including compatible legacy records.
- Use Pi transformContext and steering; persist its canonical transcript, send input revisions incrementally, and bound diagnostic reads/repeated tool failures.
- Load fresh business code behind the standard MCP SDK, verify actual build identity, protect active tasks and upgrade idle engines.
- Add CLI/MCP/browser/App input and delivery controls; retain all contextfix.1–4 changes already in alpha.12.


## 0.2.0-alpha.12 — Tool reliability

- Unify configurable per-chunk writes (default 16000 chars) and batch totals (64000 chars); actionable, bounded errors preserve content without echoing it.
- Bound read/search output, expose pagination and truncation, include actual match snippets, and cap directory traversal.
- Detect overlapping edit matches, recheck file conflicts before rename, hash binary acceptance files correctly, and persist expired resume as a terminal deadline state.
- Preserve scopes, symlink/private-path protection, exact command allowlists, unknown-usage reservations and model-control semantics.
- New bounded resume instructions reset only the no-progress observation window, preserving original token/call/time allowances.
- Passed milestones can be revalidated after review; a failed prerequisite recheck invalidates downstream checks.
- Add regression coverage for tool boundary failures and recovery.

## 0.2.0-alpha.11.contextfix.4

- Default model-call allowance to null (unlimited), with explicit finite caps preserved.
- Handle unlimited calls in submission budget resolution, admission, checkpoints and console display.
- Add CLI and console settings for future-task model-call allowance without changing other limits or existing tasks.

## 0.2.0-alpha.11.contextfix.3

- Consolidate contextfix.2 source, compact MCP summaries, execution-evidence preservation and admission diagnostics into the development repository.
- Set new-install and recommended cumulative task token allowance to 16,000,000; raise configuration/task validation and browser settings ceiling to the same value. Share the connection budget validator with configuration parsing.
- Preserve explicit lower budgets, submitted task snapshots, model/credential settings and all other limits.


## 0.2.0-alpha.11.contextfix.2 (2026-11-11, local review build)

- Based on the supplied contextfix.1 runtime and preserves its mandatory execution/read evidence.
- Bound default MCP task responses and add explicitly paged public task details.
- Expose requested/effective budgets, clipping sources, recommendation differences and admission rejection measurements without changing allowances.
- Keep normal logs in the console, correct the wait timeout inference wording, and update the packaged worker handoff skill.
- Add deterministic response-size and protocol/diagnostic regression coverage; no live model or automatic host-wake claim.


## Unreleased

- Preserve normalized system messages and tool additions/removals during context compaction, including DeepSeek reasoning chains. Oversized system policy/tools now fail locally instead of disappearing from requests.
- Verify that compacted ordinary and DeepSeek HTTP/SSE requests retain the system policy and complete native tool set, with no live model calls.

## 0.2.0-alpha.11.contextfix.1 (local context-compaction fix, 2026-11-10)

- Retain the latest substantive tool exchange and current file-read evidence during compaction; excerpt large reads with explicit line and truncation metadata.
- Carry recent operation outcomes and milestone state into deterministic checkpoints; stop if required evidence cannot fit the hard limit.
- Verify 20 offline regressions, including 8 exact historical compaction replays and a mocked request-adapter integration. No live model calls.

## 0.2.0-alpha.11 (local revision, 2026-11-08)

- Default new model profiles to low reasoning; retain configured output caps.
- Preserve whole DeepSeek reasoning/tool chains during compaction and reject malformed request history before dispatch. Add structural-only request diagnostics.
- Change truncation recovery to a minimal executable slice with low reasoning and an 8K maximum output cap.
- Stop repeated responses without actual progress; bound validation error echoes and aggregate cache/reasoning usage.
- Add scoped/hash-checked batch file writes, immutable ordered milestone checks, and quiet cursor-based completion waits.
- Add local SSE, compaction/recovery, no-progress, batch, milestone and observer regression tests. No live provider compatibility claim.


## 0.2.0-alpha.10 — 2026-11-05

- Set explicit new-connection defaults: 256K context, 32768 output tokens, five-minute request timeout, thinking enabled with medium requested effort, and 1000000 cumulative task tokens.
- Add provider-specific reasoning request formats and show the requested/wire effort separately. DeepSeek medium requests are mapped to high; unsupported formats are an explicit configuration choice.
- Expose generation controls in terminal/browser settings and public metadata. Preserve them across endpoint edits and provide configure --recommended for explicit adoption by existing connections.
- Preserve historical task snapshots and budgets, including their original reasoning wire behavior. Keep connectivity-only probes bounded with thinking disabled; full tool/reasoning probes remain explicit.
- Verify multi-turn reasoning_content replay without publishing reasoning text or credentials in public events.

## 0.2.0-alpha.9 — 2026-11-05

- Detect DSML protocol markup in ordinary model text, block every tool in that response, and recover only within the original task's limits. Never execute text as tools.
- Preserve response diagnostics, recovery history and actionable failure codes; stop repeated no-finish/protocol failures in waiting_input instead of reporting a generic worker stop.
- Unify write/append/edit replacement chunks at 2000 characters; add scoped directory listing and field-specific command cwd validation.
- Record command exit/signal/timeout/truncation separately from tool transport, and separate settled token usage from pending/unknown reservations in both consoles.
- Add embedded UI-client acknowledgments and a local console status tool, without treating host capability or queued tab opening as display proof.
- Fix isolated native-tool probes from a user-level configuration. Add an opt-in same-sandbox Swift/PNG/H.264 finalize-and-decode check without loosening isolation.

- Refresh both READMEs with matching product/workflow, installation, compatibility and documentation navigation.
- Add bilingual support, troubleshooting, roadmap, demo storyboard and GitHub launch preparation; leave video/GIF assets explicitly pending.
- Update MCP App status to reflect user-observed desktop rendering without claiming successful live-provider execution or general host compatibility.
- Expand bilingual issue/PR templates, add a release-notes template, and check first-party documentation file links in CI.

## 0.2.0-alpha.8 — 2026-11-04

- Make default init/configure/console user-scoped; install MCP and skill once instead of binding them to the launch project.
- Add a global MCP router with explicit immutable project arguments on every tool and App call. Preserve fixed-project adapters.
- Share user connection defaults across new projects while retaining isolated engines/ledgers and explicit project overrides.
- Refresh future defaults without rewriting existing task provider/model/credential/budget snapshots. Protect user settings and skills from workers.
- Add explicit, backed-up legacy migration with private credential copying and removal of shadowing project integration; never stop a running engine automatically.

## 0.2.0-alpha.7 — 2026-11-04

- Keep the local engine alive while a person edits connection settings or confirms saving, preventing socket ENOENT after the default 60-second idle timeout.
- Release keepalive when editing ends, preserving normal idle shutdown. Respect explicit engine shutdown and report CONNECTION_DISCONNECTED rather than suggesting a missing configuration/Key file.
- Reproduce delayed human input in terminal tests and final installed npm verification using a short fixture idle timeout.

## 0.2.0-alpha.6 — 2026-11-04

- Report allowlisted filesystem failure codes and init phases without returning native error messages, credential paths or values.
- Identify invalid connection JSON and project Codex TOML explicitly; validate project registration format before changing credentials/config.
- Report when a later project-registration/ignore failure occurs after the connection was saved.
- Add regression coverage for Tencent/DeepSeek configuration and filesystem/format failures; remote user incident diagnosis remains dependent on the actual project/error.

## 0.2.0-alpha.5 — 2026-11-02

- Continue interactive `init` into the connection editor for existing projects, preserving blank values/Keys and supporting cancellation without overwrites.
- Print a readable terminal completion instead of raw configuration JSON; keep `--json` and noninteractive output machine-readable.
- Display the running version during setup and support `--version` to diagnose old launchers taking precedence.
- Verify fresh and existing-project non-offline initialization from the installed npm package without provider calls.

## 0.2.0-alpha.4 — 2026-11-02

- Require explicit API URL and model ID on first setup, with no preset provider/model.
- Name terminal/browser routes for adding a skipped Key and include exact commands for custom config paths.
- Document plaintext private credential storage and verify setup output/config JSON do not contain the Key value.

## 0.2.0-alpha.3 — 2026-11-02

- `deng init` displays the current working directory as the default and accepts Enter.
- Custom project paths create missing directories and parents automatically, while file conflicts and creation failures prompt again. Relative paths resolve from the current directory.

## 0.2.0-alpha.2 — 2026-11-01

- Make npm the primary installation path, preserving the optional runtime bundle. Add an installable tarball and an isolated global-install/MCP verification script; no registry publication is automatic.
- Bundle all reviewed runtime dependencies and retain a matching shrinkwrap for older npm versions, with public alpha-tag metadata.
- Infer per-project configuration for CLI commands and provide actionable first-run guidance. Canonicalize project paths before computing config names.
- Document “使用 Deng 开发” and “使用 DengAgent 开发” as the same invocation; keep `deng` as the terminal command.

## 0.2.0-alpha.1 — 2026-11-01

- Add a browser connection-settings form and `deng configure`: edit API URL, model, private Key and context/output limits. Blank Key retains the credential. Saving uses a revision check and atomic replacement; no inference is performed.
- Require a new Key or explicit credential reuse when the destination changes. Preserve old task connection snapshots and protected credential references. Reject saves during active or queued work without stopping tasks.
- Add an optional, explicitly confirmed one-request connection test. Do not return provider response text or save staged settings during a probe.
- Compact completed assistant/tool history for compatible-provider requests while preserving all user instructions and the full local ledger. Keep conservative input reservations; distinguish model context limits from task allowance exhaustion.
- Add bounded append chunks with SHA checks and executable-mode preservation. Recover truncated output within the original repair/call/token/deadline limits; partial tools cannot execute. Repeated truncation waits for input.
- Prepare portable setup/release documentation, MIT licensing and dependency notices, GitHub templates and offline CI. Native MCP App rendering remains experimental and host-dependent.
- Upgrade Zod to 4.6.7 for GHSA-mrhx-c7xc-m3w5. Preserve nested config defaults and genuinely partial task-budget overrides during the migration. Re-prompt invalid first-run API URLs before requesting a Key.

## 0.1.3 and earlier

Internal developer previews established Pi execution, project-scoped MCP setup, task budgets, fixed acceptance commands, local event observation, task control and model selection. They were not public stable releases.
