# Demo plan / 演示制作方案

**Status / 状态:** three real output videos and their covers are available in the [case gallery](showcase.md). Two user-supplied native Codex screenshots and three historical console captures are available in the [workflow guide](workflow.md). The native Codex assistant/console walkthrough below remains a separate planned recording.

三条真实成品视频及封面已加入 [media](media/README.md)，两种语言首页均已展示。另有用户提供的两张 Codex 原生会话截图，以及三张历史控制台截图，见[工作流图解](workflow.md)。Codex 原生窗口的端到端操作录屏仍待补充，未标为已完成。

## Story / 要让用户看到什么

A user delegates one concrete change from Codex, watches Deng work in the console, then inspects a real result and its checks. Installation is a separate short onboarding clip, so the main demonstration reaches the product quickly.

用户在 Codex 用一句话交办具体改动，看到 Deng 的执行过程，最后检查真实产物与验收结果。安装向导单独录制，不占主视频的开头。

Recommended fixture: a small local task board with one failing acceptance check. Ask Deng to add a status filter, preserve the existing layout, and make the fixed check pass. Use disposable sample cards. A small existing repository gives a more legible before/after than generating an entire application.

建议用一个小型本地任务看板：预先准备一项失败的固定验收，交给 Deng 实现“状态筛选”，保留原布局并让验收通过。卡片均为演示数据。已有小项目更容易呈现明确的前后变化。

## Main video / 主视频：45–60 seconds

| Time / 时间 | Shot / 画面 | Caption / 字幕 |
| --- | --- | --- |
| 0–5 s | Show the board before the change and the missing filter. / 展示改动前页面和缺失的筛选。 | A focused task / 一项具体任务 |
| 5–12 s | Type the request in Codex; show the selected project. / 在 Codex 输入请求并展示选定项目。 | Delegate with DengAgent / 交给 DengAgent |
| 12–28 s | Show submitted → running, public output, file changes and a check. / 展示提交、执行、公开输出、文件变更和检查。 | Follow the work / 看到执行过程 |
| 28–35 s | Optionally pause, wait for acknowledgment, then explicitly resume. / 可选展示暂停回执，再明确继续。 | You keep control / 随时控制任务 |
| 35–48 s | Show the working filter, changed files and actual passing acceptance result. / 展示可用筛选、文件变更和真实通过的验收。 | Review the result / 检查结果 |
| 48–60 s | Show the project name, setup commands and language links. / 展示项目名、安装步骤和双语入口。 | Your model. Your project. / 你的模型，你的项目 |

Keep Codex and the console side by side at 16:9, ideally 1920×1080. Increase text size until captions and controls remain readable at 960 px width. Prepare Chinese and English captions from the same recording. Make accelerated waits visible with a “sped up” caption; never edit away a failed step while suggesting continuous success.

建议 16:9、1920×1080，Codex 与控制台左右分屏。按 960 像素宽度预览，确保文字可读。同一录屏分别制作中英文字幕。加速等待应标注，不通过剪辑把失败伪装成一次成功。

## README loop / 首页 GIF：10–15 seconds

Show request → visible execution → working filter with short captions. Crop tightly to the workflow, target 960 px wide and 8–12 fps, and aim for less than 5 MB. Keep the MP4 as the full-quality version. A GIF does not need to reproduce installation or every event.

只展示“输入请求 → 可见执行 → 功能生效”。建议 960 像素宽、8–12 fps，尽量控制在 5 MB 内。完整清晰版本用 MP4；GIF 不承载安装和全部日志。

## Optional onboarding / 可选安装演示：20–30 seconds

Show `npm install --global dengagent`, `deng --version`, `deng init`, URL/model prompts and hidden Key entry, then `deng configure` from another directory. Use a disposable demo account. Never show an actual Key, credential file, browser password manager or terminal history containing secrets.

展示 npm 注册表安装、版本、首次初始化与隐藏 Key 输入，再从另一个目录修改配置。使用专用演示账户，不展示 Key、凭证文件、密码管理器或含密钥的终端历史。

## Recording conditions / 录制验收

- Record the exact version, OS, host and model/provider privately; publish only sanitized compatibility facts. / 记录准确版本、系统、宿主和模型，公开时只保留经过整理的信息。
- A live-provider demonstration must actually succeed before it is labeled successful. Keep the demonstrated task scope and the main assistant’s corrections visible; do not present a cooperative workflow as unaided execution. / 真实供应商演示必须实际成功；保留实际任务范围与主助手修正的事实，不将协作过程包装成独立全自动制作。
- Offline demonstrations must carry a visible “offline fixture” label; do not call them a live model demonstration. / 离线夹具须明确标注，不称为真实模型演示。
- Hide user names, local absolute paths, task IDs and random console URL tokens. Re-record from a clean fixture rather than publishing private screenshots. / 隐去用户名、本机绝对路径、任务 ID 和控制台随机地址；优先用干净夹具重录。
- Confirm the exported video and loop contain no private data and the final UI works. / 检查导出素材无隐私信息，最终界面功能可用。

Future filenames: `docs/media/overview.mp4`, `docs/media/overview.gif`, `docs/media/overview-poster.png`, `docs/media/captions.en.vtt`, `docs/media/captions.zh-CN.vtt`. These are planned names, not existing assets.

The main video can be attached to a GitHub release or uploaded through GitHub's editor. Use the returned real URL only after uploading. Reference the committed GIF with a relative path; provide a descriptive alt text and a full-video link in both READMEs. Keep large raw recordings out of Git history.

主视频可作为 Release 附件或通过 GitHub 编辑器上传，上传后使用实际地址；GIF 使用相对路径，并补充描述和完整视频链接。两份 README 同步更新，原始大录屏不提交到 Git 历史。
