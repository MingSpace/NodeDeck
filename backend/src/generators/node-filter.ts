import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";

export function applyNodeFilter(nodes: Node[], filter: Profile["node_filter"]): Node[] {
  let out = nodes.slice();
  // include/exclude_regex 默认大小写不敏感(JS RegExp 不支持 PCRE 风格的 `(?i)` 内联标志,
  // 直接传 "i" flag 既覆盖了 `JP` 匹配 `jp` 的常见诉求,又能让 placeholder/示例里不再用会抛
  // SyntaxError 的 `(?i)` 写法。如果有人确实需要大小写敏感,可在正则里用字符类如 `[A-Z]` 明确区分。
  if (filter.include_regex) {
    try {
      const re = new RegExp(filter.include_regex, "i");
      out = out.filter((n) => re.test(n.name));
    } catch {
      // ignore invalid regex
    }
  }
  if (filter.exclude_regex) {
    try {
      const re = new RegExp(filter.exclude_regex, "i");
      out = out.filter((n) => !re.test(n.name));
    } catch {
      // ignore
    }
  }
  if (filter.exclude_types && filter.exclude_types.length > 0) {
    out = out.filter((n) => !filter.exclude_types.includes(n.type));
  }
  if (filter.rename_rules && filter.rename_rules.length > 0) {
    out = out.map((n) => {
      let newName = n.name;
      for (const rule of filter.rename_rules) {
        try {
          const re = new RegExp(rule.pattern, rule.flags ?? "g");
          newName = newName.replace(re, rule.replace);
        } catch {
          // ignore
        }
      }
      return newName === n.name ? n : { ...n, name: newName };
    });
  }
  return out;
}
