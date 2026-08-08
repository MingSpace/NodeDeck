import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ChainPath } from "../chain/apply.js";
import { GROUP_BUILTIN_POLICIES } from "./group-refs.js";
import { resolveGroupMemberEntries, type GroupMemberOrigin } from "./group-members.js";

/**
 * Web UI「流转」视图的数据模型:把 规则 → 策略组 → 成员(含嵌套组 / 链式前置) 拍平成一张图,
 * 让用户不用读产物就能看懂一次请求实际怎么走。
 *
 * 成员顺序直接复用 `resolveGroupMemberEntries` —— 与两端 generator 写进产物的顺序同源。
 * 这一点对 `fallback` 组是**语义**而不只是展示:客户端按声明顺序取第一个可用的成员,
 * 视图里顺序错了就等于教用户配错优先级。
 */

export type FlowMemberKind = "node" | "group" | "builtin" | "missing";

export interface FlowMember {
  name: string;
  kind: FlowMemberKind;
  origin: GroupMemberOrigin;
  /** 该成员是节点且挂了链式前置时的完整链路 `[自身, 前置, ...]`,末项即真正的出口 */
  chain_path?: string[];
}

export interface FlowNote {
  level: "info" | "warn";
  text: string;
}

export interface FlowGroup {
  name: string;
  type: ProxyGroup["type"];
  /** Clash 端实际落地的类型(smart→url-test / ssid→select),两端不一致时 UI 要提示 */
  clash_type: string;
  members: FlowMember[];
  /** selector 命中但没列进 members 的节点数(只回样本,避免几百个节点撑爆响应) */
  selector_omitted: number;
  /** 递归展开嵌套组之后,这个组实际覆盖的真实节点总数 */
  node_total: number;
  url?: string;
  interval?: number;
  timeout?: number;
  tolerance?: number;
  include_other_group?: string;
  include_all_proxies?: boolean;
  policy_regex_filter?: string;
  notes: FlowNote[];
}

export interface FlowEntry {
  kind: "ruleset" | "geoip" | "final";
  label: string;
  detail?: string;
  policy: string;
  policy_kind: "group" | "builtin" | "unknown";
}

export interface FlowGraph {
  entries: FlowEntry[];
  groups: FlowGroup[];
}

/** selector 动态命中的成员最多列这么多个 —— 再多对"看流转"没有增量信息,只会淹没结构。 */
const SELECTOR_SAMPLE_LIMIT = 6;

/**
 * 各组类型的选择语义。措辞直接对应 Surge manual 的 Policy Group 章节,
 * 目的是让用户在 UI 上就能判断"我这个组到底会不会自动切换"。
 */
const SELECTION_SEMANTICS: Record<ProxyGroup["type"], string> = {
  select: "在客户端手动选择,不会自动切换",
  "url-test": "自动选延迟最低的成员",
  fallback: "按下面的顺序取第一个可用的成员,越靠前优先级越高",
  "load-balance": "在可用成员之间分摊连接",
  smart: "按实测连接质量自动选择,当前成员失败时立刻重试下一个",
  ssid: "按当前接入的网络(SSID)选择",
  external: "由外部代理程序决定",
};

const AUTO_TEST_TYPES = new Set<ProxyGroup["type"]>(["url-test", "fallback", "load-balance"]);

function clashType(type: ProxyGroup["type"]): string {
  return type === "smart" ? "url-test" : type === "ssid" ? "select" : type;
}

export interface BuildFlowGraphInput {
  groups: ProxyGroup[];
  nodes: Node[];
  /** 已应用链式规则并经 validateChain 清理后的链路,用于给成员标注前置 */
  chains: ChainPath[];
  /** buildGroupMemberIndex 的产出:组名 → 递归展开后的真实节点名集合 */
  groupMembers: Map<string, Set<string>>;
  hiddenNodes: Set<string>;
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  geoipFallback?: { policy: string };
  finalRule?: { policy: string; dns_failed?: boolean };
}

