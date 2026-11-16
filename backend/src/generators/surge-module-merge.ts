import type { SurgeModule } from "../schemas/surge-module.js";
import {
  localModuleSections,
  parseArgumentDefaults,
  parseSgmodule,
  substituteArguments,
  type ModuleSection,
} from "../surge-modules/sgmodule.js";

/**
 * Profile 引用的 Surge 模块 → 并进 .conf 时各段要加的内容。
 *
 * 目标是「并进 profile」与「在设备上安装同一个模块」效果一致,所以按 Surge 模块语义合并
 * (manual.nssurge.com/profile/module.html):
 * - [General] / [MITM]:`key = value` 覆盖,`key = %APPEND% v` 追加到末尾,`key = %INSERT% v` 插到开头;
 * - 行型段(Rule / Script / URL Rewrite / Host / ...):模块的行放在 profile 原有内容 **之前**
 *   (多个模块按 profile.surge_modules 的顺序);
 * - `{{{参数}}}` 用 #!arguments 的默认值替换(并进 profile 没有设备上填的值);
 * - 整段替换型(WireGuard / Tailscale / MTProto / Snell Server)与 [Ruleset *] 合并等不做,告警跳过 ——
 *   这类模块请在设备上用 /module/<id>.sgmodule 安装。
 * - #!system / #!requirement 并进 profile 后不再生效(没有「按设备判断」的时机),同样只在安装时生效。
 */

/** 远程模块由 profile-resolver 附上拉到的内容;没有内容的远程模块直接跳过(resolver 已告警) */
export type SurgeModuleInput = SurgeModule & { remote_text?: string };

export type KvSectionName = "General" | "MITM";

export interface KvOp {
  key: string;
  op: "set" | "append" | "insert";
  value: string;
}

export interface ModuleContributions {
  /** 段名(规范大小写) → 要放在 profile 原有行之前的行 */
  lineSections: Map<string, string[]>;
  kvOps: Map<KvSectionName, KvOp[]>;
}

/** 按「新增行插到原有内容顶部」合并的段(文档列出的那组),值是 profile 里的规范段名 */
export const MODULE_LINE_SECTIONS = [
  "Rule",
  "Script",
  "URL Rewrite",
  "Header Rewrite",
  "Body Rewrite",
  "Map Local",
  "Host",
  "IP Rewrite",
  "SSID Setting",
  "Panel",
] as const;

const LINE_SECTION_BY_LOWER = new Map<string, string>(MODULE_LINE_SECTIONS.map((n) => [n.toLowerCase(), n]));
const KV_SECTION_BY_LOWER = new Map<string, KvSectionName>([
  ["general", "General"],
  ["mitm", "MITM"],
]);

function moduleSectionsOf(m: SurgeModuleInput): { sections: ModuleSection[]; argumentSpec?: string } | null {
  if (m.source === "remote") {
    if (m.remote_text === undefined) return null;
    const parsed = parseSgmodule(m.remote_text);
    return { sections: parsed.sections, argumentSpec: parsed.meta.arguments };
  }
  return { sections: localModuleSections(m), argumentSpec: m.arguments };
}

function parseKvLine(line: string): KvOp | null {
  const eq = line.indexOf("=");
  if (eq <= 0) return null;
  const key = line.slice(0, eq).trim();
  let value = line.slice(eq + 1).trim();
  let op: KvOp["op"] = "set";
  const marker = /^%(APPEND|INSERT)%\s*/i.exec(value);
  if (marker) {
    op = marker[1].toUpperCase() === "APPEND" ? "append" : "insert";
    value = value.slice(marker[0].length).trim();
  }
  return { key, op, value };
}

export function collectModuleContributions(modules: SurgeModuleInput[], warnings: string[]): ModuleContributions {
  const lineSections = new Map<string, string[]>();
  const kvOps = new Map<KvSectionName, KvOp[]>();
  for (const m of modules) {
    const content = moduleSectionsOf(m);
    if (!content) continue;
    const defaults = parseArgumentDefaults(content.argumentSpec);
    const skipped: string[] = [];
    for (const section of content.sections) {
      const lines = substituteArguments(section.lines, defaults, (name) =>
        warnings.push(`Surge 模块 "${m.name}" 的参数 {{{${name}}}} 没有默认值,并入 profile 时替换为空`),
      );
      const lower = section.name.toLowerCase();
      const kvName = KV_SECTION_BY_LOWER.get(lower);
      if (kvName) {
        const ops = kvOps.get(kvName) ?? [];
        for (const line of lines) {
          const op = parseKvLine(line);
          if (op) ops.push(op);
          else warnings.push(`Surge 模块 "${m.name}" 的 [${kvName}] 行 "${line}" 不是 key = value,已跳过`);
        }
        kvOps.set(kvName, ops);
        continue;
      }
      const lineName = LINE_SECTION_BY_LOWER.get(lower);
      if (lineName) {
        lineSections.set(lineName, [...(lineSections.get(lineName) ?? []), ...lines]);
        continue;
      }
      skipped.push(section.name);
    }
    if (skipped.length > 0) {
      warnings.push(
        `Surge 模块 "${m.name}" 的 ${skipped.map((s) => `[${s}]`).join(" ")} 段不支持并入 profile,已跳过;需要的话在设备上安装该模块`,
      );
    }
  }
  return { lineSections, kvOps };
}

/**
 * 在 `key = value` 行列表上应用模块的覆盖 / 追加 / 插入。key 按小写匹配;列表型值用 ", " 拼接
 * (Surge 的 hostname / skip-proxy / always-real-ip 等都是逗号分隔)。
 */
export function applyKvOps(lines: string[], ops: KvOp[]): string[] {
  const out = [...lines];
  const indexOf = (key: string) =>
    out.findIndex((l) => {
      const eq = l.indexOf("=");
      return eq > 0 && l.slice(0, eq).trim().toLowerCase() === key.toLowerCase();
    });
  for (const { key, op, value } of ops) {
    const i = indexOf(key);
    const current = i >= 0 ? out[i].slice(out[i].indexOf("=") + 1).trim() : "";
    let next = value;
    if (op === "append" && current) next = value ? `${current}, ${value}` : current;
    if (op === "insert" && current) next = value ? `${value}, ${current}` : current;
    const line = `${i >= 0 ? out[i].slice(0, out[i].indexOf("=")).trim() : key} = ${next}`;
    if (i >= 0) out[i] = line;
    else out.push(line);
  }
  return out;
}
