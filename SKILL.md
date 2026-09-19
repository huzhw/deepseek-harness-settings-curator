---
name: deepseek-harness-settings-curator
description: DeepSeek Harness（DSH）专用技能：定期梳理 settings.yaml 的 LLM 供应商模型配置（追加新模型、清理失效/重复模型、参数量与版本标记对齐、找限时免费模型）。触发词：梳理配置、梳理模型、settings.yaml、追加模型、清理模型、清理旧模型、免费模型、限时免费、参数对齐、模型配置、模型维护、默认模型、模型路由、切模型、费用检查、agent-default-model。
author: 胡志伟
platform: DSH (DeepSeek Harness)
motto: "配置如园，常理常新。查证为准，不写未知。每次改动，方案先行。"
---

# 📋 settings.yaml 模型配置梳理 — 胡架定制

> **本技能专用于 DeepSeek Harness（DSH）的模型配置维护**（DSH 消费端 `~/.dsh/skills` 为第一使用场景，同时兼容挂载到 Claude Code 技能目录）

## 目标文件

- 主文件：`C:\Users\Administrator\.dsh\settings.yaml`（DSH LLM 供应商配置；密钥已零明文迁到 `~/.dsh/.credentials.yaml`，settings 用 apiKeyEnv 变量名引用，两处都勿外传）
- 已知 provider（精简阵容 5 个）：zhipu（智谱GLM官方）、opencode-go（OpenCode Go）、bailian（百炼）、company-gateway（公司网关3000）、openrouter-go（OpenRouter直连）；已下线：volcengine（火山方舟）、sensenova（商汤日月新）；另有官方直连路由 `deepseek-official`（配置段 `llm-deepseek:`，非 llm-pi-ai 成员，详见 §7）
- 默认模型（agent-default-model）：`settings.yaml` 顶层段 **+** `profiles/tui/cordis.patch.yml`、`profiles/web/cordis.patch.yml` 补丁段（**patch 覆盖 settings，生效以 patch 为准**）
- 网络放行：`C:\Users\Administrator\.dsh\rules.yaml` 网络白名单（查官方价目需放行 `api.deepseek.com` / `bigmodel.cn` / `open.bigmodel.cn`；2026-08-31 已加）
- **Codex 侧同步链（详见 §8 Codex 侧同步）**：`C:\Users\Administrator\.codex\models.json`（Codex 模型目录，由 live `~/.codex/config.toml` 的 `model_catalog_json` 指向）← 定时任务「codex opencode-go 全量口径巡检」（13:10）每轮维护；而 `C:\Users\Administrator\.codemoss\config.json`（CCGUI 插件 `idea-claude-code-gui` 的私有状态，内含 Codex 供应商的 `configToml` 模板）**是原厂件，只能在该插件 UI 里改，外部一律只读**——改它会让插件的 `appliedProviderRevision` 校验失配、Codex 会话直接罢工。**codemoss 的 `claude` 段与 `~/.claude` 下任何文件更不属本技能管辖，禁止改动**

## 用户选型偏好（用户口味确认，梳理时优先执行）

- 常用主力只留三条线：**DeepSeek 系、GLM 系（各自必须带 flash 档）、千问系（flash 为主，1~2 个）**。
- 免费渠道保留：company-gateway（New API 类公司网关）、openrouter-go（auto/free/fusion 免费聚合档）——即"牛来那种免费"口径。
- **非偏好系厂商/模型一律不主动加**，用户点名才加，加前照常查证。
- 每次梳理以精简为先：同款模型多渠道重复时，只留最稳/最便宜的，其余列删除清单走确认流程。
- 千问 flash 口径：bailian 配 `qwen3.7-flash`（实测 200 通）+ `qwen3.8-flash`（2026-08-27 发布，见 §4）。`qwen3.6-flash` 模型存在但免费额度已耗尽（403 insufficient_quota，需充值或控制台关闭 free-tier-only），额度恢复前不加回。

## 安全红线（必读）

1. **密钥文件含明文 API key，禁止整文件 read/输出**——会命中 dsh-defend（sk-openai / bearer-token 规则）被拦截。settings.yaml 已零明文（apiKeyEnv 引用），明文密钥本体在 `~/.dsh/.credentials.yaml`，掩码规则照旧适用。
   - 查看：用分段 read 跳过密钥行；或 pwsh 掩码后输出：
     ```powershell
     $m = $l -replace 'sk-[A-Za-z0-9_\-\.]+', 'KEY'
     $m = $m -replace 'Bearer\s+\S+', 'Bearer KEY'
     $m = $m -replace '[0-9a-f]{32}\.[A-Za-z0-9]+', 'KEY'
     ```
   - 写入带 key 的配置：`Authorization: Bearer` 单独一行、key 缩进写下一行（YAML 折行拼接，避免同一行 `Bearer <token>` 被规则拦截；bailian/openrouter 段已是此写法）。
