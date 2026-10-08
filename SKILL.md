---
name: deepseek-harness-settings-curator
description: DeepSeek Harness（DSH）专用技能：定期梳理 DSH 的 LLM 供应商模型配置（2026-09-23 起真源 = profiles/web/cordis.patch.yml 的 profile 补丁，旧 settings.yaml 已退役），追加新模型、清理失效/重复模型、参数量与版本标记对齐、找限时免费模型。触发词：梳理配置、梳理模型、cordis.patch.yml、profile 补丁、settings.yaml、追加模型、清理模型、清理旧模型、免费模型、限时免费、参数对齐、模型配置、模型维护、默认模型、模型路由、切模型、费用检查、agent-default-model。
author: 胡志伟
platform: DSH (DeepSeek Harness)
motto: "配置如园，常理常新。查证为准，不写未知。每次改动，方案先行。"
---

# 📋 DSH 模型配置梳理（profile 补丁版） — 胡架定制

> **本技能专用于 DeepSeek Harness（DSH）的模型配置维护**（DSH 消费端 `~/.dsh/skills` 为第一使用场景，同时兼容挂载到 Claude Code 技能目录）

## 目标文件

- 主文件（唯一真源）：`C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml` —— 新版 DSH（0.1.7+）的配置权威落点，**顶层是条目数组**：`- id: llm-pi-ai`（各渠道模型在 `config.providers.<路由>.models`）、`- id: llm-deepseek`（官方直连模型在 `config.models`）、`- id: agent-default-model`、`- id: permission` 等，每项 `config:` 下挂该插件配置。
- ⚠️ **旧 `~/.dsh/settings.yaml` 已退役（2026-09-23 起）**：新版 DSH 启动时把它一次性导入各 profile 补丁并改名 `settings.yaml.imported`，该文件之后不存在、也不再被读取。**凡是仍指向 settings.yaml 的脚本/提示词/话术全部失效**，一律改锚 `cordis.patch.yml`（2026-09-23 实测：巡检任务因此连环 failed）。
- 已知 provider（精简阵容 5 个）：zhipu（智谱GLM官方）、opencode-go（OpenCode Go）、bailian（百炼）、company-gateway（公司网关3000）、openrouter-go（OpenRouter直连）；已下线：volcengine（火山方舟）、sensenova（商汤日月新）；另有官方直连路由 `deepseek-official`（配置在 `- id: llm-deepseek` 条目的 `config.models`，非 llm-pi-ai 成员，详见 §7）
- 默认模型（agent-default-model）：`profiles/web/cordis.patch.yml` 的 `- id: agent-default-model` 条目（生效值）；`profiles/tui/cordis.patch.yml` 另有一份（只对 tui profile 生效），互不干扰
- **配置层级（patch 语义，2026-09-23 实测）**：引擎内置 bundle → `<profile>/cordis.patch.yml` → 运行期 `--patch <一次性 yml>`，**后者压前者**；同 id 的条目以更靠后的层为准（实测：面板 AI 任务用 `--patch` 压 `agent-default-model` 与 `permission` 均生效）
- 网络放行：`C:\Users\Administrator\.dsh\rules.yaml` 网络白名单（查官方价目需放行 `api.deepseek.com` / `bigmodel.cn` / `open.bigmodel.cn`；2026-08-31 已加）
- **Codex 侧同步链（详见 §8 Codex 侧同步）**：`C:\Users\Administrator\.codex\models.json`（Codex 模型目录，由 live `~/.codex/config.toml` 的 `model_catalog_json` 指向）← 定时任务「codex opencode-go 全量口径巡检」（13:10）每轮维护；而 `C:\Users\Administrator\.codemoss\config.json`（CCGUI 插件 `idea-claude-code-gui` 的私有状态，内含 Codex 供应商的 `configToml` 模板）**是原厂件，只能在该插件 UI 里改，外部一律只读**——改它会让插件的 `appliedProviderRevision` 校验失配、Codex 会话直接罢工。**codemoss 的 `claude` 段与 `~/.claude` 下任何文件更不属本技能管辖，禁止改动**

## 用户选型偏好（用户口味确认，梳理时优先执行）

- 常用主力只留三条线：**DeepSeek 系、GLM 系（各自必须带 flash 档）、千问系（flash 为主，1~2 个）**。
- 免费渠道保留：company-gateway（New API 类公司网关）、openrouter-go（auto/free/fusion 免费聚合档）——即"牛来那种免费"口径。
- **非偏好系厂商/模型一律不主动加**，用户点名才加，加前照常查证。
- 每次梳理以精简为先：同款模型多渠道重复时，只留最稳/最便宜的，其余列删除清单走确认流程。
- 千问 flash 口径：bailian 配 `qwen3.7-flash`（实测 200 通）+ `qwen3.8-flash`（2026-08-27 发布，见 §4）。`qwen3.6-flash` 模型存在但免费额度已耗尽（403 insufficient_quota，需充值或控制台关闭 free-tier-only），额度恢复前不加回。

## 安全红线（必读）

1. **密钥文件含明文 API key，禁止整文件 read/输出**——会命中 dsh-defend（sk-openai / bearer-token 规则）被拦截。`cordis.patch.yml` 已零明文（供应商用 `apiKeyEnv` 引变量名），明文密钥本体在 `~/.dsh/.credentials.yaml`，掩码规则照旧适用。
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
  - DeepSeek 系：官网直连（`deepseek-official`）现配 `deepseek-flash`（V4.1 Flash，显示名别名 `deepseek官网/DeepSeek V4.1 Flash/552B/正式`）；opencode-go / bailian 侧另有各自的 `deepseek-v4-flash` 条目（渠道独立口径，别混），查证有无更新 flash；
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
- **模态红线（2026-09-19 定，2026-09-27 细化为两层）**：**配置层** `input:` 只允许 `text` / `image` 两个值——pi-ai 适配器 schema 的模态枚举就这两个；omni/音视频模型官方再宣传 audio/video 也不许写进配置，写了**整个 `llm-pi-ai` 分节会被拒载**、全渠道模型从选择器集体消失（2026-09-18 实踩：百炼巡检给 `qwen3.8-omni-flash` 写 `audio/video`，当天起 6 路由 42 模型全部不显示）。**台账层已放开（2026-09-27）**：`ai_model_capability.input_modalities` 可如实记录 audio/video（全模态模型如 `qwen3.8-omni-flash`），探测与 AI 查证按模态并集落库、写回器永不下发 audio/video 进配置。视觉口径 = `input: [text, image]`。

### 3. 清理旧模型
- 识别依据：调用 404、厂商下架、免费变收费、重复条目。
- 流程：列删除清单 → 给用户确认 → 删 → YAML 校验。

