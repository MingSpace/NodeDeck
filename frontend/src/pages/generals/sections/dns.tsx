import { Wifi, Waypoints } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldGroup, LabeledField, ToggleRow } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function DnsSection({ data, update }: Props) {
  const dns = data.dns ?? { enable: true };

  const setDns = (patch: Partial<NonNullable<GeneralPresetData["dns"]>>) => {
    update({ dns: { ...dns, ...patch } });
  };

  return (
    <div className="space-y-3">
      <ToggleRow
        label="启用 DNS 模块"
        hint="关闭后不输出 DNS 相关配置,客户端使用其自身默认 DNS。"
        checked={dns.enable}
        onChange={(v) => setDns({ enable: v })}
      />

      <FieldGroup
        icon={<Wifi className="h-3.5 w-3.5" />}
        title="Surge DNS"
        hint="仅 Surge 生效的 DNS 字段,留空则不输出。"
      >
        <LabeledField
          label="DNS 服务器"
          raw="dns-server"
          hint="Surge 使用的普通 DNS 服务器(UDP/TCP)。每行一个。"
        >
          <ListArea
            items={dns.server ?? []}
            onChange={(arr) => setDns({ server: arr.length ? arr : undefined })}
            placeholder="119.29.29.29"
          />
        </LabeledField>
        <LabeledField
          label="加密 DNS"
          raw="encrypted-dns-server"
          hint="Surge 使用的加密 DNS(DoH / DoT / DoQ)。每行一个,如 https://1.1.1.1/dns-query。"
        >
          <ListArea
            items={dns.encrypted_server ?? []}
            onChange={(arr) => setDns({ encrypted_server: arr.length ? arr : undefined })}
            placeholder="https://1.1.1.1/dns-query"
          />
        </LabeledField>
        <LabeledField
          label="劫持 DNS"
          raw="hijack-dns"
          hint="劫持指定地址的 DNS 请求交给 Surge 处理(常填 8.8.8.8:53),防止系统绕过。"
        >
          <ListArea
            items={dns.hijack ?? []}
            onChange={(arr) => setDns({ hijack: arr.length ? arr : undefined })}
            placeholder="8.8.8.8:53"
          />
        </LabeledField>
      </FieldGroup>

      <FieldGroup
        icon={<Waypoints className="h-3.5 w-3.5" />}
        title="Clash DNS"
        hint="仅 mihomo / Clash 生效的 DNS 字段。"
      >
        <LabeledField label="nameserver" raw="nameserver" hint="mihomo 默认 DNS 服务器,用于常规域名解析。">
          <ListArea
            items={dns.nameserver ?? []}
            onChange={(arr) => setDns({ nameserver: arr.length ? arr : undefined })}
            placeholder="119.29.29.29"
          />
        </LabeledField>
        <LabeledField label="fallback" raw="fallback" hint="回退 DNS(通常填国外 DoH),配合 fallback-filter 处理污染结果。">
          <ListArea
            items={dns.fallback ?? []}
            onChange={(arr) => setDns({ fallback: arr.length ? arr : undefined })}
            placeholder="https://1.1.1.1/dns-query"
          />
        </LabeledField>
        <div>
          <LabeledField
            label="节点域名解析 DNS"
            raw="proxy-server-nameserver"
            hint="专门用于解析代理节点域名的 DNS。必须非空,host 里的 server: 指定解析才会在 Clash 端生效。"
          >
            <ListArea
              items={dns.proxy_server_nameserver ?? []}
              onChange={(arr) => setDns({ proxy_server_nameserver: arr.length ? arr : undefined })}
              placeholder="https://doh.pub/dns-query"
            />
          </LabeledField>
          {!dns.proxy_server_nameserver?.length && (
            <div className="text-[11px] text-rose-600 mt-1 leading-relaxed">
              留空时,host 里 <span className="font-mono">server:</span> 条目(指定 DoH 解析节点域名)在 Clash 端不会生效
              ——mihomo 要求 <span className="font-mono">proxy-server-nameserver</span> 非空,
              <span className="font-mono">proxy-server-nameserver-policy</span> 才生效。
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <LabeledField label="增强模式" raw="enhanced-mode" hint="fake-ip 返回虚假 IP(性能好,推荐)/ redir-host 真实解析。">
            <Select
              value={dns.enhanced_mode ?? "__none__"}
              onValueChange={(v) => setDns({ enhanced_mode: v === "__none__" ? undefined : (v as "fake-ip" | "redir-host") })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(不指定)</SelectItem>
                <SelectItem value="fake-ip">fake-ip</SelectItem>
                <SelectItem value="redir-host">redir-host</SelectItem>
              </SelectContent>
            </Select>
          </LabeledField>
          <LabeledField label="fake-ip 网段" raw="fake-ip-range" hint="fake-ip 模式使用的虚假 IP 网段,一般无需改动。">
            <Input
              value={dns.fake_ip_range ?? ""}
              onChange={(e) => setDns({ fake_ip_range: e.target.value || undefined })}
              placeholder="198.18.0.1/16"
            />
          </LabeledField>
        </div>
      </FieldGroup>
    </div>
  );
}

function ListArea({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (arr: string[]) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={items.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
      className="w-full min-h-[60px] border rounded-md p-2 text-xs font-mono"
      placeholder={placeholder ? `每行一个,例如:\n${placeholder}` : "每行一个"}
    />
  );
}
