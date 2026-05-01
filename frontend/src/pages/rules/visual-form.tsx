import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface RuleSetData {
  id: string;
  name: string;
  description?: string;
  policy?: string;
  type: "remote_url" | "inline_list" | "geosite" | "geoip";
  url?: string;
  payload?: string[];
  geosite_category?: string;
  geoip_country_code?: string;
  behavior: "domain" | "ipcidr" | "classical";
  format: "yaml" | "text" | "mrs";
  surge_flags?: {
    no_resolve?: boolean;
    extended_matching?: boolean;
    pre_matching?: boolean;
    dns_failed?: boolean;
    force_remote_dns?: boolean;
  };
  surge_reject_options?: {
    type: "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF";
    notification_text?: string;
    notification_interval?: number;
  };
  clash_format: "rule_provider" | "inline";
  surge_format: "rule_set" | "inline_ruleset" | "domain_set";
  update_interval: number;
}

interface Props {
  data: RuleSetData;
  update: (patch: Partial<RuleSetData>) => void;
}

export function RuleSetVisualForm({ data, update }: Props) {
  const flags = data.surge_flags ?? {};
  const reject = data.surge_reject_options;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID (文件名)">
          <Input value={data.id} onChange={(e) => update({ id: e.target.value })} />
        </Field>
        <Field label="显示名">
          <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
      </div>

      <Field label="描述 (可选)">
        <Input
          value={data.description ?? ""}
          onChange={(e) => update({ description: e.target.value || undefined })}
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="类型">
          <Select value={data.type} onValueChange={(v) => update({ type: v as RuleSetData["type"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="remote_url">remote_url</SelectItem>
              <SelectItem value="inline_list">inline_list</SelectItem>
              <SelectItem value="geosite">geosite</SelectItem>
              <SelectItem value="geoip">geoip</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="behavior">
          <Select value={data.behavior} onValueChange={(v) => update({ behavior: v as RuleSetData["behavior"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="domain">domain</SelectItem>
              <SelectItem value="ipcidr">ipcidr</SelectItem>
              <SelectItem value="classical">classical</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="format (Clash)">
          <Select value={data.format} onValueChange={(v) => update({ format: v as RuleSetData["format"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yaml">yaml</SelectItem>
              <SelectItem value="text">text</SelectItem>
              <SelectItem value="mrs">mrs</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {data.type === "remote_url" && (
        <Field label="URL">
          <Input
            value={data.url ?? ""}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://ruleset.skk.moe/List/non_ip/cn.conf"
          />
        </Field>
      )}

      {data.type === "inline_list" && (
        <Field label="payload (每行一条规则)">
          <textarea
            value={(data.payload ?? []).join("\n")}
            onChange={(e) => update({ payload: e.target.value.split("\n").filter(Boolean) })}
            className="w-full min-h-[120px] border rounded-md p-2 text-sm font-mono"
            placeholder="DOMAIN-SUFFIX,example.com"
          />
        </Field>
      )}

      {data.type === "geosite" && (
        <div className="space-y-3">
          <Field label="GEOSITE 分类 (Clash, 不填回退到 ID)">
            <Input
              value={data.geosite_category ?? ""}
              onChange={(e) => update({ geosite_category: e.target.value || undefined })}
              placeholder="cn / google / youtube / netflix ..."
            />
          </Field>
          <Field label="Surge fallback payload (Surge 无原生 GEOSITE,可手写 inline 规则备用)">
            <textarea
              value={(data.payload ?? []).join("\n")}
              onChange={(e) => update({ payload: e.target.value.split("\n").filter(Boolean) })}
              className="w-full min-h-[80px] border rounded-md p-2 text-sm font-mono"
              placeholder="DOMAIN-SUFFIX,google.com"
            />
          </Field>
          <Field label="Surge fallback URL (DOMAIN-SET 远程链接,二选一)">
            <Input
              value={data.url ?? ""}
              onChange={(e) => update({ url: e.target.value || undefined })}
              placeholder="https://ruleset.skk.moe/List/domainset/google.conf"
            />
          </Field>
        </div>
      )}

      {data.type === "geoip" && (
        <Field label="GEOIP 国家代码 (不填回退到 ID)">
          <Input
            value={data.geoip_country_code ?? ""}
            onChange={(e) => update({ geoip_country_code: (e.target.value || undefined)?.toUpperCase() })}
            placeholder="CN / US / JP ..."
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Clash 输出方式">
          <Select value={data.clash_format} onValueChange={(v) => update({ clash_format: v as RuleSetData["clash_format"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rule_provider">rule-provider (推荐)</SelectItem>
              <SelectItem value="inline">inline</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Surge 输出方式">
          <Select value={data.surge_format} onValueChange={(v) => update({ surge_format: v as RuleSetData["surge_format"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rule_set">RULE-SET (推荐)</SelectItem>
              <SelectItem value="inline_ruleset">inline ruleset</SelectItem>
              <SelectItem value="domain_set">DOMAIN-SET</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="默认策略 (policy, 可在 Profile 覆盖)">
          <Input
            value={data.policy ?? ""}
            onChange={(e) => update({ policy: e.target.value || undefined })}
            placeholder="DIRECT / Proxys / ..."
          />
        </Field>
        <Field label="刷新间隔 (秒)">
          <Input
            type="number"
            value={data.update_interval}
            onChange={(e) => update({ update_interval: parseInt(e.target.value || "86400", 10) })}
          />
        </Field>
      </div>

      <fieldset className="border rounded-md p-3">
        <legend className="text-xs font-medium px-1">Surge flags</legend>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <FlagCheck label="no-resolve" checked={flags.no_resolve ?? false} onChange={(v) => update({ surge_flags: { ...flags, no_resolve: v } })} />
          <FlagCheck label="extended-matching" checked={flags.extended_matching ?? false} onChange={(v) => update({ surge_flags: { ...flags, extended_matching: v } })} />
          <FlagCheck label="pre-matching" checked={flags.pre_matching ?? false} onChange={(v) => update({ surge_flags: { ...flags, pre_matching: v } })} />
          <FlagCheck label="dns-failed (FINAL only)" checked={flags.dns_failed ?? false} onChange={(v) => update({ surge_flags: { ...flags, dns_failed: v } })} />
          <FlagCheck label="force-remote-dns" checked={flags.force_remote_dns ?? false} onChange={(v) => update({ surge_flags: { ...flags, force_remote_dns: v } })} />
        </div>
      </fieldset>

      <fieldset className="border rounded-md p-3">
        <legend className="text-xs font-medium px-1 flex items-center gap-2">
          Surge REJECT 选项
          <input
            type="checkbox"
            checked={!!reject}
            onChange={(e) =>
              update({
                surge_reject_options: e.target.checked
                  ? { type: "REJECT", notification_text: undefined, notification_interval: undefined }
                  : undefined,
              })
            }
          />
          <span className="text-muted-foreground font-normal">启用</span>
        </legend>
        {reject && (
          <div className="space-y-2">
            <Field label="类型">
              <Select
                value={reject.type}
                onValueChange={(v) =>
                  update({
                    surge_reject_options: { ...reject, type: v as typeof reject.type },
                  })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REJECT">REJECT</SelectItem>
                  <SelectItem value="REJECT-DROP">REJECT-DROP</SelectItem>
                  <SelectItem value="REJECT-NO-DROP">REJECT-NO-DROP</SelectItem>
                  <SelectItem value="REJECT-TINYGIF">REJECT-TINYGIF</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="notification-text">
              <Input
                value={reject.notification_text ?? ""}
                onChange={(e) => update({ surge_reject_options: { ...reject, notification_text: e.target.value || undefined } })}
              />
            </Field>
            <Field label="notification-interval (秒)">
              <Input
                type="number"
                value={reject.notification_interval ?? ""}
                onChange={(e) =>
                  update({
                    surge_reject_options: {
                      ...reject,
                      notification_interval: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    },
                  })
                }
              />
            </Field>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function FlagCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
