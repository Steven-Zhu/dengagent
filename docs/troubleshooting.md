# Troubleshooting / 常见问题

[Documentation](README.md) · [Support / 支持](../SUPPORT.md)

## Installed version / 运行的版本不对

```sh
deng --version
command -v deng
npm prefix --global
```

An old `.command` launcher can take precedence over npm. Invoke the npm prefix's `bin/deng`, or adjust PATH. npm installation does not overwrite a different launcher path. Node version-manager changes may require reinstalling the package and repeating user setup.

旧 `.command` 入口可能排在 npm 之前。明确使用 npm 前缀下的 `bin/deng`，或调整 PATH；换 Node 版本后可能需要重新安装并运行用户级接入。[安装说明](npm-installation.md)

## Setup and scope / 初始化与目录

`deng init` sets up the user connection once; `deng configure` works from any directory. `GLOBAL_NOT_CONFIGURED` means the user connection is missing. `PROJECT_NOT_CONFIGURED` may indicate an exact custom/legacy configuration was selected. Check `--project` / `--config` and the version before creating another config.

`deng init` 默认只做一次用户级接入，`deng configure` 不依赖当前目录。缺少全局配置时运行一次初始化；使用自定义或旧配置时，核对传入的参数，不要反复新建配置。[接入与迁移](global-integration.md)

The MCP requires an absolute project path on every call. `PROJECT_REQUIRED` means the host must select the intended project. `CONFIG_PROJECT` means a configuration belongs to another project; do not copy private project config files between workspaces.

每次 MCP 调用必须明确绝对项目路径。`PROJECT_REQUIRED` 需要选择项目；`CONFIG_PROJECT` 说明配置属于其他项目，不要通过复制私有配置来接入新项目。

## HTTP 401 / 模型认证失败

`UPSTREAM_HTTP: Model service returned HTTP 401` means the model endpoint rejected authentication. A connected local console does not validate the provider Key.

Check the provider's official base URL and the corresponding Key type, Key validity and account entitlement. Deng uses OpenAI Chat Completions; supply the base URL, not a full endpoint ending in `/chat/completions`. Do not mix a provider's subscription Key with another API product. Model IDs must come from that provider's own documentation.

For Tencent Token Plan, use the [official quick start and error table](https://cloud.tencent.com/document/product/1823/130119); addresses and supported models can change. Do not infer one exact cause from HTTP status alone.

本地控制台“已连接”只代表控制台连接成功，不代表模型 Key 可用。核对供应商官方基础 URL、配套的 Key 类型、有效状态和账户权限。不要把不同 API 产品的 Key 混用。腾讯云 Token Plan 请以[官方接入与错误码说明](https://cloud.tencent.com/document/product/1823/130119)为准，不能仅凭 401 判断是哪一项错误。

Save the corrected connection and submit a new task. Existing tasks retain their original connection snapshot. A test connection is optional and requires explicit permission for one potentially billable request.

保存正确连接后提交新任务，旧任务保留原连接快照。连接测试需要明确允许一次可能收费的请求。

## Key files and blank lines / Key 文件与空行

The user config is `~/.config/dengagent/global.json`. The current profile's `api_key_file` points to its credential file; a project override may refer to a different one. Stored credentials are private plaintext files, not encrypted. Inspect only locally; do not paste them into issues.

Deng trims leading/trailing whitespace when saving and reading a Key. A final newline, multiple blank lines or CRLF endings do not become part of the authentication header. A newline inside the Key is different: paste the complete Key again through `deng configure`. Empty Key input retains the previous value.

配置的当前 profile 中，`api_key_file` 指向实际凭证文件，项目覆盖可能指向不同文件。Key 以私有明文文件保存，只在本机查看，不要上传。首尾空格、换行和多个空行会被去除，不影响认证；如果 Key 字符串中间断行，应重新完整粘贴。配置时 Key 留空表示保留原值。

Newly saved file Keys use file credentials explicitly. Legacy `credential_source: auto` may take a nonempty environment variable before its file. `key_configured: true` confirms only local presence, not validity. [Credential behavior](configuration.md)

## Unknown token usage / token 数字不一定是实际消耗

When a provider returns no usage, Deng retains a conservative reservation and records unknown usage. A displayed token total can include that reservation; it is not a provider bill. Inspect the provider's usage records before reconciling unknown requests. No automatic acknowledgment or allowance increase occurs.

供应商没有返回用量时，Deng 会保留保守预留并标记未知；界面 token 数字可能包含预留，不代表已确认账单。不要为了继续执行而未经核对清除未知用量。

## Settings editor disconnected / 配置编辑断开

Current versions keep the settings engine alive during interactive editing. A manually stopped engine is not restarted to force a save. On `CONNECTION_DISCONNECTED`, rerun `deng configure`; on a filesystem error, retain its safe code and phase in the report. Do not include Key values or private paths.

当前版本在交互编辑期间保持配置服务存活。手动停止引擎后不会为了保存而强制重启。出现断开时重新运行配置；其他故障请保留安全错误码和阶段，反馈时移除 Key 与私有路径。

## Embedded console unavailable / 嵌入控制台不可用

MCP App rendering depends on the host. Use the local browser URL returned by `prepare_console` when the host cannot display it. A fresh engine returns a fresh URL; retrieve it again instead of bookmarking an old token. Closing the page does not stop work.

嵌入展示取决于宿主。不支持时打开 `prepare_console` 返回的本机浏览器地址；引擎重启后获取新地址。关闭页面不会停止任务。[MCP App status](mcp-app.md)
