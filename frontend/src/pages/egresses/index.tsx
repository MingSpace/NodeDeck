import { useEntityList } from "@/api/entities";
import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import type { ProviderData } from "@/pages/providers/visual-form";
import { EgressVisualForm, egressAddress, type EgressData } from "./visual-form";

const TEMPLATE: Partial<EgressData> = {
  name: "新出口",
  type: "ssh",
  port: 22,
  username: "root",
  auth: "key",
};

const TYPE_LABEL: Record<EgressData["type"], string> = { ssh: "SSH", proxy: "代理" };

export function EgressesPage() {
  // 每个出口被哪些节点源用着,行内直接列出来,删之前心里有数
  const providers = useEntityList<ProviderData>("providers");
  const usedBy = (id: string) =>
    (providers.data?.items ?? []).filter((p) => p.fetch_via?.includes(id)).map((p) => p.name);

  return (
    <EntityListPage<EgressData>
      title="出口 (Egresses)"
      description="机场按来源 IP 拦截服务器时,借这些机器的网络拉订阅;在节点源的「拉取线路」里按顺序选用"
      kind="egresses"
      template={TEMPLATE}
      renderRow={(e) => {
        const names = usedBy(e.id);
        return (
          <span className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 rounded border px-1.5 text-[10px] font-medium uppercase tracking-wide">
              {TYPE_LABEL[e.type]}
            </span>
            <span className="font-mono truncate">{egressAddress(e)}</span>
            <span className="shrink-0 text-muted-foreground/70">
              {names.length > 0 ? `· ${names.join("、")} 在用` : "· 未被使用"}
            </span>
          </span>
        );
      }}
      renderDialog={({ entity, open, onOpenChange, defaultId }) => (
        <EntityVisualDialog<EgressData>
          kind="egresses"
          entity={entity}
          open={open}
          onOpenChange={onOpenChange}
          // 通用列表页按 kind 去掉末尾 s 拼 id,egresses 会变成 egresse-xxx
          defaultId={defaultId.replace(/^egresse-/, "egress-")}
          templateValue={TEMPLATE}
          maxWidth="sm:max-w-2xl"
          description="拉订阅时借用的机器。保存后到节点源的「拉取线路」里选上"
          renderForm={(data, update) => <EgressVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}
