# tabby-image 生图 Skill 方案

**日期**: 2026-07-02
**状态**: 设计中
**负责人**: 待定

---

## 1. 背景

桌面端用户登录官方云账号后，会获得一个特殊模型 `tabby-image`（或 `tabby-image-free`，视账号档位而定）的访问权限——实际底层是 GPT-image-2，由 `tabbyapi.picaso.studio` 网关以标准 OpenAI 生图接口提供服务。这个模型已经在 `apps/web/src/lib/special-models.ts` 里被标记为特殊用途模型（对话模型选择器里灰显、不可选），但目前没有任何路径让 bot 实际调用它生图。

现状核查：

| 层面 | 结论 | 证据 |
|---|---|---|
| 云端模型下发 | 登录云账号后，`config.desktop.cloud.models` 通过 `GET {linkUrl}/v1/models` 自动同步，`tabby-image` 若账号有权限会出现在列表里 | `apps/controller/src/store/nexu-config-store.ts:2475-2495`（`fetchDesktopCloudModels`） |
| 本地凭证落地 | 同步后的凭证被编译进本地 `$OPENCLAW_STATE_DIR/openclaw.json` 的 `models.providers.link`：`baseUrl: "{linkUrl}/v1"`，`apiKey: desktopCloud.apiKey` | `apps/controller/src/lib/openclaw-config-compiler.ts:262-275`（`compileModelsConfig`） |
| 现有生图 skill 范式 | `nano-banana-one-shop` 是随包分发的 static skill，脚本自己管凭证、自己调用图片生成 API，用 `MEDIA: <path>` 约定把图片投递进聊天 | `apps/desktop/static/bundled-skills/nano-banana-one-shop/`（生产版本）；`skills/nexubot/nano-banana/`（仓库内源码镜像） |
| nano-banana 凭证机制 | 走的是**云端 secrets 池子密钥**模式（`GET {cloudApiUrl}/api/internal/secrets/nano-banana-one-shop?poolId=...`），因为 Gemini key 是市场付费共享密钥，需要按池子计费/鉴权 | `generate-image.js:132-165`（`fetchApiKey`） |
| tabby-image 凭证特点 | **和 nano-banana 完全不同**——`apiKey`/`baseUrl` 已经是用户自己的本地凭证，随云账号登录免费自带，已经躺在本地 `openclaw.json` 里，不需要额外的云端 secrets 调用 | 本次探索期间在两个本地 dev 环境的 `openclaw.json` 里实测确认（见 §6） |

**核心结论**：tabby-image 不需要复刻 nano-banana 的"云端池子密钥"机制，只需要一个新 skill 直接读本地已编译好的 `openclaw.json`，取出 `providers.link` 的 `baseUrl`/`apiKey`，调用标准 OpenAI `images/generations` 接口即可。

---

## 2. 目标 / 非目标

**目标**
- 新增一个 SkillHub 可选装 skill（`tabby-image`），bot 装上后能通过自然语言触发调用 tabby-image 模型生成图片，并把结果投递进聊天。
- 凭证获取零新增后端接口、零网络往返（直接读本地已编译的 openclaw.json）。
- 未登录云账号 / 没有 tabby-image 模型权限时，明确报错提示用户去登录，而不是静默失败或误用别的模型。

**非目标**
- 不做图片编辑/多图合成（`images/edits`）——见 §6，`tabbyapi.picaso.studio` 网关在设计期间处于全线 500 故障，无法验证该接口是否存在，留待网关恢复后单独验证再补。
- 不修改 `openclaw-config-compiler.ts`、bot schema、web 模型选择器——tabby-image 已经通过既有的云模型同步链路进到本地 `providers.link`，本次改动只在 skill 层。
- 不改 OpenClaw 源码（AGENTS.md 硬性约束）。

---

## 3. 方案：本地读取已编译凭证 + 标准 OpenAI images/generations 调用

### 3.1 分发方式

新增两处：
- `skills/nexubot/tabby-image/`（仓库内源码镜像，和 nano-banana 的镜像模式一致）
- `apps/desktop/static/bundled-skills/tabby-image/`（生产版本，随桌面包分发）

`apps/controller/src/services/skillhub/curated-skills.ts` 的 `STATIC_SKILL_SLUGS` 加入 `"tabby-image"`。分发机制、"用户需要手动为 bot 启用"的交互，与 `nano-banana-one-shop` 完全一致，复用 `copyStaticSkills()` 现有逻辑，不需要新代码。

### 3.2 凭证解析

Skill 脚本启动时：
1. 读 `process.env.OPENCLAW_STATE_DIR`（nano-banana 已经在用这个环境变量，确认对 skill 脚本可见）。
2. 拼出 `${OPENCLAW_STATE_DIR}/openclaw.json`，JSON 解析。
3. 取 `models.providers.link`：
   - 若不存在，或 `apiKey` 为空 → 报错退出，提示"请在桌面端登录官方账号后重试"。
   - 从 `providers.link.models[]` 里按顺序查找 `tabby-image`，找不到再找 `tabby-image-free` → 都没有则报错提示"当前账号没有 tabby-image 模型访问权限"。
