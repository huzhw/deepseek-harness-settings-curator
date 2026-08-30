# settings.yaml 模型配置梳理

> **适用平台：DeepSeek Harness（DSH）** —— 维护 `C:\Users\Administrator\.dsh\settings.yaml`。DSH 消费端（`~/.dsh/skills`）为第一使用场景，同时兼容挂载到 Claude Code 技能目录。

定期维护 `C:\Users\Administrator\.dsh\settings.yaml` 的 LLM 供应商模型配置：追加新模型、清理旧模型、参数量与版本对齐、找限时免费模型。

## 相关技能

- [git-commit](https://github.com/huzhw/git-commit-skill)：Git 提交规范
- [coding-rules](https://github.com/huzhw/coding-rules)：AI 编码协作规范
- [reread-claude-md](https://github.com/huzhw/reread-claude-md-skill)：重新加载 CLAUDE.md 规则
- [daily-record](https://github.com/huzhw/daily-record-skill)：日报记录
- [daily-merge](https://github.com/huzhw/daily-merge-skill)：日报合并
- [code-check](https://github.com/huzhw/code-check-skill)：增量代码隐患检查
- [token-3000](https://github.com/huzhw/token-3000-skill)：API Token 切换

---

## 解决了什么问题

settings.yaml 是 DSH 所有 LLM 供应商的配置源（key 明文），模型一多就乱：

- 新模型上线（GLM-5.3、DeepSeek V4 正式版…）不知道该不该加、加哪个 id
- 旧模型 404 / 下架 / 免费变收费没人管
- 参数量写错（qwen3.7-plus 曾把人家的 35B 串号写上去）
- 版本口径混（DeepSeek 有预览/正式两档，GLM 没有，商汤"公测"是活动不是版本）
- 各厂商限时免费/送额度漏捡

这个技能把整套维护流程固化下来，每次调用按固定步骤走，不再靠记忆和临场翻车。

## 核心能力

- **梳理**：掩码安全读配置，检查 name/重复/前缀/参数量/版本标记
- **追加新模型**：本地 pi-ai 官方目录 + web_search 双源查证，命名统一 `前缀/模型id/参数量(/版本)`
- **清理旧模型**：404/下架/免费变收费识别，确认后删除
- **参数对齐**：查不到不写，MoE 取总参，内置已核实数字速查表
- **限时免费**：web_search 扫各厂商免费公测/送额度，评估落库

## 使用

触发词（任选）：`梳理配置`、`梳理模型`、`追加模型`、`清理模型`、`限时免费`、`参数对齐`、`settings.yaml`。

## 安全性

- **密钥红线**：文件含明文 key，禁止整文件输出；查看必须掩码/分段
- **确认词流程**：任何改动前出方案带四字成语确认词，用户回词才动手
- **查证原则**：参数量/版本/免费状态没有可靠来源就不写，明说"未查到"

## 文件结构

```
settings-curator/
├── SKILL.md                        ← 技能定义（工作流）
├── README.md                       ← 本文档
└── JUNCTION说明.md                  ← Junction 挂接说明
```

## 安装

两端已在消费端目录建好 Junction（本仓库为唯一数据源）：

```bash
C:\Users\Administrator\.claude\skills\settings-curator
C:\Users\Administrator\.dsh\skills\settings-curator
```

## 许可

MIT