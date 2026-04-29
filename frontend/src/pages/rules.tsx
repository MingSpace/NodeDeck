import { EntityListPage } from "@/components/entity-list-page";

interface RuleSet {
  id: string;
  name: string;
  type: string;
  url?: string;
  behavior: string;
  policy?: string;
}

export function RulesPage() {
  return (
    <EntityListPage<RuleSet>
      title="规则模块 (RuleSets)"
      description="RULE-SET URL / DOMAIN-SET / inline 规则,Profile 中按顺序引用"
      kind="rules"
      renderRow={(r) => (
        <span className="text-xs">
          {r.type} · {r.behavior} · {r.url ?? "inline"}
        </span>
      )}
      template={{
        name: "新规则",
        type: "remote_url",
        url: "https://ruleset.skk.moe/List/non_ip/example.conf",
        behavior: "classical",
        format: "yaml",
        clash_format: "rule_provider",
        surge_format: "rule_set",
        update_interval: 86400,
      } as Partial<RuleSet>}
    />
  );
}
