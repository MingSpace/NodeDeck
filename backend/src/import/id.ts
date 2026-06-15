import { customAlphabet } from "nanoid";

// idSchema 限定 alphanumeric / underscore / dash,所以 nanoid 字母表只用 [0-9a-z]。
// 6 位 nanoid 在导入场景内单次冲突概率约为 1/2^31,够用;真撞了由 router 兜底重试。
const idSuffixAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
export const shortId = customAlphabet(idSuffixAlphabet, 6);

/**
 * 给从 /import 流程导入的实体生成稳定 ID。
 *
 * 设计:
 * - 永远以 `imported-` 开头,前端列表页 / data 文件夹一眼能识别"这是从订阅一键导入的"。
 * - 中段保留可读 slug(如机场名 / 规则名 / 组名),让 yaml 文件名仍能粗略对得上原资源;
 *   slug 净化后超过 32 字符截断,避免 Linux 文件名过长。
 * - 末尾追加 6 位 nanoid 后缀,使得:
 *   1) 同一份文件多次 commit(在 dedup 命中之前)不会撞 id;
 *   2) 不同机场内的同名实体(`Auto`/`Proxy`/`Hong Kong` 之类极易撞名)能共存;
 *   3) 永不覆盖用户在 Web UI 里手建的同名资源(因为后缀是新生成的)。
 *
 * 注意:不再像旧版本那样把 General Preset 写成固定 `imported`,所以多次导入不同机场
 * 配置时,每个 imported 预设都会作为独立条目落库;靠 `generalPresetIdentity` 的内容
 * 哈希去重,避免重复创建同内容预设。
 */
export function generateImportedId(slugSource: string | undefined | null): string {
  const slug = slugify(slugSource ?? "");
  return slug ? `imported-${slug}-${shortId()}` : `imported-${shortId()}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
