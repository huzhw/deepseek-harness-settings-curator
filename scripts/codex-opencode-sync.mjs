#!/usr/bin/env node
/**
 * codex-opencode-sync.mjs — Codex 侧 opencode-go 模型口径同步
 *
 * 把 DSH 的 opencode-go 渠道模型（DeepSeek 全系 + GLM 全系）同步到 Codex 侧三处：
 *   ① ~/.codex/models.json            Codex 模型目录（model_catalog_json 指向）
 *   ② ~/.codemoss/config.json         Codemoss 里 codex provider 的 configToml 模板 + customModelContextWindows.codex（claude 段不碰）
 *   ③ ~/.codex/config.toml            live 配置：默认模型行 + model_catalog_json 行兜底
 *
 * 口径（红线）
 *   - 数据源唯一 = ~/.dsh/settings.yaml 的 llm-pi-ai.providers.opencode-go.models，本脚本不联网
 *   - 收录集合 = id 匹配 ^(deepseek|glm) 且含 flash 的条目（只留 GLM flash + DeepSeek flash，Pro 及其它档用不起，2026-09-10 收紧）
 *   - slug = 官方 API id 原样；display_name = 照抄 DSH 的 name 整串（别名与 DSH 一致）
 *   - 排序 = 按 name 末尾「每5小时N次」的次数倒序，同次数按 settings.yaml 原序
 *   - 默认模型 = DeepSeek 系里次数最大的那一条的官方 id（codemoss 模板与 live config.toml 同时写，并加注释标记）
 *   - claude 段 / ~/.claude 下任何文件：一律逐字节不动
 *
 * 用法
 *   node codex-opencode-sync.mjs           预览（零写入）
 *   node codex-opencode-sync.mjs --apply   备份后落库（并发防护：settings.yaml 2 分钟内被写过则跳过）
 *   node codex-opencode-sync.mjs --apply --force   忽略并发防护
 *
 * 退出码：0 = 成功（含"无变化"与"并发跳过"）；1 = 校验失败已回滚
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
// 🔴 默认「只读巡检」.codemoss/config.json：CCGUI（idea-claude-code-gui 插件）把托管供应商记录
//    用 appliedProviderRevision（MessageDigest）盖了章，外部改写 configToml 会让插件重算的
//    providerRevision 对不上 → "已应用"状态失效 → 报 error.codexLocalAccessNotAuthorized
//    （"尚未配置 AI 供应商或未授权使用本地配置"）。2026-09-10 实踩，故默认不写。
const WRITE_CODEMOSS = process.argv.includes('--write-codemoss');
const HOME = os.homedir();

const SETTINGS = path.join(HOME, '.dsh', 'settings.yaml');
const CATALOG = path.join(HOME, '.codex', 'models.json');
const CODEMOSS = path.join(HOME, '.codemoss', 'config.json');
const CODEX_TOML = path.join(HOME, '.codex', 'config.toml');
const CONCURRENCY_GUARD_MS = 2 * 60 * 1000;

const DEFAULT_MODEL_FAMILY = /^deepseek/; // 默认模型只从 DeepSeek 系里挑
const PICK = /^(deepseek|glm)/i;          // 渠道家族：DeepSeek / GLM
const FLASH_ONLY = /flash/i;              // 2026-09-10 收紧：只留 flash 档，Pro 及其它档用不起
const CATALOG_DESCRIPTION = 'OpenCode Go 套餐接入；名称口径与 DSH settings.yaml 一致';
const BASE_INSTRUCTIONS =
    'You are Codex, a precise coding agent. Complete tasks directly with minimal edits, ' +
    "follow the repository's existing style, and verify changes before finishing.";
const LEVELS = [
    { effort: 'none', description: '快速响应：不推理直接回答，速度最快，适合简单任务' },
    { effort: 'low', description: '基础推理：轻量推理，快速但较粗略' },
    { effort: 'medium', description: '平衡思考：推理强度适中，速度与质量兼顾' },
    { effort: 'high', description: '深度推理：分析更全面，耗时更长' },
    { effort: 'max', description: '最大推理：最高强度，效果最好但最慢' }
];

const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- 工具
/** DSH checkout 里的 yaml 依赖 */
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

/** name 末尾「每5小时N次」的次数；取不到 -1 */
function tailCount(name) {
    const m = /每5小时([\d,]+)次/.exec(name || '');
    return m ? Number(m[1].replace(/,/g, '')) : -1;
}