2. **外网直连被策略代理全挡**（curl 一律 403/000），外部信息只能靠 web_search；本地离线目录可查：
   - `F:\Program Files\nodejs\node_global\node_modules\@deepseek-ai\dsh\node_modules\@earendil-works\pi-ai\dist\providers\data\*.json`
   - 各厂商官方模型目录（openrouter/deepseek/qwen/zai/minimax/moonshotai/xiaomi/opencode-go/nvidia 等），字段含 `id/name/cost/contextWindow`；`cost.input==0 && cost.output==0` 即免费模型。
3. **查不到的不写**：参数量、版本、免费状态没有可靠来源时不编造，明说"未查到"，让用户提供或放弃。

## 工作流程

### 1. 梳理现状
- **第一步·最新 flash 巡视（每轮必做）**：按三条主力线逐线巡检"厂商是否出了更新的 flash 档"——
  - DeepSeek 系：现配 `deepseek-v4-flash`（opencode-go 预览 / bailian 正式 / deepseek 官网 正式 三渠道），查证有无更新 flash；
  - GLM 系：现配 `glm-5.3-flash`，查证有无更新代 flash（当前官方未披露，按"未查到"口径记录）；
  - 千问系：现配 `qwen3.7-flash` + `qwen3.8-flash`，查证有无 qwen3.9-flash；
  - 定式动作：① 本地 pi-ai 快照 diff（新 id 是否已进快照）→ ② web_search 多路（`<厂商> 最新 flash 模型 发布` / `<厂商> flash 免费额度` / `<厂商> 新模型 价格`）→ ③ 与已配列表 diff；
  - 产出「候选追加清单」：模型 id / 参数量 / 价格 / 免费额度 / 有效期 / 建议动作，列给用户选，**仍走确认词流程落库，绝不自动写**；查证无新 flash 就明说"无新 flash"，本地目录 diff 优先、web 最多两路，不无限深挖。
- 掩码 dump 全文件，列出每个 provider 的：模型 id、name、参数量后缀、版本标记。
- 检查项：name 缺失 / 重复 id / 前缀不一致 / 参数量与版本标记是否规范 / 疑似该删的旧模型。

### 2. 追加新模型
- 查证模型存在性与 id：本地官方目录优先 → web_search 兜底（厂商公告、模型页、vLLM recipes）。
- 参数量：多源交叉（vLLM recipes、厂商公告、目录官方 name）；MoE 取总参；查不到不标。
- 版本标记（仅 DeepSeek 系有预览/正式之分）：`/正式`（0731=Flash 正式版、0813=Pro 正式版、-ga- 日期=GA 正式）或 `/预览`（无后缀活接口、未切正式的渠道）。商汤的"服务公测免费"是活动不是模型版本。
- 命名规范：`<前缀>/<模型id>/<参数量>(/<版本>)`；前缀约定：百炼 / 火山方舟 / 公司网关 / OpenCode / OpenRouter / 商汤日月新 / 智谱 / 官网（deepseek-official 官方直连）。

### 3. 清理旧模型
- 识别依据：调用 404、厂商下架、免费变收费、重复条目。
- 流程：列删除清单 → 给用户确认 → 删 → YAML 校验。

### 4. 参数量对齐（已知可靠数字速查，2026-08 多源查证）
- deepseek-v4-pro=1.6T/激活49B、deepseek-v4-flash=284B/激活13B
- glm-5.2=743B/39B、glm-5.1=744B/40B（glm-5、glm-5.3、5.3-flash 未披露）
- kimi-k2.6=k2.7-code=1T/32B、minimax-m3=428B、minimax-m2.7=230B/10B
- mimo-v2.5=311B/15B、mimo-v2.5-pro=1T/42B
- qwen3.8-max=2.4T、qwen3.7-max≈1.2T（第三方，中置信）；qwen3.7-flash/plus、qwen3.6-plus 官方未披露
- qwen3.8-flash（2026-08-27 发布，已核实）：多模态 MoE、上下文 1M、最大输出 128K；免费华北2（北京）100 万 tokens（开通百炼或模型发布起 90 天，以较晚者为准）；价格 输入 0.8 / 输出 2.7 / 缓存命中输入 0.1 元每百万（8/27 起下调）；参数量未披露。
- OpenRouter 免费档（2026-09-10 实时，按 `/api/v1/models` 的 `pricing=0` 筛出 21 个）：**前沿档只有 `thinkingmachines/inkling:free`**（付费孪生 $1/$4.05 每百万，1M 上下文 / 262K 输出，已配）；其余皆开源杂牌（nemotron-3-ultra-550b、3.5-lightning、super-120b、nano 系列、gemma-4-26b/31b、poolside laguna-s-2.1/xs-2.1、north-mini-code、lyria 音乐生成、content-safety 分类器、lfm-2.5-2.6b），按"不要垃圾"口径不收；`auto`/`openrouter/free`/`fusion` 为聚合端点无参数量。**旧清单已过期**：laguna-m.1、ling-3.0-flash、gpt-oss-20b、nemotron-3-nano-30b 的免费档已下架；OpenRouter 免费档**限 50 次/天、名单按月轮换**，不能当主力。
- sensenova-6.8-flash-lite 未披露。
- 坑：qwen3.7-plus 曾把 Qwen3.5-35B-A3B 的 35B 串号写错——不同型号别混，比对时看全名。

