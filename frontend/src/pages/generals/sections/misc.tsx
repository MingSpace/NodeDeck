import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function HostsSection({ data, update }: Props) {
  const hosts = data.hosts ?? {};
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const entries = Object.entries(hosts);

  const setHosts = (next: Record<string, string>) => {
    update({ hosts: Object.keys(next).length === 0 ? undefined : next });
  };

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">域名解析覆盖</div>
      {entries.length === 0 && (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
          暂无 host 条目
        </div>
      )}
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={k}
            onChange={(e) => {
              const next = { ...hosts };
              delete next[k];
              next[e.target.value] = v;
              setHosts(next);
            }}
            placeholder="*.example.com"
            className="text-xs"
          />
          <span className="text-xs text-muted-foreground">=</span>
          <Input
            value={v}
            onChange={(e) => setHosts({ ...hosts, [k]: e.target.value })}
            placeholder="1.2.3.4 或 server:223.5.5.5"
            className="text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              const next = { ...hosts };
              delete next[k];
              setHosts(next);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2 items-center pt-2 border-t">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="新 host (key)"
          className="text-xs"
        />
        <span className="text-xs text-muted-foreground">=</span>
        <Input
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="value"
          className="text-xs"
        />
        <Button
          size="sm"
          onClick={() => {
            if (!newKey.trim() || !newVal.trim()) return;
            setHosts({ ...hosts, [newKey.trim()]: newVal.trim() });
            setNewKey("");
            setNewVal("");
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </div>
  );
}

export function SsidSection({ data, update }: Props) {
  const rules = data.ssid_rules ?? [];
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">仅 Surge 生效。按 WiFi SSID 设置代理行为</div>
      {rules.length === 0 && (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
          无 SSID 规则
        </div>
      )}
      {rules.map((r, i) => (
        <div key={i} className="border rounded-md p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              value={r.ssid}
              onChange={(e) => {
                const next = rules.slice();
                next[i] = { ...r, ssid: e.target.value };
                update({ ssid_rules: next });
              }}
              placeholder="WiFi 名称"
              className="text-xs"
            />
            <Input
              value={r.policy ?? ""}
              onChange={(e) => {
                const next = rules.slice();
                next[i] = { ...r, policy: e.target.value || undefined };
                update({ ssid_rules: next });
              }}
              placeholder="policy (可选)"
              className="text-xs"
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={r.suspend ?? false}
                onChange={(e) => {
                  const next = rules.slice();
                  next[i] = { ...r, suspend: e.target.checked };
                  update({ ssid_rules: next });
                }}
              />
              suspend
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => update({ ssid_rules: rules.filter((_, idx) => idx !== i) })}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => update({ ssid_rules: [...rules, { ssid: "" }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        添加 SSID 规则
      </Button>
    </div>
  );
}

export function SurgeOnlySection({ data, update }: Props) {
  return (
    <div className="space-y-3">
      <Field label="skip_proxy (绕过代理的目标,逗号或换行分隔)">
        <textarea
          value={(data.skip_proxy ?? []).join("\n")}
          onChange={(e) =>
            update({
              skip_proxy: e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="w-full min-h-[80px] border rounded-md p-2 text-xs font-mono"
          placeholder="127.0.0.0/8\nlocalhost\n*.local"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer pt-5">
          <input
            type="checkbox"
            checked={data.exclude_simple_hostnames ?? false}
            onChange={(e) => update({ exclude_simple_hostnames: e.target.checked })}
          />
          exclude_simple_hostnames
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer pt-5">
          <input
            type="checkbox"
            checked={data.read_etc_hosts ?? false}
            onChange={(e) => update({ read_etc_hosts: e.target.checked })}
          />
          read_etc_hosts
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={data.show_error_page_for_reject ?? false}
            onChange={(e) => update({ show_error_page_for_reject: e.target.checked })}
          />
          show_error_page_for_reject
        </label>
        <Field label="udp_policy_not_supported_behaviour">
          <Select
            value={data.udp_policy_not_supported_behaviour ?? "__none__"}
            onValueChange={(v) =>
              update({
                udp_policy_not_supported_behaviour:
                  v === "__none__" ? undefined : (v as "DIRECT" | "REJECT"),
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(默认)</SelectItem>
              <SelectItem value="DIRECT">DIRECT</SelectItem>
              <SelectItem value="REJECT">REJECT</SelectItem>
            </SelectContent>
          </Select>
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
