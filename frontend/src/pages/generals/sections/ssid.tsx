import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LabeledField, ToggleRow, InfoHint } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

/**
 * Surge Subnet Settings(产物段名为兼容历史仍是 `[SSID Setting]`)。
 * 字段与取值范围跟 backend/src/schemas/general-preset.ts 的 ssidRuleSchema 保持同步。
 *
 * 注意这里**没有"策略"**:本段只改设置,按网络切策略是 subnet 策略组 / SUBNET 规则的事。
 */

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

type SsidRule = NonNullable<GeneralPresetData["ssid_rules"]>[number];

const platformBadge = (text: string) => (
  <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal text-muted-foreground">
    {text}
  </Badge>
);

const MATCH_PREFIXES = [
  { value: "SSID", label: "SSID · Wi-Fi 名称", placeholder: "MyHomeWiFi(支持 * ? 通配)" },
  { value: "BSSID", label: "BSSID · 指定 AP 的 MAC", placeholder: "00:11:22:33:44:55" },
  { value: "ROUTER", label: "ROUTER · 网关 IP", placeholder: "192.168.1.1" },
  { value: "TYPE", label: "TYPE · 网络类型", placeholder: "" },
  { value: "MCCMNC", label: "MCCMNC · 运营商代码", placeholder: "460-11" },
  { value: "__bare__", label: "裸值(兼容旧写法)", placeholder: "MyHomeWiFi" },
] as const;

const NETWORK_TYPES = [
  { value: "WIFI", label: "WIFI · 所有 Wi-Fi" },
  { value: "WIRED", label: "WIRED · 有线" },
  { value: "CELLULAR", label: "CELLULAR · 蜂窝(iOS)" },
] as const;

function splitMatch(match: string): { prefix: string; value: string } {
  const m = /^(SSID|BSSID|ROUTER|TYPE|MCCMNC):([\s\S]*)$/i.exec(match);
  return m ? { prefix: m[1].toUpperCase(), value: m[2] } : { prefix: "__bare__", value: match };
}

function joinMatch(prefix: string, value: string): string {
  return prefix === "__bare__" ? value : `${prefix}:${value}`;
}

/** 一行里所有参数都空 → generator 会跳过该行(裸表达式在 Surge 里是空操作)。 */
function hasNoParams(r: SsidRule): boolean {
  return (
    r.suspend === undefined
    && r.cellular_mode === undefined
    && !r.cellular_fallback
    && !r.tfo_behaviour
    && !r.dns_server?.length
    && !r.encrypted_dns_server?.length
  );
}