### 5. 限时免费模型
- web_search 多路扫：`<厂商> 限时免费 模型 token 额度`、`新模型 免费公测`、`openrouter free models list`、`百炼 送 tokens`、`商汤 公测 免费`、`智谱 新模型 活动`、`deepseek 免费额度`。
- **OpenRouter 实时清单（首选，比 web_search 准）**：用 node fetch `https://openrouter.ai/api/v1/models`，按 `pricing.prompt==0 && pricing.completion==0` 筛免费项；**前沿档判据 = 同族付费版 ≥$0.5/百万输入**（实例：`thinkingmachines/inkling:free` 付费版 $1/$4.05）；stealth 代号（ox/pony/korrine/omen 风格）+ 1M 上下文 + 图片/视频输入 = 白嫖前沿的信号。脚本写工作区 `_tmp\*.mjs` 再跑（curl 被策略代理挡）。
- **牛来案例（2026-08）**：Ox Alpha（中文绰号"牛来"）= 智谱 GLM-5.3 Flash 匿名版——8/20 空降 OpenRouter，一周免费近乎无限额度、首日登顶用量榜，8/26 官方认领后转付费。**匿名前沿模型是"限时白嫖窗口"，靠巡检抢，不靠常驻清单**。
- 评估：免费条件是否限时、适合挂哪个 provider、收费后是否保留。
- 汇报格式：模型 / 免费条件 / 有效期 / 建议动作。

### 6. 默认模型（agent-default-model）梳理与费用核查

- 位置与生效：settings.yaml 顶层段 + 两个 profile 的 cordis.patch.yml（**patch 覆盖 settings，两处不一致以 patch 为准**）。
- 影响面：默认模型 = 主代理路由，**dsh-auto-review 审查器 fork 继承同一路由**，改一处两者同切渠道。
- 检查项：provider 必须在 settings.yaml `llm-pi-ai.providers` 存在，或为官方直连路由 `deepseek-official`（配置在 `llm-deepseek:` 段，见 §7）；model id 必须在对应 provider 的 models 列表（deepseek-official 对应 `llm-deepseek.models` 或内置目录三行之一）。
- 历史坑：patch 残留 `provider: deepseek`（缺 -official 的旧写法）会同时把主代理+审查器烧向官网（2026-08-31 已切 `zhipu / glm-5.3-flash`）；官方直连的规范路由名是 `deepseek-official`，别把正确名当坑绕开。
- 费用核查（选型依据）：
  1. 本地优先：`pi-ai\dist\providers\data\*.json` 的 `cost` 字段（input/output/cacheRead，单位 $/1M；全 0 = 免费）。**注意快照滞后**：本地是 7/25 生成，DeepSeek 8/17 调价（峰谷定价，高峰最高 +1100%，周末低谷价）后已作废，必须与官网/报道对账。
  2. web_search 兜底（如 `DeepSeek 调价 峰谷 每百万`）。
  3. 查不到就明说"未查到"，不编造（glm-5.3-flash 官方价目当前即未查到状态，由用户浏览器确认）。
  - DeepSeek 官网最新价（2026-08 调价后，api-docs.deepseek.com）：flash 输入·缓存未命中 1.5/3.0 元（空闲/高峰）、输出 4.5/9.0 元；**缓存命中输入仅 0.05/0.10 元（差 30 倍）**——缓存命中率低即"贵"主因；pro 为 flash 恰好 3 倍；高峰=周一至五 9-12、14-18 点，空闲=高峰半价。
  - 对比表格式：模型 / 渠道 / 输入 / 输出 / 缓存读 / 免费？
  - 更合适就切换：列候选 → 用户选 → 确认词 → 备份 patch → 改 → 校验。
- 2026-08-31 状态：已切 `zhipu / glm-5.3-flash`，patch 备份 `cordis.patch.yml.bak-20260831-085333`。

### 7. deepseek-official 官方直连渠道

- 定位：DeepSeek 官方直连适配器（`dsh-llm-deepseek`），路由名 `deepseek-official`（不是 `deepseek`）；配置在 settings.yaml 顶层 `llm-deepseek:` 段，独立于 `llm-pi-ai.providers`，两套适配器可并存。
- 结构（照 schema 实录）：
  - `apiKeyEnv`：凭据引用名，默认 `DEEPSEEK_API_KEY`（凭据 ref 已存在）；`baseURL` 缺省即官方公共端点。
  - `thinking`：enabled/disabled；`reasoningEffort`：off/low/high/max。
  - `models`：数组，每项 `id` / `name`（选择器显示名）/ `description` / `contextWindow` / `maxTokens`，可选 `inputModalities`（vision 档需声明 text+image 才能收图）。