### 4. 参数量对齐（已知可靠数字速查，更新至 2026-09-25）
- DeepSeek V4.1 Flash（API id `deepseek-flash`）=552B/输入激活8B/输出激活16B（2026-09-10 官方发布公告）；deepseek-v4-pro=1.6T/激活49B。
- **显示名对照（2026-09-25 引擎 0.1.7-rc.2 实录）**：引擎内置目录把 V4.1 Flash 的显示名写成 `DeepSeek-V41-Flash`（官方连写 `V41`，**不是新代号、也不是 V4 Flash**）；`deepseek-v4-pro` 显示名 `DeepSeek-V4-Pro`。旧的 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已不在内置目录（官网旧 id 仍暂路由到 V4.1）。
- DeepSeek 规格判定红线：284B/激活13B 仅为旧 V4 Flash 历史规格，禁止套用到 V4.1；官网已说明旧 `deepseek-v4-flash` 等 id 会暂时路由到 V4.1。参数量冲突时以该模型对应的官方发布公告/模型卡为准，不得让本地速查或旧 id 覆盖官网。
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

- 位置与生效：`profiles/web/cordis.patch.yml` 的 `- id: agent-default-model` 条目（生效值）；`profiles/tui/cordis.patch.yml` 里另有一份（只对 tui profile 生效，互不干扰）。旧 settings.yaml 顶层段已随新版 DSH 退役。
- 影响面：默认模型 = 主代理路由，**dsh-auto-review 审查器 fork 继承同一路由**，改一处两者同切渠道。
- 检查项：provider 必须在补丁 `- id: llm-pi-ai` 条目的 `config.providers` 里存在，或为官方直连路由 `deepseek-official`（配置在 `- id: llm-deepseek` 条目的 `config.models`，见 §7）；model id 必须在对应路由的 models 列表（deepseek-official 对应 `config.models` 或内置目录三行之一）。
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

- 定位：DeepSeek 官方直连适配器，路由名 `deepseek-official`（不是 `deepseek`）；配置在补丁的 `- id: llm-deepseek` 条目（`config.models`），独立于 `- id: llm-pi-ai` 的 `config.providers`，两套适配器可并存。
- **🔴 插件包名红线（2026-09-25 实踩，本节最高优先级）**：补丁里 `- id: llm-deepseek` 的 `name` 必须**逐字等于当时引擎 bundle 里同 id 条目的包名**——引擎 `0.1.7-rc.2` 起是 `@deepseek-ai/dsh-llm-deepseek-api-key`，**不是** `@deepseek-ai/dsh-llm-deepseek`（后者只是适配器库包，两包同名同版本号并存，极易看错）。
  - 写错名的后果：该条目 `config` 被**静默忽略**，运行期回落引擎内置目录 → 选择器里我们的别名消失、改显示 `DeepSeek-V41-Flash`/`DeepSeek-V4-Pro`，**无任何报错弹窗**；而 `settings/describe` 里 `user` 层仍显示你自己的别名（**文档层有值、运行层没值 = 中招特征**）。
  - 查证法：读引擎 bundle `@deepseek-ai/dsh-base/cordis.patch.yml`，grep `id: llm-deepseek` 看紧邻下一行 `name`；脚本 `scripts/pi-ai-schema-check.mjs` 已内置该校验（第 3 道，见 §9）。
- 结构（照 schema 实录）：
  - `apiKeyEnv`：凭据引用名，默认 `DEEPSEEK_API_KEY`（凭据 ref 已存在）；`baseURL` 缺省即官方公共端点。
  - `thinking`：enabled/disabled；`reasoningEffort`：off/low/high/max（**config 级单数**）。
  - `models`：数组，每项合法键 = `id` / `name`（选择器显示名）/ `description` / `contextWindow` / `maxTokens` / `inputModalities`（vision 档需声明 text+image 才能收图）/ `imagePixelBudget` / `imageMaxBytes` / `systemPromptUpdate` / `toolUpdate`。**没有复数 `reasoningEfforts`**（那是 pi-ai 路由的键；2026-09-24 23:09 的 capfix 曾误写进 llm-deepseek；2026-09-25 手工摘掉后，**面板能力写回器按台账又自动写回**——实测两套引擎都容忍它、不致故障，但属 schema 外键：要彻底消灭得先改写回器口径（面板代码），**别靠手工反复摘，会被写回**）。
