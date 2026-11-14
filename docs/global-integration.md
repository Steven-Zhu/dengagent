# User-wide Deng integration

Agent integration currently supports Codex. Other agent integrations are in development. / 目前支持 Codex 接入，其他 Agent 的接入正在开发中。

## First setup

Install the npm package, then run `deng init` once from any directory. The interactive wizard asks for the API base URL, model ID and hidden optional Key. No provider/model default is supplied. Skipped Keys can be entered later with `deng configure`; global settings and `deng console` work from any directory. Restart/reload the host MCP connection and open a new chat after integration.

User-level files:

| Purpose | Location |
| --- | --- |
| MCP registration | `~/.codex/config.toml` |
| Skill | `~/.agents/skills/dengagent/SKILL.md` |
| Connection | `~/.config/dengagent/global.json` |
| Private credential files | User private settings/credentials directories; config contains references only |
| Project runtime snapshots | `~/.config/dengagent/projects/<id>/runtime.json` |
| Project task ledger/events | `<project>/.dengagent/` |

Public settings omit Key values and paths. Credential files are local plaintext with owner-only permissions, not application-encrypted. npm installation alone does not edit host settings or ask for credentials.

Codex supports both user and project scopes for [MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [skills](https://learn.chatgpt.com/docs/build-skills). Deng now uses user scope by default. Availability is per installed host/user; it does not install itself on another computer, expose a local MCP to a cloud container, or bypass host tool availability/policy.

## Invocation and isolation

In a Codex workspace, say “使用 Deng 开发 …” or “使用 DengAgent 开发 …”. The skill passes the current project as an absolute `project` argument on **every** MCP call, including console/model calls, reads and controls. Without project context, choose a project before executing. A new project directory must exist; the host can create a requested new directory before invoking Deng.

A single global MCP can concurrently serve multiple projects. There is no shared mutable project selection or fallback to the MCP launch directory. Each project has a separate engine, console, ledger and declared task scopes. Managed `.dengagent` directories receive their own ignore-all `.gitignore` so private ledgers/credentials are not accidentally added to the project repository; the root project ignore file is not rewritten by lazy routing. Cross-project task lookup fails instead of searching other workspaces. Global settings/skill/credentials remain protected even when the selected project is an ancestor of them.

Global URL/model/Key changes apply to future tasks in inheriting projects. Existing active, queued and paused task snapshots retain their prior provider/model/Key reference and budgets; no automatic pause/resume occurs. Global model selection through its console or `deng model --global` persists to the user connection. A deliberate per-project model selection can remain an override of the model ID while using that profile's current inherited connection.

`deng configure --project /absolute/project` (or that project's console settings form) creates an explicit connection override. It does not change the user connection or other projects. Such edits are refused while that project is executing/queued. Legacy private project configs are also preserved as overrides until migration.

## Legacy migration

Handle project work and explicitly stop its engine, then run:

```sh
deng stop-engine --project /absolute/legacy-project
deng init --from-project /absolute/legacy-project
```

Migration refuses any live project engine instead of stopping it. If no user connection exists, it imports the legacy URL/model/settings and copies existing file credentials into private user storage without displaying values. Original files and old task references remain. Environment-based credentials retain their environment reference. Missing credentials remain unconfigured and can be filled in the wizard. If user settings already exist, migration preserves them.

The project JSON is backed up before linking future defaults to the user connection. Project task data is retained. Shadowing project Deng MCP/skill files are backed up, then only that MCP entry and skill file are removed so the user registration/skill can take effect. Other MCP entries and unrelated files remain. Re-running migration is supported after resolving an interrupted setup; the existing user settings are not overwritten by the legacy source.

A user who already has global settings can preview/remove shadowing project integration separately:

```sh
deng setup --global --project /absolute/project
deng setup --global --project /absolute/project --apply
```

These commands change integration only, not that project's connection override. Full `init --from-project` also links its future connection defaults.

To recover an old project override, use its retained `.backup-global-*` JSON and integration backups after deliberately handling/stopping work. Do not delete old credential files while checkpoints or backups still reference them.

## CLI defaults

| Command | Default |
| --- | --- |
| `deng init` | User-wide setup; no project prompt |
| `deng configure`, `deng configure --show` | User connection from any cwd |
| `deng console` | User connection/settings console |
| `deng model --global` | Persist user-wide future default |
| `deng run/status/model/... --project PATH` | Explicit execution project |
| Execution commands without `--project` | CLI cwd is the explicit shell context |
| `deng mcp --global` | Every tool explicitly names its project; launch cwd unused |
| `deng ... --config PATH` | Legacy/custom exact configuration |
| `deng init --project PATH` | Legacy project-specific setup |
| `deng stop-engine --global` | Stop only the settings engine, when explicitly requested |

Actual task execution retains platform limitations: protected commands currently use macOS `sandbox-exec`. Global availability does not imply cross-platform sandbox parity. Native MCP Apps remain experimental; test metadata/resource negotiation does not prove desktop rendering. The supported browser fallback uses the console for the explicitly selected project.
