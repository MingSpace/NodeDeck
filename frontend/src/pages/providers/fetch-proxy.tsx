import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CircleCheck, CircleX, LoaderCircle, Route } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { useEntityList } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProviderData } from "./visual-form";

// 与 backend/src/routes/provider-actions.ts TestFetchAttempt 保持同步
interface TestFetchAttempt {
  route: "direct" | "proxy";
  ok: boolean;
  error?: string;
  node_count: number;
  bytes: number;
  has_userinfo: boolean;
  used_user_agent?: string;
  duration_ms: number;
}

interface TestFetchInput {
  url: string;
  user_agent: string;
  fetch_proxy?: string;
  parser_hint: ProviderData["parser_hint"];
}

const SUGGESTIONS_ID = "fetch-proxy-suggestions";

/** 展示用:去掉账号密码,与后端 redactProxyUrl 一致。 */
export function proxyHost(proxy: string): string {
  try {
    const u = new URL(proxy);
    return `${u.protocol}//${u.host}`;
  } catch {
    return proxy;
  }
}

function sameInput(a: TestFetchInput, b: TestFetchInput): boolean {
  return (
    a.url === b.url &&
    a.user_agent === b.user_agent &&
    (a.fetch_proxy ?? "") === (b.fetch_proxy ?? "") &&
    a.parser_hint === b.parser_hint
  );
}

function verdict(attempts: TestFetchAttempt[]): string {
  const proxy = attempts.find((a) => a.route === "proxy");
  const direct = attempts.find((a) => a.route === "direct");
  if (!proxy) {
    return direct?.ok ? "服务器直连就能拉到,不需要代理。" : "服务器直连拉不到。如果是机场按 IP 拦截,填一个代理再测。";
  }
  if (proxy.ok && !direct?.ok) return "直连被挡,经代理正常。保存后会经代理拉取。";
  if (proxy.ok) return "两条路线都通。不配代理也行,留空可少一个依赖。";
  if (direct?.ok) return "代理这条路不通,直连反而可以。检查代理地址,或清空改回直连。";
  return "两条路线都失败,先看下面的原因。";
}

export function FetchProxyField({
  data,
  update,
}: {
  data: ProviderData;
  update: (patch: Partial<ProviderData>) => void;
}) {
  // 其它节点源已在用的代理,做成输入建议:同一台机器的出口通常给多个订阅共用。
  const providers = useEntityList<ProviderData>("providers");
  const suggestions = [
    ...new Set(
      (providers.data?.items ?? [])
        .filter((p) => p.id !== data.id && p.fetch_proxy)
        .map((p) => p.fetch_proxy as string),
    ),
  ];

  const current: TestFetchInput = {
    url: data.url ?? "",
    user_agent: data.user_agent ?? "",
    fetch_proxy: data.fetch_proxy?.trim() || undefined,
    parser_hint: data.parser_hint ?? "auto",
  };
  const [tested, setTested] = useState<TestFetchInput | null>(null);
  const test = useMutation({
    mutationFn: (input: TestFetchInput) =>
      api.post<{ attempts: TestFetchAttempt[] }>("/api/providers/test-fetch", input),
    onMutate: (input) => setTested(input),
  });
  const outdated = !!tested && !sameInput(tested, current);

  return (
    <div>
      <Label className="text-xs" htmlFor="fetch-proxy">
        拉取代理
      </Label>
      <div className="mt-1 flex gap-2">
        <Input
          id="fetch-proxy"
          list={suggestions.length > 0 ? SUGGESTIONS_ID : undefined}
          value={data.fetch_proxy ?? ""}
          onChange={(e) => update({ fetch_proxy: e.target.value || undefined })}
          placeholder="留空 = 服务器直连"
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
        />
        {suggestions.length > 0 && (
          <datalist id={SUGGESTIONS_ID}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          disabled={!current.url || test.isPending}
          onClick={() => test.mutate(current)}
        >
          {test.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
          测试拉取
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
        机场拦了服务器的 IP 时(常见是直连 403),借另一台机器的网络出口拉订阅。支持{" "}
        <span className="font-mono">http://</span> <span className="font-mono">https://</span>{" "}
        <span className="font-mono">socks5://</span>,可带账号密码;只影响拉订阅,不影响客户端连节点。
      </p>

      {(test.isPending || test.data || test.error) && (
        <div
          className={cn(
            "mt-2 rounded-md border bg-muted/30 p-2.5 text-xs transition-opacity",
            outdated && "opacity-60",
          )}
          aria-live="polite"
        >
          {test.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {tested?.fetch_proxy ? "正在分别经代理和直连拉取…" : "正在从服务器直连拉取…"}
            </div>
          )}
          {test.error && <div className="text-destructive">测试请求失败:{(test.error as Error).message}</div>}
          {test.data && !test.isPending && (
            <>
              <div className="font-medium mb-2">
                {outdated ? "参数已改动,结果对应的是上一次测试。" : verdict(test.data.attempts)}
              </div>
              <div className="space-y-1.5">
                {test.data.attempts.map((a) => (
                  <AttemptRow key={a.route} attempt={a} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// 代理地址就在上方输入框里,行内只标路线,免得长地址被截断
const ROUTE_LABEL: Record<TestFetchAttempt["route"], string> = {
  proxy: "经代理",
  direct: "服务器直连",
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function AttemptRow({ attempt: a }: { attempt: TestFetchAttempt }) {
  return (
    <div className="grid grid-cols-[1rem_5rem_minmax(0,1fr)_auto] items-start gap-x-2">
      {a.ok ? (
        <CircleCheck className="h-3.5 w-3.5 mt-px text-emerald-600 dark:text-emerald-400" aria-label="成功" />
      ) : (
        <CircleX className="h-3.5 w-3.5 mt-px text-destructive" aria-label="失败" />
      )}
      <span>{ROUTE_LABEL[a.route]}</span>
      {a.ok ? (
        <span className="flex flex-wrap gap-x-3 text-muted-foreground">
          <span className="text-foreground">{a.node_count} 个节点</span>
          <span>{formatBytes(a.bytes)}</span>
          <span>{a.has_userinfo ? "带流量信息" : "无流量信息"}</span>
          {a.used_user_agent && <span className="font-mono">UA {a.used_user_agent}</span>}
        </span>
      ) : (
        <span className="text-destructive break-words">{a.error}</span>
      )}
      <span className="tabular-nums text-muted-foreground">{formatDuration(a.duration_ms)}</span>
    </div>
  );
}
