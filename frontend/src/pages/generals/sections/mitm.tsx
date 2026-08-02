import { useRef, useState } from "react";
import { Upload, FileCheck2, Download, Eye, EyeOff, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { LabeledField, ToggleRow, InfoHint } from "@/components/config-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function MitmSection({ data, update }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const mitm = data.mitm ?? {
    enable: false,
    hostname: [],
    h2: true,
    tcp_connection: false,
    skip_server_cert_verify: false,
  };

  const setMitm = (patch: Partial<NonNullable<GeneralPresetData["mitm"]>>) => {
    update({ mitm: { ...mitm, ...patch } });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".p12")) {
      toast({ title: "请上传 .p12 文件", variant: "error" });
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      setMitm({ ca_p12: b64 });
      toast({ title: `已加载 ${f.name}`, description: `${(buf.byteLength / 1024).toFixed(1)} KB`, variant: "success" });
    } catch (err) {
      toast({ title: "读取文件失败", description: String(err), variant: "error" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onDownload = () => {
    if (!mitm.ca_p12) return;
    try {
      const binary = atob(mitm.ca_p12);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/x-pkcs12" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const presetId = data.id || "nodedeck";
      a.download = `${presetId}-mitm-ca.p12`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "下载失败", description: String(err), variant: "error" });
    }
  };

  const p12Length = mitm.ca_p12?.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        仅 Surge 输出生效 · 解密指定域名的 HTTPS 流量
        <InfoHint>
          中间人(MITM)会用下方 CA 证书解密命中域名的 TLS 流量,供脚本 / 重写读取内容。需在设备上安装并信任该 CA 证书。
        </InfoHint>
      </div>

      <ToggleRow
        label="启用 MITM"
        checked={mitm.enable}
        onChange={(v) => setMitm({ enable: v })}
      />

      <LabeledField
        label="解密域名"
        raw="hostname"
        hint="需要 MITM 解密的域名列表,支持通配符 *;前缀 - 表示排除(如 -pinned.example.com 跳过证书绑定的域名)。每行一个。"
      >
        <textarea
          value={mitm.hostname.join("\n")}
          onChange={(e) => setMitm({ hostname: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          className="w-full min-h-[80px] border rounded-md p-2 text-xs font-mono"
          placeholder={"*.example.com\n-pinned.api.com"}
        />
      </LabeledField>

      <div className="divide-y rounded-md border">
        <ToggleRow
          label="HTTP/2 解密"
          raw="h2"
          hint="对 HTTP/2 连接启用 MITM 解密。"
          checked={mitm.h2}
          onChange={(v) => setMitm({ h2: v })}
          className="px-2.5"
        />
        <ToggleRow
          label="TCP 连接解密"
          raw="tcp-connection"
          hint="对非 HTTP 的普通 TCP over TLS 连接也尝试 MITM,用于抓取部分私有协议。"
          checked={mitm.tcp_connection}
          onChange={(v) => setMitm({ tcp_connection: v })}
          className="px-2.5"
        />
        <ToggleRow
          label="跳过服务器证书校验"
          raw="skip-server-cert-verify"
          hint="MITM 时不校验上游服务器证书。有安全风险,仅在调试自签名 / 过期证书时开启。"
          checked={mitm.skip_server_cert_verify}
          onChange={(v) => setMitm({ skip_server_cert_verify: v })}
          className="px-2.5"
        />
      </div>

      <div className="border rounded-md p-3 space-y-2 bg-muted/20">
        <div className="text-xs font-medium flex items-center gap-2">
          CA 证书 (.p12)
          {p12Length > 0 && (
            <Badge variant="success" className="text-[10px]">
              <FileCheck2 className="h-3 w-3" />
              已嵌入 ({(p12Length * 0.75 / 1024).toFixed(1)} KB)
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          上传 PKCS#12 格式 CA 证书,内容会以 base64 嵌入 yaml 文件
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".p12"
            onChange={onFile}
            className="hidden"
          />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            选择 .p12 文件
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowGenerate(true)}>
            <Sparkles className="h-3.5 w-3.5" />
            自动生成
          </Button>
          {p12Length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={onDownload}>
                <Download className="h-3.5 w-3.5" />
                下载 .p12
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMitm({ ca_p12: undefined })}
                className="text-destructive"
              >
                清除
              </Button>
            </>
          )}
        </div>
        <LabeledField label="证书密码" raw="ca-passphrase" hint="导入上方 .p12 证书时使用的 PKCS#12 密码。自动生成时会一并填好。">
          <div className="relative">
            <Input
              type={showPassphrase ? "text" : "password"}
              value={mitm.ca_passphrase ?? ""}
              onChange={(e) => setMitm({ ca_passphrase: e.target.value || undefined })}
              placeholder="证书密码"
              className="pr-9"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassphrase((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassphrase ? "隐藏密码" : "显示密码"}
            >
              {showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </LabeledField>
      </div>

      <GenerateCaDialog
        open={showGenerate}
        onOpenChange={setShowGenerate}
        defaultCn={`${data.name || data.id || "NodeDeck"} MITM CA`}
        onGenerated={(p12Base64, passphrase) => {
          setMitm({ ca_p12: p12Base64, ca_passphrase: passphrase });
        }}
      />
    </div>
  );
}

function GenerateCaDialog({
  open,
  onOpenChange,
  defaultCn,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultCn: string;
  onGenerated: (p12Base64: string, passphrase: string) => void;
}) {
  const [commonName, setCommonName] = useState(defaultCn);
  const [years, setYears] = useState(10);
  const [passphrase, setPassphrase] = useState("nodedeck");
  const [showPwd, setShowPwd] = useState(true);
  const [generating, setGenerating] = useState(false);

  // dialog 每次打开重置默认 CN(跟随 preset 名称变化)
  const handleOpenChange = (v: boolean) => {
    if (generating) return;
    if (v) setCommonName(defaultCn);
    onOpenChange(v);
  };

  const onGenerate = async () => {
    if (!commonName.trim()) {
      toast({ title: "请填写 Common Name", variant: "error" });
      return;
    }
    if (!passphrase) {
      toast({ title: "请填写密码", variant: "error" });
      return;
    }
    setGenerating(true);
    try {
      // 让 loading UI 先渲染,再跑 CPU 密集的 RSA 生成
      await new Promise((r) => setTimeout(r, 30));
      const b64 = await generateCaP12(commonName.trim(), years, passphrase);
      onGenerated(b64, passphrase);
      toast({
        title: "已生成 CA 证书",
        description: `${commonName.trim()} · 有效期 ${years} 年`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "生成失败", description: String(err), variant: "error" });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>自动生成 CA 证书</DialogTitle>
          <DialogDescription>
            在浏览器本地生成 RSA-2048 自签 CA,用 PKCS#12 打包嵌入。证书数据不会上传到服务器。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Common Name</Label>
            <Input
              value={commonName}
              onChange={(e) => setCommonName(e.target.value)}
              placeholder="NodeDeck MITM CA"
              className="mt-1"
              disabled={generating}
            />
          </div>
          <div>
            <Label className="text-xs">有效期 (年)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={years}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!Number.isNaN(v)) setYears(Math.max(1, Math.min(30, v)));
              }}
              className="mt-1"
              disabled={generating}
            />
          </div>
          <div>
            <Label className="text-xs">密码 (PKCS#12 passphrase)</Label>
            <div className="relative mt-1">
              <Input
                type={showPwd ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="证书密码"
                className="pr-9"
                disabled={generating}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPwd ? "隐藏密码" : "显示密码"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            生成后会自动填充到 CA 证书和 ca_passphrase 字段。RSA-2048 在普通设备需要 1-3 秒。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            取消
          </Button>
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? "生成中..." : "生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function generateCaP12(cn: string, years: number, passphrase: string): Promise<string> {
  // 按需加载 node-forge,避免主 bundle 体积膨胀。
  // node-forge 是 CommonJS 包,Vite/esbuild 会做 interop:
  // `default` 通常指向整个 module,但少数构建器下可能拿到的是 namespace 本身,做一次兜底。
  const mod = await import("node-forge");
  const forge = (mod.default ?? mod) as typeof import("node-forge");
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "00" + forge.util.bytesToHex(forge.random.getBytesSync(8));
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + years);
  const attrs = [
    { name: "commonName", value: cn },
    { name: "organizationName", value: "NodeDeck" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: "3des",
    friendlyName: cn,
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  return forge.util.encode64(p12Der);
}
