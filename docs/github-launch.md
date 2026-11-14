# GitHub launch / GitHub 上线准备

The release repository is [Steven-Zhu/dengagent](https://github.com/Steven-Zhu/dengagent). This guide records the presentation choices and operational checklist. Repository creation, hosted CI, npm publication and release publication are separate steps; a checked-in file does not establish that an account setting or publication has completed.

发布仓库为 [Steven-Zhu/dengagent](https://github.com/Steven-Zhu/dengagent)。本文记录展示方案和操作清单；仓库设置、托管 CI、npm 发布和 Release 发布分别验收，不以文档存在代替实际完成。

## Identity / 账号与仓库归属

Keep your existing personal account. If DengAgent should have its own brand and shared ownership, create a GitHub Organization through that account and place the repository there. Contributors keep using individual personal accounts. An organization is not a shared login or a claim that the project has a large staff.

继续使用现有个人账号。如果希望 DengAgent 有独立品牌和多人权限管理，可用该账号创建 GitHub Organization，将仓库放在组织下；每个人仍使用自己的账号。不要用共享账号模拟团队，也不必为了项目另注册一个个人号。

DengAgent currently uses the personal repository `Steven-Zhu/dengagent`. The package metadata points to this repository. A future organization transfer should update these URLs and verify redirects.

目前使用个人仓库 `Steven-Zhu/dengagent`，包元数据已配置对应地址。今后若迁入组织，应同步更新 URL 并检查重定向。

Reference: [GitHub organizations](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/about-organizations). GitHub Free supports organizations; paid plans add capabilities.

## Repository presentation / 仓库展示

Suggested English description:

> Hand your Codex plan to a local worker. Choose its model, follow execution and verify delivery.

中文介绍：

> 把 Codex 中设计好的方案交给 DengAgent，自选模型，平衡智能与成本。目前支持 Codex 接入。

Suggested topics: `dengagent`, `coding-agent`, `mcp`, `codex`, `local-first`, `developer-tools`, `pi`, `javascript`. Use truthful, relevant topics; GitHub explains their discovery role in [repository topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).

Do not add a website, npm badge, CI success badge, download count or customer claim until it points to a real verified destination. The [1280×640 social preview](assets/social-preview.png) combines the repository mark and real output frames. After creating the repository, upload it under Settings → Social preview; committing the image does not configure this setting. GitHub recommends 1280×640 and a PNG/JPG/GIF under 1 MB in its [social-preview guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

## Presentation and media / 页面与视频

- Start with the bilingual [English](../README.md) / [Chinese](../README.zh-CN.md) READMEs. / 首页使用双语 README。
- Use the [English](announcement.md) / [Chinese](announcement.zh-CN.md) release introductions for the project story; adapt the [release template](../.github/RELEASE_TEMPLATE.md) for version-specific verification. / 项目发布介绍与版本验收说明分别使用对应文档。
- Covers link to the complete MP4s; the [gallery](showcase.md) states provenance, checks and limitations. / 封面链接完整 MP4，案例页说明来源、检查与边界。
- The [first-task guide](first-task.md) provides an offline source demo and a small real-task prompt. / 首次任务指南提供离线演示和真实小任务提示词。

The current distribution videos are approximately 5.96 MB (watch), 2.32 MB (pelican) and 1.17 MB (cube), all H.264 MP4. They are below GitHub's documented 10 MB free-plan video attachment limit. The watch original was larger and is preserved in the local QA project; its web copy is explicitly re-encoded. See [GitHub attachment formats and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).

传播版约为 5.96、2.32、1.17 MB，均为 H.264 MP4。腕表原片在本地 QA 工程保留，传播版明确记录重新编码。文件大小与 SHA-256 见[素材清单](media/showcase/manifest.json)。

Video links use the repository’s raw file URLs so they also work in the npm README. After uploading the source, test them on the actual GitHub page. For native attachment players, upload each movie in an appropriate GitHub editor, retain the returned real attachment URL, and verify playback on desktop and mobile before replacing links in both READMEs. Do not use a fake `user-attachments` URL or assume a relative file link autoplays. Originals need not be uploaded.

视频使用仓库原始文件地址，兼顾 npm README；源码上传后实测 GitHub 页面。需要内嵌附件播放器时，上传传播版、使用返回的真实地址，再同步双语首页并检查桌面与手机播放。静图负责初次加载，完整视频按需观看。

未确定真实地址前，不填网站、不放 npm / CI 成功徽章或下载量等声明。社交预览图可后补，现有小图标仅用于项目识别，不代表完成商标核查。

## Launch checklist / 上线清单

- [x] Choose the account/organization and repository name: `Steven-Zhu/dengagent`. / 已确定仓库归属及名称。
- [ ] Confirm MIT as the intended source license before public distribution. / 公开前确认采用 MIT。
- [ ] Create a standalone repository from this clean source root, not a parent workspace. / 使用干净源码根目录，不提交父工作区。
- [x] Fill `package.json` with the real `repository`, `homepage` and `bugs.url`. / 已补齐真实仓库元数据。
- [ ] Review the exact files to commit, including hidden files; no credentials, runtime databases, local logs or private screenshots. / 审查提交文件，包括隐藏文件，无凭证、数据库和隐私素材。
- [ ] Enable Issues, set the description/topics and verify bilingual README navigation. / 开启 Issues，设置简介和 topics，检查双语导航。
- [ ] Enable private vulnerability reporting; verify the reporting path works. / 开启并检查私密漏洞报告。
- [ ] Enable dependency alerts where available; review Dependabot proposals before merging. / 开启可用的依赖告警，审查自动更新。
- [ ] Run hosted CI on the uploaded commit; require a passing check before merging changes when the repository settings allow. / 在实际提交上运行 CI，并按仓库设置要求通过检查。
- [ ] Choose real reviewer/owner handles before adding CODEOWNERS; no fabricated identities. / 确定真实维护者后再加 CODEOWNERS。
- [ ] Verify the final release artifact, attach checksums and publish the first public release as v1.0. / 验证最终发布包，附校验和，首次公开发布命名为 v1.0。
- [ ] Publish npm only through the chosen publisher after exact version/name checks. / 确认版本与包名后，由选定发布者发布 npm。
- [x] Prepare three output videos, extracted covers and portable provenance locally. / 已在本地准备三条视频、抽帧封面和来源清单。
- [ ] Verify image/video links after upload; attach the share card in Settings. / 上传后验证图片视频入口，在设置中上传分享封面。
- [x] Prepare bilingual annotated workflow images from the supplied Codex screenshots, with original captures and English-captioned video. / 已准备基于真实 Codex 截图的双语图解、原图及英文字幕视频。
- [ ] Optionally record a continuous assistant/console walkthrough. / 可后续补充连续操作录屏。

The source includes issue forms, PR/release templates, support/security/conduct files, Dependabot and an offline-verification workflow. Settings such as private reporting and required checks must be enabled on the actual repository; files alone cannot enable them.

源码包含反馈表单、PR / 发布模板、支持 / 安全 / 行为规范、Dependabot 和离线验证工作流。私密报告和必需检查等设置必须在真实仓库开启，文件本身不能代替设置。

References: [README guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes), [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## First public release / 首次公开发布

Follow [releasing](releasing.md) and the [release template](../.github/RELEASE_TEMPLATE.md). The first public release will be named **v1.0**. Align the package version, release tag and installation instructions when preparing that release, then rebuild and verify the actual artifacts. The successful local installation proof does not replace a live provider/task check or hosted CI. Media is optional; clear installation and truthful compatibility information are required.

按发布清单和模板操作。首次公开发布统一命名为 **v1.0**；届时同步包版本、发布标签与安装说明，重新构建和验收发布物。本地安装验证不能代替真实供应商任务或托管 CI。媒体可后补，安装说明与兼容性声明需准确。
