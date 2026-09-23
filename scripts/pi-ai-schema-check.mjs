// ── pi-ai schema 校验（2026-09-19 固化，2026-09-23 换锚 profile 补丁）──────────
// 背景：2026-09-18 百炼巡检给 qwen3.8-omni-flash 写了 input: [text, image, audio, video]，
//       pi-ai 适配器 schema 的模态枚举只有 text|image → 整个 llm-pi-ai 分节被拒载，
//       6 路由 42 模型从模型选择器集体消失（进程内存留最后有效值，重启才暴露）。
//       YAML.parse 只管语法拦不住这种错，必须拿 DSH 引擎自带的 Config 真 schema 校验。
//
// 数据源（2026-09-23 改版）：新版 DSH(0.1.7+) 把配置从 ~/.dsh/settings.yaml 迁到
//   <DSH_HOME>/profiles/<profile>/cordis.patch.yml（顶层 = 条目数组 [{id, config}]，
//   旧 settings.yaml 在启动时被一次性导入后改名 .imported）。本脚本两种形状都认：
//     · 补丁数组 → 按 id 取 llm-pi-ai / llm-deepseek 条目的 config 再校验；
//     · 旧顶层段 → 直接取分节校验（仅作回退核对）。
//   ⚠️ 补丁形状下若两个条目都不在 = 校验对象不存在，直接判失败 —— 防止"读空即跳过"的假通过
//     （这正是 2026-09-23 巡检连环失手的根源之一：脚本报通过、实际什么都没校验）。
//
// 用法（任意工作目录可跑，退出码 0=通过 / 1=失败）：
//   node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\pi-ai-schema-check.mjs" [补丁路径...]
//   缺省校验 %DSH_HOME%\profiles\web\cordis.patch.yml，没有 DSH_HOME 则 %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
//   可用环境变量 DSH_CONFIG_FILE 覆盖缺省目标；--allow-no-llm = 补丁里确实没有 llm 条目时不算失败
//
// 原理：直接 import 引擎 checkout 里的 @deepseek-ai/dsh-llm-pi-ai 与 @deepseek-ai/dsh-llm-deepseek
//       导出的 Config schema（schemastery，可调用=校验并返回归一化值，抛错=拒载），
//       schema 随引擎升级走，不会像手写枚举校验那样漂移。
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 引擎 checkout 候选：DSH_ENGINE_DIR 优先，其后是全局安装位（2026-09-19 实测位）
const ENGINE_CANDIDATES = [
    process.env.DSH_ENGINE_DIR,
    'C:/Users/Administrator/node_global/node_modules/@deepseek-ai/dsh',
].filter(Boolean);

let engineDir = null;
let requireFromEngine = null;
for (const cand of ENGINE_CANDIDATES) {
    const pkg = join(cand, 'package.json');
    if (existsSync(pkg)) { engineDir = cand; requireFromEngine = createRequire(pathToFileURL(pkg)); break; }
}
if (!engineDir) {
    console.error('[pi-ai-schema-check] 找不到 DSH 引擎 checkout（设 DSH_ENGINE_DIR 或确认 node_global 安装位）');
    process.exit(1);
}

const YAML = requireFromEngine('yaml');
const engineMod = (name) => import(pathToFileURL(join(engineDir, 'node_modules', name, 'lib', 'index.js')).href);
const [piAi, deepseek] = await Promise.all([
    engineMod('@deepseek-ai/dsh-llm-pi-ai'),
    engineMod('@deepseek-ai/dsh-llm-deepseek'),
]);

/**
 * 把文档折算成"段名 → 该段 config"。
 * 补丁 = 顶层条目数组（另有 insert: 里嵌条目的写法）；旧 settings.yaml = 顶层段映射。
 * @returns {{layout: 'patch'|'legacy', sections: object, ids?: string[]}}
 */
function sectionsOf(root) {
    if (!Array.isArray(root)) return { layout: 'legacy', sections: root };
    const sections = {};
    const take = (e) => {
        if (e && e.id && !(e.id in sections)) sections[e.id] = e.config ?? {};
    };
    for (const e of root) {
        if (e && Array.isArray(e.insert)) e.insert.forEach(take);
        else take(e);
    }
    return { layout: 'patch', sections, ids: Object.keys(sections) };
}