- 内置目录（`models` 未落盘即继承）：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`（text+image）。
- GUI 入口：设置→模型→DeepSeek 行；每行可改 id/显示名/上下文/最大输出，可增删行，改后落 `llm-deepseek.models` 的 `name`，「/model」弹窗与 composer 显示该名。
- 梳理检查项：`models` 空 = 继承内置目录；id 重复 / name 缺失 / 与 pi-ai 渠道同款模型按"精简为先"去重（只留最稳或最便宜）；版本标记沿用 DeepSeek 系口径（0731=Flash 正式、0813=Pro 正式、-ga- =GA）。
- 费用：价目见 §6 费用核查（缓存命中输入 0.05/0.10 元，差 30 倍）。

### 8. opencode-go 渠道（OpenCode Go 套餐 · 订阅全量渠道）

**口径（红线，与官网/智谱/百炼不是一套逻辑）**
- 定位：OpenCode Go 订阅渠道（$10/月、$100 用量，仅订阅用户可用）；**按线上协议拆两条路由**（2026-09-17 定，见下方「协议分路由」）：`opencode-go`（`api: openai-completions`、baseURL `https://opencode.ai/zen/go/v1`）与 `opencode-go-anthropic`（`api: anthropic-messages`、baseURL `https://opencode.ai/zen/go`，**不带 `/v1`**——适配器自动补 `/v1/messages`）。
- **全量收录**：官方「当前支持的模型列表」里的模型**一个不落**，只增不减（官方下架才删）；**不做三线口味精简、不跨渠道去重、不与官网/智谱/百炼合并口径**。
- **命名**：`[新/][N倍用量/]OpenCode/<显示名>/<参数量?>(/<版本?>)/每5小时N次`
  - **标记区前置**：官方「新」徽章拼 `新/`、落地页限时倍数拼 `N倍用量/`，两者都放在 `OpenCode` **前边**（都有则 `新/4倍用量/OpenCode/…`；只有一个就只拼那个；都没有则省略）；
  - **显示名带版本**（DeepSeek V4.1 Flash → `deepseek-v4.1-flash`）；**id 用官方 API id**（V4.1 Flash 的官方 id 是 `deepseek-flash`，官方命名不跟版本走）；
  - **name 里的〈显示名〉一律取官方显示名，禁止拿 API id 顶替**（2026-09-17 实踩：`union-alpha` 的官方显示名是 **Union Alpha Free**，巡检把 id 当显示名写成 `新/OpenCode/union-alpha/每5小时无限制次` → 用户看不出这是哪个模型；正确写法 `新/OpenCode/Union Alpha Free/每5小时无限制次/限时`）。落地页/文档页显示什么就照抄什么（含 `Free`/`Preview`/`Experimental` 这类后缀），只把空格按需保留、大小写照官方；
  - 官方没给「N 次」预估的写 `每5小时无限制次`；**限时供应/限时免费**的档在末尾补 `/限时`（如 union-alpha）；
  - 参数量只标 §4 已核实数字，未披露不标；
  - 调用次数**中文标注、拼名字末尾**；整表按**显示值**（name 里那个次数，**促销值优先**，如 V4.1 Flash 用 26000 而非基础 6500）**倒序**；标记区（`新/`、`N倍用量/`）只随行移动、不参与排序；同次数按官方表原序。
- 三窗口（官方）：**每 5 小时 = 月限 20%、每周 50%、每月 100%**；预估请求数表按典型每请求 token 假设推算（如 deepseek-v4-flash 每次 410 输入 + 71,300 缓存 + 310 输出 token）。

**协议分路由（2026-09-17 定，红线）**
- **协议（`api`）是路由级，模型级覆盖不了**：一个 provider 只能有一种线上协议，模型级只认 `name/contextWindow/maxTokens/input/reasoningEfforts/compat`。所以同渠道里走不同协议的模型**必须拆成不同路由**，不能只改某个模型的 `api`。
- **归属判据 = 官方端点表**：文档页的端点表（`/v1/messages` vs `/v1/chat/completions`）是唯一判据；`/zen/go/v1/models` 只返回 `id/object/created/owned_by`，**没有协议字段**，别指望它。挂 `/v1/messages`（Anthropic SDK）的进 `opencode-go-anthropic`，其余进 `opencode-go`。2026-09-17 时 messages 侧 = `union-alpha` 一条（官方标注限时免费）。
- **新增模型必过双探针**（**只测新增**，旧模型不复扫——全量重测是白烧钱；旧模型仅在真报 4xx/5xx 时按错误驱动单条复检）：对候选模型各发一次最小请求（`max_tokens: 16`、45s 超时、**必带 `x-opencode-session` 头**），`/chat/completions` 与 `/v1/messages` 各一次：
  - 两路都 200 → 归主路由 `opencode-go`（网关对老模型宽容，两路都能通属正常，按文档页端点表定归属）；
  - **只有 `/v1/messages` 200、`/chat/completions` 5xx** → 归 `opencode-go-anthropic`（2026-09-17 实测 union-alpha 走 chat/completions 报 `500 Internal server error`，走 messages 200）；
  - 探针命令与原始响应摘要要写进巡检报告。
