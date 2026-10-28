import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProviderData } from "./visual-form";

interface UserAgentPreset {
  ua: string;
  label: string;
  /** 面板多半会按这个 UA 吐什么格式 */
  hint: string;
}

// 机场面板按 UA 子串选输出格式(以 Xboard 为例):含 meta / verge / clashmetaforandroid → Clash Meta,
// 只含 clash → 老 Clash(没有 vless / hy2 / tuic / anytls,所以不提供),空或不认识 → base64 链接。
// 前四个 = 默认列表,与 backend/src/schemas/provider.ts DEFAULT_USER_AGENTS 保持同步。
export const USER_AGENT_PRESETS: UserAgentPreset[] = [
  { ua: "clash.meta/v1.19.33", label: "mihomo 内核", hint: "Clash Meta 格式,协议最全" },
  { ua: "clash-verge/v2.5.8", label: "Clash Verge Rev", hint: "Clash Meta 格式" },
  { ua: "", label: "空 UA", hint: "面板通用格式,多为 base64 链接" },
  { ua: "v2rayN/7.25.6", label: "v2rayN", hint: "base64 链接" },
  { ua: "ClashMetaForAndroid/2.11.36", label: "Clash Meta for Android", hint: "Clash Meta 格式" },
  { ua: "Surge Mac/12600", label: "Surge", hint: "Surge 格式,带 [Host] / 机场 DoH;没有 vless" },
];

export const DEFAULT_USER_AGENTS = USER_AGENT_PRESETS.slice(0, 4).map((p) => p.ua);

/** 留空 = 默认列表 */
export function resolveUserAgents(list: readonly string[] | undefined): string[] {
  return list?.length ? [...list] : [...DEFAULT_USER_AGENTS];
}

const presetOf = (ua: string) => USER_AGENT_PRESETS.find((p) => p.ua === ua);

/** 结果行等处展示用:空 UA 单独标出来,不然看着像没值 */
export function formatUserAgent(ua: string): string {
  return ua === "" ? "(空 UA)" : ua;
}

// 与 backend/src/providers/cache-store.ts UserAgentMemory 保持同步
interface UserAgentMemory {
  user_agent: string;
  list: string[];
}

/** 上次拿到节点的 UA;与 backend rememberedUserAgent 同一判定:列表没改过且它还在列表里才作数 */
function useRememberedUserAgent(providerId: string, list: string[]): string | undefined {
  // 复用列表页的 status 查询(同 queryKey)
  const status = useQuery<{ items: { provider: { id: string }; ua_memory?: UserAgentMemory }[] }>({
    queryKey: ["providers", "status"],
    queryFn: () => api.get("/api/providers/status"),
  });
  const memory = status.data?.items.find((i) => i.provider.id === providerId)?.ua_memory;
  if (!memory || memory.list.join("\n") !== list.join("\n")) return undefined;
  return list.includes(memory.user_agent) ? memory.user_agent : undefined;
}

// Select 的 value 不能是空串,空 UA 用占位值代替
const EMPTY_UA_VALUE = "__empty__";
const CUSTOM_VALUE = "__custom__";

export function UserAgentsField({
  data,
  update,
}: {
  data: ProviderData;
  update: (patch: Partial<ProviderData>) => void;
}) {
  const list = resolveUserAgents(data.user_agents);
  const isDefault = list.join("\n") === DEFAULT_USER_AGENTS.join("\n");
  const options = USER_AGENT_PRESETS.filter((p) => !list.includes(p.ua));
  const [custom, setCustom] = useState<string | null>(null);
  const remembered = useRememberedUserAgent(data.id, list);

  // 和默认列表一样就存空,以后默认列表更新了也能跟上
  const setList = (next: string[]) =>
    update({ user_agents: next.join("\n") === DEFAULT_USER_AGENTS.join("\n") ? [] : next });
  const move = (i: number, delta: number) => {
    const next = [...list];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setList(next);
  };

  const customUa = custom?.trim() ?? "";
  const customDup = custom !== null && list.includes(customUa);
  const addCustom = () => {
    if (custom === null || customDup) return;
    setList([...list, customUa]);
    setCustom(null);
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-2">
        <Label className="text-xs">User-Agent</Label>
        {!isDefault && (
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setList([])}>
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </Button>
        )}
      </div>

      <ol className="mt-1.5 rounded-md border divide-y text-xs">
        {list.map((ua, i) => {
          const preset = presetOf(ua);
          return (
            <li key={ua || EMPTY_UA_VALUE} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-4 text-center tabular-nums text-muted-foreground">{i + 1}</span>
              <span className={cn("min-w-0 truncate font-mono", ua === "" && "font-sans text-muted-foreground")}>
                {formatUserAgent(ua)}
              </span>
              <span className="min-w-0 truncate text-muted-foreground/70">{preset?.hint ?? "自定义"}</span>
              {ua === remembered && (
                <span
                  className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[11px] text-emerald-700 dark:text-emerald-400"
                  title="上次刷新用它拿到了节点,下次刷新先试它;改动这个列表后会按新顺序重新试"
                >
                  上次可用 · 先试
                </span>
              )}
              <div className="ml-auto flex items-center shrink-0">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={i === list.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="下移"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  // 至少留一个:列表删空会等同于「用默认列表」,反而又冒出四个
                  disabled={list.length === 1}
                  onClick={() => setList(list.filter((u) => u !== ua))}
                  aria-label="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          );
        })}
        {custom !== null ? (
          <li className="flex items-center gap-1.5 px-1.5 py-1">
            <Input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                } else if (e.key === "Escape") {
                  setCustom(null);
                }
              }}
              placeholder="如 Shadowrocket/2070,留空 = 不带 UA"
              className={cn("h-7 font-mono text-xs", customDup && "border-destructive focus-visible:ring-destructive")}
            />
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={customDup} onClick={addCustom} aria-label="添加">
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setCustom(null)} aria-label="取消">
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        ) : (
          <li className="px-1.5 py-1">
            {/* value 固定为空:选完立刻追加,下拉框回到占位状态 */}
            <Select
              value=""
              onValueChange={(v) => {
                if (v === CUSTOM_VALUE) setCustom("");
                else setList([...list, v === EMPTY_UA_VALUE ? "" : v]);
              }}
            >
              <SelectTrigger className="h-7 border-0 shadow-none text-xs text-muted-foreground focus:ring-0">
                <span className="flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  <SelectValue placeholder="添加 UA" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.ua || EMPTY_UA_VALUE} value={p.ua || EMPTY_UA_VALUE}>
                    <span>{p.label}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{p.hint}</span>
                  </SelectItem>
                ))}
                {options.length > 0 && <SelectSeparator />}
                <SelectItem value={CUSTOM_VALUE}>自定义…</SelectItem>
              </SelectContent>
            </Select>
          </li>
        )}
      </ol>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
        从上往下试,拿到能解析出节点的内容就停;空 body、「请使用客户端」之类的页面会换下一个。
        上次能用的 UA 下次先试,失败再按顺序往下;改动列表后按新顺序重新试。
        机场按 UA 决定吐什么格式:Clash Meta 格式协议最全,还带 hosts,所以排在前面。
      </p>
    </div>
  );
}
