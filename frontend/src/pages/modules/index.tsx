import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { SurgeModuleVisualForm, type SurgeModuleData } from "./visual-form";

const TEMPLATE: Partial<SurgeModuleData> = {
  name: "新模块",
  description: "",
  content_sections: {
    mitm: "hostname = %APPEND% example.com",
  },
};

export function ModulesPage() {
  return (
    <EntityListPage<SurgeModuleData>
      title="Surge 模块 (Surge Modules)"
      description="MITM / URL Rewrite / Header Rewrite / Script;仅在 Surge 输出中生效"
      kind="modules"
      renderRow={(m) => <span className="text-xs">{m.description ?? "-"}</span>}
      template={TEMPLATE}
      renderDialog={({ entity, open, onOpenChange, defaultId }) => (
        <EntityVisualDialog<SurgeModuleData>
          kind="modules"
          entity={entity}
          open={open}
          onOpenChange={onOpenChange}
          defaultId={defaultId}
          templateValue={TEMPLATE}
          maxWidth="sm:max-w-4xl"
          description="按段编辑模块内容,每段对应 Surge 配置文件中的一个 [Section]"
          renderForm={(data, update) => <SurgeModuleVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}
