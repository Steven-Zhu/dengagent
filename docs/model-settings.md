# Model settings / 模型生成参数

New connections in alpha.10 have explicit preferences. These are application limits, not promises about a provider's capabilities; choose a supported model/route.

alpha.10 新连接使用明确默认值。供应商仍决定模型能力和参数支持，不会自动探测、改模型或降级重试。

| Setting / 参数 | Default / 默认 | Meaning / 含义 |
| --- | --- | --- |
| context_window | 262144 (256K) | Local context admission limit / 本地上下文准入上限 |
| max_output_tokens | 32768 | Per response, including reasoning when counted by the provider / 单次响应上限，供应商计入时包含思考 |
| thinking | enabled | Explicit thinking preference / 明确开启 |
| reasoning_effort | low | Requested effort / 请求的思考强度 |
| timeout_ms | 300000 | Five-minute total request timeout, including streaming / 单次请求含流式过程的五分钟总超时 |
| budget.max_total_tokens | 16000000 | Whole-task cumulative input/output allowance including retained reservations / 全任务累计输入输出额度，含保留预留 |

New configurations have no model-call count limit (`max_model_calls: null`); the original task duration limit stays 30 minutes. A smaller explicit task JSON budget still takes precedence. Actual output is capped by the selected output limit, remaining task allowance and available context. Increasing a per-call cap does not mean every call consumes it.

新配置默认不限制模型调用次数（`max_model_calls: null`），任务期限仍为 30 分钟。任务 JSON 明确指定的较低额度仍有效。输出上限还受剩余额度和上下文空间限制，不代表每轮一定生成或消费这么多。

## Why 32K output / 为什么选择 32K

8192 can be adequate for short tool calls, but thinking and the answer can share an output allowance. 32768 leaves more room for reasoning while file-tool chunks remain limited to 2000 characters. It is a starting preference, not a quality guarantee or an unlimited writing instruction.

