# npm installation

Node.js 24+ and npm 10+ are required. Install from the public npm registry, then initialize your user connection once:

> npm publication is undergoing automated validation. The registry command below becomes usable when the full package is released; the temporary holding package does not contain the CLI.

```sh
npm install --global dengagent
deng init
```

The public package is [dengagent](https://www.npmjs.com/package/dengagent). npm installation only installs the CLI; `init` explicitly writes user MCP/skill settings and asks for URL/model/hidden Key. No project is bound. `deng configure` and `deng console` work from any directory. A new Codex project inherits global settings without per-project initialization.

See [global integration and legacy migration](global-integration.md) for exact scopes, file locations, migration backups and task isolation. Every global MCP tool requires an explicit absolute project. Legacy project configs remain overrides until migrated; `--project` explicitly creates/edits a project override, while `--config` selects an exact custom config.

To upgrade, run `npm install --global dengagent@latest`, then repeat `deng init` to refresh user registration. Handle running tasks and explicitly stop old engines before requiring a new binary version. The settings engine is stopped with `deng stop-engine --global`; project engines use `--project PATH`. No command automatically pauses/resumes work to make a settings change or migration possible.

Use `deng --version`, `command -v deng` and `npm prefix --global` to diagnose an old launcher taking precedence. A `.command` launcher in `~/.local/bin` can precede npm's bin directory. npm does not replace a different path's executable. Node version-manager changes can move the Node/global prefix: reinstall and repeat user setup; explicitly migrate old project wiring so it cannot shadow the user entry.

The tarball bundles reviewed runtime dependencies and their legal notices, but not Node. Local tarball installation is tested offline. The matching shrinkwrap is retained for compatible npm versions; version preservation is checked against the bundled tree. No automatic install/prepare credential hooks are included.

Initialization errors include safe filesystem codes and a phase without native messages/Key values. A configuration editor keeps its local engine alive while a person types; finishing editing releases keepalive. A manually stopped engine is not automatically restarted to save the form. `PROJECT_NOT_CONFIGURED` / `GLOBAL_NOT_CONFIGURED` should be checked against the intended scope and any custom `--config`.

References: [npm global installation](https://docs.npmjs.com/cli/v11/commands/npm-install/), [published package files](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).
