# Security

Only the latest Alpha source is maintained. There is no security-response SLA. This is a local developer preview, not a hardened multi-user service.

For a suspected credential leak, scope bypass, command sandbox escape or unauthorized task control, use this repository's **Security → Advisories → Report a vulnerability** when private vulnerability reporting is enabled. Do not put credentials, exploit details or private task logs into a public issue. If private reporting is unavailable, open a minimal issue asking maintainers to enable a private reporting channel; share details only after a private channel is established.

Include the version, OS/architecture, isolation mode, affected component and a reproduction using fake credentials in a temporary project. Rotate a genuinely exposed Key with its provider.

The browser console binds only to loopback, uses a random URL, and requires same-origin JSON/CSRF for writes. Anyone with access to the local account can still access its files and Unix socket. The random console URL is local access information: do not publish it. Do not expose this port through a public proxy.

Keys are stored in private local files or supplied through environment variables. They are not encrypted by this application. Old credential files are retained and protected so existing task snapshots continue to reference their original connection. Remove them only after intentionally retiring dependent tasks and backups. Provider/model credentials never belong in task input or model-visible files.

The macOS command backend denies network access and restricts writes, but is not a general read-isolation boundary. `tools.isolation="host"` means ordinary host execution and provides no OS sandbox. See [architecture](docs/architecture.md) and [configuration](docs/configuration.md).

## 中文说明

当前只维护最新 alpha，不提供安全响应时限承诺，也不是面向不可信多用户的服务。

凭证泄露、任务越权、沙箱绕过和未经授权的任务控制，请使用本仓库 **Security → Advisories → Report a vulnerability**。该入口需仓库维护者启用；不可用时只提交“请求开启私密报告渠道”的简短 issue，不要公开漏洞细节、利用代码、凭证或私有日志，私密渠道建立后再提供复现。

报告包含版本、系统与架构、隔离模式、受影响组件，以及临时项目和虚构凭证的复现。真实泄露的 Key 应及时在供应商端轮换。

控制台仅监听本机，随机 URL 不能替代账户安全，不应向公网转发或公开 URL。凭证保存在权限受限的明文文件或环境变量中，应用不加密；旧任务可能仍依赖旧凭证，不要未经确认删除历史文件。macOS 后端禁止网络并限制写入，但不隔离所有读取；host 模式没有操作系统沙箱。
