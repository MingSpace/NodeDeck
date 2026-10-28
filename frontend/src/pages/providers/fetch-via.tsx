import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleCheck, CircleX, LoaderCircle, Plus, Route, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { useEntityList } from "@/api/entities";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { egressAddress, type EgressData } from "@/pages/egresses/visual-form";
import type { ProviderData } from "./visual-form";
import { formatUserAgent } from "./user-agents";

// 与 backend/src/schemas/egress.ts DIRECT_ROUTE / resolveFetchRoutes 保持同步
export const DIRECT_ROUTE = "direct";

/** 实际尝试顺序:直连是固定兜底线路,没写进 fetch_via 时排在最后。 */
export function resolveFetchRoutes(fetchVia: readonly string[] = []): string[] {
  return fetchVia.includes(DIRECT_ROUTE) ? [...fetchVia] : [...fetchVia, DIRECT_ROUTE];
}

// 与 backend/src/routes/provider-actions.ts TestFetchAttempt 保持同步
interface TestFetchAttempt {
  route: string;
  label: string;
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
  user_agents: string[];
  fetch_via: string[];
  parser_hint: ProviderData["parser_hint"];
}

/** 线路 id → 展示名;出口被删了就显示 id,并由调用方标红。 */
export function useRouteNames(): (route: string) => string | undefined {
  const egresses = useEntityList<EgressData>("egresses");
  const byId = new Map((egresses.data?.items ?? []).map((e) => [e.id, e.name]));
  return (route) => (route === DIRECT_ROUTE ? "服务器直连" : byId.get(route));
}

function sameInput(a: TestFetchInput, b: TestFetchInput): boolean {
  return (
    a.url === b.url &&
    a.user_agents.join("\n") === b.user_agents.join("\n") &&
    a.fetch_via.join(",") === b.fetch_via.join(",") &&
    a.parser_hint === b.parser_hint
  );
}

function verdict(attempts: TestFetchAttempt[], fetchVia: string[]): string {
  const routes = resolveFetchRoutes(fetchVia);
  const onlyDirect = routes.length === 1;
  const first = routes.map((r) => attempts.find((a) => a.route === r)).find((a) => a?.ok);
  if (first) {
    if (onlyDirect) return "服务器直连就能拉到,不需要出口。";
    if (first.route === DIRECT_ROUTE) return "按当前顺序会走服务器直连。";
    const directOk = attempts.find((a) => a.route === DIRECT_ROUTE)?.ok;
    return `按当前顺序会经「${first.label}」拉到。${directOk ? " 直连其实也能拉到,出口可以不配。" : ""}`;
  }
  if (onlyDirect) return "服务器直连拉不到。如果是机场按 IP 拦截,添加出口再选上测试。";
  return "所有线路都失败,先看下面的原因。";
}