There is no universal agent output cap. For comparison, current [Claude Code documentation](https://code.claude.com/docs/en/env-vars) says defaults vary by recognized model and gives 32000 for an unresolved model ID. Deng does not copy another agent's model-specific caps.

8192 适合短调用，但开启思考时可能先被思考内容消耗。32K 为推理和工具参数留出空间，文件分块仍保持 2000 字符硬上限。不同 agent、模型的上限各不相同，不能把某个数视为通用标准。

## Configure / 修改方法

```sh
deng configure --advanced
deng configure --show
deng models
```

The browser connection form offers thinking/effort directly and context/output/timeout/task allowance/format under advanced settings. Saving is local and makes no model request. New task defaults change; existing task snapshots do not.

浏览器表单提供思考开关和强度，高级选项提供上下文、输出、超时、累计额度和格式。保存不调用模型；已有任务不变。

To explicitly adopt all new preferences for an existing connection:

```sh
deng configure --recommended
```

This retains the endpoint, model and Key, changes the selected profile's generation controls, and changes the shared future-task cumulative allowance. Interactive mode still confirms saving; noninteractive mode applies the explicitly requested change and returns public metadata. Project-specific connections can use the same flag with `--project /absolute/project`. It does not stop work; project saves retain the existing busy check.

此入口保留 URL、模型和 Key，更新选定 profile 的生成参数及本配置共用的新任务总额度。终端交互仍需确认保存；非交互显式调用直接应用并返回公开元数据。项目覆盖可加 --project，运行中的项目仍拒绝保存，不自动停任务。

Explicit overrides can be combined:

```sh
deng configure --thinking enabled --reasoning-effort low --timeout-ms 300000 --context-window 262144 --max-output-tokens 32768 --max-total-tokens 16000000
```

Existing explicit values are preserved unless edited or `--recommended` is requested. Missing fields in a connection normalize to the new defaults; historical task profile snapshots retain the alpha.9 wire behavior even when they predate the new fields.

已明确保存的旧值不被无提示覆盖；连接中缺失的字段使用新默认值。历史任务快照即使没有新字段，也继续使用原版本的发送方式。

## Reasoning formats and effective effort / 格式与发送强度

`compat.reasoning_format` supports:

| Format | Wire behavior / 发送方式 |
| --- | --- |
| auto | DeepSeek-prefixed model IDs use deepseek; other IDs use openai. No URL-based hidden default. / 按模型 ID 判断，不按域名改思考偏好 |
| deepseek | thinking.type plus reasoning_effort when enabled; disabled omits effort. / 开启时发送开关和强度，关闭时不发强度 |
| openai | reasoning_effort; disabled sends none. / 标准 effort；关闭发送 none |
| none | No reasoning control parameters; use for routes without that support. / 不发送控制参数，适合不支持的接口 |

Thinking can be `enabled`, `disabled`, or explicitly `provider-default`. The last choice sends no reasoning controls. A none format likewise does not claim the server actually enabled thinking. Unsupported controls return a normal provider error; Deng does not silently retry, switch models or remove controls.

思考模式可明确选开启、关闭或跟随供应商默认。不发送参数不代表实际关闭；不支持时应配置正确格式，不会暗中重试或换模型。

DeepSeek's [current thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/) maps a requested medium level to high. Deng keeps medium as the user's preference, sends high on the DeepSeek format, and exposes `wire_reasoning_effort` separately. This is the value sent, not independent evidence of the provider's internal reasoning. Low/high/max are forwarded as selected; a provider can still map them.

DeepSeek 当前将 medium 映射为 high。Deng 保留用户选择的中等，DeepSeek 格式实际发送 high，并分别展示。此字段只证明发送值，不能独立验证供应商内部思考强度。

For aliases that do not start with DeepSeek, select deepseek explicitly when that gateway requires it. Endpoint/model edits preserve the thinking preference and requested effort. Review the format when changing provider families.

模型别名不能识别时可手动选格式。修改地址或模型保留思考偏好，更换供应商家族时需检查格式是否支持。

## Reasoning history, privacy and tests / 历史与验证

Native SSE reasoning_content is retained in private task checkpoints and replayed for retained assistant/tool turns. It is not added to public text events or console views. Context compaction removes complete exchanges; it does not strip reasoning from a retained exchange. Offline/local SSE tests verify replay, effort/cap payloads, timeout abort and reservation retention; they are not a live Tencent/DeepSeek certification.

思考字段保留在私有任务检查点，供后续工具回合回传，不展示到公开事件或界面。上下文压缩按完整交换移除，不单独剥离保留回合的思考。回环测试通过不等于真实腾讯云接口已验证。

The small connection test deliberately disables thinking, keeps a 32-output-token cap and does not save its form. It verifies connectivity only. The separate, explicitly requested `doctor --probe` exercises the selected reasoning/tool configuration within its own bounded probe task.

小型连接测试明确关闭思考，保持 32 输出 token 上限且不保存，只验证连通性；明确执行 doctor --probe 才检查选定的思考和工具流程。

## Context accounting limitation / 上下文计量限制

The current admission estimator conservatively uses serialized JSON bytes rather than an exact provider tokenizer. Setting 256K does not prove exactly 256K tokens will be retained; earlier compaction is possible. This change does not replace the estimator. The local ledger and user instructions survive request-history compaction, and the task's cumulative allowance is a separate bound.

当前仍使用 JSON 字节数保守估算，不是供应商精确 tokenizer。256K 配置不能保证精确保留 256K token，可能更早压缩；本次没有替换计量算法。完整本地记录和用户指令仍保留，累计任务额度另行控制。


From alpha.11, new configurations default to enabled/low. Explicit high/max planning profiles remain available. Existing saved settings are preserved until explicitly edited; `deng configure --reasoning-effort low` updates future tasks without changing output limits, credentials or old task snapshots. Truncation recovery requests use low and a cap of min(configured limit, 8192).

alpha.11 新配置默认 enabled/low。复杂规划可显式选择 high/max；已有配置需执行 `deng configure --reasoning-effort low`，只影响未来任务。截断恢复使用 low，单次输出最多为原限制与 8192 的较小值。

## 16M task allowance

New configurations and `configure --recommended` use 16,000,000 cumulative task tokens; configuration, task overrides and browser edits accept at most 16,000,000. This is a whole-task allowance, not a model context window. Existing explicit lower budgets and submitted task snapshots retain their values. To change only the user-wide future-task allowance, run `deng configure --max-total-tokens 16000000`; this preserves model, credential and generation settings. Task duration (30 minutes), context (262144) and per-request output (32768) are unchanged; newer versions default to unlimited model calls. No automatic retry or resumption is triggered.

## Unlimited model calls

`budget.max_model_calls` defaults to `null` (unlimited). Set `deng configure --max-model-calls unlimited` for the user-wide future-task default, or use a positive count (1–200) to retain a finite cap. `--recommended` also selects unlimited calls. Task JSON accepts `null` or a finite count; a finite configured project cap cannot be bypassed by a task override. Existing explicit budgets and submitted task snapshots remain unchanged. Changing this setting does not resume any task or relax token, duration, no-progress, or repair limits.
