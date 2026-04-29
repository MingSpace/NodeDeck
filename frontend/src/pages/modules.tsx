import { EntityListPage } from "@/components/entity-list-page";

interface SurgeModule {
  id: string;
  name: string;
  description?: string;
  enabled_by_default: boolean;
}

export function ModulesPage() {
  return (
    <EntityListPage<SurgeModule>
      title="Surge 模块 (Surge Modules)"
      description="MITM / URL Rewrite / Header Rewrite / Script;仅在 Surge 输出中生效"
      kind="modules"
      renderRow={(m) => <span className="text-xs">{m.description ?? "-"}</span>}
      template={{
        name: "新模块",
        description: "",
        enabled_by_default: true,
        content_sections: {
          general: "",
          host: "",
          mitm: "hostname = %APPEND% example.com",
          url_rewrite: "",
          header_rewrite: "",
          script: "",
        },
      } as Partial<SurgeModule>}
    />
  );
}
