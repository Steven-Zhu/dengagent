# Contributing / 贡献指南

DengAgent is an alpha local task executor. Small, reviewable improvements and reproducible reports are welcome in English or Chinese. Read [the execution boundaries](docs/architecture.md) before changing task control, credentials, accounting or isolation.

欢迎中文和英文贡献，优先提交清晰、可复现、便于审查的小改动。涉及任务控制、凭证、用量或隔离时，先阅读[执行边界](docs/architecture.md)。

## Local development / 本地开发

Use Node.js 24+ and npm 10+:

```sh
npm ci
npm test
npm run check:docs
npm run audit:source
```

Tests use offline workers or loopback fixtures; never provide a personal Key. macOS is required for command sandbox checks. Other operating systems skip macOS-specific checks and do not establish equivalent isolation. For dependency changes also run `npm run licenses`, inspect both lockfiles and review every attribution change.

测试使用离线执行器和本机夹具，不能使用个人 Key。命令沙箱验证需要 macOS；其他系统不能把跳过测试等同于同等保护。修改依赖后需重新生成并审查许可证清单和两个锁文件。

## A useful change / 提交什么信息

Explain the concrete problem and resulting behavior, why the change helps, and how it was verified. Link a related issue if one exists. Discuss substantial new behavior before implementation; a small bug fix does not need a separate proposal.

说明具体问题、修改后的行为、修改原因和验证方法；已有 issue 时附上关联。较大新能力先讨论，小型修复无需另写提案。

Preserve task revisions, connection snapshots, usage reservations and original deadlines. Never silently stop/resume work, broaden file/command scope, increase an allowance, accept unknown usage or retry a provider request. Avoid unrelated refactoring in a focused fix.

保留任务版本校验、连接快照、用量预留和原始期限；不要暗中控制任务、扩大范围、增加额度、确认未知用量或重试模型请求。修复中避免混入无关重构。

## Documentation and media / 文档与素材

Keep `README.md` and `README.zh-CN.md` aligned on installation, behavior and limitations. Update linked reference guides where needed. Use `npm run check:docs` to check local file destinations. Follow the [demo plan](docs/demo-plan.md) for recordings; describe offline fixtures honestly.

中英文首页的安装、行为和边界应保持一致。相应参考文档也需更新，录制演示按既有方案进行，离线夹具应明确标注。

Never commit credentials, private paths, raw task logs/databases, private workspaces or unreviewed screenshots. Report security issues through [SECURITY.md](SECURITY.md).

不得提交凭证、私有路径、原始任务日志与数据库、私人项目或未经审查的截图。安全问题使用私密报告流程。

## Review and license / 审查与协议

Use the pull request template and include relevant platform coverage and whether a real model request occurred. CI and maintainer review decide whether a change is ready to merge; no response time is guaranteed.

使用 PR 模板，说明验证平台，以及是否调用真实模型。合并以 CI 和维护者审查为准，暂不承诺响应时限。

By contributing, you provide your contribution under this repository's [MIT license](LICENSE). Submit only work you have permission to license this way. Dependencies retain their own terms; changes require review of legal texts and NOTICE requirements. Follow the [community conduct](CODE_OF_CONDUCT.md).

贡献按本仓库 MIT 协议提供，请确保有权提交并采用该协议。第三方依赖仍遵循各自条款；更新时审查协议文本和 NOTICE 要求，并遵守行为准则。