- 内置目录（`models` 未落盘即继承；2026-09-25 引擎 `0.1.7-rc.2` 实录）：`deepseek-flash`（显示名 `DeepSeek-V41-Flash`，text+image，`systemPromptUpdate: in-history`，`toolUpdate: addition-only`）、`deepseek-v4-pro`（显示名 `DeepSeek-V4-Pro`）。旧的 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` **已从内置目录移除**（官网旧 id 仍暂路由到 V4.1，但引擎不再列，别按旧目录判"官网下架/新增"）。
- 并存分组：`llm-deepseek-account`（账号登录路由，选择器分组显示 `DeepSeek 账号`）与官方直连 `DeepSeek` 是**两个 provider**；账号组**不吃** `llm-deepseek` 的 `config.models`，它显示内置目录名属正常，别当成"配置没生效"。分组排序固定 账号 → 官方直连 → 其余。
- GUI 入口：设置→模型→DeepSeek 行；每行可改 id/显示名/上下文/最大输出，可增删行，改后落 `llm-deepseek.models` 的 `name`，「/model」弹窗与 composer 显示该名。
- **运行期自查（改完必做：文件对 ≠ 生效）**：查运行期真目录，`deepseek-official` 组的 `models[].name` 必须等于补丁里的 `name`（本次实测：改 `name` 后**热生效、无需重启**）：
  ```powershell
  xh post :13080/api/session/modelCatalog type=client-request rpcId=c1 method=session/modelCatalog payload:='{"args":{}}'
  ```
- 梳理检查项：`models` 空 = 继承内置目录；id 重复 / name 缺失 / 与 pi-ai 渠道同款模型按"精简为先"去重（只留最稳或最便宜）；版本标记沿用 DeepSeek 系口径（0731=Flash 正式、0813=Pro 正式、-ga- =GA）；**id 一律用官方 API id 原样**（V4.1 Flash = `deepseek-flash`）。
- 费用：价目见 §6 费用核查（缓存命中输入 0.05/0.10 元，差 30 倍）。
- **当前档位（2026-10-08 架构师定）**：web 与 headless 两份补丁的 `llm-deepseek` config 均已显式 `reasoningEffort: max`（config 级单数键，与 `models` 同级；两端同步加是防面板 overlay 撞重复键）。同日架构师手改：`zhipu`/`zhipu-htc` 路由级 `reasoning: max`、`agent-default-model.reasoningEffort: max`。

### 8. opencode-go 渠道（OpenCode Go 套餐 · 订阅全量渠道）

**口径（红线，与官网/智谱/百炼不是一套逻辑）**
- 定位：OpenCode Go 订阅渠道（$10/月、$100 用量，仅订阅用户可用）；**按线上协议拆两条常驻路由**（2026-09-17 定，见下方「协议分路由」）：`opencode-go`（`api: openai-completions`、baseURL `https://opencode.ai/zen/go/v1`）与 `opencode-go-anthropic`（`api: anthropic-messages`、baseURL `https://opencode.ai/zen/go`，**不带 `/v1`**——适配器自动补 `/v1/messages`）。另有第三条 Responses 路由 `opencode-go-responses`：**2026-09-27 曾建、当晚已撤**（GPT Luna 系上游 403 地区限制，Luna 暂不启用），口径与重建步骤见下方「responses 侧模型」。
- **全量收录**：官方「当前支持的模型列表」里的模型**一个不落**，只增不减（官方下架才删）；**不做三线口味精简、不跨渠道去重、不与官网/智谱/百炼合并口径**。**阈值口径废止（2026-09-26 架构师定，原 2026-09-20 的「<1000 不收录」作废）**：不再按请求数过滤——收录范围 = 官方支持列表 − 巡检目标清单停用/待复核（人工启停为准）；次数只用于 name 显示与排序；清单里不想要的模型用「停用」开关处理，下一轮巡检自动摘掉。
- **displayName 协议后缀（2026-09-20 定）**：渠道 displayName 统一带协议标注——`openai-completions` 加 `(OpenAi协议)`、`anthropic-messages` 加 `(Anthropic协议)`（实例：`OpenCode Go套餐(OpenAi协议)` / `OpenCode Go套餐(Anthropic协议)` / `OpenCode Go套餐(Responses协议)` / `智谱GLM官方(Anthropic协议)` / `OpenRouter(直连)(OpenAi协议)`）；巡检只守不碰（骨架键），改名只由人工做；displayName 改完**热生效**（2026-09-27 实测 profile 行热更新，无需重启），GUI 选择器里若没立刻看到就刷新页面。deepseek官网（llm-deepseek 独立适配器）不参与此约定。
- **命名（2026-09-25 用户口径改为缩写）**：`[新/][N倍/]OpenCode/<显示名>/<参数量?>(/<版本?>)/5h·N`
  - **标记区前置**：官方「新」徽章拼 `新/`、落地页限时倍数拼 `N倍/`，两者都放在 `OpenCode` **前边**（都有则 `新/N倍/OpenCode/…`；只有一个就只拼那个；都没有则省略）；
  - **显示名带版本**（DeepSeek V4.1 Flash → `deepseek-v4.1-flash`）；**id 用官方 API id**（V4.1 Flash 的官方 id 是 `deepseek-flash`，官方命名不跟版本走）；
  - **name 里的〈显示名〉一律取官方显示名，禁止拿 API id 顶替**（2026-09-17 实踩：`union-alpha` 的官方显示名是 **Union Alpha Free**，巡检把 id 当显示名写成 `新/OpenCode/union-alpha/5h·无限` → 用户看不出这是哪个模型；正确写法 `新/OpenCode/Union Alpha Free/5h·无限/限`）。落地页/文档页显示什么就照抄什么（含 `Free`/`Preview`/`Experimental` 这类后缀），只把空格按需保留、大小写照官方；
  - 官方没给「N 次」预估的写 `5h·无限`；**限时供应/限时免费**的档在末尾补 `/限`（如 union-alpha）；
  - 参数量只标 §4 已核实数字，未披露不标；
  - 调用次数以 `5h·N`（无预估写 `5h·无限`）拼在名字末尾——**别再写「每5小时N次」长串**（2026-09-25 用户嫌长）；整表按**显示值**（name 里 `5h·` 后的数字，**当轮显示值优先**——倍数活动进行中取促销值，活动结束取默认值）**倒序**；标记区（`新/`、`N倍/`）只随行移动、不参与排序；同次数按官方表原序。
- 三窗口（官方）：**每 5 小时 = 月限 20%、每周 50%、每月 100%**；预估请求数表按典型每请求 token 假设推算（如 deepseek-v4-flash 每次 410 输入 + 71,300 缓存 + 310 输出 token）。

**协议分路由（2026-09-17 定，红线）**
- **协议（`api`）是路由级，模型级覆盖不了**：一个 provider 只能有一种线上协议，模型级只认 `name/contextWindow/maxTokens/input/reasoningEfforts/compat`。所以同渠道里走不同协议的模型**必须拆成不同路由**，不能只改某个模型的 `api`。
- **归属判据 = 官方端点表**：文档页的端点表是唯一判据；`/zen/go/v1/models` 只返回 `id/object/created/owned_by`，**没有协议字段**，别指望它。**三分桶（2026-09-27 定，原"其余进主路由"的两分桶已作废）**：
  - 挂 `/v1/messages`（Anthropic SDK）→ `opencode-go-anthropic`；
  - 挂 `/v1/responses`（`@ai-sdk/openai`）→ **`opencode-go-responses`，人工维护，巡检只报告不落库**（2026-09-27 定，见下方「responses 侧模型」）；
  - 其余（`/v1/chat/completions`）→ `opencode-go` 主路由。
  2026-09-17 时 messages 侧 = `union-alpha` 一条（官方标注限时免费）。端点表现有 responses 侧 **6 款**：`gpt-6-luna`、`gpt-5.6-luna`、`grok-4.7`、`grok-4.6`、`muse-spark-1.2-contributor`、`muse-spark-1.3-contributor`。
- **responses 侧模型（2026-09-27 定，红线；当前状态：路由已撤、GPT Luna 系暂不收录——上游对该系返回 403 地区限制，等上游通了再按本节重建）**：这些模型官方只开 `/v1/responses`，挂进 `openai-completions` 主路由必然报错。**运维口径**：① 主路由里不许有它们（有则删）；② 将来要收：先重建 `opencode-go-responses` 路由（骨架：`api: openai-responses` + baseURL `…/zen/go/v1` + 同 `apiKeyEnv` + `displayName: OpenCode Go套餐(Responses协议)`，`name`/次数/排序仍按 §8 命名口径）；③ 重建后**必须同时把 `opencode-go-responses` 登记回 `opencode-go-session-header` 的 `providers`**（漏登记 → 400 `MissingSessionID`；登记随 profile 补丁热更新，**不用重启**，自证见下条）；④ 巡检目标清单里对应行要**停用**并注明"归 responses 路由"，否则 12:38 会把它搬回主路由（2026-09-27 事故根因）。**2026-10-08 复核：headless 补丁主路由曾残留 `gpt-6-luna`，已由新增的「headless 补丁模型对齐」任务首跑清除（web 侧无残留）；两份补丁的模型清单此后由任务 14 每日对齐。**
- **新路由禁写两样东西（2026-09-27 实测）**：`compat.sessionAffinityFormat`（`openai-responses` 下是 withhold 字段，运行期 `assertOfferedCompatFields` 抛错拒载，且 §9 三道校验查不出来——schemastery 保留未知键、`Config()` 照样通过）；`reasoningEfforts` 非 `off` 档位写 `null`（同样只在运行期拒）。目录里 gpt-5.6-luna 的 `compat.sessionAffinityFormat: openai-nosession` **抄不得**——路由键不叫 `opencode-go` 就拿不到目录 compat，适配器改走默认 `openai` 亲和格式（请求多带 `session_id` + `x-client-request-id` 头），以一次最小请求 200 为准自证。
- **新增模型必过三探针**（**只测新增**，旧模型不复扫——全量重测是白烧钱；旧模型仅在真报 4xx/5xx 时按错误驱动单条复检）：对候选模型各发一次最小请求（45s 超时、**必带 `x-opencode-session` 头**），三个端点各一次——`/chat/completions` 与 `/v1/messages` 用 `{model, max_tokens:16, messages:[{role:'user',content:'hi'}]}`，`/v1/responses` 用 `{model, input:'hi', max_output_tokens:16}`：
  - 主路两端都 200 → 归主路由 `opencode-go`（网关对老模型宽容，两路都能通属正常，按文档页端点表定归属）；
  - **只有 `/v1/messages` 200、`/chat/completions` 5xx** → 归 `opencode-go-anthropic`（2026-09-17 实测 union-alpha 走 chat/completions 报 `500 Internal server error`，走 messages 200）；
  - **只有 `/v1/responses` 200** → 归 `opencode-go-responses`（GPT 6 Luna 类；**归进去=人工接管，巡检不写它的 models**，只报告"应迁路由"）；
  - 探针命令与原始响应摘要要写进巡检报告。
