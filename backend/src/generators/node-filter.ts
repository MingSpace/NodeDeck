import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";

export function applyNodeFilter(nodes: Node[], filter: Profile["node_filter"]): Node[] {
  let out = nodes.slice();
  if (filter.include_regex) {
    try {
      const re = new RegExp(filter.include_regex);
      out = out.filter((n) => re.test(n.name));
    } catch {
      // ignore invalid regex
    }
  }
  if (filter.exclude_regex) {
    try {
      const re = new RegExp(filter.exclude_regex);
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
