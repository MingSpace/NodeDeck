import { useEffect, useState } from "react";
import { Flag, Ban } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FieldGroup, LabeledField, ToggleRow } from "@/components/config-fields";

export interface RuleSetData {
  id: string;
  name: string;
  description?: string;
  policy?: string;
  type: "remote_url" | "inline_list" | "geosite" | "geoip" | "surge_internal";
  url?: string;
  payload?: string[];
  geoip_country_code?: string;
  surge_internal_name?: "SYSTEM" | "LAN";
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

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="类型"
          hint="规则集来源:remote_url 远程订阅链接;inline_list 手写规则;geosite 用手写规则或 DOMAIN-SET 链接替代;geoip 国家代码;surge_internal Surge 内置集(SYSTEM / LAN)。"
        >
          <Select value={data.type} onValueChange={(v) => update({ type: v as RuleSetData["type"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="remote_url">remote_url</SelectItem>
              <SelectItem value="inline_list">inline_list</SelectItem>
              <SelectItem value="geosite">geosite</SelectItem>
              <SelectItem value="geoip">geoip</SelectItem>
              <SelectItem value="surge_internal">surge_internal (SYSTEM/LAN)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="输出方式"
          hint="RULE-SET:输出为 RULE-SET 远程引用(推荐)。inline ruleset:内联展开为多条规则。DOMAIN-SET:输出为纯域名集合文件(仅域名类可用,匹配更快)。"
        >
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
          <PayloadTextarea
            value={data.payload ?? []}
            onChange={(payload) => update({ payload })}
            className="min-h-[120px]"
            placeholder="DOMAIN-SUFFIX,example.com"
          />
        </Field>
      )}

      {data.type === "geosite" && (
        <div className="space-y-3">
          <Field label="inline 规则 (Surge 无原生 GEOSITE,手写规则替代)">
            <PayloadTextarea
              value={data.payload ?? []}
              onChange={(payload) => update({ payload })}
              className="min-h-[80px]"
              placeholder="DOMAIN-SUFFIX,google.com"
            />
          </Field>
          <Field label="DOMAIN-SET 远程链接 (与 inline 规则二选一)">
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

      {data.type === "surge_internal" && (
        <div className="space-y-2">
          <Field label="Surge 内置 ruleset 名">
            <Select
              value={data.surge_internal_name ?? "SYSTEM"}
              onValueChange={(v) => update({ surge_internal_name: v as "SYSTEM" | "LAN" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SYSTEM">SYSTEM (macOS/iOS 系统服务直连)</SelectItem>
                <SelectItem value="LAN">LAN (本地网络直连,会触发 DNS 查询)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}


      <div className="grid grid-cols-2 gap-3">
        <Field label="默认策略 (policy, 可在 Profile 覆盖)">
          <Input
            value={data.policy ?? ""}
            onChange={(e) => update({ policy: e.target.value || undefined })}
            placeholder="DIRECT / Proxy / ..."
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

      <FieldGroup
        icon={<Flag className="h-3.5 w-3.5" />}
        title="规则修饰符"
        hint="附加在规则末尾的可选修饰符,微调匹配 / 解析行为。"
      >
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <ToggleRow
            label="no-resolve"
            hint="IP 类规则匹配时不触发 DNS 解析,避免为域名提前解析 IP。仅对 IP-CIDR / GEOIP 等 IP 规则有意义。"
            checked={flags.no_resolve ?? false}
            onChange={(v) => update({ surge_flags: { ...flags, no_resolve: v } })}
          />
          <ToggleRow
            label="extended-matching"
            hint="启用扩展匹配(结合 SNI / Host),提升域名规则命中率。"
            checked={flags.extended_matching ?? false}
            onChange={(v) => update({ surge_flags: { ...flags, extended_matching: v } })}
          />
          <ToggleRow
            label="pre-matching"
            hint="在建立连接前预匹配规则,可降低延迟。"
            checked={flags.pre_matching ?? false}
            onChange={(v) => update({ surge_flags: { ...flags, pre_matching: v } })}
          />
          <ToggleRow
            label="dns-failed"
            badge={<Badge variant="outline" className="px-1 py-0 text-xs font-normal text-muted-foreground">FINAL</Badge>}
            hint="仅用于 FINAL 规则:DNS 解析失败的流量交给该策略处理。"
            checked={flags.dns_failed ?? false}
            onChange={(v) => update({ surge_flags: { ...flags, dns_failed: v } })}
          />
          <ToggleRow
            label="force-remote-dns"
            hint="命中的域名强制使用远程 DNS 解析(走代理侧解析)。"
            checked={flags.force_remote_dns ?? false}
            onChange={(v) => update({ surge_flags: { ...flags, force_remote_dns: v } })}
          />
        </div>
      </FieldGroup>

      <FieldGroup
        icon={<Ban className="h-3.5 w-3.5" />}
        title="Surge REJECT 行为"
        hint="当该规则集的策略为 REJECT 时,自定义拒绝方式与通知。"
        trailing={
          <Switch
            checked={!!reject}
            onCheckedChange={(v) =>
              update({
                surge_reject_options: v
                  ? { type: "REJECT", notification_text: undefined, notification_interval: undefined }
                  : undefined,
              })
            }
            aria-label="启用 Surge REJECT 行为"
          />
        }
      >
        {reject ? (
          <>
            <LabeledField
              label="拒绝方式"
              raw="type"
              hint="REJECT 返回错误 / 断开;REJECT-DROP 静默丢包更省电;REJECT-NO-DROP 发 RST 立即断开;REJECT-TINYGIF 返回 1x1 透明图,适合图片广告位。"
            >
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
                  <SelectItem value="REJECT">REJECT · 返回错误 / 断开</SelectItem>
                  <SelectItem value="REJECT-DROP">REJECT-DROP · 静默丢弃</SelectItem>
                  <SelectItem value="REJECT-NO-DROP">REJECT-NO-DROP · 发送 RST 断开</SelectItem>
                  <SelectItem value="REJECT-TINYGIF">REJECT-TINYGIF · 返回 1x1 透明图</SelectItem>
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="通知文案" raw="notification-text" hint="触发拒绝时弹出的系统通知内容,留空则不通知。">
              <Input
                value={reject.notification_text ?? ""}
                onChange={(e) => update({ surge_reject_options: { ...reject, notification_text: e.target.value || undefined } })}
              />
            </LabeledField>
            <LabeledField label="通知间隔 (秒)" raw="notification-interval" hint="同一条拒绝通知的最小间隔,防止频繁弹出刷屏。">
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
            </LabeledField>
          </>
        ) : (
          <div className="text-xs italic text-muted-foreground">未启用 — 命中 REJECT 策略时使用客户端默认行为</div>
        )}
      </FieldGroup>
    </div>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <LabeledField label={label} hint={hint}>
      {children}
    </LabeledField>
  );
}

// payload 是 string[],但直接把 join/split+filter(Boolean) 放进受控 textarea 会导致:
// 每次按回车产生的空行在 onChange 里被立刻过滤掉,重渲染后换行消失 —— 用户根本敲不出回车。
// 这里保留一份本地原始文本,允许自由换行(含空行);只把过滤后的数组同步给父级,
// 落盘数据仍然干净。仅当外部 value(切 YAML 模式 / 重开条目)与当前过滤结果不一致时才回填。
function PayloadTextarea({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => value.join("\n"));
  useEffect(() => {
    if (value.join("\n") !== text.split("\n").filter(Boolean).join("\n")) {
      setText(value.join("\n"));
    }
  }, [value]);
  return (
    <textarea
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split("\n").filter(Boolean));
      }}
      className={`w-full border rounded-md p-2 text-sm font-mono ${className ?? ""}`}
      placeholder={placeholder}
    />
  );
}