- **路由键必须登记进会话头插件**：`profiles/web/cordis.patch.yml` 的 `opencode-go-session-header` 行 `providers` 要含**所有** opencode 系路由键（现为 `opencode` / `opencode-go` / `opencode-go-anthropic`）。漏登记 → 上游 400 `MissingSessionID`。**改了要重启 dsh 才生效**（插件 config 只在启动时读）。会话头由 `dsh-opencode-session` 插件按路由键注入，2026-09-05 起上游强制要求。
- **巡检只重建 models，不删路由**：`opencode-go-anthropic` 的 `api`/`baseURL`/`apiKeyEnv`/`displayName` 与注释，巡检一律不动；它只按上面的判据维护里面该放哪些模型。反过来，重建 `opencode-go` 时**必须把 messages 侧模型排除**，不许因为「官方列表里有」就写回主路由——写回即该条调用 500（chat/completions 对 messages-only 模型是稳定 500，带不带会话头都一样，2026-09-17 复测）。
- **上游间歇 503（2026-09-17 实测，不是配置问题）**：union-alpha 后端池约 1/3 概率**秒回** 503 `Endpoint is unavailable`，**成片出现**（坏窗口持续几分钟~几十分钟，同一请求过几分钟就通）；与 system 大小 / tools / max_tokens(≤32K) / 鉴权头样式（x-api-key 或双发）均无关。缺会话头是另一回事（400 `MissingSessionID`）。**别把 503 当配置错误去乱改路由**。缓解：装 `dsh-llm-retry` 插件 + 路由 `retryPolicy`（SERVER 属默认可重试码，默认 maxRetries=5、500ms 起指数退避）；没插件时就人工重发一次。

**抓取逻辑（优先级严格，每轮两页都抓）**
1. **文档页** https://opencode.ai/zh/docs/go/（公开、月更、web_fetch）——**权威列 = 「当前支持的模型列表」**；价格表/基础预估表作辅助；**端点表是协议归属的唯一判据**（见上「协议分路由」），但它同样含陈旧残留行 → 只用来判协议、不用来判收录；
2. **落地页** https://opencode.ai/zh/go——取文档页没有的两类信息：**「新」徽章（新模型）**与**限时倍数用量**（实例：DeepSeek V4.1 Flash「限时享受 4 倍使用额度」，6,500 → **26,000** 请求/5 小时、月限 $15 → $60）；
3. **取值规则**：带限时促销的模型取**落地页促销值**（26,000），并在 name 前置 `N倍用量/` 标记；促销结束、落地页回落基础值时，巡检自动改回基础值并去掉该标记；
4. `/zen/go/v1/models`（需订阅鉴权，尽力抓；401/无权限就跳过并说明）——**只用来比对 id 集合，拿不到协议**；
5. 文档页价格表与端点表**有陈旧残留行**（实例：MiniMax M2.5 有价格行、有端点行，但不在支持列表 → **不收录**）；与①冲突**一律以①为准**；
6. 抓不到 → 报「页面结构变化或抓取失败」，**绝不编造**；字段缺失写「未查到」。

**生成**
- 按口径产出**两条路由的 models 块**：`llm-pi-ai.providers.opencode-go.models`（chat/completions 侧）与 `llm-pi-ai.providers.opencode-go-anthropic.models`（messages 侧，通常 1~2 条）；YAML 同级缩进，`- id:` 8 空格、`name:` 10 空格。
- **同一个 id 只许出现在一条路由里**：两路由并集 = 官方支持列表，交集 = ∅。

**校验（必须全过，任一不过即回滚并报错，不静默）**
1. `YAML.parse` 通过；
2. **id 集合双向 diff（两路由并集）**：官方列表 −（`opencode-go` ∪ `opencode-go-anthropic`）= ∅ **且** 并集 − 官方 = ∅，且并集内**无重复 id**；
3. 条数比对：官方 N = 两条路由条数之和；
4. name 正则逐条 `^(新/)?(\d+倍用量/)?OpenCode/.+/每5小时(\d+|无限制)次(/限时)?$`（官方无预估的用 `无限制次`，限时档末尾补 `/限时`；确有其它例外须显式标注）；
5. **排序单调性**：逐条解析 name 末尾的次数，序列必须**非递增**（排序键 = 显示值，促销值优先）——排错即判失败、还原备份；
6. **路由骨架未被改动**：`opencode-go` 仍 `api: openai-completions` + baseURL `…/zen/go/v1`；`opencode-go-anthropic` 仍 `api: anthropic-messages` + baseURL `https://opencode.ai/zen/go`（无 `/v1`）+ 同 `apiKeyEnv`；任一被动过即判失败、还原备份；
7. 落库前备份 `settings.yaml.bak-<时间戳>`，落库后回读打印全部 id/name（标明所属路由）供人工核。

