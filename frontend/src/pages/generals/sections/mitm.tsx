import { useRef } from "react";
import { Upload, FileCheck2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import type { GeneralPresetData } from "../types";

interface Props {
  data: GeneralPresetData;
  update: (patch: Partial<GeneralPresetData>) => void;
}

export function MitmSection({ data, update }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
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
    }
  };

  const p12Length = mitm.ca_p12?.length ?? 0;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">仅 Surge 输出生效</div>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={mitm.enable} onChange={(e) => setMitm({ enable: e.target.checked })} />
        启用 MITM
      </label>

      <div>
        <Label className="text-xs">hostname (每行一个)</Label>
        <textarea
          value={mitm.hostname.join("\n")}
          onChange={(e) => setMitm({ hostname: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          className="mt-1 w-full min-h-[80px] border rounded-md p-2 text-xs font-mono"
          placeholder="*.example.com\n-pinned.api.com"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={mitm.h2} onChange={(e) => setMitm({ h2: e.target.checked })} />
          h2 (HTTP/2)
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={mitm.tcp_connection} onChange={(e) => setMitm({ tcp_connection: e.target.checked })} />
          tcp_connection
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={mitm.skip_server_cert_verify}
            onChange={(e) => setMitm({ skip_server_cert_verify: e.target.checked })}
          />
          skip_server_cert_verify
        </label>
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
        <div className="flex gap-2">
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
          {p12Length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMitm({ ca_p12: undefined })}
              className="text-destructive"
            >
              清除
            </Button>
          )}
        </div>
        <div>
          <Label className="text-xs">ca_passphrase</Label>
          <Input
            type="password"
            value={mitm.ca_passphrase ?? ""}
            onChange={(e) => setMitm({ ca_passphrase: e.target.value || undefined })}
            placeholder="证书密码"
            className="mt-1"
          />
        </div>
      </div>
    </div>
  );
}
