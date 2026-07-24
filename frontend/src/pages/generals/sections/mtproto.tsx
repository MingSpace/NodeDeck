import { useState } from "react";
import { Dices, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

const SECRET_RE = /^(dd)?[0-9a-fA-F]{32}$/;

function randomSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Surge [MTProto] 段:Surge 作为 Telegram MTProto 入站代理(iOS 5.21.0+ / Mac 6.8.0+)。
 * 仅 Surge 输出生效;secret 非法时 generator 会跳过该段并输出 WARN 注释。
 */
export function MtprotoSection({ data, update }: Props) {
  const [showSecret, setShowSecret] = useState(false);
  const enabled = data.mtproto?.enable ?? false;
  const mt = data.mtproto ?? {
    enable: false,
    interface: "127.0.0.1",
    port: 5753,
    secret: "",
  };

  const setMt = (patch: Partial<NonNullable<GeneralPresetData["mtproto"]>>) => {
    update({ mtproto: { ...mt, ...patch } });
  };

  const secretInvalid = enabled && mt.secret.length > 0 && !SECRET_RE.test(mt.secret);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        仅 Surge 生效(iOS 5.21+ / Mac 6.8+)。Surge 作为 Telegram 专用 MTProto 入站代理,
        Telegram 客户端直连该端口,DC 选路与出站策略仍走 Surge 规则(可配合{" "}
        <code className="text-[10px]">PROTOCOL,MTProto</code> 规则匹配)
      </div>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setMt({ enable: e.target.checked })}
        />
        启用 MTProto 代理
      </label>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="interface (监听地址)">
              <Input
                value={mt.interface}
                onChange={(e) => setMt({ interface: e.target.value })}
                placeholder="127.0.0.1"
                className="text-xs"
              />
            </Field>
            <Field label="port (监听端口)">
              <Input
                type="number"
                value={mt.port}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isInteger(n)) setMt({ port: n });
                }}
                placeholder="5753"
                className="text-xs"
              />
            </Field>
          </div>
          <Field label="secret (32 位十六进制,可带 dd 前缀)">
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={mt.secret}
                  onChange={(e) => setMt({ secret: e.target.value.trim() })}
                  placeholder="0123456789abcdef0123456789abcdef"
                  className={`text-xs font-mono pr-9 ${secretInvalid ? "border-destructive" : ""}`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showSecret ? "隐藏 secret" : "显示 secret"}
                >
                  {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                type="button"
                title="随机生成 16 字节 secret"
                onClick={() => setMt({ secret: randomSecret() })}
              >
                <Dices className="h-3.5 w-3.5" />
                随机
              </Button>
            </div>
            {secretInvalid && (
              <div className="text-[11px] text-destructive mt-1">
                secret 必须是 32 位十六进制字符(可选 dd 前缀),否则 Surge 输出会跳过该段
              </div>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer pt-5">
              <input
                type="checkbox"
                checked={mt.ipv6 ?? false}
                onChange={(e) => setMt({ ipv6: e.target.checked })}
              />
              ipv6 (强制走 Telegram IPv6 DC)
            </label>
            <Field label="dc-config-url (自定义 DC 映射,可选)">
              <Input
                value={mt.dc_config_url ?? ""}
                onChange={(e) => setMt({ dc_config_url: e.target.value || undefined })}
                placeholder="https://.../mtproto-dc-config.json"
                className="text-xs"
              />
            </Field>
          </div>
          <div className="text-[11px] text-muted-foreground border-t pt-2">
            Telegram 客户端填:服务器 = 可达 interface 的地址,端口 = {mt.port},secret 同上;
            或使用链接 <code className="text-[10px]">tg://proxy?server=&lt;host&gt;&amp;port={mt.port}&amp;secret=&lt;secret&gt;</code>
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