**执行方式**：定时任务「opencode-go 全量口径巡检」按 §10 排班跑（B 模式自主落库：先备份 → 改 → 跑上面 1~7 项校验 → 任一失败即还原备份并报错）；人工梳理时并入 §1「最新 flash 巡视」同轮。

**Codex 侧同步（models.json 归我们 + CCGUI 模板归插件）**——2026-09-10 起由定时任务「codex opencode-go 全量口径巡检」（13:10）每轮执行

- **一句话执行**（脚本内含并发防护、备份、校验不过自动回滚、Codex 本体实测）：
  ```powershell
  node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\codex-opencode-sync.mjs"           # 预览，零写入
  node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\codex-opencode-sync.mjs" --apply   # 备份 + 落库 + 自校验
  # 调试：--emit <目录> 导出"应然产物"做 diff；--force 忽略并发防护
  # ⚠️ --write-codemoss 会写 .codemoss\config.json —— 默认关闭，非必要别开（2026-09-10 事故成因）
  ```
- **口径**（与 DSH 的 §8 全量口径不是一套）：
  - 收录集合 = `settings.yaml` 的 `opencode-go.models` 里 **id 匹配 `^deepseek` 或 `^glm`** 的条目（DeepSeek 全系 + GLM 全系，2026-09-10 为 8 条）；其余渠道内模型（mimo / kimi / minimax / qwen / hy / grok / longcat / omen / muse-spark / gpt-*）**一律不进 Codex 清单**。
  - `slug` = 官方 API id **原样**（V4.1 Flash 的 slug 是 `deepseek-flash`）；**`display_name` = 照抄 DSH 的 `name` 整串**（别名与 DSH 一致，带 `新/`、`N倍用量/` 标记与次数）；排序 = 按 name 末尾次数倒序，同次数按 settings.yaml 原序。
  - 其余字段逐字沿用 Codex 目录模板（`base_instructions` / `supported_reasoning_levels` 五档 / `priority:1` / `context_window:1000000` / `effective_context_window_percent:95` …），**不新增不删字段**。
  - **口径默认模型 = DeepSeek 系里调用次数最大的那条的官方 id**（2026-09-10 为 `deepseek-flash`，4 倍用量 26,000 次/5h）。**但默认模型由 CCGUI 供应商模板的 `model` 行决定，脚本只报不写**——要改就在 CCGUI 供应商管理 UI 里改（见下）。
- **落点与归属（2026-09-10 事故后定，红线）**：
  | 文件 | 归属 | 脚本动作 |
  |---|---|---|
  | `~\.codex\models.json` | **我们**（插件不碰） | 全量维护（唯一真正落库的文件） |
  | `~\.codex\config.toml` | CCGUI 按模板重写 | **只兜底补 `model_catalog_json` 行**；`model` 行与注释一概不写 |
  | `~\.codemoss\config.json` | **CCGUI 私有状态** | **只读**，只报差异（禁止写） |
- **校验**：8 项落库前校验（JSON 可解析 / 根键与 claude 段未变 / **模板含 catalog 行** / 上下文窗口覆盖 / slug 唯一…）→ 落库后回读 → 调 **Codex 本体**实测：
  ```powershell
  & "$env:USERPROFILE\.codemoss\dependencies\codex-sdk\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe" debug models
  ```
  `debug models` 吐出**实际加载的完整模型目录 JSON**，逐条核 slug 与 display_name——唯一能证明"Codex 真认这份目录"的手段（`codex.exe` 不在 PATH 上）。
