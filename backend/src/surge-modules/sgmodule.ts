import type { SurgeModule } from "../schemas/surge-module.js";

/**
 * Surge 模块(.sgmodule)文本的解析 / 生成。语法见 manual.nssurge.com/profile/module.html:
 *   #!name=xxx / #!desc=xxx / #!arguments=k:v,k2:v2 / #!requirement=CORE_VERSION>=20
 *   [Section]
 *   ...行...
 */

export interface ModuleSection {
  /** 段头里的名字,如 `MITM`、`URL Rewrite`、`Ruleset Foo`(不含方括号) */
  name: string;
  lines: string[];
}

export interface ParsedModule {
  /** `#!key=value` 元数据,key 一律小写 */
  meta: Record<string, string>;
  sections: ModuleSection[];
}

/** local 模块 content_sections 的键 → 段名。ruleset_inline 是历史字段,不输出(与原行为一致)。 */
export const LOCAL_SECTION_NAMES = [
  ["general", "General"],
  ["host", "Host"],
  ["rule", "Rule"],
  ["url_rewrite", "URL Rewrite"],
  ["header_rewrite", "Header Rewrite"],
  ["body_rewrite", "Body Rewrite"],
  ["script", "Script"],
  ["mitm", "MITM"],
] as const satisfies ReadonlyArray<readonly [keyof SurgeModule["content_sections"], string]>;

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("#") || trimmed.startsWith(";") || trimmed.startsWith("//");
}

/** 段内容 → 有效行(去空行、整行注释;行内内容原样保留,脚本参数里可能有 # 等字符) */
export function sectionBodyLines(body: string | undefined): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isCommentLine(l));
}

export function parseSgmodule(text: string): ParsedModule {
  const meta: Record<string, string> = {};
  const sections: ModuleSection[] = [];
  let current: ModuleSection | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#!")) {
      const eq = line.indexOf("=");
      if (eq > 2) meta[line.slice(2, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
      continue;
    }
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const name = header[1].trim();
      // 同名段出现多次时并到一起
      current = sections.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
      if (!current) {
        current = { name, lines: [] };
        sections.push(current);
      }
      continue;
    }
    if (isCommentLine(line) || !current) continue;
    current.lines.push(line);
  }
  return { meta, sections };
}

/**
 * 拉到的远程内容像不像一个模块。挡掉最常见的误配:URL 指向 HTML 页面(GitHub 的 blob 页而不是 raw)、
 * 登录页、空文件。
 */
export function checkModuleText(text: string): string | null {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return "上游返回空内容";
  if (trimmed.startsWith("<")) return "上游返回的是 HTML 页面,不是 .sgmodule(GitHub 请用 Raw 地址)";
  const parsed = parseSgmodule(trimmed);
  if (parsed.sections.length === 0 && !parsed.meta.name) return "内容里没有任何 [段落] 或 #!name,不像 Surge 模块";
  return null;
}

/** 单行元数据值里不能有换行,否则会把后面内容截成新行 */
function metaValue(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

/** 本地模块 → 各段(只含有内容的段) */
export function localModuleSections(m: Pick<SurgeModule, "content_sections">): ModuleSection[] {
  const out: ModuleSection[] = [];
  for (const [key, name] of LOCAL_SECTION_NAMES) {
    const lines = sectionBodyLines(m.content_sections[key]);
    if (lines.length > 0) out.push({ name, lines });
  }
  return out;
}

/** 本地模块 → .sgmodule 文本(供 /module/<id>.sgmodule 安装用) */
export function renderLocalSgmodule(m: SurgeModule): string {
  const out: string[] = [`#!name=${metaValue(m.name)}`];
  if (m.description?.trim()) out.push(`#!desc=${metaValue(m.description)}`);
  if (m.arguments?.trim()) out.push(`#!arguments=${metaValue(m.arguments)}`);
  if (m.requirement?.trim()) out.push(`#!requirement=${metaValue(m.requirement)}`);
  for (const s of localModuleSections(m)) {
    out.push("", `[${s.name}]`, ...s.lines);
  }
  return out.join("\n") + "\n";
}

/**
 * `#!arguments=hostname:example.com,enable_mitm:true` → 参数名 → 默认值。
 * 冒号后是默认值,可省略(省略记 undefined)。参数名只允许字母数字下划线(文档要求)。
 */
export function parseArgumentDefaults(spec: string | undefined): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  if (!spec) return out;
  for (const part of spec.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const colon = item.indexOf(":");
    const name = (colon >= 0 ? item.slice(0, colon) : item).trim();
    if (!/^\w+$/.test(name)) continue;
    out.set(name, colon >= 0 ? item.slice(colon + 1).trim() : undefined);
  }
  return out;
}

/**
 * 把 `{{{name}}}` 替换成 #!arguments 的默认值。并进 profile 时没有「设备上填的参数值」,只能用默认值;
 * 没声明或没默认值的占位符替换为空串并告警(留着 `{{{x}}}` 原文会让 Surge 把它当成字面值)。
 */
export function substituteArguments(
  lines: string[],
  defaults: Map<string, string | undefined>,
  onMissing: (name: string) => void,
): string[] {
  const reported = new Set<string>();
  return lines.map((line) =>
    line.replace(/\{\{\{(\w+)\}\}\}/g, (_m, name: string) => {
      const v = defaults.get(name);
      if (v !== undefined) return v;
      if (!reported.has(name)) {
        reported.add(name);
        onMissing(name);
      }
      return "";
    }),
  );
}
