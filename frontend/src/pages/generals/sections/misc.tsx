import { useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HostRowsEditor } from "@/components/host-rows-editor";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function HostsSection({ data, update }: Props) {
  return <HostRowsEditor value={data.hosts} onChange={(hosts) => update({ hosts })} />;
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
          placeholder={"127.0.0.0/8\nlocalhost\n*.local"}
        />
      </Field>

      <Field label="always_real_ip (强制真实 IP 解析,逗号或换行分隔)">
        <textarea
          value={(data.always_real_ip ?? []).join("\n")}
          onChange={(e) =>
            update({
              always_real_ip: e.target.value
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="w-full min-h-[60px] border rounded-md p-2 text-xs font-mono"
          placeholder={"msftconnecttest.com\n*.srv.nintendo.net"}
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
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="iOS only">
          <input
            type="checkbox"
            checked={data.wifi_assist ?? false}
            onChange={(e) => update({ wifi_assist: e.target.checked })}
          />
          wifi_assist <span className="text-muted-foreground">(iOS)</span>
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer" title="iOS only">
          <input
            type="checkbox"
            checked={data.allow_hotspot_access ?? false}
            onChange={(e) => update({ allow_hotspot_access: e.target.checked })}
          />
          allow_hotspot_access <span className="text-muted-foreground">(iOS)</span>
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={data.allow_wifi_access ?? false}
            onChange={(e) => update({ allow_wifi_access: e.target.checked })}
          />
          allow_wifi_access
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <Field label="ipv6_vif (虚拟接口 IPv6)">
          <Select
            value={data.ipv6_vif ?? "__none__"}
            onValueChange={(v) =>
              update({ ipv6_vif: v === "__none__" ? undefined : (v as "off" | "auto") })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(默认)</SelectItem>
              <SelectItem value="off">off</SelectItem>
              <SelectItem value="auto">auto</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="block_quic (全局 QUIC 拦截, iOS 5.14.6+/Mac 5.10.3+)">
          <Select
            value={data.block_quic ?? "__none__"}
            onValueChange={(v) =>
              update({
                block_quic:
                  v === "__none__"
                    ? undefined
                    : (v as "per-policy" | "all-proxy" | "all" | "always-allow"),
              })
            }
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(默认 per-policy)</SelectItem>
              <SelectItem value="per-policy">per-policy (按各策略自身设置)</SelectItem>
              <SelectItem value="all-proxy">all-proxy (拦截所有代理的 QUIC)</SelectItem>
              <SelectItem value="all">all (连 DIRECT 一起拦)</SelectItem>
              <SelectItem value="always-allow">always-allow (全部放行)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="http_listen (Surge HTTP 代理)">
          <Input
            value={data.http_listen ?? ""}
            onChange={(e) => update({ http_listen: e.target.value || undefined })}
            placeholder="0.0.0.0:8888"
            className="text-xs"
          />
        </Field>
        <Field label="socks5_listen (Surge SOCKS5)">
          <Input
            value={data.socks5_listen ?? ""}
            onChange={(e) => update({ socks5_listen: e.target.value || undefined })}
            placeholder="0.0.0.0:8889"
            className="text-xs"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="proxy_test_udp (UDP 可达性测试)">
          <Input
            value={data.proxy_test_udp ?? ""}
            onChange={(e) => update({ proxy_test_udp: e.target.value || undefined })}
            placeholder="www.apple.com@64.6.64.6"
            className="text-xs"
          />
        </Field>
        <Field label="geoip_maxmind_url (自定义 GeoIP 数据库)">
          <Input
            value={data.geoip_maxmind_url ?? ""}
            onChange={(e) => update({ geoip_maxmind_url: e.target.value || undefined })}
            placeholder="https://.../Country.mmdb"
            className="text-xs"
          />
        </Field>
      </div>
    </div>
  );
}

export function HttpApiSection({ data, update }: Props) {
  const [showPwd, setShowPwd] = useState(false);
  const enabled = !!data.http_api;
  const api = data.http_api ?? {
    user: "M1ing",
    password: "",
    listen: "0.0.0.0:8890",
    web_dashboard: true,
    tls: false,
  };

  const setApi = (patch: Partial<NonNullable<GeneralPresetData["http_api"]>>) => {
    update({ http_api: { ...api, ...patch } });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Surge 控制台 API。开启后将生成 <code className="text-[10px]">http-api / http-api-web-dashboard / http-api-tls</code> 三行
      </div>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => update({ http_api: e.target.checked ? api : undefined })}
        />
        启用 HTTP API
      </label>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="user">
              <Input
                value={api.user}
                onChange={(e) => setApi({ user: e.target.value })}
                placeholder="M1ing"
                className="text-xs"
              />
            </Field>
            <Field label="password">
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={api.password}
                  onChange={(e) => setApi({ password: e.target.value })}
                  placeholder="API 密码"
                  className="text-xs pr-9"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPwd ? "隐藏密码" : "显示密码"}
                >
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </Field>
          </div>
          <Field label="listen (监听地址)">
            <Input
              value={api.listen}
              onChange={(e) => setApi({ listen: e.target.value })}
              placeholder="0.0.0.0:8890"
              className="text-xs"
            />
          </Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={api.web_dashboard}
                onChange={(e) => setApi({ web_dashboard: e.target.checked })}
              />
              web_dashboard
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={api.tls}
                onChange={(e) => setApi({ tls: e.target.checked })}
              />
              tls (HTTPS)
            </label>
          </div>
        </>
      )}
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
