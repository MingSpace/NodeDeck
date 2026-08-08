import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, CornerDownRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowGroup, FlowMember, FlowMemberKind, FlowMemberOrigin } from "./types";

/** 嵌套组最多展开这么多层。组之间互相引用在客户端是合法的,但视图里再深就没人看得懂了。 */
const MAX_DEPTH = 4;

const KIND_LABEL: Record<FlowMemberKind, string> = {
  node: "节点",
  group: "策略组",
  builtin: "内置策略",
  missing: "找不到",
};

const ORIGIN_LABEL: Record<FlowMemberOrigin, string> = {
  explicit: "手动点名",
  nested: "嵌套引用",
  other_group: "平铺展开",
  selector: "条件自动匹配",
  fallback: "空组兜底",
};

/** 只有 fallback 的成员顺序是语义(取第一个可用的),其余类型标序号反而会误导。 */
function isPriorityOrdered(type: string): boolean {
  return type === "fallback";
}

const PRIORITY_MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

export function FlowGroupCard({
  group,
  groupsByName,
  highlighted,
}: {
  group: FlowGroup;
  groupsByName: Map<string, FlowGroup>;
  highlighted: boolean;
}) {
  return (
    <div
      id={`flow-group-${group.name}`}
      className={cn(
        "rounded-lg border bg-card transition-shadow",
        highlighted && "ring-2 ring-primary/60",
      )}
    >
      <div className="border-b px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-sm font-medium">{group.name}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {group.type}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            覆盖 {group.node_total} 个节点
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {group.notes.find((n) => n.level === "info")?.text}
        </p>
        <TestParams group={group} />
      </div>

      <div className="px-3 py-2">
        <MemberList
          members={group.members}
          ownerType={group.type}
          groupsByName={groupsByName}
          depth={0}
          ancestors={new Set([group.name])}
        />
        {group.selector_omitted > 0 && (
          <div className="mt-1 pl-6 text-[11px] text-muted-foreground/70">
            还有 {group.selector_omitted} 个由条件自动匹配的节点未列出
          </div>
        )}
      </div>

      {group.notes.filter((n) => n.level === "warn").length > 0 && (
        <div className="space-y-1 border-t bg-amber-50/60 px-3 py-2 dark:bg-amber-950/20">
          {group.notes
            .filter((n) => n.level === "warn")
            .map((n) => (
              <div
                key={n.text}
                className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{n.text}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function TestParams({ group }: { group: FlowGroup }) {
  const parts: string[] = [];
  if (group.url) parts.push(`测试 ${group.url}`);
  if (group.interval !== undefined) parts.push(`每 ${group.interval}s 复测`);
  if (group.timeout !== undefined) parts.push(`超时 ${group.timeout}s`);
  if (group.tolerance !== undefined) parts.push(`容差 ${group.tolerance}ms`);
  if (group.include_other_group) parts.push(`平铺 ${group.include_other_group} 的成员`);
  if (group.clash_type !== group.type) parts.push(`Clash 端降级为 ${group.clash_type}`);
  if (parts.length === 0) return null;
  return (
    <div className="mt-1 flex items-start gap-1.5 text-[11px] text-muted-foreground/80">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="break-all">{parts.join(" · ")}</span>
    </div>
  );
}

function MemberList({
  members,
  ownerType,
  groupsByName,
  depth,
  ancestors,
}: {
  members: FlowMember[];
  ownerType: string;
  groupsByName: Map<string, FlowGroup>;
  depth: number;
  ancestors: Set<string>;
}) {
  const priority = isPriorityOrdered(ownerType);
  return (
    <div className="space-y-0.5">
      {members.map((m, i) => (
        <MemberRow
          key={`${m.name}-${i}`}
          member={m}
          mark={priority ? (PRIORITY_MARKS[i] ?? `${i + 1}.`) : undefined}
          groupsByName={groupsByName}
          depth={depth}
          ancestors={ancestors}
        />
      ))}
    </div>
  );
}

function MemberRow({
  member,
  mark,
  groupsByName,
  depth,
  ancestors,
}: {
  member: FlowMember;
  mark?: string;
  groupsByName: Map<string, FlowGroup>;
  depth: number;
  ancestors: Set<string>;
}) {
  const nested = member.kind === "group" ? groupsByName.get(member.name) : undefined;
  // 组互相引用时不再往下展(客户端运行时也只是逐层选择,不会真的无限递归)。
  const cyclic = nested !== undefined && ancestors.has(member.name);
  const expandable = nested !== undefined && !cyclic && depth < MAX_DEPTH;
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="flex items-start gap-1.5 py-0.5 text-xs">
        {mark ? (
          <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-primary">{mark}</span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={open ? `收起 ${member.name}` : `展开 ${member.name}`}
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span
              className={cn(
                "truncate font-mono",
                member.kind === "missing" && "text-destructive line-through",
                member.kind === "group" && "font-medium text-primary",
              )}
              title={member.name}
            >
              {member.name}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              {KIND_LABEL[member.kind]} · {ORIGIN_LABEL[member.origin]}
            </span>
            {cyclic && <span className="text-[10px] text-amber-600 dark:text-amber-400">循环引用,不再展开</span>}
          </div>
          {member.chain_path && <ChainTrail path={member.chain_path} />}
        </div>
      </div>

      {expandable && open && nested && (
        <div className="ml-6 border-l pl-2.5">
          <div className="py-1 text-[10px] text-muted-foreground/70">
            {nested.type} · 覆盖 {nested.node_total} 个节点
          </div>
          <MemberList
            members={nested.members}
            ownerType={nested.type}
            groupsByName={groupsByName}
            depth={depth + 1}
            ancestors={new Set([...ancestors, nested.name])}
          />
          {nested.selector_omitted > 0 && (
            <div className="pb-1 pl-6 text-[10px] text-muted-foreground/70">
              还有 {nested.selector_omitted} 个自动匹配的节点未列出
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 链式节点的实际出站路径:`自身 → 前置 → …`,末项才是真正落地的地方。 */
function ChainTrail({ path }: { path: string[] }) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
      <CornerDownRight className="h-3 w-3 shrink-0" />
      <span>先连</span>
      {path.slice(1).map((hop, i) => (
        <span key={`${hop}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-muted-foreground/50">→</span>}
          <span className="max-w-[180px] truncate rounded bg-primary/10 px-1.5 py-0.5 font-mono" title={hop}>
            {hop}
          </span>
        </span>
      ))}
      <span>再落地</span>
    </div>
  );
}
