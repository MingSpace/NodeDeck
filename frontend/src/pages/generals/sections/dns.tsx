import { LabeledField } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function DnsSection({ data, update }: Props) {
  const dns = data.dns ?? {};

  const setDns = (patch: Partial<NonNullable<GeneralPresetData["dns"]>>) => {
    update({ dns: { ...dns, ...patch } });
  };

  return (
    <div className="space-y-3">
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
