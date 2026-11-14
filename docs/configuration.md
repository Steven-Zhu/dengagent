# Connection configuration

`deng init` configures a user-level connection and installs global MCP/skill integration once. It does not select a task workspace. `deng configure` and `deng console` edit that shared connection from any directory. `configure --project PATH` explicitly creates/edits a project override; `--config PATH` retains custom/legacy configuration support. Global MCP tools always receive an explicit absolute project path.

The user config is `~/.config/dengagent/global.json`. Its internal workspace/data fields belong only to the settings service: that service rejects task submission. Actual task workspaces are selected separately and use per-project runtime snapshots/ledgers. See [global integration](global-integration.md).

```sh
deng configure --config /absolute/private-config.json
deng configure --config /absolute/private-config.json --show
deng configure --config /absolute/private-config.json --advanced
```

The terminal hides Key input. Blank URL/model/Key retains the current value. Canceling before save leaves the config untouched. `--show` returns only public metadata and whether a credential appears configured; it does not verify provider access. For automation, `--base-url`, `--model-id`, `--profile`, `--context-window`, `--max-output-tokens` and `--key-stdin` are supported. Read a Key from an existing private file without putting it in argv or shell history:

```sh
deng configure --config /absolute/private-config.json --model-id your-model --key-stdin < /absolute/private-key-file
```

No `--api-key` argument exists. `--reuse-credential` explicitly permits the old credential to be sent to a new URL. Changing the destination without a new Key or that permission fails. HTTPS is required except for loopback HTTP fixtures; embedded URL credentials, queries and fragments are rejected. The app appends `/chat/completions` to the supplied base URL.

## Browser form and connection test

Run `deng console --config ...`, open the fresh URL and click **连接设置**. Public responses never return Key values or credential file paths. The form clears a newly entered Key on successful save and when closed. It does not store Key values in browser storage. Browser writes require the page's CSRF token and exact same-origin JSON requests. A changed config revision causes a conflict rather than an overwrite; close/reopen the form to reload.

Opening the form and saving it do not invoke a model. The **测试连接** button requires a separate unchecked-by-default permission for one small potentially billable request. It sends one non-streaming completion request with a 32-output-token cap, a 15-second timeout, redirects disabled and no retries. It returns only sanitized status/usage metadata and never provider response text. Timeout or unknown usage does not imply that the provider did no work. The test does not save settings or validate all streaming/native-tool capabilities.

`deng configure --probe ...` explicitly requests that same one-call probe before saving; a failed probe does not save. `doctor --probe` is a different, broader native-tool/streaming test with its own bounds (up to three model calls); plain `doctor` makes no model request.

## Task snapshots and persistence

Project connection saves are refused while that project has active/queued work. Global connection saves are independent of project execution and refresh future defaults; they do not modify existing task snapshots or pause/resume/cancel work. An explicit project save detaches that project from inheritance. Saving validates the entire candidate, writes a private temporary config, checks the revision again and renames it atomically. The edited profile becomes the future-task default.

New Keys are written to versioned private files under the data directory. Existing tasks retain their original profile/URL/credential reference; changing the current profile does not rewrite a task checkpoint. Old credential references remain protected from worker file/process access. Do not delete these files while a task or backup still depends on them. Backups and local files are not encrypted by Deng.

The current profile's `api_key_file` is the authoritative file reference; a directory may also contain historical Keys. Save/read operations trim leading and trailing whitespace, including blank lines and CRLF endings. A newline at the end of a credential file is normal and is not sent in the authentication header. Do not insert line breaks inside the Key. See [troubleshooting](troubleshooting.md) before sharing diagnostics.

A new file Key uses `credential_source="file"`, so an inherited environment variable cannot unexpectedly override it. Legacy profiles default to `auto` (nonempty environment variable first, private file second). `credential_source="env"` explicitly uses only the configured environment variable. Environment-backed tasks retain an environment-variable reference, not a frozen secret value; changing the engine environment after a restart can change the credential that reference resolves to.

For multiple providers, define separate `models.profiles` in the private JSON config, then stop/reload the engine after ensuring tasks are stopped. The UI edits existing profiles; it does not add/delete profiles. A profile change clears same-profile model choices when its destination changes while preserving explicit thinking/effort and generation limits. Review the reasoning format when moving providers. Context/output limits are application settings and must match actual provider capabilities.

Manually editing the config outside the engine is detected. Reload it with an intentional `stop-engine` after handling active work; old running services are not forcibly replaced. After upgrading the application, stop the old idle engine to load the new version.

## Generation controls

See [model settings](model-settings.md) for explicit 256K / 32K / five-minute / enabled-low / 16M defaults, terminal and browser editing, legacy adoption and provider-specific wire behavior. The small connectivity test disables thinking and does not verify multi-turn reasoning.


`budget.max_no_progress_calls` defaults to 4 (range 1–20). Changed file content or new successful command/milestone evidence advances execution progress. Distinct scoped reads/listings/searches receive a separate finite discovery window (`tools.max_discovery_calls`, default 12); repeating identical evidence does not. Repeated tool/code/argument failures stop within the same original allowance. A task may lower this configured ceiling. NO_PROGRESS requires narrowed input on explicit resume; budgets and deadlines remain unchanged.

## File-tool limits

`tools.write_chunk_chars` controls single-file writes, appends, edit replacement text and each batch entry (default 16000; accepted range 256–64000). `tools.write_batch_chars` controls the sum of batch content (default 64000; accepted range 256–256000). Set these fields in the private configuration JSON, then reload an idle engine; the connection form preserves them. Limits are checked before writes, with actual length and a bounded recovery hint. Tool-schema strings intentionally do not reject sizes first, so the actionable error reaches the model. Overall resulting text files remain limited to 200 KB. Larger chunks do not increase provider output caps or task budgets.

`read_file` returns at most 200 lines / 24000 content characters per call, flags clipped lines and provides `next_start_line`. A single line is capped at 4000 characters. Use an explicitly authorized command for minified/long-line files; never treat a truncated read as the entire file. Search scans at most 1000 distinct entries (including directories), returns 50 bounded match-centered snippets and includes both read and write roots.

Per-command timeout/replay authorization, `acceptance.protected_files`, first-input inline limits and loaded build checks are described in [delivery and lifecycle](delivery-lifecycle.md). New global task defaults remain 16,000,000 total tokens; an explicit task override is reported separately from that default.
