#!/usr/bin/env node
/**
 * zhipu-claude-sync.mjs — CCGUI Claude 供应商模板 ← DSH 智谱 glm flash 口径同步
 *
 * 把 DSH 的智谱渠道模型（llm-pi-ai.providers.zhipu.models）同步进 CCGUI 的 Claude Code
 * 供应商模板（.codemoss\config.json → claude.providers[智谱GLM官网].settingsConfig.env）：
 *   - 四个别名（OPUS/SONNET/FABLE/HAIKU）全挂 glm flash 正式档（Pro 及非 flash 用不起，禁用）
 *   - 端点固定 open.bigmodel.cn/api/anthropic（不一致才改）
 *   - token 模板里已有值一律不动（用户手配）；空值直接报错让人工在 CCGUI 里配
 *
 * 口径（红线）
 *   - 数据源唯一 = ~/.dsh/settings.yaml 的 llm-pi-ai.providers.zhipu.models，本脚本不联网
 *     （zhipu 与 zhipu-htc 两账号模型集合由 glm-智谱巡检保证一致，这里只读主账号）
 *   - 别名值只能取当前口径内的 glm flash id：口径删掉的必须同步从别名清掉，
 *     宁可四别名重合，不准留口径外死 id；Pro 系与预览/实验档不进别名
 *   - 只动目标记录 env 里 4 个别名键 + 必要时 BASE_URL；settings.json 一个字节不碰；
 *     codex 段、deepseek官网 记录、其它供应商、claude.current、providerOrder 逐字节不动
 *   - [1m] 后缀沿用现值（1M 上下文标记）
 *
 * 用法
 *   node zhipu-claude-sync.mjs            预览（零写入）
 *   node zhipu-claude-sync.mjs --apply    备份后落库（并发防护：settings.yaml 2 分钟内被写过则跳过）
 *   node zhipu-claude-sync.mjs --apply --force   忽略并发防护
 *
 * 退出码：0 = 成功（含"无变化"与"并发跳过"）；1 = 校验失败或被插件回写冲掉
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const HOME = os.homedir();

const SETTINGS = path.join(HOME, '.dsh', 'settings.yaml');
const CODEMOSS = path.join(HOME, '.codemoss', 'config.json');
const BACKUP_DIR = path.join(HOME, '.dsh', 'backup', 'ccgui-claude');
const PROVIDER_ID = '655afdfe-a637-414a-9969-9d4f5dd4086d'; // claude 段里 name = 智谱GLM官网 的记录
const PROVIDER_NAME = '智谱GLM官网';
const BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
const GUARD_MS = 2 * 60 * 1000;
const ALIAS_KEYS = [
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL'
];

const log = (...a) => console.log(...a);

/** DSH checkout 里的 yaml 依赖（与 codex-opencode-sync.mjs 同款） */
function loadYaml() {
    const cands = [
        'C:/Users/Administrator/node_global/node_modules/@deepseek-ai/dsh/package.json',
        path.join(HOME, 'node_global/node_modules/@deepseek-ai/dsh/package.json')
    ];
    for (const c of cands) {
        if (fs.existsSync(c)) return createRequire(c)('yaml');
    }
    throw new Error('找不到 DSH checkout 里的 yaml 依赖，无法解析 settings.yaml');
}

/** 从 startIdx 起找配对的大括号区间（跳过字符串内括号） */
function objectSpan(text, startIdx) {
    const open = text.indexOf('{', startIdx);
    if (open < 0) throw new Error('找不到 {');
    let depth = 0;
    let inStr = false;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            if (c === '\\') i++;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return { open, close: i };
        }
    }
    throw new Error('大括号不配对');
}

// ---------------------------------------------------------------- 1. 读数据源
const settingsRaw = fs.readFileSync(SETTINGS, 'utf8');
const settingsMtime = fs.statSync(SETTINGS).mtime;
const doc = loadYaml().parse(settingsRaw);
const models = doc?.['llm-pi-ai']?.providers?.zhipu?.models;
if (!Array.isArray(models) || models.length === 0) {
    throw new Error('settings.yaml 里 llm-pi-ai.providers.zhipu.models 为空/缺失，中止（疑似口径异常）');
}