/** name 里的显示名段：'新/4倍用量/OpenCode/deepseek-v4.1-flash/预览/每5小时26000次' → 'deepseek-v4.1-flash' */
function displaySeg(name) {
    const rest = (name || '').split('OpenCode/')[1] || '';
    return rest.split('/')[0] || '';
}

/** name 里的标记段：'新/4倍用量/' → ['新','4倍用量'] */
function marks(name) {
    const pre = (name || '').split('OpenCode/')[0] || '';
    return pre.split('/').filter(Boolean);
}

/** 统一换行风格 */
function eolOf(raw) {
    return raw.includes('\r\n') ? '\r\n' : '\n';
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

/** 从文本里取 JSON 字符串字面量的原始转义串（含引号） */
function jsonStringLiteral(text, keyIdx) {
    const start = text.indexOf('"', keyIdx);
    let i = start + 1;
    while (i < text.length) {
        const c = text[i];
        if (c === '\\') i += 2;
        else if (c === '"') return { raw: text.slice(start, i + 1), start, end: i + 1 };
        else i++;
    }
    throw new Error('字符串未闭合');
}

// ---------------------------------------------------------------- 1. 读数据源
const YAML = loadYaml();
const settingsRaw = fs.readFileSync(SETTINGS, 'utf8');
const settingsMtime = fs.statSync(SETTINGS).mtime;

const doc = YAML.parse(settingsRaw);
const allModels = doc['llm-pi-ai'].providers['opencode-go'].models;
const picked = allModels
    .map((m, i) => ({ ...m, _i: i, _n: tailCount(m.name) }))
    .filter((m) => PICK.test(m.id) && FLASH_ONLY.test(m.id))
    .sort((a, b) => b._n - a._n || a._i - b._i);

if (picked.length === 0) throw new Error('opencode-go 里没有命中 deepseek/glm 的 flash 条目，中止（疑似 settings.yaml 异常）');

const defaultEntry = picked.filter((m) => DEFAULT_MODEL_FAMILY.test(m.id)).sort((a, b) => b._n - a._n)[0];
if (!defaultEntry) throw new Error('DeepSeek 系里没有条目，无法确定默认模型，中止');
const DEFAULT_MODEL = defaultEntry.id;

const markParts = marks(defaultEntry.name);
const markLine =
    '# 默认模型 = opencode-go 调用次数最大的 DeepSeek 档：' +
    displaySeg(defaultEntry.name) +
    '（' +
    [markParts.join(' · '), `${defaultEntry._n.toLocaleString('en-US')} 次/5h`, `官方 id ${defaultEntry.id}`]
        .filter(Boolean)
        .join(' · ') +
    '）';

log('=== 数据源 ===');
log(SETTINGS, '| mtime =', settingsMtime.toLocaleString());
log(`opencode-go 共 ${allModels.length} 条 → 命中 deepseek/glm flash ${picked.length} 条`);
picked.forEach((m, i) => log(`  ${String(i + 1).padStart(2)}. ${m.id.padEnd(30)} ${String(m._n).padStart(6)} 次/5h  ${m.name}`));
log('默认模型（次数最大的 DeepSeek 档）=', DEFAULT_MODEL);
log('标记注释 =', markLine);

// ---------------------------------------------------------------- 2. 生成 models.json
const buildEntry = (m) => ({
    slug: m.id,
    display_name: m.name,
    description: CATALOG_DESCRIPTION,
    base_instructions: BASE_INSTRUCTIONS,
    default_reasoning_level: 'medium',
    supported_reasoning_levels: LEVELS,
    shell_type: 'unified_exec',
    visibility: 'list',
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10000 },
    experimental_supported_tools: [],
    context_window: 1000000,
    max_context_window: 1000000,
    effective_context_window_percent: 95
});

const catalogOld = fs.existsSync(CATALOG) ? fs.readFileSync(CATALOG, 'utf8') : '';
const catalogNew = JSON.stringify({ models: picked.map(buildEntry) }, null, 2) + '\n';
const slugs = picked.map((m) => m.id);

if (catalogOld) {
    const o = new Set(JSON.parse(catalogOld).models.map((m) => m.slug));
    const n = new Set(slugs);
    log('--- models.json slug diff ---');
    log('  新增:', [...n].filter((s) => !o.has(s)).join(', ') || '无');
    log('  删除:', [...o].filter((s) => !n.has(s)).join(', ') || '无');
}