- **路由键必须登记进会话头插件**：`profiles/web/cordis.patch.yml` 的 `opencode-go-session-header` 行 `providers` 要含**所有** opencode 系路由键（现为 `opencode` / `opencode-go` / `opencode-go-anthropic`；2026-09-27 曾加 `opencode-go-responses`，撤路由时同步摘键）。漏登记 → 上游 400 `MissingSessionID`。**改完不用重启（2026-09-27 实测纠偏）**：profile 补丁行是**热更新**的——给该插件行临时加 `debugFile` 写路径，改完约 20 秒内即生效，调试文件随即出现 `{"provider":"opencode-go","header":"x-opencode-session","value":"<会话id>"}` 记录（这份 config 对象里 `providers` 已含新键）；撤掉 `debugFile` 同样即时生效。插件 README 说的 restart 指**包自带 bundle 层**，**profile 覆盖行不适用**；且引擎日志里**没有**该插件的 logger 输出（logs 目录全部 grep 零命中），所以别拿"启动日志那行"当自证——**唯一可靠自证 = 临时 `debugFile` + 看有没有写出记录（验完撤掉）**。会话头由 `dsh-opencode-session` 插件按路由键注入，2026-09-05 起上游强制要求。
- **巡检只重建 models，不删路由、不碰 responses 路由**：`opencode-go-anthropic` 的 `api`/`baseURL`/`apiKeyEnv`/`displayName` 与注释，巡检一律不动；它只按上面的判据维护里面该放哪些模型。反过来，重建 `opencode-go` 时**必须把 messages 侧与 responses 侧模型都排除**，不许因为「官方列表里有」就写回主路由——messages 侧写回即 500（chat/completions 对 messages-only 模型是稳定 500，带不带会话头都一样，2026-09-17 复测）；**responses 侧写回即该模型调用报错（2026-09-27 事故：`gpt-6-luna` 被全量镜像回主路由 → 次日又报错）**。`opencode-go-responses` 的 models 由人工维护，巡检正文对它只许"发现异常写报告"，不许增删改。
- **上游间歇 503（2026-09-17 实测，不是配置问题）**：union-alpha 后端池约 1/3 概率**秒回** 503 `Endpoint is unavailable`，**成片出现**（坏窗口持续几分钟~几十分钟，同一请求过几分钟就通）；与 system 大小 / tools / max_tokens(≤32K) / 鉴权头样式（x-api-key 或双发）均无关。缺会话头是另一回事（400 `MissingSessionID`）。**别把 503 当配置错误去乱改路由**。缓解：装 `dsh-llm-retry` 插件 + 路由 `retryPolicy`（SERVER 属默认可重试码，默认 maxRetries=5、500ms 起指数退避）；没插件时就人工重发一次。

**抓取逻辑（优先级严格，每轮两页都抓）**
1. **文档页** https://opencode.ai/zh/docs/go/（公开、月更、web_fetch）——**权威列 = 「当前支持的模型列表」**；价格表/基础预估表作辅助；**端点表是协议归属的唯一判据**（见上「协议分路由」），但它同样含陈旧残留行 → 只用来判协议、不用来判收录；
2. **落地页** https://opencode.ai/zh/go——取文档页没有的两类信息：**「新」徽章（新模型）**与**限时倍数用量**（只在官网出现「限时享受 N 倍使用额度」字样时才成立；DeepSeek V4.1 Flash 的 4 倍活动已于 2026-09-26 前结束，26,000 转正为默认值；现实例：Space Bunny Free「限时」免费 ∞/∞）；
3. **取值规则**：官网出现「限时享受 N 倍使用额度」字样才取**促销值**并在 name 前置 `N倍/` 标记；官方撤掉倍数活动（落地页与文档页数值一致、无倍数字样）时按默认值写并摘掉 `N倍/` 标记（实例：V4.1 Flash 的 4 倍活动结束，标记已摘、26,000 为默认值）；
4. **官网数据块（徽章与次数真源，覆盖全部 32 条）**：落地页 HTML 源码里找 `/_build/assets/index-*.js` 脚本地址（可能多个，逐个抓，内含全部模型数组——每条 `id/name/requests/allowance`，可带 `featured/fresh/limitedTime/regions`——的那个就是）；字段口径：`fresh`=「新」徽章、`limitedTime`=末尾 `/限`、`requests`=次数依据（2026-09-26 起不做次数过滤，只用于显示与排序）；**非 featured 模型的徽章只有数据块里有**（首屏 HTML 看不见，实例：MiMo-V2.6-Pro `fresh:true` 但不在首屏）；数据块与①②数值冲突时先复核再取舍并写进报告；
5. `/zen/go/v1/models`（需订阅鉴权，尽力抓；401/无权限就跳过并说明）——**只用来比对 id 集合，拿不到协议**；
6. 文档页价格表与端点表**有陈旧残留行**（实例：MiniMax M2.5 有价格行、有端点行，但不在支持列表 → **不收录**）；与①冲突**一律以①为准**；
7. 抓不到 → 报「页面结构变化或抓取失败」，**绝不编造**；字段缺失写「未查到」；数据块挖不到就退回首屏徽章口径，报告注明「徽章盲区」。