// 选 flash 档：排除 Pro 与预览/实验档；多个候选时取 id 版本号最大的（5.3 > 5.2 > 5.1）
const isPro = (m) => /pro/i.test(m.id || '') || /Pro/.test(m.name || '');
const isPreview = (m) => /预览/.test(m.name || '') || /-exp/.test(m.id || '');
const flashCandidates = models
    .filter((m) => /flash/i.test(m.id || '') || /flash/i.test(m.name || ''))
    .filter((m) => !isPro(m) && !isPreview(m));
if (flashCandidates.length === 0) throw new Error('智谱口径里没有可用的 glm flash 正式档，中止（不写盘）');
const FLASH = flashCandidates.slice().sort((a, b) => String(b.id).localeCompare(String(a.id)))[0];
const flashIds = new Set(flashCandidates.map((m) => m.id));
if (!flashIds.has(FLASH.id)) throw new Error('flash 选档自检失败，中止');

log('=== 数据源 ===');
log(SETTINGS, '| mtime =', settingsMtime.toLocaleString());
log(`智谱 zhipu 共 ${models.length} 条 → flash 可用 ${flashCandidates.length} 条（Pro/预览已排除）`);
log('flash 选档 =', FLASH.id, '（', FLASH.name, '）');

// ---------------------------------------------------------------- 2. 读目标记录
const cfgRaw = fs.readFileSync(CODEMOSS, 'utf8');
const cfgObj = JSON.parse(cfgRaw); // 只读校验用
const provider = cfgObj?.claude?.providers?.[PROVIDER_ID];
if (!provider) throw new Error('config.json 里找不到 provider ' + PROVIDER_ID + '（记录可能被改名/删除，人工确认）');
if (provider.name !== PROVIDER_NAME) throw new Error(`记录 ${PROVIDER_ID} 的 name 是「${provider.name}」，不是「${PROVIDER_NAME}」，中止`);
const env = provider?.settingsConfig?.env;
if (!env || typeof env !== 'object') throw new Error('目标记录缺 settingsConfig.env，结构变化，中止');

// [1m] 后缀沿用现值（四个别名共用同一约定）
const suffix = ALIAS_KEYS.some((k) => typeof env[k] === 'string' && env[k].endsWith('[1m]')) ? '[1m]' : '';
const target = FLASH.id + suffix;

const changes = {};
for (const k of ALIAS_KEYS) if (env[k] !== target) changes[k] = [env[k], target];
if (env.ANTHROPIC_BASE_URL !== BASE_URL) changes.ANTHROPIC_BASE_URL = [env.ANTHROPIC_BASE_URL, BASE_URL];

if (typeof env.ANTHROPIC_AUTH_TOKEN !== 'string' || env.ANTHROPIC_AUTH_TOKEN.length === 0) {
    throw new Error('模板 token 为空：请人工在 CCGUI 供应商管理里配置智谱密钥（本脚本不代写密钥）');
}

log('--- 别名 diff（旧 → 新）---');
const keys = Object.keys(changes);
if (keys.length === 0) {
    log('  无变化（四别名与端点均已达标）');
} else {
    for (const k of keys) log(`  ${k}: ${changes[k][0]} → ${changes[k][1]}`);
}

