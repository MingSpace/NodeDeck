import { useState } from "react";
import { Dices, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LabeledField, ToggleRow, InfoHint } from "@/components/config-fields";
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

  // 空 secret 也算非法:enable=true + 空 secret 能通过保存,但 generator 会静默跳过整段,
  // 用户会以为开了 MTProto 而订阅里没有;这里必须在 UI 就标红。
  const secretInvalid = enabled && !SECRET_RE.test(mt.secret);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">

        <span>
          仅 Surge 生效(iOS 5.21+ / Mac 6.8+)· 把 Surge 当作 Telegram 专用 MTProto 入站代理
          <InfoHint>
            Telegram 客户端直连该端口,DC 选路与出站策略仍走 Surge 规则(可配合{" "}
            <code className="text-[10px]">PROTOCOL,MTProto</code> 规则匹配)。
          </InfoHint>
        </span>
      </div>
      <ToggleRow
        label="启用 MTProto 代理"
        checked={enabled}
        onChange={(v) => setMt({ enable: v })}
      />
      {enabled && (
        <div className="space-y-3 rounded-lg border bg-card/50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <LabeledField label="监听地址" raw="interface" hint="MTProto 入站监听的本地地址。若需局域网其他设备连入可填 0.0.0.0。">
              <Input
                value={mt.interface}
                onChange={(e) => setMt({ interface: e.target.value })}
                placeholder="127.0.0.1"
                className="text-xs"
              />
            </LabeledField>
            <LabeledField label="监听端口" raw="port" hint="Telegram 客户端连接的端口。">
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
            </LabeledField>
          </div>
          <LabeledField
            label="Secret"
            raw="secret"
            hint="32 位十六进制字符(可选 dd 前缀)。Telegram 客户端连接时需填写相同值;非法时 Surge 会跳过整段。"
          >
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
          </LabeledField>
          <ToggleRow
            label="强制 IPv6 DC"
            raw="ipv6"
            hint="强制走 Telegram 的 IPv6 数据中心(DC)。"
            checked={mt.ipv6 ?? false}
            onChange={(v) => setMt({ ipv6: v })}
          />
          <LabeledField
            label="自定义 DC 映射"
            raw="dc-config-url"
            hint="可选。自定义 Telegram DC 地址映射表的下载链接,一般留空即可。"
          >
            <Input
              value={mt.dc_config_url ?? ""}
              onChange={(e) => setMt({ dc_config_url: e.target.value || undefined })}
              placeholder="https://.../mtproto-dc-config.json"
              className="text-xs"
            />
          </LabeledField>
          <div className="text-[11px] text-muted-foreground border-t pt-2">
            Telegram 客户端填:服务器 = 可达 interface 的地址,端口 = {mt.port},secret 同上;
            或使用链接 <code className="text-[10px]">tg://proxy?server=&lt;host&gt;&amp;port={mt.port}&amp;secret=&lt;secret&gt;</code>
          </div>
        </div>
      )}
    </div>
  );
}