**生成**
- 按口径产出**两条路由的 models 块**：`llm-pi-ai.providers.opencode-go.models`（chat/completions 侧）与 `llm-pi-ai.providers.opencode-go-anthropic.models`（messages 侧，通常 1~2 条）；YAML 同级缩进，`- id:` 8 空格、`name:` 10 空格。**第三条 `opencode-go-responses.models` 不在本任务产出范围**（人工维护，正文与校验都不碰它）。
- **同一个 id 只许出现在一条路由里**：两路由并集 + 人工维护的 responses 路由 = 官方支持列表，交集 = ∅；responses 侧模型若还在主路由里，按 §8「responses 侧模型」删掉它。

**校验（必须全过，任一不过即回滚并报错，不静默）**
1. `YAML.parse` 通过；
2. **id 集合 diff（两路由并集，按清单停用/待复核 + responses 侧豁免，2026-09-27 改）**：官方列表 −（`opencode-go` ∪ `opencode-go-anthropic`）− **端点表标 `/v1/responses` 的模型**（人工维护，不算漏配）每一条都必须是巡检目标清单里标为 disabled 或 retired 的模型（其余条目漏配即判失败）**且** 并集 − 官方 = ∅，且并集内**无重复 id**；另加一条硬检：`opencode-go` 主路由里**出现任何 responses 侧 id 即判失败**（还原备份并写报告）；
3. 条数比对（**按集合差算，别做纯数字相减**）：两条路由条数之和 = ｜官方列表 −（清单停用/待复核行）−（端点表 responses 侧模型）｜ —— 停用行里很可能**同时**含 responses 侧模型（现 5 条），纯做"N − a − b"会重复减一次，把对的配置判成失败。参照数（2026-09-27）：官方 32、opencode 侧清单行 32（启用 6、停用 26→现 25，`gpt-5.6-luna` 行已人工删除）、responses 侧 6 → 两路由应为 6 条；
4. name 正则逐条 `^(新/)?(\d+倍/)?OpenCode/.+/5h·(\d+|无限)(/限)?$`（官方无预估的用 `5h·无限`，限时档末尾补 `/限`；确有其它例外须显式标注）；
5. **排序单调性**：逐条解析 name 末尾 `5h·` 后的数字（「无限」按 +∞），序列必须**非递增**（排序键 = 显示值，促销值优先）——排错即判失败、还原备份；
6. **路由骨架未被改动**：`opencode-go` 仍 `api: openai-completions` + baseURL `…/zen/go/v1`；`opencode-go-anthropic` 仍 `api: anthropic-messages` + baseURL `https://opencode.ai/zen/go`（无 `/v1`）+ 同 `apiKeyEnv`；任一被动过即判失败、还原备份；
7. 落库前备份到 `C:\Users\Administrator\.dsh\profiles\web\.bak\cordis.patch.yml.bak-<时间戳>`，落库后回读打印全部 id/name（标明所属路由）供人工核；
8. **pi-ai schema 校验（2026-09-19 加，必跑）**：`node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\pi-ai-schema-check.mjs" "C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml"`，exit 1 = 条目会被 DSH 拒载，立即还原备份——YAML.parse 只管语法，拦不住 `input` 超枚举这类 schema 拒载。脚本缺省目标已是 web 补丁，且**补丁里两个 llm 条目都不在时会直接判失败**（防"读空即跳过"的假通过）。
9. **运行期必查（2026-09-27 加，第四道）**：三道全过 ≠ 能跑。`compat` 写 withhold 字段、`reasoningEfforts` 非 `off` 档位写 `null` 这类错误**三道全绿但运行期拒载**（schemastery 保留未知键，`Config()` 照单全收，只有 dsh-llm-pi-ai 运行期 `assertOfferedCompatFields` / 档位解析才抛 `PiAiCatalogError`）→ 改完**等约 30 秒**让 profile 补丁热更新（**2026-09-27 实测：profile 行不用重启**），再做两件自查：① `xh post :13080/api/session/modelCatalog ...`（§7）确认新路由/新模型真的进了运行期目录；② 对改动过的路由发一次最小请求，**判据看报错类型**：`200` 或 `403 地区` = 路由/协议通了；`400 ModelProtocolUnsupported` = 协议错（路由没接对）；`400 MissingSessionID` = 会话头没登记。任一不过即还原备份（真不行再重启 dsh）。

**执行方式**：定时任务「OpenCode-go 渠道巡检（三协议）」（面板任务 id=4；2026-09-27 由「双协议」改名，因官方拆出 `/v1/responses` 第三条路由）按 §10 排班跑（B 模式自主落库：先备份 → 改 → 跑上面 1~9 项校验 → 任一失败即还原备份并报错）；人工梳理时并入 §1「最新 flash 巡视」同轮。

**Codex 侧同步（models.json 归我们 + CCGUI 模板归插件）**——2026-09-10 起由定时任务「codex opencode-go 全量口径巡检」（13:10）每轮执行

- **一句话执行**（脚本内含并发防护、备份、校验不过自动回滚、Codex 本体实测）：
  ```powershell
  node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\codex-opencode-sync.mjs"           # 预览，零写入
  node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\codex-opencode-sync.mjs" --apply   # 备份 + 落库 + 自校验
  # 调试：--emit <目录> 导出"应然产物"做 diff；--force 忽略并发防护
  # ⚠️ --write-codemoss 会写 .codemoss\config.json —— 默认关闭，非必要别开（2026-09-10 事故成因）
  ```
- **本体实测必须带 `CODEX_HOME`（2026-09-23 实踩）**：`codex.exe` 0.155.1 起**不认 `USERPROFILE`/`HOME`**，按 Windows 用户档案解析 home；面板巡检跑在 LocalSystem 会话里 → 落到 `systemprofile` → 实测读到内置 9 条 gpt-*、3 项假 FAIL（落库其实是成功的）。脚本已改成 `execFileSync` 显式传 `CODEX_HOME=<HOME>\.codex`，实测 4 条与补丁目录逐条 MATCH。
- **口径**（与 DSH 的 §8 全量口径不是一套）：
  - 收录集合 = 补丁 `- id: llm-pi-ai` 条目 `config.providers.opencode-go.models` 里 **id 匹配 `^deepseek` 或 `^glm`** 的条目（DeepSeek 全系 + GLM 全系，2026-09-10 为 8 条）；其余渠道内模型（mimo / kimi / minimax / qwen / hy / grok / longcat / omen / muse-spark / gpt-*）**一律不进 Codex 清单**。
  - `slug` = 官方 API id **原样**（V4.1 Flash 的 slug 是 `deepseek-flash`）；**`display_name` = 照抄 DSH 的 `name` 整串**（别名与 DSH 一致，带 `新/`、`N倍/` 标记与 `5h·N`）；排序 = 按 name 末尾 `5h·` 后的数字倒序，同次数按补丁原序。
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
- **两页口径不同**：`新` 徽章与限时倍数只在落地页 `/zh/go`，文档页只给默认值——倍数活动进行中时只读文档页会漏促销值；2026-09-26 起 V4.1 Flash 两页一致（26,000 默认值，4 倍活动已结束，别再按促销写）；
- **官网数据块 JS 文件名带 hash**（如 `index-BodLf6jr.js`），官网一改版就变——**别写死文件名**，每次从落地页 HTML 源码现挖 `/_build/assets/index-*.js` 再逐个试；
- `deepseek-flash` 是 V4.1 Flash 的官方 id，显示名要写成 `deepseek-v4.1-flash`；
- OpenCode 渠道 DeepSeek 系标「预览」口径（与官网「正式」区分）；V4 flash/pro 峰谷价（Peak=UTC 周一五 01-04/06-10）；
- Omen Alpha 匿名身份疑似智谱 GLM 系（OpenCode 数据页归属智谱，未官方认领），规格未披露；
- muse-spark contributor 仅限 Meta 地理政策允许地区，以允许训练换折扣；
- DSH 在官方「已知存在问题客户端」名单（会话头支持不完整，discussion #5495）；
- 官方「预估请求数」会变（v4-flash 7600→13000 即实例），name 里的次数随表同步改。

