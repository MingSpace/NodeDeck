import { Puzzle } from "lucide-react";
import { useEntityList } from "@/api/entities";
import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { SurgeModuleVisualForm, type SurgeModuleData } from "./visual-form";
import { ModuleRow } from "./module-row";
import { useModuleStatus } from "./api";

const TEMPLATE: Partial<SurgeModuleData> = {
  name: "新模块",
  description: "",
  source: "local",
  public: false,
  content_sections: {
    mitm: "hostname = %APPEND% example.com",
  },
};

export function ModulesPage() {
  const status = useModuleStatus();
  const statusById = new Map((status.data?.items ?? []).map((s) => [s.id, s]));
  // 与 backend/src/refs/entity-references.ts 的 modules 分支同源:只有 profile.surge_modules 按 id 引用模块
  const profiles = useEntityList<{ id: string; name: string; surge_modules?: string[] }>("profiles");
  const usedBy = (id: string) =>
    (profiles.data?.items ?? []).filter((p) => p.surge_modules?.includes(id)).map(({ id, name }) => ({ id, name }));
  return (
    <EntityListPage<SurgeModuleData>
      title="Surge 模块"
      icon={Puzzle}
      emptyDescription="Surge 模块用来放 MITM、URL 重写、规则和脚本。可以被 Profile 引用并进 Surge 订阅,也可以用单独的链接装到设备上;内容可以在这里编辑,也可以引用远程 .sgmodule。Clash 订阅不受影响。"
      description="Profile 引用即并入订阅;每个模块另有公开链接,可在各设备上单独安装、各自开关"
      kind="modules"
      renderRow={(m) => (
        <ModuleRow
          module={m}
          status={statusById.get(m.id)}
          usedBy={profiles.data ? usedBy(m.id) : undefined}
        />
      )}
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
          description="本地按段编辑,或引用远程 .sgmodule;内容一律按 Surge 模块语法"
          renderForm={(data, update) => <SurgeModuleVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}