// ---------------------------------------------------------------- 3. 生成 codemoss config.json
const codemossOld = fs.readFileSync(CODEMOSS, 'utf8');
const cmObj = JSON.parse(codemossOld);
const providerId = cmObj.codex.appliedProviderId;
const provider = cmObj.codex.providers[providerId];
if (!provider) throw new Error('codemoss 里找不到 appliedProviderId 对应的 provider: ' + providerId);

const tomlOld = provider.configToml;
const tomlEol = eolOf(tomlOld);
const tlines = tomlOld.split(/\r?\n/);
let mi = tlines.findIndex((l) => /^model\s*=/.test(l));
if (mi < 0) throw new Error('codemoss 模板里找不到 model = 行');
tlines[mi] = `model = "${DEFAULT_MODEL}"`;
if (tlines.some((l) => /^#\s*默认模型\s*=/.test(l))) {
    tlines[tlines.findIndex((l) => /^#\s*默认模型\s*=/.test(l))] = markLine;
} else {
    tlines.splice(mi, 0, markLine);
}
// TOML 基本字符串字面量：JSON.stringify 会把每个反斜杠双写，正好是 TOML 需要的转义层数
const catalogTomlValue = JSON.stringify(CATALOG);
const catalogLine = `model_catalog_json = ${catalogTomlValue}`;
const ci = tlines.findIndex((l) => l.startsWith('model_catalog_json'));
if (ci >= 0) tlines[ci] = catalogLine;
else tlines.splice(tlines.findIndex((l) => /^model\s*=/.test(l)), 0, catalogLine);
const tomlNew = tlines.join(tomlEol);

let codemossNew = codemossOld;
{
    const keyIdx = codemossOld.indexOf('"configToml"');
    if (keyIdx < 0) throw new Error('codemoss 里找不到 configToml');
    const lit = jsonStringLiteral(codemossOld, codemossOld.indexOf(':', keyIdx));
    if (JSON.parse(lit.raw) !== tomlOld) throw new Error('configToml 原始串与解析值不一致，中止');
    // 沿用该文件原有的转义风格（= 写成 \u003d）
    const esc = (s) => JSON.stringify(s).replace(/=/g, '\\u003d');
    codemossNew = codemossNew.slice(0, lit.start) + esc(tomlNew) + codemossNew.slice(lit.end);
}

// customModelContextWindows.codex 补齐
{
    const rootKey = codemossNew.indexOf('"customModelContextWindows"');
    if (rootKey < 0) throw new Error('codemoss 里找不到 customModelContextWindows');
    const codexKey = codemossNew.indexOf('"codex"', rootKey);
    const { open, close } = objectSpan(codemossNew, codexKey);
    const existing = cmObj.customModelContextWindows.codex;
    const keys = [...Object.keys(existing), ...slugs.filter((s) => !(s in existing))];
    const block = '{\n' + keys.map((k) => `      ${JSON.stringify(k)}: 1000000`).join(',\n') + '\n    }';
    codemossNew = codemossNew.slice(0, open) + block + codemossNew.slice(close + 1);
}

// ---------------------------------------------------------------- 4. 生成 live config.toml
// CCGUI 是 live 配置的写方：每次"应用/切换"供应商都会按它的 configToml 模板重写
// ~/.codex/config.toml —— model 行会被扳回模板值、所有注释会被丢掉，但**未知顶层键会保留**。
// 所以这里只兜底补 model_catalog_json；model 行与注释一律不写（写了也会被插件冲掉，纯拉锯）。
const liveOld = fs.readFileSync(CODEX_TOML, 'utf8');
const liveEol = eolOf(liveOld);
const ll = liveOld.split(/\r?\n/);
const liveModelInFile = (liveOld.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || null;
const lci = ll.findIndex((l) => l.startsWith('model_catalog_json'));
if (lci >= 0) ll[lci] = catalogLine;
else {
    const at = ll.findIndex((l) => /^model\s*=/.test(l));
    ll.splice(at < 0 ? 1 : at, 0, catalogLine);
}
const liveNew = ll.join(liveEol);

// ---------------------------------------------------------------- 5. 落库前校验
const cmAfter = JSON.parse(codemossNew);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const preChecks = {
    'codemoss JSON 可解析': true,
    'codemoss 根键未变': same(Object.keys(cmObj).sort(), Object.keys(cmAfter).sort()),
    'codemoss claude 段逐字节未变': same(cmObj.claude, cmAfter.claude),
    'codemoss codex 元信息未变': cmObj.codex.appliedProviderId === cmAfter.codex.appliedProviderId &&
        cmObj.codex.appliedProviderRevision === cmAfter.codex.appliedProviderRevision &&
        cmObj.codex.localConfigAuthorized === cmAfter.codex.localConfigAuthorized,
    'codemoss 模板含 model_catalog_json（长期口径的关键）': tomlOld.includes('model_catalog_json'),
    'contextWindows 覆盖全部目录模型': slugs.every((s) => s in cmAfter.customModelContextWindows.codex),
    'models.json 可解析且条数正确': JSON.parse(catalogNew).models.length === slugs.length
};
log('--- 落库前校验 ---');
let ok = true;
for (const [k, v] of Object.entries(preChecks)) {
    log((v ? '  PASS  ' : '  FAIL  ') + k);
    if (!v) ok = false;
}
if (!ok) { log('校验未全过，未写入任何文件'); process.exit(1); }

const changes =
    (catalogOld !== catalogNew ? 1 : 0) + (liveOld !== liveNew ? 1 : 0) + (WRITE_CODEMOSS && codemossOld !== codemossNew ? 1 : 0);
log('--- 差异文件数 =', changes, '(models.json / codex config.toml' + (WRITE_CODEMOSS ? ' / codemoss config.json' : '') + ') ---');
log('live config.toml 的 model 行 =', liveModelInFile || '(缺失)', '（由 CCGUI 模板决定，本脚本不改）');
if (liveModelInFile && liveModelInFile !== DEFAULT_MODEL) {
    log(`  口径默认模型是 ${DEFAULT_MODEL}（DeepSeek 系次数最大）。要改默认模型请在 CCGUI 供应商管理`);
    log(`  里改该供应商模板的 model 行——脚本不代写：插件下次应用会把 live 的 model 行扳回模板值，写也是白写。`);
}
if (codemossOld !== codemossNew) {
    log('--- .codemoss/config.json 差异（' + (WRITE_CODEMOSS ? '会被写入' : '只报不写，CCGUI 托管状态需保护') + '）---');
    log('  模板 model 行 现网 =', (tomlOld.match(/^model = .*/m) || ['-'])[0], '| 口径应为 =', `model = "${DEFAULT_MODEL}"`);
    log('  模板含 model_catalog_json =', tomlOld.includes('model_catalog_json'));
    log('  contextWindows.codex 缺的键 =', slugs.filter((s) => !(s in cmObj.customModelContextWindows.codex)).join(', ') || '无');
    if (!WRITE_CODEMOSS) {
        log('  提示：模板已带 model_catalog_json 就别动它（插件每次应用都按模板重写 live 配置）；');
        log('        若哪天发现模板里没了这行，请在 CCGUI 供应商管理里手工加回并重新"应用"。');
    }
}

// 调试用：把"脚本认为应该长这样"的产物导出到目录，便于和现网文件做 diff（不碰原文件）
const emitIdx = process.argv.indexOf('--emit');
if (emitIdx >= 0) {
    const dir = process.argv[emitIdx + 1];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'models.json'), catalogNew, 'utf8');
    fs.writeFileSync(path.join(dir, 'codemoss-config.json'), codemossNew, 'utf8');
    fs.writeFileSync(path.join(dir, 'config.toml'), liveNew, 'utf8');
    log('已导出应然产物到:', dir);
    for (const [name, before, after] of [
        ['models.json', catalogOld, catalogNew],
        ['codemoss-config.json', codemossOld, codemossNew],
        ['config.toml', liveOld, liveNew]
    ]) {
        if (before === after) { log(`  ${name}: 与现网一致`); continue; }
        const a = before.split(/\r?\n/);
        const b = after.split(/\r?\n/);
        const n = Math.max(a.length, b.length);
        log(`  ${name}: 现网 ${a.length} 行 / 应然 ${b.length} 行，首个差异：`);
        for (let i = 0; i < n; i++) {
            if (a[i] !== b[i]) { log(`    L${i + 1}\n      现网: ${a[i]}\n      应然: ${b[i]}`); break; }
        }
    }
}

if (!APPLY) { log('预览模式，零写入。加 --apply 落库。'); process.exit(0); }
if (changes === 0) { log('无变化，不写盘。'); process.exit(0); }

// ---------------------------------------------------------------- 6. 并发防护 + 写入
const since = Date.now() - settingsMtime.getTime();
if (!FORCE && since < CONCURRENCY_GUARD_MS) {
    log(`检测到并发写：settings.yaml ${Math.round(since / 1000)} 秒前被写过（<2 分钟），本轮跳过落库，只出报告。`);
    process.exit(0);
}

const stamp = (() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
})();

const written = [];
const backups = [];
try {
    const plan = [
        [CATALOG, catalogOld, catalogNew],
        [CODEX_TOML, liveOld, liveNew]
    ];
    if (WRITE_CODEMOSS) plan.push([CODEMOSS, codemossOld, codemossNew]);
    for (const [file, before, after] of plan) {
        if (before === after) continue;
        const bak = `${file}.bak-${stamp}`;
        fs.writeFileSync(bak, before, 'utf8');
        backups.push(bak);
        fs.writeFileSync(file, after, 'utf8');
        written.push(file);
    }
    log('已落库:'); written.forEach((f) => log('  ' + f));
    log('备份:'); backups.forEach((f) => log('  ' + f));

    // 回读校验
    JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
    if (WRITE_CODEMOSS) {
        const cm2 = JSON.parse(fs.readFileSync(CODEMOSS, 'utf8'));
        if (!same(cm2.claude, cmObj.claude)) throw new Error('回读：codemoss claude 段被改动');
        if (!cm2.codex.providers[providerId].configToml.includes('model_catalog_json')) throw new Error('回读：model_catalog_json 丢失');
    }
    const live2 = fs.readFileSync(CODEX_TOML, 'utf8');
    if (!live2.includes(`model = "${DEFAULT_MODEL}"`)) throw new Error('回读：live 默认模型未生效');
    log('回读校验: PASS');
} catch (err) {
    log('落库过程出错，回滚:', err.message);
    for (const bak of backups) {
        const orig = bak.replace(/\.bak-\d{8}-\d{6}$/, '');
        fs.copyFileSync(bak, orig);
        log('  已还原', orig);
    }
    process.exit(1);
}

// ---------------------------------------------------------------- 7. Codex 本体实测
function findCodexExe() {
    const base = path.join(HOME, '.codemoss', 'dependencies', 'codex-sdk', 'node_modules', '@openai');
    if (!fs.existsSync(base)) return null;
    for (const d of fs.readdirSync(base)) {
        if (!/^codex-.*x64$/.test(d)) continue;
        const vendor = path.join(base, d, 'vendor');
        if (!fs.existsSync(vendor)) continue;
        for (const v of fs.readdirSync(vendor)) {
            const exe = path.join(vendor, v, 'bin', 'codex.exe');
            if (fs.existsSync(exe)) return exe;
        }
    }
    return null;
}

const exe = findCodexExe();
if (!exe) {
    log('⚠ 未找到 codex.exe，跳过 Codex 本体实测（请手工确认模型列表）');
    process.exit(0);
}
log('--- Codex 本体实测:', exe);
let rawOut = '';
try {
    rawOut = execFileSync(exe, ['debug', 'models'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (err) {
    log('✗ codex debug models 执行失败:', err.message);
    process.exit(1);
}
const got = JSON.parse(rawOut).models;
const gotBySlug = new Map(got.map((m) => [m.slug, m]));
const finalChecks = {
    'Codex 实际加载条数与目录一致': got.length === slugs.length,
    'slug 集合双向一致': slugs.every((s) => gotBySlug.has(s)) && got.every((m) => slugs.includes(m.slug)),
    'display_name 与 DSH name 逐条一致': slugs.every((s) => gotBySlug.get(s)?.display_name === picked.find((m) => m.id === s).name)
};
log('--- Codex 本体实测结果 ---');
for (const [k, v] of Object.entries(finalChecks)) {
    log((v ? '  PASS  ' : '  FAIL  ') + k);
    if (!v) ok = false;
}
log(`Codex 实际加载 ${got.length} 条:`);
got.forEach((m) => log('  ' + m.slug.padEnd(30) + m.display_name));
if (!ok) { log('实测未全过：文件已落库，请人工核（备份见上）。'); process.exit(1); }
log('全部校验通过 ✅');
