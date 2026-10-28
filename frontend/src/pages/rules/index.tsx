import { Filter } from "lucide-react";
import { EntityListPage } from "@/components/entity-list-page";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { RuleSetVisualForm, type RuleSetData } from "./visual-form";

const TEMPLATE: Partial<RuleSetData> = {
  name: "新规则",
  type: "remote_url",
  url: "https://ruleset.skk.moe/List/non_ip/example.conf",
  behavior: "classical",
  format: "yaml",
  clash_format: "rule_provider",
  surge_format: "rule_set",
  update_interval: 86400,
};

export function RulesPage() {
  return (
    <EntityListPage<RuleSetData>
      title="规则模块"
      icon={Filter}
      emptyDescription="规则模块决定哪些流量走哪个策略组。可以引用远程规则集 URL,也可以直接写几条规则,再到 Profile 里按顺序启用。"
      description="RULE-SET URL / DOMAIN-SET / inline 规则,Profile 中按顺序引用"
      kind="rules"
      renderRow={(r) => (
        <span className="text-xs">
          {r.type} · {r.behavior} · {r.url ?? "inline"}
        </span>
      )}
      template={TEMPLATE}
      renderDialog={({ entity, open, onOpenChange, defaultId }) => (
        <EntityVisualDialog<RuleSetData>
          kind="rules"
          entity={entity}
          open={open}
          onOpenChange={onOpenChange}
          defaultId={defaultId}
          templateValue={TEMPLATE}
          description="可视化编辑规则集字段;复杂结构可切换 YAML 模式"
          renderForm={(data, update) => <RuleSetVisualForm data={data} update={update} />}
        />
      )}
    />
  );
}