4. `baseUrl = providers.link.baseUrl`（已经是 `{linkUrl}/v1` 形式），`apiKey = providers.link.apiKey`。

不引入新的 controller HTTP 端点，不做云端 secrets 请求——凭证已经在本地磁盘，OpenClaw 自己也是这么读的，skill 只是多读一次同一个文件。

### 3.3 API 调用

```
POST {baseUrl}/images/generations
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "model": "<解析出的 tabby-image 或 tabby-image-free>",
  "prompt": "<用户 prompt>",
  "n": 1,
  "size": "1024x1024"   // 可选 --size 参数，默认方图
}
```

响应体防御性解析：兼容 `data[0].b64_json`（直接 base64 解码写文件）和 `data[0].url`（下载后写文件）两种形态，不假设网关一定走哪种（GPT-image 系列的 OpenAI 官方 API 只有 b64_json，但这是第三方网关包了一层，实际返回形态未验证）。

网关返回的错误（如 §6 遇到的 `new_api_error` / `Database error`）原样透传给用户，不吞、不包装成别的措辞——方便用户判断是自己没权限还是网关故障。

### 3.4 输出投递

复用 nano-banana 的既有约定：脚本把生成的图片写到
```
$OPENCLAW_STATE_DIR/media/outbound/{slugid}/tabby-image/{filename}
```
并在 stdout 打印一行 `MEDIA: <absolute-path>`。SKILL.md 里像 nano-banana 一样明确指示 agent 必须把这行原样带进回复文本。这是现有 chat 附件投递机制的既定协议，bot 侧不需要学新东西。

### 3.5 命名与触发词

- slug: `tabby-image`
- SKILL.md `description` 强调"官方/免费自带"定位，用 "official image model" / "tabby image" / "gpt image" 等词，与 nano-banana 现有触发词（"generate image", "nano banana", "edit image"）有意区分，避免完全撞词。
- 通用词（如 "generate image"）两边 skill 都可能响应——这是正常的多 skill 路由场景，交给 OpenClaw 既有的技能匹配逻辑决策，不做额外抑制。

### 3.6 参数范围（v1）

只暴露：
- `--prompt`（必填）
- `--filename`（必填，同 nano-banana 约定）
- `--size`（可选，默认 `1024x1024`，透传给网关）

不做：`n > 1`、`quality`、图片编辑/多图合成（`-i` 输入图片）。

---

## 4. 错误处理

| 场景 | 行为 |
|---|---|
| `OPENCLAW_STATE_DIR` 未设置 / openclaw.json 不存在 | 报错退出，提示环境异常（正常不应发生，仅防御） |
| `providers.link` 不存在或 `apiKey` 为空 | 报错提示"请在桌面端登录官方 Tabby 账号后重试" |
| `tabby-image` / `tabby-image-free` 都不在 `providers.link.models[]` | 报错提示"当前账号没有生图模型访问权限" |
| 网关请求非 2xx | 把网关返回的 `error.message` 原样带出，不二次包装 |
| 响应体没有 `b64_json` 也没有 `url` | 报错提示"网关返回格式异常"，附带响应体前 200 字符方便排查 |

---

## 5. 测试

- 单元测试：凭证解析函数（给定 mock openclaw.json，验证能正确挑出 `tabby-image` / `tabby-image-free` / 都没有三种情况）、响应体解析函数（b64_json / url / 都没有三种情况）。这两个函数是纯函数、无网络依赖，用 Node 内置 `node:test` + `assert` 跑（skill 脚本是独立 Node 进程，不接入仓库的 vitest/pnpm test 流水线，和 nano-banana 现状一致——该 skill 目前也没有仓库内单测）。
- 手动验证：网关恢复正常后，在装有 tabby-image 权限账号的开发环境里跑一次真实生图，确认 `MEDIA:` 行能正确投递进 webchat。

---

## 6. 网关状态记录（设计期间的现场证据）

设计过程中用两个本地开发环境的真实凭证探测 `tabbyapi.picaso.studio`，发现网关当时处于**全线 500 故障**（不只是 images 接口）：

```json
{"error":{"code":"","message":"Database error, please contact the administrator","type":"new_api_error"}}
```

`GET /v1/models`、`POST /v1/chat/completions`、`POST /v1/images/generations`、`POST /v1/images/edits` 全部返回同样的错误，两个账号一致——说明这是网关自身数据库层的问题，与路由是否存在无关。因此：
- 无法在设计阶段验证 `/v1/images/edits` 是否被网关实现，`images/edits` 功能推迟到网关恢复后专门验证。
- 这次故障期间的观察也间接说明：桌面端对话模型调用、手机端 VLM 凭证调用（都走同一个 `link` 网关）在故障窗口期应该也在报错——属于 [[telemetry-observability-rollout]] 阶段 A 已经能捕获到的那类问题，不在本 skill 的处理范围内。

两个探测用的账号本身也都**没有** `tabby-image` 出现在已同步的模型列表里（分别是 `deepseek-v4-pro/gpt-5.5/...` 和 `tabby-pro/tabby-free/...`）——说明不是所有云账号档位都自带这个模型，skill 的错误处理必须覆盖"账号没有这个模型"的情况（见 §4）。
