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
      title="规则模块 (RuleSets)"
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
