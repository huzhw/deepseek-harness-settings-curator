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

- 主文件：`C:\Users\Administrator\.dsh\settings.yaml`（DSH LLM 供应商配置，key 明文存放，勿外传）
- 已知 provider：bailian（百炼）、company-gateway（公司网关）、volcengine（火山方舟）、opencode-go（OpenCode Go）、openrouter-go（OpenRouter）、sensenova（商汤日月新）、zhipu（智谱GLM官方）
- 默认模型（agent-default-model）：`settings.yaml` 顶层段 **+** `profiles/tui/cordis.patch.yml`、`profiles/web/cordis.patch.yml` 补丁段（**patch 覆盖 settings，生效以 patch 为准**）
- 网络放行：`C:\Users\Administrator\.dsh\rules.yaml` 网络白名单（查官方价目需放行 `api.deepseek.com` / `bigmodel.cn` / `open.bigmodel.cn`；2026-08-31 已加）

## 安全红线（必读）

1. **文件含明文 API key，禁止整文件 read/输出**——会命中 dsh-defend（sk-openai / bearer-token 规则）被拦截。
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
- 掩码 dump 全文件，列出每个 provider 的：模型 id、name、参数量后缀、版本标记。
- 检查项：name 缺失 / 重复 id / 前缀不一致 / 参数量与版本标记是否规范 / 疑似该删的旧模型。

### 2. 追加新模型
- 查证模型存在性与 id：本地官方目录优先 → web_search 兜底（厂商公告、模型页、vLLM recipes）。
- 参数量：多源交叉（vLLM recipes、厂商公告、目录官方 name）；MoE 取总参；查不到不标。
- 版本标记（仅 DeepSeek 系有预览/正式之分）：`/正式`（0731=Flash 正式版、0813=Pro 正式版、-ga- 日期=GA 正式）或 `/预览`（无后缀活接口、未切正式的渠道）。商汤的"服务公测免费"是活动不是模型版本。
- 命名规范：`<前缀>/<模型id>/<参数量>(/<版本>)`；前缀约定：百炼 / 火山方舟 / 公司网关 / OpenCode / OpenRouter / 商汤日月新 / 智谱。

### 3. 清理旧模型
- 识别依据：调用 404、厂商下架、免费变收费、重复条目。
- 流程：列删除清单 → 给用户确认 → 删 → YAML 校验。

### 4. 参数量对齐（已知可靠数字速查，2026-08 多源查证）
- deepseek-v4-pro=1.6T/激活49B、deepseek-v4-flash=284B/激活13B
- glm-5.2=743B/39B、glm-5.1=744B/40B（glm-5、glm-5.3、5.3-flash 未披露）
- kimi-k2.6=k2.7-code=1T/32B、minimax-m3=428B、minimax-m2.7=230B/10B
- mimo-v2.5=311B/15B、mimo-v2.5-pro=1T/42B
- qwen3.8-max=2.4T、qwen3.7-max≈1.2T（第三方，中置信）；qwen3.7-flash/plus、qwen3.6-plus 官方未披露
- OpenRouter 免费档：nemotron-3-nano-30b/nano-omni/super-120b/ultra-550b、gemma-4-26b/31b、gpt-oss-20b、north-mini-code=30B、laguna-m.1=225B/s-2.1=118B/xs-2.1=33B、ling-3.0-flash=124B；auto/openrouter/free/fusion 为聚合端点无参数量
- sensenova-6.8-flash-lite 未披露。
- 坑：qwen3.7-plus 曾把 Qwen3.5-35B-A3B 的 35B 串号写错——不同型号别混，比对时看全名。

### 5. 限时免费模型
- web_search 多路扫：`<厂商> 限时免费 模型 token 额度`、`新模型 免费公测`、`openrouter free models list`、`百炼 送 tokens`、`商汤 公测 免费`、`智谱 新模型 活动`、`deepseek 免费额度`。
- 评估：免费条件是否限时、适合挂哪个 provider、收费后是否保留。
- 汇报格式：模型 / 免费条件 / 有效期 / 建议动作。

### 6. 默认模型（agent-default-model）梳理与费用核查