### 9. 流程红线
- 任何改动前：**分析 → 方案结尾带四字成语确认词 → 等用户回确认词才动手**（"行/好/确认"等不算）。
- 改 agent-default-model 前**先备份 profile 补丁**（`Copy-Item <file> C:\Users\Administrator\.dsh\profiles\web\.bak\cordis.patch.yml.bak-<时间戳>`；tui 那份若也动，一并备份）。
- 多个方案列出来让用户选，不替用户做主。
- 改后校验（**三道，任一不过立即回滚**）：
  ```powershell
  # ① 语法：YAML.parse（工作目录放 DSH checkout，yaml 依赖在 node_modules；补丁顶层是数组，看条目数）
  node -e "const fs=require('fs');const YAML=require('yaml');const doc=YAML.parse(fs.readFileSync('C:/Users/Administrator/.dsh/profiles/web/cordis.patch.yml','utf8'));console.log('PATCH_YAML_OK 条目数='+doc.length)"
  # ② schema + ③ 插件包名一致性（2026-09-19 加 / 2026-09-25 加第③道，必跑，任意目录可跑）：
  #    ② 拿引擎自带 Config 真 schema 校验 llm-pi-ai / llm-deepseek 条目；schema 来源自动锚到桌面端引擎（0.1.7-rc.2）
  #    ③ 补丁里每条显式 name 必须与 bundle 同 id 条目逐字一致（引擎升级会换包名，不同步就静默失效）
  node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\pi-ai-schema-check.mjs"
  ```
  只跑①是 2026-09-18 事故根因之一：语法全对但 `input` 声明 `audio/video` 超枚举 → 整个 `llm-pi-ai` 条目被拒载、全渠道模型消失。
  只跑①②是 2026-09-25 事故根因：语法与 schema 全过，但 `- id: llm-deepseek` 的 `name` 还是旧包名 → 该条目 config 被静默忽略、运行期回落内置目录（见 §7 包名红线）。
  ③ 可用历史副本自检：`node <脚本> <补丁.bak 路径>`（脚本会向上找到 profile 根取 bundle 清单）。
  ⚠ **三道全过也可能运行期拒载（2026-09-27 实测坐实 = 第四道盲区）**：`compat` 写 withhold 字段（例：`openai-responses` 下的 `sessionAffinityFormat`）、`reasoningEfforts` 非 `off` 档位写 `null`，schemastery 都保留原键并通过 `Config()`，只有 dsh-llm-pi-ai 运行期 `assertOfferedCompatFields` / 档位解析才抛 `PiAiCatalogError` → 路由或整分节拒载且无弹窗。**落库后必做**：等约 30 秒（profile 补丁行热更新，2026-09-27 实测**无需重启**）→ §7 运行期 modelCatalog 自查 → 对改动过的路由发一次最小请求看报错类型（或临时 `debugFile` 自证头已注入）。
- 用户可能自行改过文件：edit 前必须先 read；报"file changed since read"就重读再编辑。
- 只改任务要求的，不顺手优化；尊重用户手改（如 displayName、去版本号命名）。

### 10. 定时任务与巡检排班

> 本节 **2026-10-08 实测复核**（原 2026-09-25 快照）。**改过任务后顺手更新本节**，过期排班表会误导后来人。
>
> **任务实档在哪（2026-09-23 实测）**：巡检已全部搬进**日报管家面板**——任务在 `daily_panel.ai_task` + `ai_task_schedule` 两张表（页面「日报管家 → AI 任务」，程序化读写走面板 `:18787/api/aitask/*`），由面板进程内的 node-schedule 触发；每次运行由面板 spawn `node <dsh 的 bin.js> --profile web --patch <一次性覆盖层> "<提示词>"`，工作目录固定 `~/.dsh/automations`。
> - **DSH 侧两套调度器 2026-09-23 实测都已空**：桌面端插件调度器 `GET :13080/api/desktop/dsh-tauri-panel-scheduler/tasks` → `{"tasks":[]}`；引擎自带 `~/.dsh/crons/tasks` → 空（`scheduler_list` 查的也是它）。**别再往 DSH 侧找巡检任务**，改任务一律去面板。
> - DSH 侧遗留的 `~/.dsh/automations/*.mjs|ps1`（09-10/09-19 那批）已无人调用，且仍写死 `settings.yaml` —— 复活前必须换锚 `profiles/web/cordis.patch.yml`。
> - 判断「某轮巡检到底跑了没」：面板 `ai_task_log`（`/api/aitask/logs`，比自述可靠）最准，其次看 `~/.dsh/sessions/**/session*.jsonl.zstd` 的 mtime。

排班表（面板实档 2026-10-08 查：10 条任务全部 `daily`，模型统一钉 `zhipu/glm-5.3-flash`，权限一律 `danger-full-access`，超时 1800s；**晚间档已取消**，全天窗口 12:30–13:58）：

