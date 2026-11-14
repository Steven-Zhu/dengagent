# Support / 支持

DengAgent is a developer preview maintained through this repository. English and Chinese reports are welcome. There is no guaranteed response time or commercial support commitment.

DengAgent 目前为开发预览版，通过本仓库维护，接受中文和英文反馈，暂不承诺响应时限或商业支持。

## Start here / 先查这里

- [Installation and upgrades / 安装升级](docs/npm-installation.md)
- [Configuration and credentials / 模型与凭证](docs/configuration.md)
- [Troubleshooting / 常见问题](docs/troubleshooting.md)
- [Compatibility and limits / 执行边界](docs/architecture.md)

## Ask or report / 提问与反馈

Use this repository's Issues tab and choose a bug report, feature request or usage question. Search existing issues first. Provide `deng --version`, OS/architecture, how you installed it, the relevant safe error code, expected behavior and a minimal reproduction with fake data.

在本仓库 Issues 中选择故障、功能建议或使用问题，先搜索已有反馈。提供版本、系统与架构、安装方式、安全错误码、预期行为，以及使用虚构数据的最小复现。

Do not upload API Keys, private connection files, raw task databases, private source, full console URLs or unreviewed logs. Even `configure --show` can contain a private endpoint; sanitize before sharing. Never include a Key on a command line for a report.

不要上传 Key、私有配置、任务数据库、私有源码、完整控制台地址或未经检查的日志。`configure --show` 虽隐藏 Key，仍可能含私有 API 地址，分享前也应检查。

For security issues use [SECURITY.md](SECURITY.md), not a public issue. Cloud account, billing and entitlement issues may need the provider's support; a local configuration check does not validate that account.

安全问题按[安全报告流程](SECURITY.md)处理。云账户、账单和套餐权限需联系供应商，本地配置检查不能验证这些状态。