const args = process.argv.slice(2);
const allowNoLlm = args.includes('--allow-no-llm');
const files = args.filter((a) => !a.startsWith('--'));
const defaultConfig = process.env.DSH_CONFIG_FILE
    || join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh'), 'profiles', 'web', 'cordis.patch.yml');
const targets = files.length > 0 ? files : [defaultConfig];

let failed = false;
for (const file of targets) {
    console.log(`== ${file}`);
    if (!existsSync(file)) { console.error('  [失败] 文件不存在'); failed = true; continue; }

    let doc;
    try { doc = YAML.parse(readFileSync(file, 'utf8')); } catch (error) { console.error(`  [失败] YAML 语法: ${error?.message ?? error}`); failed = true; continue; }
    if (doc === null || typeof doc !== 'object') { console.error('  [失败] 解析结果不是对象'); failed = true; continue; }

    const { layout, sections, ids } = sectionsOf(doc);
    if (layout === 'patch') console.log(`  [形状] profile 补丁（${ids.length} 条目）: ${ids.join(', ')}`);

    const piSection = sections['llm-pi-ai'];
    const dsSection = sections['llm-deepseek'];

    if (layout === 'patch' && piSection === undefined && dsSection === undefined) {
        if (allowNoLlm) {
            console.log('  [跳过] 补丁里没有 llm-pi-ai / llm-deepseek 条目（--allow-no-llm 放行）');
        } else {
            console.error('  [失败] 补丁里既无 llm-pi-ai 也无 llm-deepseek 条目：校验对象不存在（疑似落点不对或文件被改写）');
            failed = true;
            continue;
        }
    }

    // ① llm-pi-ai 条目：整个 config 一条 schema，一处超枚举=整条被拒载
    //    ⚠️ 只取"抛不抛"：引擎这条 schema 归一化后 providers 是非枚举 dict（只有 .get()，
    //    Object.keys 只剩 ['get']、JSON.stringify 变 {}），展示一律回原始 YAML 结构。
    if (piSection === undefined || piSection === null) {
        console.log('  [跳过] 无 llm-pi-ai 条目（休眠态，合法）');
    } else {
        try {
            piAi.Config(piSection);
            const routes = Object.entries(piSection.providers ?? {});
            console.log(`  [通过] llm-pi-ai：${routes.length} 条路由`);
            for (const [route, profile] of routes) {
                const models = Array.isArray(profile.models) ? profile.models : [];
                console.log(`    - ${route}（${profile.displayName ?? '默认名'}）: ${models.length} 条 → ${models.map((m) => m.id).join(', ') || '（继承目录）'}`);
            }
        } catch (error) {
            console.error(`  [失败] llm-pi-ai schema（此条会被整体拒载，全渠道模型消失）: ${error?.message ?? error}`);
            failed = true;
        }
    }

    // ② llm-deepseek 条目（deepseek-official 直连路由）：同样拿真 schema 校验
    //    注：该 schema 管结构（models 必须数组、id 必须字符串），不校验未知字段、允许空数组 —— 已知宽松面。
    if (dsSection === undefined || dsSection === null) {
        console.log('  [跳过] 无 llm-deepseek 条目');
    } else {
        try {
            deepseek.Config(dsSection);
            const models = Array.isArray(dsSection.models) ? dsSection.models : [];
            console.log(`  [通过] llm-deepseek：${models.length} 条 → ${models.map((m) => m.id).join(', ') || '（继承内置目录）'}`);
        } catch (error) {
            console.error(`  [失败] llm-deepseek schema: ${error?.message ?? error}`);
            failed = true;
        }
    }
}

console.log(failed ? '[pi-ai-schema-check] 结论：失败（条目会被 DSH 拒载，先修复再落库）' : '[pi-ai-schema-check] 结论：全部通过');
process.exit(failed ? 1 : 0);