function parseList(text: string): string[] | undefined {
  const items = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function SsidSection({ data, update }: Props) {
  const rules = data.ssid_rules ?? [];
  const patch = (i: number, r: SsidRule) => {
    const next = rules.slice();
    next[i] = r;
    update({ ssid_rules: next });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        仅 Surge 生效 · 在匹配的网络下套用一组设置
        <InfoHint>
          官方文档名 Subnet Settings,配置里的段名为兼容历史仍叫 [SSID Setting]。命中当前网络时套用挂起 / DNS
          覆盖 / TFO 等设置。它不负责选策略 —— 想按网络切代理请用 subnet 策略组或 SUBNET 规则。
        </InfoHint>
      </div>
      {rules.length === 0 && (
        <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          暂无网络环境设置
        </div>
      )}
      {rules.map((r, i) => {
        const { prefix, value } = splitMatch(r.match);
        const meta = MATCH_PREFIXES.find((p) => p.value === prefix) ?? MATCH_PREFIXES[0];
        return (
          <div key={i} className="space-y-2 rounded-md border p-2.5">
            <div className="flex items-end gap-2">
              <LabeledField
                label="匹配网络"
                raw="subnet expression"
                hint="按当前接入的网络匹配。前缀形式需 iOS 4.12.0+ / Mac 4.5.0+;裸值是兼容旧配置的写法,会依次按 SSID / BSSID / 网关 IP 比对。"
                className="w-[172px] shrink-0"
              >
                <Select value={prefix} onValueChange={(p) => patch(i, { ...r, match: joinMatch(p, value) })}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCH_PREFIXES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </LabeledField>
              <div className="flex-1">
                {prefix === "TYPE" ? (
                  <Select
                    value={value.toUpperCase()}
                    onValueChange={(v) => patch(i, { ...r, match: joinMatch(prefix, v) })}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue placeholder="选择网络类型" />
                    </SelectTrigger>
                    <SelectContent>
                      {NETWORK_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={value}
                    onChange={(e) => patch(i, { ...r, match: joinMatch(prefix, e.target.value) })}
                    placeholder={meta.placeholder}
                    className="text-xs"
                  />
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => update({ ssid_rules: rules.filter((_, idx) => idx !== i) })}
                title="删除该条"
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>

            {value.trim() === "" && (
              <div className="text-[11px] text-destructive">匹配表达式不能为空,否则该行生成时会被跳过</div>
            )}

            <div className="divide-y rounded-md border">
              <ToggleRow
                label="挂起 Surge"
                raw="suspend"
                hint="连接该网络时暂停 Surge(所有流量直连),离开后恢复。适合在可信内网关闭代理。注意只在切换网络时触发:已经连着该网络再手动启动 Surge 不会被挂起。"
                checked={r.suspend ?? false}
                onChange={(v) => patch(i, { ...r, suspend: v || undefined })}
                className="px-2.5"
              />
              <ToggleRow
                label="视为计费网络"
                raw="cellular-mode"
                badge={platformBadge("Mac")}
                hint="把该网络当计费网络,自动开启 Metered Network Mode:只有允许列表里的应用能联网。允许列表在 Surge Mac 客户端里配。"
                checked={r.cellular_mode ?? false}
                onChange={(v) => patch(i, { ...r, cellular_mode: v || undefined })}
                className="px-2.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <LabeledField
                label={<span className="flex items-center gap-1.5">Wi-Fi 助理 {platformBadge("iOS")}</span>}
                raw="cellular-fallback"
                hint="覆盖该网络下的 Wi-Fi 助理 / 混合网络行为:default 跟随全局 / off 关闭 / wifi-assist 仅 Wi-Fi 助理 / hybrid 混合网络。"
              >
                <Select
                  value={r.cellular_fallback ?? "__none__"}
                  onValueChange={(v) =>
                    patch(i, {
                      ...r,
                      cellular_fallback:
                        v === "__none__" ? undefined : (v as SsidRule["cellular_fallback"]),
                    })
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不设置</SelectItem>
                    <SelectItem value="default">default · 跟随全局</SelectItem>
                    <SelectItem value="off">off · 关闭</SelectItem>
                    <SelectItem value="wifi-assist">wifi-assist · 仅 Wi-Fi 助理</SelectItem>
                    <SelectItem value="hybrid">hybrid · 混合网络</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>

              <LabeledField
                label="TCP Fast Open"
                raw="tfo-behaviour"
                hint="覆盖该网络下的 TFO 行为。force-enabled 会忽略系统黑洞检测 —— 配之前先确认该网络真的支持 TFO,否则代理会完全连不上。iOS 4.12.0+ / Mac 4.5.0+。"
              >
                <Select
                  value={r.tfo_behaviour ?? "__none__"}
                  onValueChange={(v) =>
                    patch(i, {
                      ...r,
                      tfo_behaviour: v === "__none__" ? undefined : (v as SsidRule["tfo_behaviour"]),
                    })
                  }
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不设置</SelectItem>
                    <SelectItem value="auto">auto · 系统默认</SelectItem>
                    <SelectItem value="force-enabled">force-enabled · 强制开启</SelectItem>
                    <SelectItem value="force-disabled">force-disabled · 强制关闭</SelectItem>
                  </SelectContent>
                </Select>
              </LabeledField>

              <LabeledField
                label="DNS 上游"
                raw="dns-server"
                hint="该网络下的 DNS 服务器,逗号分隔;填 system 表示用系统 DNS。常用于公司内网需要走内部 DNS 解析的场景。"
              >
                <Input
                  value={(r.dns_server ?? []).join(", ")}
                  onChange={(e) => patch(i, { ...r, dns_server: parseList(e.target.value) })}
                  placeholder="192.168.1.1, system"
                  className="text-xs"
                />
              </LabeledField>

              <LabeledField
                label="加密 DNS"
                raw="encrypted-dns-server"
                hint="该网络下的加密 DNS(DoH / DoQ URL),逗号分隔。全局配了加密 DNS 而这里想退回传统 DNS,必须显式填 off。"
              >
                <Input
                  value={(r.encrypted_dns_server ?? []).join(", ")}
                  onChange={(e) => patch(i, { ...r, encrypted_dns_server: parseList(e.target.value) })}
                  placeholder="off 或 https://1.1.1.1/dns-query"
                  className="text-xs"
                />
              </LabeledField>
            </div>

            {hasNoParams(r) && (
              <div className="text-[11px] text-muted-foreground">
                没有任何生效参数,该行不会写进配置(裸表达式在 Surge 里是空操作)
              </div>
            )}
          </div>
        );
      })}
      <Button
        size="sm"
        variant="outline"
        onClick={() => update({ ssid_rules: [...rules, { match: "SSID:" }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        添加网络环境
      </Button>
    </div>
  );
}