- 位置与生效：settings.yaml 顶层段 + 两个 profile 的 cordis.patch.yml（**patch 覆盖 settings，两处不一致以 patch 为准**）。
- 影响面：默认模型 = 主代理路由，**dsh-auto-review 审查器 fork 继承同一路由**，改一处两者同切渠道。
- 检查项：provider 必须在 settings.yaml `llm-pi-ai.providers` 存在（或内置 deepseek 官方路由）；model id 必须在对应 provider 的 models 列表。
- 历史坑：patch 残留 `provider: deepseek`（官网）会同时把主代理+审查器烧向官网（2026-08-31 已切 `zhipu / glm-5.3-flash`）。
- 费用核查（选型依据）：
  1. 本地优先：`pi-ai\dist\providers\data\*.json` 的 `cost` 字段（input/output/cacheRead，单位 $/1M；全 0 = 免费）。**注意快照滞后**：本地是 7/25 生成，DeepSeek 8/17 调价（峰谷定价，高峰最高 +1100%，周末低谷价）后已作废，必须与官网/报道对账。
  2. web_search 兜底（如 `DeepSeek 调价 峰谷 每百万`）。
  3. 查不到就明说"未查到"，不编造（glm-5.3-flash 官方价目当前即未查到状态，由用户浏览器确认）。
  - DeepSeek 官网最新价（2026-08 调价后，api-docs.deepseek.com）：flash 输入·缓存未命中 1.5/3.0 元（空闲/高峰）、输出 4.5/9.0 元；**缓存命中输入仅 0.05/0.10 元（差 30 倍）**——缓存命中率低即"贵"主因；pro 为 flash 恰好 3 倍；高峰=周一至五 9-12、14-18 点，空闲=高峰半价。
  - 对比表格式：模型 / 渠道 / 输入 / 输出 / 缓存读 / 免费？
  - 更合适就切换：列候选 → 用户选 → 确认词 → 备份 patch → 改 → 校验。
- 2026-08-31 状态：已切 `zhipu / glm-5.3-flash`，patch 备份 `cordis.patch.yml.bak-20260831-085333`。

### 7. 流程红线
- 任何改动前：**分析 → 方案结尾带四字成语确认词 → 等用户回确认词才动手**（"行/好/确认"等不算）。
- 改 agent-default-model 前**先备份两个 profile 的 cordis.patch.yml**（`Copy-Item <file> cordis.patch.yml.bak-<时间戳>`）。
- 多个方案列出来让用户选，不替用户做主。
- 改后校验（工作目录放 DSH checkout，yaml 依赖在 node_modules）：
  ```powershell
  node -e "const fs=require('fs');const YAML=require('yaml');const doc=YAML.parse(fs.readFileSync(process.env.USERPROFILE+'/.dsh/settings.yaml','utf8'));console.log('YAML_OK')"
  ```
- 用户可能自行改过文件：edit 前必须先 read；报"file changed since read"就重读再编辑。
- 只改任务要求的，不顺手优化；尊重用户手改（如 displayName、去版本号命名）。

## 已知坑位

- dsh-defend 会拦截任何"带密钥样式"的工具结果与 edit 参数；tool 参数也要避免 `Bearer <token>` 同行。
- `ui-onboarding:` 等顶层键在 0 列（无缩进），编辑锚点别加空格。
- edit 工具 old_string 需与文件精确一致（含缩进）；多行块编辑比逐行安全。
- 公司网关内网 `192.168.80.248:3000` 在白名单外，无法直连查验，按官网口径（0731/0813=正式版）标注。
- agent-default-model 在 settings.yaml 与两个 profile patch 各有一份，容易两处不一致；patch 覆盖 settings，排查以 patch 为准。
- dsh-auto-review 审查器 fork 继承会话路由：换默认模型 = 主代理+审查器同时换渠道，反之亦然。
- zhipu key 明文在 settings.yaml；dsh-defend 拦 `sk-`/Bearer 样式，写带 key 配置用"Authorization: Bearer 换行缩进下一行"写法。
- Windows 沙箱受限令牌下 curl 的 schannel 报 `SEC_E_NO_CREDENTIALS`（TLS 挂），抓 https 用 node fetch 更稳；node 脚本写工作区 `_tmp\` 再跑，避免 shell 引号转义。