| 面板任务 id | 时间 | 任务 | 落库口径 |
|---|---|---|---|
| 3 | 12:30 | deepseek 官网巡检（`- id: llm-deepseek` 的 `config.models`） | 对账式：官网在服保留、**disabled / 404 一律删除**（人工停用优先） |
| 4 | 12:38 | OpenCode-go 渠道巡检（三协议） | 自动落库（§8 全量镜像；两条路由 `opencode-go` + `opencode-go-anthropic`；**responses 侧模型排除，`opencode-go-responses` 人工维护、本任务不碰**） |
| 5 | 12:46 | OpenRouter 渠道巡检（`openrouter-go` 双协议） | 自动收录，仅前沿档 |
| 6 | 12:54 | glm-智谱巡检（zhipu / zhipu-htc） | 自动收录，只增不删 |
| 7 | 13:02 | 百炼巡检（bailian） | 自动收录，只增不删 |
| 10 | 13:10 | opencode-go CCGUI codex 全量口径巡检（Codex 侧） | 自动落库（`~\.codex\models.json` + 兜底补 live 的 `model_catalog_json` 行；`.codemoss\config.json` 只读） |
| 11 | 13:18 | deepseek CCGUI claude code 全量口径巡检 | CCGUI claude 段别名同步（`deepseek-claude-sync.mjs`；备份 `~\.dsh\backup\ccgui-claude\`） |
| 12 | 13:26 | glm CCGUI claude code 智谱巡检 | CCGUI claude 段别名同步（`zhipu-claude-sync.mjs`；备份同上） |
| 13 | 13:50 | 模型能力探测（`{{CAPABILITY_PENDING}}` 只填空槽） | **只查证、不写配置**；面板据末尾标记块落能力台账（`ai_model_capability`） |
| 14 | 13:58 | headless 补丁模型对齐（grp=对齐巡检） | **web 为真源、web 永远只读**：把 headless 补丁的 `llm-pi-ai` + `llm-deepseek` 两段逐路由对齐到 web（models+全部模型键+路由级 reasoning 默认档，骨架键不一致也以 web 为准，多删少补）；permission 只报告不改；备份 `headless-cordis.patch.yml.bak-<时间戳>`+2 分钟并发防护+YAML/schema 双校验，败即还原。2026-10-08 首跑 success，清掉 headless 主路由 `gpt-6-luna` 残留 |

排班原则（红线，改动前先读）：

- **跑在空闲窗口**：官网直连有峰谷价（周一至五 9-12、14-18 为高峰），排班全落在 12:00-14:00 与 18:00 之后 → 半价。
- **错峰 ≥8 分钟 + 并发防护 2 分钟，两者必须配套**：同批任务都写同一个 profile 补丁（`profiles/web/cordis.patch.yml`），落盘前先看该文件 LastWriteTime，**不足 2 分钟就跳过本轮落库**（只出报告并写明"检测到并发写"）。若把错峰压到 2 分钟以内，或把防护窗口放大到 5 分钟以上，邻座任务会被误判并发而**集体白跑**。
- **一天两次的需求拆成两个任务**：scheduler 单个任务一天只能有一个时刻（`kind: daily` 仅一个 `time`），所以"中午 + 晚上"= 两个任务，prompt 正文完全相同。
- 高频任务锚点尽量压在空闲窗口内；落在高峰的那几轮只是 flash 输入价翻倍，差价每天几分钱，不值得为此牺牲频率。
- 模型钉在任务上（`provider`/`model` 字段）：不吃 `agent-default-model`；opencode 巡检钉**别的渠道**，避免"套餐挂了连巡检都跑不动"的自证循环。
- **落库三道校验（2026-09-25 加第③道，见 §9）**：YAML 语法 → schema → **插件包名与 bundle 一致**。第③道的由来：引擎升级把 `- id: llm-deepseek` 的插件包名换掉，补丁不同步时该条目 config 被静默忽略（无报错），巡检会"报告落库成功、选择器却显示内置默认名"——**假阳性**。改完补丁务必用 §7 的运行期自查复核，别只信文件。
- **执行 profile 是 headless，不是 web**（2026-09-25 实测纠偏）：面板 spawn 的是 `node <CLI> --profile headless --patch <一次性覆盖层> --json -`，覆盖层由面板 `buildRunOverlay` 现拼（`llm-pi-ai` + `llm-deepseek` 段按 provider/model 求 **web ∪ headless 并集** + `permission` 段）。所以：**headless 侧也有一份 `llm-deepseek` 条目**，改配置真源（web）时若两端的同名嵌套键（如 `reasoningEfforts`）不一致，合并出的覆盖层可能撞 YAML 重复键 → 巡检启动即 `failed to parse overlay`（2026-09-25 11:09/11:10 实测两次）。
- **Codex 侧那条（13:10）不写 profile 补丁、只读它** → 不受"2 分钟并发防护"约束（脚本内仍保留该防护，撞上就只出报告不落库）；必须排在 12:38 那轮之后，才能取到当天最新落库结果。它同样钉 `deepseek-official`：任务正文只读写 `~\.codex\models.json`（+ 兜底补 live 的 `model_catalog_json` 行），**一次都不碰 `.codemoss\config.json`**（CCGUI 私有状态，见 §8），也不碰 opencode-go 的 API。
- **任务 14（13:58）写的是 headless 补丁，不是 web**（2026-10-08 加）：并发防护看的是 headless 文件的 LastWriteTime，web 侧只读；排在任务 13 之后，看到的是当天巡检+能力写回的最终态。**它的提示词里 headless 路径与备份前缀是字面量**（patrolPaths.js 未登记 headless 占位符），环境搬家/路径改名时要手动同步改这条任务的提示词（见坑位区）。

权限与护栏：必须 `danger-full-access`——任务要写会话工作区之外的 `C:\Users\Administrator\.dsh\profiles\web\cordis.patch.yml`，且无人值守没人批权限，`read-only`/`workspace-write` 会在落盘那步被拒。每次落库：备份到 `profiles\web\.bak\cordis.patch.yml.bak-<时间戳>` → 只改自己那条条目的 models → YAML.parse + `pi-ai-schema-check.mjs` schema 校验（见 §9，2026-09-19 加）→ 任一不过立即回滚并报错停手。

维护方法：

- **日报管家面板（实际在跑的那套，2026-09-23 起）**：任务在面板「日报管家 → AI 任务」页管理，实档 = MySQL `daily_panel.ai_task` + `ai_task_schedule`；程序化读写走面板 `:18787/api/aitask/*`（**没有 `/tasks` 这个端点**，写错 404）：
  ```powershell
  xh get :18787/api/aitask/list                     # 列任务(响应字段是 items,不是 tasks)
  xh get :18787/api/aitask/get id=3                 # 单条(2026-10-08 实测返回"任务不存在",传参不被认;字段改从 list 解析)
  xh post :18787/api/aitask/save id=3 prompt=...    # 改正文(未给的字段沿用库中现值)
  xh post :18787/api/aitask/run id=3                # 立即干跑一次(串行队列,一次只跑一个)
  xh get ":18787/api/aitask/logs?task_id=3"         # 运行台账(比自述可靠)
  ```
  改完**回读确认**，别信回话。
- **历史（勿用）**：DSH 桌面端插件调度器 `:13080/api/desktop/dsh-tauri-panel-scheduler/tasks` 2026-09-23 实测已空，搬家后别再往那儿写。
- **引擎自带调度器**：没有 update 工具，改任务 = `scheduler_delete` + `scheduler_create`；实档 `~/.dsh/crons/tasks`（**2026-09-15 起为空**，`scheduler_list` 查的也是它，别当真相）。
- 判断「某轮巡检到底跑了没」：看 `~/.dsh/storages/session_projcache/sessions/` 里 `task-*.json`（旧引擎档）或 `session-*.json`（面板档，`cwd` = `~/.dsh/automations`）的 LastWriteTime 与首条 user message——比任何自述都可靠。

## 已知坑位

- dsh-defend 会拦截任何"带密钥样式"的工具结果与 edit 参数；tool 参数也要避免 `Bearer <token>` 同行。
- **引擎升级会换 bundle 里的插件包名（2026-09-25 实踩）**：补丁同 id 条目的 `name` 必须跟着换（`- id: llm-deepseek` 从 `@deepseek-ai/dsh-llm-deepseek` → `@deepseek-ai/dsh-llm-deepseek-api-key`）。症状 = "文件里明明有别名、选择器却显示引擎内置名、且零报错弹窗"；判据 = `settings/describe` 里该 ns 的 `user` 层（文档层）有你写的值、`value` 层（运行期）是引擎默认值。**升级引擎后先跑 §9 第③道校验，再动配置**；改完用 §7 的运行期自查复核。
- **巡检 CLI 与 GUI 可能不是同一个引擎（2026-09-25 实测）**：`{{DSH_CLI_DIR}}` = `C:\Users\Administrator\node_global\node_modules\@deepseek-ai\dsh`（**0.1.7-alpha.1**，面板 spawn 它跑 headless），GUI 跑的是桌面端 `C:\Users\Administrator\AppData\Roaming\dsh-tauri\dependencies\dsh`（**0.1.7-rc.2**）。两套引擎的 bundle 包名与内置目录可能不同：排查"某条目没生效"前，先确认是哪套引擎在加载它（本技能 `scripts/pi-ai-schema-check.mjs` 的 schema 来源已锚到桌面端引擎并回显路径）。
- 补丁里顶层条目是 `- id: xxx`（0 列），其子键 2 空格起；模型条目缩进比旧 settings.yaml 整体深 2 格（pi-ai：路由键 6 / models 8 / 模型 `- id` 10 / name·input 12 / `- text` 14；deepseek：models 4 / 模型 `- id` 6 / name 8），编辑锚点别带错缩进。
- edit 工具 old_string 需与文件精确一致（含缩进）；多行块编辑比逐行安全。
- 公司网关内网 `192.168.80.248:3000` 在白名单外，无法直连查验，按官网口径（0731/0813=正式版）标注。
- agent-default-model 在 `profiles/web` 与 `profiles/tui` 两个补丁各有一份（旧 settings.yaml 那份已随新架构退役）；面板 AI 任务运行时还会被 `--patch` 覆盖层再压一次。排查顺序：命令行覆盖层 → `profiles/web/cordis.patch.yml` → 插件内置默认。
- dsh-auto-review 审查器 fork 继承会话路由：换默认模型 = 主代理+审查器同时换渠道，反之亦然。
- zhipu key 明文在 `~/.dsh/.credentials.yaml`，补丁里只写 `apiKeyEnv` 变量名；dsh-defend 拦 `sk-`/Bearer 样式，写带 key 配置用"Authorization: Bearer 换行缩进下一行"写法。
- Windows 沙箱受限令牌下 curl 的 schannel 报 `SEC_E_NO_CREDENTIALS`（TLS 挂），抓 https 用 node fetch 更稳；node 脚本写工作区 `_tmp\` 再跑，避免 shell 引号转义。
- **`input:` 模态枚举只有 text/image（2026-09-18 实踩）**：百炼巡检给 omni 模型写 `audio/video` → 整个 `llm-pi-ai` 条目被 schema 拒载 → 6 路由 42 模型从选择器消失且**无报错弹窗**（进程内存留最后有效值，重启才暴露）。YAML.parse 查不出，必须跑 §9 的 schema 校验脚本。
- **schema 过得去、运行期才拒的两类写法（2026-09-27 实测）**：`compat` 写 withhold 字段（`openai-responses`/`anthropic-messages` 各自 withhold 集合见 dsh-llm-pi-ai 的 `RESPONSES_COMPAT_GATE`/`anthropic` gate）与 `reasoningEfforts` 非 `off` 档位写 `null`。判据一句话：schemastery 会**原样保留未知键**，所以 `Config()` 不报错 ≠ 能跑；§9 三道是文件层，第四道（重启 + modelCatalog + 最小请求）才是运行层，见 §8 校验第 9 项。
- **这份补丁还有第二个自动写手:日报管家面板的「模型能力」链**（2026-09-27 记）：每日 13:35 周期 + 任务 13（13:50）收尾时，面板把台账结论写回 **web 与 headless 两份** cordis.patch.yml 的 4 类键（视觉声明/档位映射/上下文长度只补缺/路由级默认档），带 `.bak-cap-` 备份与五重校验、**无差异不写文件**（所以 `.bak` 里平时没有 `.bak-cap-*`）。来源优先级 人工/适配器 > AI官方(ai-research) > 实测(probe) > 清单；机器写回的值带 `written_back_at` 章、不作为下轮基线（不升格 profile），AI 可纠正清单/实测来源的槽位。**巡检任务 4/5/6/7 与它共用并发防护窗口**：巡检落库前看 LastWriteTime 的 2 分钟防护对它同样必要，撞窗就只出报告。上下文声明口径（2026-09-27 统一）：一律十进制 **1M=1000000**，web/headless 两份补丁的原 1048576 二进制写法已全量改齐（同一模型跨渠道数值不再分叉），页面显示「X万 / K|M」双单位、K/M 探测换算同步十进制。
- **协议错与地区错长得不一样，别混（2026-09-27 双探针实测）**：`gpt-6-luna` 走 `/v1/chat/completions` → `400 ModelProtocolUnsupported: Model does not support this protocol.`（**这是配置错，拆 responses 路由能修**）；走 `/v1/responses` → `403 unsupported_country_region_territory`（本机直连出口 **3/3 稳定复现**，`gpt-5.6-luna` 同款；同端点 grok-4.6 / muse-spark-1.3 报的是各自上游错、不是地区）。**这个 403 是上游返回的地区/节点问题，路由拆对了也照样 403** —— 按 §8「间歇 503」同类处理：**别再改路由、别当配置错**，等上游或换出口；官方文档只对 Muse Spark 标了地区限制、没标 GPT Luna，所以更可能是上游侧问题。
- **任务 14 提示词写死 headless 路径（2026-10-08 记）**：占位符表 `services/patrolPaths.js` 没有 headless 条目，对齐任务提示词里 `profiles/headless/cordis.patch.yml` 与备份前缀 `profiles\web\.bak\headless-cordis.patch.yml.bak-` 是字面量——环境搬家先改这条任务正文（面板 `:18787/api/aitask/save`）。另：沙箱/非 tty 下 xh 要加 `--ignore-stdin`，pwsh 传内层双引号要转义（`payload:='{\"args\":{}}'`），`GET /api/aitask/get` 传 id 不被认（返回"任务不存在"），字段从 `list` 解析。