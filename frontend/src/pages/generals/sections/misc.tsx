import { useState } from "react";
import { Eye, EyeOff, Plus, Trash2, Route, Globe, Server, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HostRowsEditor } from "@/components/host-rows-editor";
import { FieldGroup, LabeledField, ToggleRow, InfoHint } from "@/components/config-fields";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

const iosBadge = (
  <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal text-muted-foreground">
    iOS
  </Badge>
);

export function HostsSection({ data, update }: Props) {
  return <HostRowsEditor value={data.hosts} onChange={(hosts) => update({ hosts })} />;
}

export function SsidSection({ data, update }: Props) {
  const rules = data.ssid_rules ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        仅 Surge 生效 · 按当前连接的 Wi-Fi 名称自动切换代理行为
        <InfoHint>
          连接到指定 SSID 的 Wi-Fi 时套用该规则:可指定使用某条策略,或直接挂起(暂停)代理。常用于在公司 / 家庭网络下走不同分流。
        </InfoHint>
      </div>
      {rules.length === 0 && (
        <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          暂无 SSID 规则
        </div>
      )}
      {rules.map((r, i) => (
        <div key={i} className="space-y-2 rounded-md border p-2.5">
          <div className="flex items-center gap-2">
            <LabeledField label="Wi-Fi 名称 (SSID)" className="flex-1">
              <Input
                value={r.ssid}
                onChange={(e) => {
                  const next = rules.slice();
                  next[i] = { ...r, ssid: e.target.value };
                  update({ ssid_rules: next });
                }}
                placeholder="MyHomeWiFi"
                className="text-xs"
              />
            </LabeledField>
            <LabeledField
              label="策略"
              raw="policy"
              hint="连接该 Wi-Fi 时使用的策略名(策略组或节点)。留空表示不改变默认分流。"
              className="flex-1"
            >
              <Input
                value={r.policy ?? ""}
                onChange={(e) => {
                  const next = rules.slice();
                  next[i] = { ...r, policy: e.target.value || undefined };
                  update({ ssid_rules: next });
                }}
                placeholder="可选,如 DIRECT / Proxys"
                className="text-xs"
              />
            </LabeledField>
            <Button
              variant="ghost"
              size="icon"
              className="mt-5 h-7 w-7 shrink-0"
              onClick={() => update({ ssid_rules: rules.filter((_, idx) => idx !== i) })}
              title="删除该规则"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
          <ToggleRow
            label="挂起代理"
            raw="suspend"
            hint="连接该 Wi-Fi 时暂停 Surge 代理引擎(所有流量直连),离开后恢复。适合在可信内网关闭代理。"
            checked={r.suspend ?? false}
            onChange={(v) => {
              const next = rules.slice();
              next[i] = { ...r, suspend: v };
              update({ ssid_rules: next });
            }}
          />
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => update({ ssid_rules: [...rules, { ssid: "" }] })}>
        <Plus className="h-3.5 w-3.5" />
        添加 SSID 规则
      </Button>
    </div>
  );
}

export function SurgeOnlySection({ data, update }: Props) {
  return (
    <div className="space-y-3">
      <FieldGroup
        icon={<Route className="h-3.5 w-3.5" />}
        title="域名解析与绕过"
        hint="控制哪些地址不走代理,以及域名解析的特殊处理。"
      >
        <LabeledField
          label="绕过代理的目标"
          raw="skip-proxy"
          hint="命中的地址不经过 Surge 的 HTTP/SOCKS 入站代理,由系统直接连接。一般填内网网段、localhost、*.local。每行一个。"
        >
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
            className="w-full min-h-[72px] rounded-md border p-2 font-mono text-xs"
            placeholder={"127.0.0.0/8\nlocalhost\n*.local"}
          />
        </LabeledField>

        <LabeledField
          label="强制真实 IP 解析"
          raw="always-real-ip"
          hint="这些域名始终返回真实 IP,不参与 fake-ip / DNS 映射。常用于对 IP 敏感的连通性检测、游戏主机等。每行一个。"
        >
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
            className="w-full min-h-[56px] rounded-md border p-2 font-mono text-xs"
            placeholder={"msftconnecttest.com\n*.srv.nintendo.net"}
          />
        </LabeledField>

        <div className="divide-y rounded-md border">
          <ToggleRow
            label="排除简单主机名"
            raw="exclude-simple-hostnames"
            hint="不含点的简单主机名(如 router、nas)直接连接,不走代理与规则匹配。"
            description="避免局域网单标签主机名被 DNS 劫持或规则误判"
            checked={data.exclude_simple_hostnames ?? false}
            onChange={(v) => update({ exclude_simple_hostnames: v })}
            className="px-2.5"
          />
          <ToggleRow
            label="读取系统 hosts"
            raw="read-etc-hosts"
            hint="解析域名时读取系统 /etc/hosts 文件中的记录(仅 macOS)。"
            checked={data.read_etc_hosts ?? false}
            onChange={(v) => update({ read_etc_hosts: v })}
            className="px-2.5"
          />
        </div>
      </FieldGroup>

      <FieldGroup
        icon={<Globe className="h-3.5 w-3.5" />}
        title="QUIC / IPv6 / UDP"
        hint="传输层协议相关的全局开关。"
      >
        <LabeledField
          label="QUIC 拦截"
          raw="block-quic"
          hint="拦截 QUIC(HTTP/3)连接,迫使应用回退到 TCP,便于规则分流与 MITM 抓包。iOS 5.14.6+ / Mac 5.10.3+。"
        >
          <Select
            value={data.block_quic ?? "__none__"}
            onValueChange={(v) =>
              update({
                block_quic:
                  v === "__none__" ? undefined : (v as "per-policy" | "all-proxy" | "all" | "always-allow"),
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">默认 (per-policy)</SelectItem>
              <SelectItem value="per-policy">per-policy · 按各策略自身设置</SelectItem>
              <SelectItem value="all-proxy">all-proxy · 拦截所有代理的 QUIC</SelectItem>
              <SelectItem value="all">all · 连 DIRECT 一起拦</SelectItem>
              <SelectItem value="always-allow">always-allow · 全部放行</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>

        <div className="grid grid-cols-2 gap-3">
          <LabeledField
            label="虚拟接口 IPv6"
            raw="ipv6-vif"
            hint="虚拟网卡(增强模式 / TUN)的 IPv6 支持:off 关闭 / auto 自动。影响 IPv6 流量是否被接管。"
          >
            <Select
              value={data.ipv6_vif ?? "__none__"}
              onValueChange={(v) => update({ ipv6_vif: v === "__none__" ? undefined : (v as "off" | "auto") })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">默认</SelectItem>
                <SelectItem value="off">off · 关闭</SelectItem>
                <SelectItem value="auto">auto · 自动</SelectItem>
              </SelectContent>
            </Select>
          </LabeledField>

          <LabeledField
            label="UDP 不支持时"
            raw="udp-policy-not-supported-behaviour"
            hint="当所选策略不支持 UDP 转发时,UDP 流量的回退行为:DIRECT 直连 / REJECT 拒绝。"
          >
            <Select
              value={data.udp_policy_not_supported_behaviour ?? "__none__"}
              onValueChange={(v) =>
                update({
                  udp_policy_not_supported_behaviour: v === "__none__" ? undefined : (v as "DIRECT" | "REJECT"),
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">默认</SelectItem>
                <SelectItem value="DIRECT">DIRECT · 直连</SelectItem>
                <SelectItem value="REJECT">REJECT · 拒绝</SelectItem>
              </SelectContent>
            </Select>
          </LabeledField>
        </div>
      </FieldGroup>

      <FieldGroup
        icon={<Server className="h-3.5 w-3.5" />}
        title="入站与共享"
        hint="把本机作为代理,分享给局域网 / 热点里的其他设备使用。"
      >
        <div className="grid grid-cols-2 gap-3">
          <LabeledField
            label="HTTP 入站监听"
            raw="http-listen"
            hint="额外开放一个 HTTP 代理入站端口,供其他设备连接。格式 IP:端口。"
          >
            <Input
              value={data.http_listen ?? ""}
              onChange={(e) => update({ http_listen: e.target.value || undefined })}
              placeholder="0.0.0.0:8888"
              className="text-xs"
            />
          </LabeledField>
          <LabeledField
            label="SOCKS5 入站监听"
            raw="socks5-listen"
            hint="额外开放一个 SOCKS5 代理入站端口。格式 IP:端口。"
          >
            <Input
              value={data.socks5_listen ?? ""}
              onChange={(e) => update({ socks5_listen: e.target.value || undefined })}
              placeholder="0.0.0.0:8889"
              className="text-xs"
            />
          </LabeledField>
        </div>
        <div className="divide-y rounded-md border">
          <ToggleRow
            label="允许局域网访问"
            raw="allow-wifi-access"
            hint="允许同一局域网内的其他设备把本机当作 HTTP/SOCKS 代理使用。"
            checked={data.allow_wifi_access ?? false}
            onChange={(v) => update({ allow_wifi_access: v })}
            className="px-2.5"
          />
          <ToggleRow
            label="允许热点设备访问"
            raw="allow-hotspot-access"
            badge={iosBadge}
            hint="允许通过个人热点连入的其他设备也走 Surge 代理。"
            checked={data.allow_hotspot_access ?? false}
            onChange={(v) => update({ allow_hotspot_access: v })}
            className="px-2.5"
          />
        </div>
      </FieldGroup>

      <FieldGroup icon={<Wrench className="h-3.5 w-3.5" />} title="其他选项">
        <div className="divide-y rounded-md border">
          <ToggleRow
            label="Wi-Fi 助理"
            raw="wifi-assist"
            badge={iosBadge}
            hint="Wi-Fi 信号差时自动切换到蜂窝网络以保持连接。"
            checked={data.wifi_assist ?? false}
            onChange={(v) => update({ wifi_assist: v })}
            className="px-2.5"
          />
          <ToggleRow
            label="REJECT 显示错误页"
            raw="show-error-page-for-reject"
            hint="被 REJECT 拦截的 HTTP 请求返回一个错误提示页面,而不是直接断开连接。"
            checked={data.show_error_page_for_reject ?? false}
            onChange={(v) => update({ show_error_page_for_reject: v })}
            className="px-2.5"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <LabeledField
            label="UDP 可达性测试"
            raw="proxy-test-udp"
            hint="测试代理 UDP 可达性的目标,格式 域名@DNS,如 www.apple.com@64.6.64.6。"
          >
            <Input
              value={data.proxy_test_udp ?? ""}
              onChange={(e) => update({ proxy_test_udp: e.target.value || undefined })}
              placeholder="www.apple.com@64.6.64.6"
              className="text-xs"
            />
          </LabeledField>
          <LabeledField
            label="自定义 GeoIP 库"
            raw="geoip-maxmind-url"
            hint="自定义 GeoIP 数据库(MaxMind .mmdb)下载地址,替换内置库用于 GEOIP 规则匹配。"
          >
            <Input
              value={data.geoip_maxmind_url ?? ""}
              onChange={(e) => update({ geoip_maxmind_url: e.target.value || undefined })}
              placeholder="https://.../Country.mmdb"
              className="text-xs"
            />
          </LabeledField>
        </div>
      </FieldGroup>
    </div>
  );
}

export function HttpApiSection({ data, update }: Props) {
  const [showPwd, setShowPwd] = useState(false);
  const enabled = !!data.http_api;
  // 与 backend/src/schemas/general-preset.ts 的 httpApiSchema 默认值保持同步
  const api = data.http_api ?? {
    password: "",
    listen: "0.0.0.0:8890",
    web_dashboard: false,
    tls: false,
  };

  const setApi = (patch: Partial<NonNullable<GeneralPresetData["http_api"]>>) => {
    update({ http_api: { ...api, ...patch } });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Surge 控制台 API · 供外部程序 / 网页面板远程读写配置
        <InfoHint>
          开启后 Surge 会监听一个管理端口,可用于外部工具(如 Surge 网页面板、快捷指令)查询状态、切换策略。生成
          <code className="mx-1 text-[10px]">http-api / http-api-web-dashboard / http-api-tls</code>
          三行。
        </InfoHint>
      </div>

      <ToggleRow
        label="启用 HTTP API"
        checked={enabled}
        onChange={(v) => update({ http_api: v ? api : undefined })}
      />

      {enabled && (
        <div className="space-y-3 rounded-lg border bg-card/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <LabeledField
              label="用户名"
              raw="user"
              hint="Surge 的 http-api 只接受一整串密钥,没有用户名概念。留空即手册标准写法;仅当旧配置写成「用户名:密码@地址」需要原样保留时才填。"
            >
              <Input
                value={api.user ?? ""}
                onChange={(e) => setApi({ user: e.target.value || undefined })}
                placeholder="留空(推荐)"
                className="text-xs"
              />
            </LabeledField>
            <LabeledField
              label="密码"
              raw="password"
              hint="访问控制台 API 的密钥。留空会生成畸形的 http-api 行,保存时后端会拒绝。"
            >
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  value={api.password}
                  onChange={(e) => setApi({ password: e.target.value })}
                  placeholder="API 密码"
                  className="pr-9 text-xs"
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
              {api.password.length === 0 && (
                <div className="text-[11px] text-destructive mt-1">
                  密钥不能为空,否则会生成畸形的 http-api 行,保存时后端会拒绝
                </div>
              )}
            </LabeledField>
          </div>
          <LabeledField label="监听地址" raw="listen" hint="控制台 API 监听的地址与端口。0.0.0.0 表示允许局域网访问。">
            <Input value={api.listen} onChange={(e) => setApi({ listen: e.target.value })} placeholder="0.0.0.0:8890" className="text-xs" />
          </LabeledField>
          <div className="divide-y rounded-md border">
            <ToggleRow
              label="网页控制台"
              raw="web-dashboard"
              hint="开启后可通过浏览器访问 Surge 网页控制台面板。"
              checked={api.web_dashboard}
              onChange={(v) => setApi({ web_dashboard: v })}
              className="px-2.5"
            />
            <ToggleRow
              label="启用 TLS (HTTPS)"
              raw="http-api-tls"
              hint="控制台 API 使用 HTTPS 加密。一般本地使用可关闭。"
              checked={api.tls}
              onChange={(v) => setApi({ tls: v })}
              className="px-2.5"
            />
          </div>
        </div>
      )}
    </div>
  );
}
