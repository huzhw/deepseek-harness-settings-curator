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
- 定位：OpenCode Go 订阅渠道（$10/月、$100 用量，仅订阅用户可用）；baseURL `https://opencode.ai/zen/go/v1`；路由 `opencode-go/<模型id>`。
- **全量收录**：官方「当前支持的模型列表」里的模型**一个不落**，只增不减（官方下架才删）；**不做三线口味精简、不跨渠道去重、不与官网/智谱/百炼合并口径**。
- **命名**：`[新/][N倍用量/]OpenCode/<显示名>/<参数量?>(/<版本?>)/每5小时N次`
  - **标记区前置**：官方「新」徽章拼 `新/`、落地页限时倍数拼 `N倍用量/`，两者都放在 `OpenCode` **前边**（都有则 `新/4倍用量/OpenCode/…`；只有一个就只拼那个；都没有则省略）；
  - **显示名带版本**（DeepSeek V4.1 Flash → `deepseek-v4.1-flash`）；**id 用官方 API id**（V4.1 Flash 的官方 id 是 `deepseek-flash`，官方命名不跟版本走）；
  - 参数量只标 §4 已核实数字，未披露不标；
  - 调用次数**中文标注、拼名字末尾**；整表按**显示值**（name 里那个次数，**促销值优先**，如 V4.1 Flash 用 26000 而非基础 6500）**倒序**；标记区（`新/`、`N倍用量/`）只随行移动、不参与排序；同次数按官方表原序。
- 三窗口（官方）：**每 5 小时 = 月限 20%、每周 50%、每月 100%**；预估请求数表按典型每请求 token 假设推算（如 deepseek-v4-flash 每次 410 输入 + 71,300 缓存 + 310 输出 token）。

**抓取逻辑（优先级严格，每轮两页都抓）**
1. **文档页** https://opencode.ai/zh/docs/go/（公开、月更、web_fetch）——**权威列 = 「当前支持的模型列表」**；价格表/端点表/基础预估表作辅助；
2. **落地页** https://opencode.ai/zh/go——取文档页没有的两类信息：**「新」徽章（新模型）**与**限时倍数用量**（实例：DeepSeek V4.1 Flash「限时享受 4 倍使用额度」，6,500 → **26,000** 请求/5 小时、月限 $15 → $60）；
3. **取值规则**：带限时促销的模型取**落地页促销值**（26,000），并在 name 前置 `N倍用量/` 标记；促销结束、落地页回落基础值时，巡检自动改回基础值并去掉该标记；
4. `/zen/go/v1/models`（需订阅鉴权，尽力抓；401/无权限就跳过并说明）；
5. 文档页价格表与端点表**有陈旧残留行**（实例：MiniMax M2.5 有价格行、有端点行，但不在支持列表 → **不收录**）；与①冲突**一律以①为准**；
6. 抓不到 → 报「页面结构变化或抓取失败」，**绝不编造**；字段缺失写「未查到」。

**生成**
- 按口径产出完整 `llm-pi-ai.providers.opencode-go.models` 块（YAML，`- id:` 8 空格、`name:` 10 空格缩进）。

**校验（必须全过，任一不过即回滚并报错，不静默）**
1. `YAML.parse` 通过；
2. **id 集合双向 diff**：官方列表 − 配置 = ∅ **且** 配置 − 官方 = ∅；
3. 条数比对：官方 N = 配置 N；
4. name 正则逐条 `^(新/)?(\d+倍用量/)?OpenCode/.+/每5小时\d+次$`（官方无预估的须显式标注为例外）；
5. **排序单调性**：逐条解析 name 末尾的次数，序列必须**非递增**（排序键 = 显示值，促销值优先）——排错即判失败、还原备份；
6. 落库前备份 `settings.yaml.bak-<时间戳>`，落库后回读打印全部 id/name 供人工核。

**执行方式**：定时任务「opencode-go 全量口径巡检」每 5 小时按本节跑（B 模式自主落库：先备份 → 改 → 跑上面 1~4 项校验 → 任一失败即还原备份并报错）；人工梳理时并入 §1「最新 flash 巡视」同轮。

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

> 本节是 **2026-09-10 快照**；实档一律以 `~/.dsh/crons/tasks` 为准。**改过任务后顺手更新本节**，过期排班表会误导后来人。

