# Release preparation / 发布准备

This directory is the standalone repository root. Publish only this project's clean source, not the parent workspace or personal task examples. npm is the primary distribution route; the optional macOS runtime installer is secondary. No workflow publishes npm, pushes tags or creates a release automatically.

本目录是独立仓库根目录，不要发布父工作区或私人任务示例。主要使用 npm 分发，macOS 内置运行时安装器为可选渠道。本项目没有自动发布、打标签或创建 Release 的工作流。

## Repository setup / 仓库准备

Follow [GitHub launch](github-launch.md): choose the owner, confirm the source license, create the repository, fill actual package URLs, enable private vulnerability reporting and run hosted CI. Do not invent contact details, owners or badges. MIT source, dependency terms and any bundled Node license are distinct.

按上线清单确定归属、确认协议、创建仓库、补齐真实 URL、开启私密安全报告并实际运行 CI；不要编造联系方式、维护者或成功徽章。

## Verify the source / 源码验证

Use Node.js 24+ and npm 10+:

```sh
npm ci
npm test
npm run check:docs
npm run audit:source
npm run licenses
```

Inspect both lockfiles and all generated license changes. Run the offline demo with `npm run demo` when relevant. Tests use offline workers and loopback fixtures; do not describe them as live provider success. A hosted workflow is not passed until it actually runs on the intended commit. Review any dependency vulnerability findings before release.

审查锁文件和生成的协议声明，需要时运行离线 demo。离线与本机夹具不能证明真实供应商成功。GitHub CI 必须在目标提交实际通过，依赖漏洞结果也需审查。

Before export, check exact filenames, versions, private paths, credentials, task databases, logs, screenshots and runtime directories. Include source, tests, scripts, portable docs, examples, lockfiles, licenses and community files. Exclude `node_modules`, local task records, personal workspaces and machine-specific reports.

## Verify the npm tarball / npm 包验证

```sh
npm run sync:shrinkwrap
npm run licenses
npm run check:docs
npm run audit:source
npm test
npm pack --pack-destination /absolute/artifacts
npm run verify:npm -- --package /absolute/artifacts/dengagent-VERSION.tgz
```

Replace VERSION with the exact package version. Inspect the tarball file list and hash before testing. The reviewed runtime dependencies are bundled; shrinkwrap alone does not guarantee npm will preserve versions. The verifier uses an isolated temporary HOME and global prefix, fake Keys and offline task work. It exercises user setup, delayed input, migration, multiple projects, overrides, reinstall and preservation on uninstall. It does not modify a real user connection or validate a cloud account.

将 VERSION 换成准确版本，检查文件列表和校验和。验证器仅使用隔离目录、虚构 Key 和离线任务，不修改实际用户接入，也不验证云账户。

For behavior changes, verify first setup, later editing, blank-Key retention, destination reuse, zero-call saving, explicit one-call probing and existing task snapshots. A real provider probe is separate, optional and potentially billable. Record the result truthfully.

## Optional macOS runtime installer / 可选 macOS 安装器

Use a trusted Node distribution whose upstream LICENSE is present beside the binary or at its root:

```sh
npm run bundle -- --node /absolute/path/to/node --out /absolute/artifacts
node scripts/verify-installer.mjs /absolute/artifacts/DengAgent-VERSION-darwin-ARCH.command
```

Substitute the actual version and architecture. Verify every offered architecture separately. Inspect bundled runtime/LICENSE, application licenses and valid relative symlinks. The existing installer is unsigned/unnotarized; do not describe it as a signed application. Signing, notarization and revalidation after transformation are separate work.

替换准确版本和架构，逐一验证要发布的架构。现有安装器未签名或公证，不能称为正式签名应用。

## First public release: v1.0 / 首次公开发布：v1.0

Use [the release template](../.github/RELEASE_TEMPLATE.md) and [changelog](../CHANGELOG.md). Include actual Node/npm, platform, architecture, test totals, hosted run, installed-package result and SHA-256 hashes. State whether any real provider/host was tested. Do not publish local path-bearing raw reports.

发布说明记录实际版本、平台、测试和安装结果，以及附件校验和；说明真实供应商与宿主验证情况，不上传含私人路径的原始报告。

Name the first public release v1.0. Align the package version to 1.0.0 and the release tag to v1.0, then rebuild and verify the actual artifacts before attaching the exact tested tgz/checksums. Historical build records retain their original identifiers. Attach optional installers only for tested architectures. Retest downloaded artifacts after any upload/signing transformation. Add media from the [demo plan](demo-plan.md) when ready; media can be omitted.

After the owner controls the final npm identity/name, publication is a separate explicit action using the explicitly chosen distribution tag. Check the version is new and the package name is really available. A registry 404 does not reserve a name. Advertise registry installation only after the exact version is published. Keep installation examples pinned to the available route.

确定并控制 npm 发布身份后，再按首次 v1.0 发布计划明确执行发布。核实名称和新版本，404 不代表预留成功。实际发布后才能宣传注册表安装指令。
