# Roadmap / 路线图

This is a direction of travel, not a release schedule. Items are not promises of delivery, compatibility or support. Discuss a concrete use case in a feature request before starting a large change.

以下是后续方向，不代表交付日期、兼容性或支持承诺。较大修改请先提交具体场景的功能建议。

## Available now / 当前已有

- User-level MCP + skill setup, explicit project routing and legacy migration. / 用户级接入、明确项目路由和旧配置迁移。
- Editable model connections, private file credentials and project overrides. / 模型连接修改、私有凭证和项目覆盖。
- Browser console, experimental embedded App, persistent task control and fixed checks. / 浏览器控制台、实验嵌入界面、持久任务控制和固定验收。
- Offline regression and installed-package checks with locked dependency attribution. / 离线回归、安装包验证和锁定依赖声明。

## Before the first public release / 首次公开发布前

- [ ] Final repository owner, npm publisher identity and source license confirmation. / 确定仓库归属、npm 发布身份并确认源码协议。
- [ ] Actual hosted CI results and a v1.0 release with matching checksums. / 实际托管 CI 结果和附校验和的 v1.0 发布。
- [ ] A sanitized successful provider/task walkthrough; record its exact platform and model. / 脱敏的真实模型成功流程，记录平台与模型。
- [ ] Optional video / GIF from the [demo plan](docs/demo-plan.md). / 按方案补充演示素材；素材可后补。

## Agent integrations / Agent 接入

Codex is currently supported. Integrations with other agents are in development; no delivery date is committed.

目前支持 Codex 接入，其他 Agent 的接入正在开发中，暂不承诺上线日期。

## Reliability and usability / 可靠性与体验

- [ ] Clearer actionable provider-authentication messages without exposing response secrets. / 在不泄露信息的前提下改善认证错误提示。
- [ ] Broader provider compatibility evidence for streaming, native tools and usage. / 扩展流式输出、工具调用和用量的供应商验证。
- [ ] A tested host/version matrix for embedded MCP Apps. / 建立嵌入式 App 的宿主版本验证表。
- [ ] Simpler profile management and a clearer path between shared defaults and overrides. / 简化多 profile 管理和全局 / 项目设置切换。
- [ ] Evaluate cross-platform command isolation and signed macOS distribution. / 评估跨平台命令隔离和 macOS 签名分发。

General filesystem read isolation, a cloud service and native host-chat token streaming are not claimed capabilities. Any expansion of execution permissions requires a separate design and review.

当前不宣称通用文件读取隔离、云服务或向宿主原生消息流写入 token。扩大执行权限需要单独设计和审查。