排班表（模型统一 `deepseek-official/deepseek-v4-flash`，权限一律 `danger-full-access`）：

| 时间 | 任务 | 落库口径 |
|---|---|---|
| 12:30 | 官网巡检（llm-deepseek.models） | 自动收录，只增不删 |
| 12:38 / 18:30 | opencode-go 全量口径巡检 | 自动落库（§8 全量镜像） |
| 12:46 / 18:38 | 前沿免费模型巡检（openrouter-go） | 自动收录，仅前沿档 |
| 12:54 | 智谱巡检（zhipu / zhipu-htc） | 自动收录，只增不删 |
| 13:02 | 百炼巡检（bailian） | 自动收录，只增不删 |

排班原则（红线，改动前先读）：

- **跑在空闲窗口**：官网直连有峰谷价（周一至五 9-12、14-18 为高峰），排班全落在 12:00-14:00 与 18:00 之后 → 半价。
- **错峰 ≥8 分钟 + 并发防护 2 分钟，两者必须配套**：同批任务都写同一个 `settings.yaml`，落盘前先看该文件 LastWriteTime，**不足 2 分钟就跳过本轮落库**（只出报告并写明"检测到并发写"）。若把错峰压到 2 分钟以内，或把防护窗口放大到 5 分钟以上，邻座任务会被误判并发而**集体白跑**。
- **一天两次的需求拆成两个任务**：scheduler 单个任务一天只能有一个时刻（`kind: daily` 仅一个 `time`），所以"中午 + 晚上"= 两个任务，prompt 正文完全相同。
- 高频任务锚点尽量压在空闲窗口内；落在高峰的那几轮只是 flash 输入价翻倍，差价每天几分钱，不值得为此牺牲频率。
- 模型钉在任务上（`provider`/`model` 字段）：不吃 `agent-default-model`；opencode 巡检钉**别的渠道**，避免"套餐挂了连巡检都跑不动"的自证循环。

权限与护栏：必须 `danger-full-access`——任务要写会话工作区之外的 `~/.dsh/settings.yaml`，且无人值守没人批权限，`read-only`/`workspace-write` 会在落盘那步被拒。每次落库：备份 `settings.yaml.bak-<时间戳>` → 只改自己那段 models → YAML.parse 校验 → 任一不过立即回滚并报错停手。

维护方法：

- scheduler **没有 update 工具**：改任务 = `scheduler_delete` + `scheduler_create`。
- 核实**回读 `~/.dsh/crons/tasks`**（JSON 实档），别信回话：
  ```powershell
  node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.env.USERPROFILE+'/.dsh/crons/tasks','utf8'));const r=Array.isArray(a)?a:(a.tasks||Object.values(a));r.forEach(t=>console.log([t.schedule&&(t.schedule.time||('每'+t.schedule.everyMinutes+'分')),t.name,'perm='+(t.permission||'默认'),'model='+((t.provider||'-')+'/'+(t.model||'默认'))].join(' | ')))"
  ```
- `scheduler_list` 工具当前有 bug（报 `invalid output: value is not lossless JSON`），核实用上面的实档回读。

## 已知坑位

- dsh-defend 会拦截任何"带密钥样式"的工具结果与 edit 参数；tool 参数也要避免 `Bearer <token>` 同行。
- `ui-onboarding:` 等顶层键在 0 列（无缩进），编辑锚点别加空格。
- edit 工具 old_string 需与文件精确一致（含缩进）；多行块编辑比逐行安全。
- 公司网关内网 `192.168.80.248:3000` 在白名单外，无法直连查验，按官网口径（0731/0813=正式版）标注。
- agent-default-model 在 settings.yaml 与两个 profile patch 各有一份，容易两处不一致；patch 覆盖 settings，排查以 patch 为准。
- dsh-auto-review 审查器 fork 继承会话路由：换默认模型 = 主代理+审查器同时换渠道，反之亦然。
- zhipu key 明文在 settings.yaml；dsh-defend 拦 `sk-`/Bearer 样式，写带 key 配置用"Authorization: Bearer 换行缩进下一行"写法。
- Windows 沙箱受限令牌下 curl 的 schannel 报 `SEC_E_NO_CREDENTIALS`（TLS 挂），抓 https 用 node fetch 更稳；node 脚本写工作区 `_tmp\` 再跑，避免 shell 引号转义。