import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { ProxyGroupVisualForm, type ProxyGroupData } from "./visual-form";

const TEMPLATE: Partial<ProxyGroupData> = {
  name: "Proxys",
  type: "url-test",
  proxies: [],
  selector: { from_providers: [], include_other_group: [], exclude_type: [], include_region: [] },
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
      renderRow={(g) => (
        <span className="text-xs">
          {g.type} · {g.proxies.length} 个成员
        </span>
      )}
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
