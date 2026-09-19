// ── pi-ai schema 校验（2026-09-19 固化）───────────────────────────────────────
// 背景：2026-09-18 百炼巡检给 qwen3.8-omni-flash 写了 input: [text, image, audio, video]，
//       pi-ai 适配器 schema 的模态枚举只有 text|image → 整个 llm-pi-ai 分节被拒载，
//       6 路由 42 模型从模型选择器集体消失（进程内存留最后有效值，重启才暴露）。
//       YAML.parse 只管语法拦不住这种错，必须拿 DSH 引擎自带的 Config 真 schema 校验。
//
// 用法（任意工作目录可跑，退出码 0=通过 / 1=失败）：
//   node "F:\idea-workspase-skills\deepseek-harness-settings-curator\scripts\pi-ai-schema-check.mjs" [settings.yaml 路径...]
//   缺省校验 %DSH_HOME%\settings.yaml，没有 DSH_HOME 则 %USERPROFILE%\.dsh\settings.yaml
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

const files = process.argv.slice(2);
const targets = files.length > 0 ? files : [
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'settings.yaml') : join(process.env.USERPROFILE ?? '', '.dsh', 'settings.yaml'),
];

let failed = false;
for (const file of targets) {
    console.log(`== ${file}`);
    if (!existsSync(file)) { console.error('  [失败] 文件不存在'); failed = true; continue; }

    let doc;
    try { doc = YAML.parse(readFileSync(file, 'utf8')); } catch (error) { console.error(`  [失败] YAML 语法: ${error?.message ?? error}`); failed = true; continue; }
    if (doc === null || typeof doc !== 'object') { console.error('  [失败] 解析结果不是对象'); failed = true; continue; }

    // ① llm-pi-ai 分节：整个分节一条 schema，一处超枚举=整节拒载
    const piSection = doc['llm-pi-ai'];
    if (piSection === undefined || piSection === null) {
        console.log('  [跳过] 无 llm-pi-ai 分节（休眠态，合法）');
    } else {
        try {
            const norm = piAi.Config(piSection);
            const routes = Object.entries(norm.providers ?? {});
            console.log(`  [通过] llm-pi-ai：${routes.length} 条路由`);
            for (const [route, profile] of routes) {
                const models = profile.models ?? [];
                console.log(`    - ${route}（${profile.displayName ?? '默认名'}）: ${models.length} 条 → ${models.map((m) => m.id).join(', ') || '（继承目录）'}`);
            }
        } catch (error) {
            console.error(`  [失败] llm-pi-ai schema（此分节会被整体拒载，全渠道模型消失）: ${error?.message ?? error}`);
            failed = true;
        }
    }

    // ② llm-deepseek 分节（deepseek-official 直连路由）：同样拿真 schema 校验
    const dsSection = doc['llm-deepseek'];
    if (dsSection === undefined || dsSection === null) {
        console.log('  [跳过] 无 llm-deepseek 分节');
    } else {
        try {
            const norm = deepseek.Config(dsSection);
            const models = norm.models ?? [];
            console.log(`  [通过] llm-deepseek：${models.length} 条 → ${models.map((m) => m.id).join(', ') || '（继承内置目录）'}`);
        } catch (error) {
            console.error(`  [失败] llm-deepseek schema: ${error?.message ?? error}`);
            failed = true;
        }
    }
}

console.log(failed ? '[pi-ai-schema-check] 结论：失败（分节会被 DSH 拒载，先修复再落库）' : '[pi-ai-schema-check] 结论：全部通过');
process.exit(failed ? 1 : 0);
