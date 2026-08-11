import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { api } from "@/lib/api";
import { summarizeGroupComposition, type PoolNodeLike } from "@/lib/group-composition";
import { ProxyGroupVisualForm, type ProxyGroupData } from "./visual-form";

const TEMPLATE: Partial<ProxyGroupData> = {
  name: "Proxys",
  type: "url-test",
  proxies: [],
  nested_groups: [],
  selector: { from_providers: [], exclude_type: [], include_region: [] },
  url: "http://cp.cloudflare.com/generate_204",
  interval: 600,
  tolerance: 50,
  timeout: 5,
};

export function GroupsPage() {
  return (
    <EntityListPage<ProxyGroupData>
      title="策略组模板 (Proxy Groups)"
      description="select / url-test / fallback / load-balance,可被多个 Profile 复用"
      kind="groups"
      renderRow={(g) => <GroupSummary group={g} />}
      template={TEMPLATE}
      renderDialog={({ entity, open, onOpenChange, defaultId }) => (
        <EntityVisualDialog<ProxyGroupData>
          kind="groups"
          entity={entity}
          open={open}
          onOpenChange={onOpenChange}
          defaultId={defaultId}
          templateValue={TEMPLATE}
          maxWidth="sm:max-w-3xl"
          description="可视化配置策略组,支持成员拖拽排序与动态 selector"
          renderForm={(data, update) => <ProxyGroupVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}

interface NodePoolResp {
  nodes: PoolNodeLike[];
}

/**
 * 列表行的成员摘要。旧版只显示 `g.proxies.length`,对「只配了 selector」或「只嵌套了其它组」
 * 的策略组一律显示 0 个成员 —— 而它们在订阅里其实成员满满,是纯粹的误导。
 * 这里按后端 resolveGroupMemberEntries 的口径把三段来源都算上。
 */
function GroupSummary({ group }: { group: ProxyGroupData }) {
  // queryKey 与编辑弹窗 / 节点池页共用,TanStack Query 自动去重,多行不会各发一次请求。
  const nodePool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get<NodePoolResp>("/api/dashboard/node-pool"),
    staleTime: 30_000,
  });

  const comp = useMemo(
    () => summarizeGroupComposition(group, nodePool.data?.nodes ?? []),
    [group, nodePool.data?.nodes],
  );

  // 节点池还没到手时,selector 那段数字不可信,先按"未知"展示,避免先闪一个 0 再跳到 256。
  const poolPending = comp.hasSelector && !nodePool.data;

  const parts: string[] = [];
  if (comp.locked > 0) parts.push(`锁定 ${comp.locked}`);
  if (comp.nested > 0) parts.push(`嵌套组 ${comp.nested}`);
  if (comp.hasSelector) parts.push(`selector 自动 ${poolPending ? "…" : comp.auto}`);

  const empty = !poolPending && comp.total === 0 && !comp.clientExpanded;

  return (
    <span className="text-xs inline-flex items-center gap-x-1.5 flex-wrap">
      <span>{group.type}</span>
      <span className="text-muted-foreground/50">·</span>
      {empty ? (
        <span
          className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"
          title={
            comp.hasSelector
              ? "selector 当前一个节点都没匹配到(条件过严 / 节点池为空 / 机场还没拉到节点)。生成订阅时成员为空,会被兜底塞一个 DIRECT。"
              : "该组既没有锁定节点、嵌套组,也没有配动态 selector。生成订阅时成员为空,会被兜底塞一个 DIRECT —— 打开编辑,锁定几个节点或配置 selector 即可。"
          }
        >
          <AlertTriangle className="h-3 w-3" />
          {comp.hasSelector ? "无成员 (selector 未匹配到节点)" : "无成员 (未配置任何成员)"}
        </span>
      ) : (
        <span
          className="tabular-nums"
          title="按当前节点池推演的成员数,与订阅实际输出同口径(profile 的 hidden_nodes / proxy-providers 可能再增减)"
        >
          共 {poolPending ? "…" : comp.total} 个成员
        </span>
      )}
      {parts.length > 1 && (
        <span className="text-muted-foreground/70">({parts.join(" · ")})</span>
      )}
      {comp.clientExpanded && (
        <span
          className="text-muted-foreground/70"
          title="开启了 include-all-proxies / policy-regex-filter / include-other-group,成员由 Surge 客户端自行展开,这里数不全"
        >
          + 客户端展开
        </span>
      )}
    </span>
  );
}