export function buildFlowGraph(input: BuildFlowGraphInput): FlowGraph {
  const nodeNames = new Set(input.nodes.map((n) => n.name));
  const groupNames = new Set(input.groups.map((g) => g.name));
  const chainByNode = new Map(input.chains.map((c) => [c.node, c.path]));

  const classify = (name: string): FlowMemberKind =>
    groupNames.has(name)
      ? "group"
      : nodeNames.has(name)
        ? "node"
        : GROUP_BUILTIN_POLICIES.has(name)
          ? "builtin"
          : "missing";

  const groups = input.groups.map((g) => {
    const entries = resolveGroupMemberEntries(g, input.nodes, {
      hiddenNodes: input.hiddenNodes,
      // 流转视图按"用户配了什么"呈现,不模拟 Clash proxy-providers 的 use: 剥离 ——
      // 那是单端输出细节,混进来只会让同一份配置在视图里凭空少掉一批节点。
      inlineIncludeOtherGroup: false,
      emptyFallback: true,
    });

    const members: FlowMember[] = [];
    let selectorSampled = 0;
    let selectorOmitted = 0;

    for (const entry of entries) {
      const kind = classify(entry.name);
      const chain = chainByNode.get(entry.name);
      if (entry.origin === "selector") {
        // 结构性成员(显式点名 / 嵌套组)全列;selector 动态命中的只留样本,
        // 但**挂了链的一律保留** —— 那正是用户来这个视图要看的东西。
        if (!chain && selectorSampled >= SELECTOR_SAMPLE_LIMIT) {
          selectorOmitted++;
          continue;
        }
        if (!chain) selectorSampled++;
      }
      members.push({
        name: entry.name,
        kind,
        origin: entry.origin,
        ...(chain && chain.length > 1 ? { chain_path: chain } : {}),
      });
    }

    return {
      name: g.name,
      type: g.type,
      clash_type: clashType(g.type),
      members,
      selector_omitted: selectorOmitted,
      node_total: input.groupMembers.get(g.name)?.size ?? 0,
      url: g.url,
      interval: g.interval,
      timeout: g.timeout,
      tolerance: g.tolerance,
      include_other_group: g.include_other_group,
      include_all_proxies: g.include_all_proxies,
      policy_regex_filter: g.policy_regex_filter,
      notes: buildNotes(g, members),
    } satisfies FlowGroup;
  });

  const policyKind = (policy: string): FlowEntry["policy_kind"] =>
    groupNames.has(policy) ? "group" : GROUP_BUILTIN_POLICIES.has(policy) ? "builtin" : "unknown";

  const entries: FlowEntry[] = input.rules.map((r) => ({
    kind: "ruleset" as const,
    label: r.ruleset.name,
    detail: describeRuleset(r.ruleset),
    policy: r.policy,
    policy_kind: policyKind(r.policy),
  }));

  // 顺序与两端 generator 的 [Rule] / rules 段一致:规则模块 → GEOIP 兜底 → FINAL。
  if (input.geoipFallback) {
    entries.push({
      kind: "geoip",
      label: "GEOIP,CN",
      detail: "国内 IP 兜底",
      policy: input.geoipFallback.policy,
      policy_kind: policyKind(input.geoipFallback.policy),
    });
  }
  if (input.finalRule) {
    entries.push({
      kind: "final",
      label: "FINAL",
      detail: input.finalRule.dns_failed ? "兜底(含 DNS 解析失败)" : "兜底",
      policy: input.finalRule.policy,
      policy_kind: policyKind(input.finalRule.policy),
    });
  }

  return { entries, groups };
}

function describeRuleset(rs: RuleSet): string | undefined {
  switch (rs.type) {
    case "geosite":
      return `GEOSITE,${rs.geosite_category ?? rs.id}`;
    case "geoip":
      return `GEOIP,${rs.geoip_country_code ?? rs.id}`;
    case "inline_list":
      return `内联 ${rs.payload?.length ?? 0} 条`;
    case "surge_internal":
      return rs.surge_internal_name;
    default:
      return rs.url;
  }
}

/**
 * 组级别的语义提示。这里刻意把「客户端会怎么理解这份配置」写死在后端:
 * 前端只负责渲染,避免同一套协议知识在两侧各写一份然后慢慢漂移。
 *
 * 依据 Surge manual 的 Policy Group / Smart Group / Fallback Group 三节
 * (目标版本 iOS 5.21+ / Mac 6.8+)。
 */
function buildNotes(g: ProxyGroup, members: FlowMember[]): FlowNote[] {
  const notes: FlowNote[] = [{ level: "info", text: SELECTION_SEMANTICS[g.type] }];

  if (g.type === "smart") {
    // Surge:"Only proxy policies can be members of a Smart Group: nested policy groups
    // and built-in policies (such as DIRECT) are silently ignored."
    const ignored = members.filter((m) => m.kind === "group" || m.kind === "builtin");
    if (ignored.length > 0) {
      notes.push({
        level: "warn",
        text: `Surge 的 smart 组只接受代理节点,会静默忽略嵌套的策略组与内置策略 —— ${ignored
          .map((m) => m.name)
          .join("、")} 实际不参与选择。想要"优先 A、A 挂了再用 B"请改用 fallback 组`,
      });
    }
    // Surge:"the interval parameter has no effect on Smart Groups"(固定 5 分钟)。
    if (g.interval !== undefined) {
      notes.push({
        level: "warn",
        text: "smart 组固定每 5 分钟重测一次,这里设的 interval 不生效",
      });
    }
  }

  // Surge fallback 的 interval 默认 600 秒 —— 直接决定"落地挂了多久才会切走",
  // 是这类"优先落地 + 兜底"配置最容易踩的坑,所以显式提示。
  if (g.type === "fallback" && g.interval === undefined) {
    notes.push({
      level: "warn",
      text: "没有设置 interval,Surge 默认 600 秒才复测一次,成员挂掉后最长要等这么久才切换",
    });
  }
  if (AUTO_TEST_TYPES.has(g.type) && !g.url) {
    notes.push({
      level: "info",
      text: "没有单独设测试 URL,使用 [General] 的 proxy-test-url",
    });
  }

  if (g.type === "smart" || g.type === "ssid") {
    notes.push({
      level: "info",
      text: `Clash 没有 ${g.type} 组,输出时会降级为 ${clashType(g.type)}`,
    });
  }

  const missing = members.filter((m) => m.kind === "missing");
  if (missing.length > 0) {
    notes.push({
      level: "warn",
      text: `成员 ${missing.map((m) => m.name).join("、")} 既不是节点也不是当前 Profile 的策略组,生成时会被剔除`,
    });
  }

  if (g.include_all_proxies || g.policy_regex_filter) {
    notes.push({
      level: "info",
      text: "开启了 include-all-proxies / policy-regex-filter,成员由 Surge 客户端自行展开,这里列不全",
    });
  }

  return notes;
}
