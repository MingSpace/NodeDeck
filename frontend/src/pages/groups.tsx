import { EntityListPage } from "@/components/entity-list-page";

interface ProxyGroup {
  id: string;
  name: string;
  type: string;
  proxies: string[];
  url?: string;
  interval?: number;
}

export function GroupsPage() {
  return (
    <EntityListPage<ProxyGroup>
      title="策略组模板 (Proxy Groups)"
      description="select / url-test / fallback / load-balance,可被多个 Profile 复用"
      kind="groups"
      renderRow={(g) => (
        <span className="text-xs">
          {g.type} · {g.proxies.length} 个成员
        </span>
      )}
      template={{
        name: "Proxys",
        type: "url-test",
        proxies: [],
        selector: { from_providers: [], include_other_group: [], exclude_type: [] },
        url: "http://cp.cloudflare.com/generate_204",
        interval: 600,
        tolerance: 50,
        timeout: 5,
      } as unknown as Partial<ProxyGroup>}
    />
  );
}