export function FetchViaField({
  data,
  update,
}: {
  data: ProviderData;
  update: (patch: Partial<ProviderData>) => void;
}) {
  const egresses = useEntityList<EgressData>("egresses");
  const nameOf = useRouteNames();
  const routes = resolveFetchRoutes(data.fetch_via);
  const options = (egresses.data?.items ?? [])
    .map((e) => ({ id: e.id, label: e.name, hint: egressAddress(e) }))
    .filter((o) => !routes.includes(o.id));
  const noEgress = egresses.isSuccess && egresses.data.items.length === 0;

  // 直连总在列表里,存回去时只剩直连就存空,保持 yaml 干净
  const setRoutes = (next: string[]) => update({ fetch_via: next.length === 1 ? [] : next });
  // 新线路默认插在直连前面(直连在最后兜底时);直连被挪到中间就追加到末尾
  const add = (id: string) =>
    setRoutes(
      routes.at(-1) === DIRECT_ROUTE ? [...routes.slice(0, -1), id, DIRECT_ROUTE] : [...routes, id],
    );
  const move = (i: number, delta: number) => {
    const next = [...routes];
    [next[i], next[i + delta]] = [next[i + delta], next[i]];
    setRoutes(next);
  };

  const current: TestFetchInput = {
    url: data.url ?? "",
    user_agents: data.user_agents ?? [],
    fetch_via: data.fetch_via ?? [],
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
      <div className="flex items-end justify-between gap-2">
        <Label className="text-xs">拉取线路</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={!current.url || test.isPending}
          onClick={() => test.mutate(current)}
        >
          {test.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Route className="h-3.5 w-3.5" />}
          测试拉取
        </Button>
      </div>

      <ol className="mt-1.5 rounded-md border divide-y text-xs">
        {routes.map((route, i) => {
          const name = nameOf(route);
          const direct = route === DIRECT_ROUTE;
          return (
            <li key={route} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-4 text-center tabular-nums text-muted-foreground">{i + 1}</span>
              <span className={cn("min-w-0 truncate", !name && "text-destructive")}>
                {name ?? `${route}(出口已删除)`}
              </span>
              {direct && <span className="shrink-0 text-muted-foreground/70">固定兜底</span>}
              <div className="ml-auto flex items-center shrink-0">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={i === routes.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="下移"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                {direct ? (
                  // 直连不可移除,留同宽占位让上下移按钮对齐
                  <span className="h-6 w-6" aria-hidden />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setRoutes(routes.filter((r) => r !== route))}
                    aria-label="移除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        {options.length > 0 && (
          <li className="px-1.5 py-1">
            {/* value 固定为空:选完立刻追加,下拉框回到占位状态 */}
            <Select value="" onValueChange={add}>
              <SelectTrigger className="h-7 border-0 shadow-none text-xs text-muted-foreground focus:ring-0">
                <span className="flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  <SelectValue placeholder="添加出口" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    <span>{o.label}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{o.hint}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        )}
      </ol>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
        机场拦了服务器的 IP 时(常见是直连 403),借出口机的网络拉订阅。从上往下试,前一条失败才换下一条;
        「服务器直连」固定在列表里不能移除,可以上下挪。只影响拉订阅,不影响客户端连节点。
        {noEgress && (
          <>
            {" "}
            还没有出口,先到{" "}
            <Link to="/egresses" className="underline underline-offset-2 hover:text-foreground">
              出口
            </Link>{" "}
            页添加。
          </>
        )}
      </p>

      {(test.isPending || test.data || test.error) && (
        <div
          className={cn("mt-2 rounded-md border bg-muted/30 p-2.5 text-xs transition-opacity", outdated && "opacity-60")}
          aria-live="polite"
        >
          {test.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在逐条线路拉取…
            </div>
          )}
          {test.error && <div className="text-destructive">测试请求失败:{(test.error as Error).message}</div>}
          {test.data && !test.isPending && tested && (
            <>
              <div className="font-medium mb-2">
                {outdated ? "参数已改动,结果对应的是上一次测试。" : verdict(test.data.attempts, tested.fetch_via)}
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

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function AttemptRow({ attempt: a }: { attempt: TestFetchAttempt }) {
  return (
    <div className="grid grid-cols-[1rem_6rem_minmax(0,1fr)_auto] items-start gap-x-2">
      {a.ok ? (
        <CircleCheck className="h-3.5 w-3.5 mt-px text-emerald-600 dark:text-emerald-400" aria-label="成功" />
      ) : (
        <CircleX className="h-3.5 w-3.5 mt-px text-destructive" aria-label="失败" />
      )}
      <span className="truncate" title={a.label}>
        {a.label}
      </span>
      {a.ok ? (
        <span className="flex flex-wrap gap-x-3 text-muted-foreground">
          <span className="text-foreground">{a.node_count} 个节点</span>
          <span>{formatBytes(a.bytes)}</span>
          <span>{a.has_userinfo ? "带流量信息" : "无流量信息"}</span>
          {a.used_user_agent !== undefined && <span className="font-mono">UA {formatUserAgent(a.used_user_agent)}</span>}
        </span>
      ) : (
        <span className="text-destructive break-words">{a.error}</span>
      )}
      <span className="tabular-nums text-muted-foreground">{formatDuration(a.duration_ms)}</span>
    </div>
  );
}
