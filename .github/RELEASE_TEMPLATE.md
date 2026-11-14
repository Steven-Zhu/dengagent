# DengAgent — release notes / 发布说明

Use this as a drafting template, not as a completed verification record. Replace every placeholder and remove unverified claims before publishing. The first public release is named v1.0; align its package version and tag before building and verifying the release artifacts.

这是发布说明模板，不是已经通过验证的记录。发布前填写全部占位信息，删除未验证声明，首次公开发布命名为 v1.0，发布前同步包版本与标签，再构建和验收实际产物。

## What changed / 本次变化

Describe the concrete problem solved and user-visible behavior. Link the matching changelog section and migration guide.

## Install or upgrade / 安装与升级

Attach the exact tested tgz and checksums. Use the real filename in the installation command. Do not advertise npm registry installation until that exact version is actually published. Explain legacy migration and old launcher precedence where relevant.

## Verification / 验证

- Version and source commit:
- Test date, Node/npm, OS and architecture:
- Regression pass/fail/skip totals:
- Installed-package verification:
- Hosted CI run:
- Live provider/host checks, or explicitly not tested:
- SHA-256 checksums of attached artifacts:

## Limits and migration / 边界与迁移

Mention developer-preview status, credential storage, platform isolation, usage reservations and host-dependent embedded UI. Point to current documentation rather than copying obsolete instructions.

## 中文说明

概述本次变化、安装或迁移步骤、实际验证范围及已知限制。不要把离线测试写成真实供应商已通过。