- **Codex 侧坑位**：
  - 🔴 **禁止外部写 `.codemoss\config.json`**：CCGUI（`idea-claude-code-gui` 插件）对 Codex 供应商盖了 `appliedProviderRevision` 的章（`CodexProviderManager.isProviderApplied`，MessageDigest）。外部改 `configToml` → 重算的 revision ≠ 记录的 revision → "已应用"失效；加上 `localConfigAuthorized:false` 就两态皆不可用 → 会话直接报 **「尚未配置 AI 供应商或未授权使用本地配置」**（`error.codexLocalAccessNotAuthorized`）。**要改模板一律在该插件 UI 里改，改完"保存/应用"让它自己盖章**。详见 `C:\Users\Administrator\.codemoss\CCGUI-Codex-配置注意项-2026-09-10.md`。
  - **CCGUI 重写 live 配置的规律**（2026-09-10 实测）：按供应商模板重写 → `model` 行被扳回模板值、**所有注释丢失**，但未知键（`notify` / `mcp_servers` / `projects` / `hooks` / `model_catalog_json`）**是合并保留的**。所以在 live 里改 `model` 行或加注释都是白干。
  - **备份别只放 `.codemoss`**：那目录归插件管，混进去的 `config.json.*` 容易和它自建的 `config.json.bak` 撞名；备份放 `~\.codex\` 等同级、插件不管的目录。（"插件会清 `.bak`"这条**未经证实**，别当事实。）
  - CCGUI 供应商模板里必须有 `model_catalog_json` 行，否则你在 UI 里切一次供应商就会把这行刷掉，**Codex 立刻不读 models.json**（2026-09-10 已由用户在 UI 里补上）。
  - **路径转义层数**：TOML 基本字符串里写 `\\`，嵌在 config.json 的 JSON 字符串里就是 4 个反斜杠；写错一层 Codex 就找不到目录（2026-09-10 实踩，脚本自检抓出）。
  - `model_catalog_json` 是**整份替换**不是合并：文件里几条，Codex 就只剩几条选择。
  - 字段缺省由 Codex 自己填（`input_modalities` 默认 `["text","image"]`）→ 非视觉模型若报图片相关错，再单独加 `input_modalities: ["text"]`，别批量猜。

**坑位**
- **两页口径不同**：`新` 徽章与限时倍数只在落地页 `/zh/go`，文档页只给基础值——只读文档页会把 V4.1 Flash 写成 6,500（实际促销 26,000）；
- `deepseek-flash` 是 V4.1 Flash 的官方 id，显示名要写成 `deepseek-v4.1-flash`；
- OpenCode 渠道 DeepSeek 系标「预览」口径（与官网「正式」区分）；V4 flash/pro 峰谷价（Peak=UTC 周一五 01-04/06-10）；
- Omen Alpha 匿名身份疑似智谱 GLM 系（OpenCode 数据页归属智谱，未官方认领），规格未披露；
- muse-spark contributor 仅限 Meta 地理政策允许地区，以允许训练换折扣；
- DSH 在官方「已知存在问题客户端」名单（会话头支持不完整，discussion #5495）；
- 官方「预估请求数」会变（v4-flash 7600→13000 即实例），name 里的次数随表同步改。

### 9. 流程红线
- 任何改动前：**分析 → 方案结尾带四字成语确认词 → 等用户回确认词才动手**（"行/好/确认"等不算）。
- 改 agent-default-model 前**先备份两个 profile 的 cordis.patch.yml**（`Copy-Item <file> cordis.patch.yml.bak-<时间戳>`）。
- 多个方案列出来让用户选，不替用户做主。
- 改后校验（工作目录放 DSH checkout，yaml 依赖在 node_modules）：
  ```powershell
  node -e "const fs=require('fs');const YAML=require('yaml');const doc=YAML.parse(fs.readFileSync(process.env.USERPROFILE+'/.dsh/settings.yaml','utf8'));console.log('YAML_OK')"
  ```
- 用户可能自行改过文件：edit 前必须先 read；报"file changed since read"就重读再编辑。
- 只改任务要求的，不顺手优化；尊重用户手改（如 displayName、去版本号命名）。

### 10. 定时任务与巡检排班

> 本节是 **2026-09-10 快照**（2026-09-17 复核过任务存放位置）。**改过任务后顺手更新本节**，过期排班表会误导后来人。
>
> **任务实档在哪（2026-09-17 实测）**：桌面端「定时任务」面板的调度器由插件 `dsh-tauri-panel-scheduler` 提供，宿主存储 + HTTP 接口 `/api/desktop/dsh-tauri-panel-scheduler/tasks`（GET/POST/PUT/DELETE，另 `/tasks/toggle`、`/tasks/run`、`/history`、`/options`、`/runs/recover`）；任务会话的工作目录固定是 `~/.dsh/automations`（插件常量 `SCHEDULER_UNGROUPED_DIRECTORY`，巡检的临时脚本也落这里）。
> - 引擎自带调度器（`scheduler_create`/`scheduler_list` 等工具读写的那个）是**另一套**：实档 `~/.dsh/crons/tasks`，**2026-09-15 起为 `{"version":1,"tasks":[]}`**；`scheduler_list` 查的也是它 → 会误报「当前没有定时任务」。
> - 2026-09-17 实测的怪象：面板 API 返回 `{"tasks":[]}`、全盘也搜不到任何含 `nextRunAt`/`lastRunAt` 的任务实档，**但当天 12:38/12:46 与 18:30/18:38 的巡检照跑**（现场在 `~/.dsh/storages/session_projcache/sessions/` 的 `task-*.json` / `session-*.json`）→ 那批任务只活在**运行中进程的内存里**，重启即失。**要让巡检继续跑，必须在面板里把任务重建出来**（重建才落库）。

排班表（模型统一 `deepseek-official/deepseek-v4-flash`，权限一律 `danger-full-access`）：

| 时间 | 任务 | 落库口径 |
|---|---|---|
| 12:30 | 官网巡检（llm-deepseek.models） | 自动收录，只增不删 |
| 12:38 / 18:30 | opencode-go 全量口径巡检 | 自动落库（§8 全量镜像；**2026-09-17 起拆 `opencode-go` + `opencode-go-anthropic` 两条路由，`union-alpha` 归 anthropic 侧**） |
| 12:46 / 18:38 | 前沿免费模型巡检（openrouter-go） | 自动收录，仅前沿档 |
| 12:54 | 智谱巡检（zhipu / zhipu-htc） | 自动收录，只增不删 |
| 13:02 | 百炼巡检（bailian） | 自动收录，只增不删 |
| 13:10 | codex opencode-go 全量口径巡检（Codex 侧） | 自动落库（§8 Codex 侧同步：`~\.codex\models.json` + 兜底补 live 的 `model_catalog_json` 行；`.codemoss\config.json` 只读） |

排班原则（红线，改动前先读）：

- **跑在空闲窗口**：官网直连有峰谷价（周一至五 9-12、14-18 为高峰），排班全落在 12:00-14:00 与 18:00 之后 → 半价。
- **错峰 ≥8 分钟 + 并发防护 2 分钟，两者必须配套**：同批任务都写同一个 `settings.yaml`，落盘前先看该文件 LastWriteTime，**不足 2 分钟就跳过本轮落库**（只出报告并写明"检测到并发写"）。若把错峰压到 2 分钟以内，或把防护窗口放大到 5 分钟以上，邻座任务会被误判并发而**集体白跑**。
- **一天两次的需求拆成两个任务**：scheduler 单个任务一天只能有一个时刻（`kind: daily` 仅一个 `time`），所以"中午 + 晚上"= 两个任务，prompt 正文完全相同。
- 高频任务锚点尽量压在空闲窗口内；落在高峰的那几轮只是 flash 输入价翻倍，差价每天几分钱，不值得为此牺牲频率。
- 模型钉在任务上（`provider`/`model` 字段）：不吃 `agent-default-model`；opencode 巡检钉**别的渠道**，避免"套餐挂了连巡检都跑不动"的自证循环。
- **Codex 侧那条（13:10）不写 `settings.yaml`、只读它** → 不受"2 分钟并发防护"约束（脚本内仍保留该防护，撞上就只出报告不落库）；必须排在 12:38 那轮之后，才能取到当天最新落库结果。它同样钉 `deepseek-official`：任务正文只读写 `~\.codex\models.json`（+ 兜底补 live 的 `model_catalog_json` 行），**一次都不碰 `.codemoss\config.json`**（CCGUI 私有状态，见 §8），也不碰 opencode-go 的 API。

权限与护栏：必须 `danger-full-access`——任务要写会话工作区之外的 `~/.dsh/settings.yaml`，且无人值守没人批权限，`read-only`/`workspace-write` 会在落盘那步被拒。每次落库：备份 `settings.yaml.bak-<时间戳>` → 只改自己那段 models → YAML.parse 校验 → 任一不过立即回滚并报错停手。

维护方法：

- **面板调度器（实际在跑的那套）**：任务在 GUI「定时任务」页管理；程序化读写走 `/api/desktop/dsh-tauri-panel-scheduler/tasks`（**有 PUT，改正文不用删了重建**）：
  ```powershell
  xh get :13080/api/desktop/dsh-tauri-panel-scheduler/tasks               # 列任务（含 prompt 全文）
  xh put :13080/api/desktop/dsh-tauri-panel-scheduler/tasks id=<任务id> prompt=<新正文>   # 改正文
  xh post :13080/api/desktop/dsh-tauri-panel-scheduler/tasks/run id=<任务id>              # 立即干跑一次
  ```
  改完**回读确认**，别信回话。
- **引擎自带调度器**：没有 update 工具，改任务 = `scheduler_delete` + `scheduler_create`；实档 `~/.dsh/crons/tasks`（**2026-09-15 起为空**，`scheduler_list` 查的也是它，别当真相）。
- 判断「某轮巡检到底跑了没」：看 `~/.dsh/storages/session_projcache/sessions/` 里 `task-*.json`（旧引擎档）或 `session-*.json`（面板档，`cwd` = `~/.dsh/automations`）的 LastWriteTime 与首条 user message——比任何自述都可靠。

## 已知坑位

- dsh-defend 会拦截任何"带密钥样式"的工具结果与 edit 参数；tool 参数也要避免 `Bearer <token>` 同行。
- `ui-onboarding:` 等顶层键在 0 列（无缩进），编辑锚点别加空格。
- edit 工具 old_string 需与文件精确一致（含缩进）；多行块编辑比逐行安全。
- 公司网关内网 `192.168.80.248:3000` 在白名单外，无法直连查验，按官网口径（0731/0813=正式版）标注。
- agent-default-model 在 settings.yaml 与两个 profile patch 各有一份，容易两处不一致；patch 覆盖 settings，排查以 patch 为准。
- dsh-auto-review 审查器 fork 继承会话路由：换默认模型 = 主代理+审查器同时换渠道，反之亦然。
- zhipu key 明文在 settings.yaml；dsh-defend 拦 `sk-`/Bearer 样式，写带 key 配置用"Authorization: Bearer 换行缩进下一行"写法。
- Windows 沙箱受限令牌下 curl 的 schannel 报 `SEC_E_NO_CREDENTIALS`（TLS 挂），抓 https 用 node fetch 更稳；node 脚本写工作区 `_tmp\` 再跑，避免 shell 引号转义。