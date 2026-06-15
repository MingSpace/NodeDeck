import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type HostValue = string | string[];
export type HostMap = Record<string, HostValue>;

interface Row {
  key: string;
  value: string;
}

function mapToRows(map: HostMap | undefined): Row[] {
  if (!map) return [];
  const rows: Row[] = [];
  for (const [key, v] of Object.entries(map)) {
    const arr = Array.isArray(v) ? v : [v];
    for (const value of arr) rows.push({ key, value });
  }
  return rows;
}

function rowsToMap(rows: Row[]): HostMap {
  const out: HostMap = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    const v = value.trim();
    if (!k || !v) continue;
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else out[k] = [existing, v];
  }
  return out;
}

interface Props {
  value?: HostMap;
  onChange: (next: HostMap | undefined) => void;
}

/**
 * Host(DNS 解析覆盖)行编辑器。允许同一域名多行(如多个 server: 上游 DNS) —— 这是
 * Surge [Host] 的合法用法,机场常借此给代理节点域名配多个 DoH 规避封锁。
 * 内部以"行列表"为真相,向上聚合成 Record(同 key 合并数组);后端 generator 决定两端展开方式。
 */
export function HostRowsEditor({ value, onChange }: Props) {
  const [rows, setRows] = useState<Row[]>(() => mapToRows(value));

  // 外部 value 与内部行的聚合结果不一致(切换编辑对象 / 外部重置)时才从 value 重建行。
  // 编辑过程中 onChange 已把状态同步给父,二者聚合一致,不触发重置,光标不丢。
  useEffect(() => {
    if (JSON.stringify(value ?? {}) !== JSON.stringify(rowsToMap(rows))) {
      setRows(mapToRows(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Row[]) => {
    setRows(next);
    const map = rowsToMap(next);
    onChange(Object.keys(map).length === 0 ? undefined : map);
  };

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        域名解析覆盖;同一域名可添加多行(如多个 server: 上游 DNS),多个 IP 也可写成多行或逗号分隔。含{" "}
        <span className="font-mono">server:</span> 的条目:Surge 写入{" "}
        <span className="font-mono">[Host]</span>,Clash 写入{" "}
        <span className="font-mono">dns.proxy-server-nameserver-policy</span>(按域名,需在 generals DNS 配{" "}
        <span className="font-mono">proxy-server-nameserver</span> 才生效);
        <span className="font-mono">DOMAIN-SET:</span> /{" "}
        <span className="font-mono">RULE-SET:</span> 为 Surge 专属,Clash 跳过。
      </div>
      {rows.length === 0 && (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
          暂无 host 条目
        </div>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={row.key}
            onChange={(e) =>
              commit(rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))
            }
            placeholder="*.example.com"
            className="text-xs"
          />
          <span className="text-xs text-muted-foreground">=</span>
          <Input
            value={row.value}
            onChange={(e) =>
              commit(rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))
            }
            placeholder="1.2.3.4 / server:https://doh.example.com/dns-query"
            className="text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => commit(rows.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => commit([...rows, { key: "", value: "" }])}
      >
        <Plus className="h-3.5 w-3.5" />
        添加 host
      </Button>
    </div>
  );
}
