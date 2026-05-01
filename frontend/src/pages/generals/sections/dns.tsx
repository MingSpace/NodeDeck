import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={dns.enable} onChange={(e) => setDns({ enable: e.target.checked })} />
        启用 DNS 模块
      </label>

      <div className="text-xs text-muted-foreground border-t pt-2">
        以下为 Surge / Mihomo 共用与各自专属字段(留空则不输出)
      </div>

      <ListField
        label="server (Surge dns-server)"
        items={dns.server ?? []}
        onChange={(arr) => setDns({ server: arr.length ? arr : undefined })}
        placeholder="119.29.29.29"
      />
      <ListField
        label="encrypted_server (Surge encrypted-dns-server)"
        items={dns.encrypted_server ?? []}
        onChange={(arr) => setDns({ encrypted_server: arr.length ? arr : undefined })}
        placeholder="https://1.1.1.1/dns-query"
      />
      <ListField
        label="hijack (Surge hijack-dns)"
        items={dns.hijack ?? []}
        onChange={(arr) => setDns({ hijack: arr.length ? arr : undefined })}
        placeholder="8.8.8.8:53"
      />
      <ListField
        label="nameserver (Clash)"
        items={dns.nameserver ?? []}
        onChange={(arr) => setDns({ nameserver: arr.length ? arr : undefined })}
        placeholder="119.29.29.29"
      />
      <ListField
        label="fallback (Clash)"
        items={dns.fallback ?? []}
        onChange={(arr) => setDns({ fallback: arr.length ? arr : undefined })}
        placeholder="https://1.1.1.1/dns-query"
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="enhanced_mode (Clash)">
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
        </Field>
        <Field label="fake_ip_range (Clash)">
          <Input
            value={dns.fake_ip_range ?? ""}
            onChange={(e) => setDns({ fake_ip_range: e.target.value || undefined })}
            placeholder="198.18.0.1/16"
          />
        </Field>
      </div>
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

function ListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (arr: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <textarea
        value={items.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        className="mt-1 w-full min-h-[60px] border rounded-md p-2 text-xs font-mono"
        placeholder={placeholder ? `每行一个,例如:\n${placeholder}` : "每行一个"}
      />
    </div>
  );
}