// ---------------------------------------------------------------- 3. 字节级手术（只动目标记录 span）
// 定位 providers 表里的记录键（区别于 claude.current 的同名值，要求键后面跟对象）
const keyRe = new RegExp(`"${PROVIDER_ID}"\\s*:\\s*\\{`);
const keyMatch = keyRe.exec(cfgRaw);
if (!keyMatch) throw new Error('config.json 里找不到记录键（结构变化，中止）');
const { open, close } = objectSpan(cfgRaw, keyMatch.index);
let span = cfgRaw.slice(open, close + 1);
const before = span;
for (const [k, [, newV]] of Object.entries(changes)) {
    const re = new RegExp(`("${k}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
    if (!re.test(span)) throw new Error('目标记录 span 内找不到键 ' + k + '，中止');
    span = span.replace(re, `$1${JSON.stringify(newV)}`);
}
const next = cfgRaw.slice(0, open) + span + cfgRaw.slice(close + 1);

// ---------------------------------------------------------------- 4. 落库前校验
const nextObj = JSON.parse(next); // 可解析
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nextEnv = nextObj?.claude?.providers?.[PROVIDER_ID]?.settingsConfig?.env;
const otherProvidersOk = Object.keys(cfgObj.claude.providers)
    .filter((id) => id !== PROVIDER_ID)
    .every((id) => same(cfgObj.claude.providers[id], nextObj.claude.providers[id]));
const preChecks = {
    '根键集合与顺序不变': same(Object.keys(cfgObj), Object.keys(nextObj)),
    'codex 段逐字节一致': cfgRaw.slice(cfgRaw.indexOf('"codex"')) === next.slice(next.indexOf('"codex"')) || same(cfgObj.codex, nextObj.codex),
    'claude.current / providerOrder 未变': cfgObj.claude.current === nextObj.claude.current &&
        same(cfgObj.claude.providerOrder ?? null, nextObj.claude.providerOrder ?? null),
    '其它供应商（含 deepseek官网）逐字节一致': otherProvidersOk,
    '非目标 env 键不变（token/effort 等）': same(
        { ...env, ANTHROPIC_BASE_URL: '', ...Object.fromEntries(ALIAS_KEYS.map((k) => [k, ''])) },
        { ...nextEnv, ANTHROPIC_BASE_URL: '', ...Object.fromEntries(ALIAS_KEYS.map((k) => [k, ''])) }
    ),
    '四别名 = flash 选档且不含 Pro/口径外 id': ALIAS_KEYS.every((k) => nextEnv[k] === target) &&
        !/pro/i.test(target) && flashIds.has(target.replace(/\[1m\]$/, '')),
    '端点正确': nextEnv.ANTHROPIC_BASE_URL === BASE_URL,
    'span 外逐字节未动': next.slice(0, open) === cfgRaw.slice(0, open) && next.slice(close + 1) === cfgRaw.slice(close + 1),
    '目标 span 只变了预期行': keys.length === 0 || span !== before
};
log('--- 落库前校验 ---');
let ok = true;
for (const [k, v] of Object.entries(preChecks)) {
    log((v ? '  PASS  ' : '  FAIL  ') + k);
    if (!v) ok = false;
}
if (!ok) { log('校验未全过，未写入任何文件'); process.exit(1); }

if (!APPLY) { log('预览模式，零写入。加 --apply 落库。'); process.exit(0); }
if (keys.length === 0) { log('无变化，不写盘。'); process.exit(0); }

// ---------------------------------------------------------------- 5. 并发防护 + 写入 + 回读
const since = Date.now() - settingsMtime.getTime();
if (!FORCE && since < GUARD_MS) {
    log(`检测到并发写：settings.yaml ${Math.round(since / 1000)} 秒前被写过（<2 分钟），本轮跳过落库，只出报告。`);
    process.exit(0);
}

const stamp = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const bak = path.join(BACKUP_DIR, `config.json.bak-${stamp}`);
fs.writeFileSync(bak, cfgRaw, 'utf8');
const mtimeBefore = fs.statSync(CODEMOSS).mtime.toLocaleString();
fs.writeFileSync(CODEMOSS, next, 'utf8');
log('已落库:', CODEMOSS);
log('备份:', bak);
log('config.json mtime:', mtimeBefore, '→', fs.statSync(CODEMOSS).mtime.toLocaleString());

// 回读：确认我们的值还在（IDEA 开着时插件可能立刻用内存态回写冲掉）
const after = fs.readFileSync(CODEMOSS, 'utf8');
const afterEnv = (() => {
    try { return JSON.parse(after)?.claude?.providers?.[PROVIDER_ID]?.settingsConfig?.env; }
    catch { return null; }
})();
const landed = afterEnv && ALIAS_KEYS.every((k) => afterEnv[k] === target);
if (!landed) {
    log('✗ 回读失败：写入后目标值丢失——大概率被 IDEA 插件内存态回写覆盖。建议关 IDEA 或稍后重跑。');
    process.exit(1);
}
log('回读校验: PASS（去 CCGUI 供应商管理 → Claude 页签 → 智谱GLM官网 → 保存/应用 后才写入 settings.json 生效）');
