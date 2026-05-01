import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function BasicSection({ data, update }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID (文件名)">
          <Input value={data.id} onChange={(e) => update({ id: e.target.value })} />
        </Field>
        <Field label="预设名">
          <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="mode">
          <Select value={data.mode} onValueChange={(v) => update({ mode: v as GeneralPresetData["mode"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rule">rule</SelectItem>
              <SelectItem value="global">global</SelectItem>
              <SelectItem value="direct">direct</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="log_level">
          <Select value={data.log_level} onValueChange={(v) => update({ log_level: v as GeneralPresetData["log_level"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="silent">silent</SelectItem>
              <SelectItem value="warning">warning</SelectItem>
              <SelectItem value="notify">notify</SelectItem>
              <SelectItem value="info">info</SelectItem>
              <SelectItem value="debug">debug</SelectItem>
              <SelectItem value="verbose">verbose</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <ToggleField
          label="ipv6"
          checked={data.ipv6}
          onChange={(v) => update({ ipv6: v })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="port (Clash HTTP)">
          <Input
            type="number"
            value={data.port ?? ""}
            onChange={(e) => update({ port: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          />
        </Field>
        <Field label="socks_port (Clash SOCKS)">
          <Input
            type="number"
            value={data.socks_port ?? ""}
            onChange={(e) => update({ socks_port: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          />
        </Field>
        <Field label="mixed_port (Clash 混合)">
          <Input
            type="number"
            value={data.mixed_port ?? ""}
            onChange={(e) => update({ mixed_port: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          />
        </Field>
      </div>
      <ToggleField
        label="allow_lan (允许局域网代理)"
        checked={data.allow_lan}
        onChange={(v) => update({ allow_lan: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="proxy_test_url">
          <Input
            value={data.proxy_test_url ?? ""}
            onChange={(e) => update({ proxy_test_url: e.target.value || undefined })}
            placeholder="http://cp.cloudflare.com/generate_204"
          />
        </Field>
        <Field label="internet_test_url">
          <Input
            value={data.internet_test_url ?? ""}
            onChange={(e) => update({ internet_test_url: e.target.value || undefined })}
            placeholder="http://wifi.vivo.com.cn/generate_204"
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

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer pt-5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
