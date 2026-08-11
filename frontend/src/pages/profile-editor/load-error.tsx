import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  FileQuestion,
  LayoutDashboard,
  LogIn,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEntityList } from "@/api/entities";
import { ApiError } from "@/lib/api";

interface ProfileSummary {
  id: string;
  name: string;
}

interface Props {
  id: string;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}

type Kind = "not-found" | "unauthorized" | "forbidden" | "failed";

function classify(error: unknown): Kind {
  if (!(error instanceof ApiError)) return "failed";
  if (error.status === 404) return "not-found";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  return "failed";
}

function errorDetail(error: unknown): string {
  if (error instanceof ApiError) return `HTTP ${error.status} · ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function Id({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>;
}

/**
 * Profile 编辑器打不开时的落地页。核心是把「这个 id 根本不存在」和「后端/网络/权限出问题了」分开:
 * 前者重试一万次也没用,该给的是别的 Profile 入口;后者才需要重试或去修配置。
 */
export function ProfileLoadError({ id, error, onRetry, retrying }: Props) {
  const kind = classify(error);
  // 只在 404 时才拉「现有的 Profile」候选列表 —— 其它错误下这个请求大概率同样失败。
  const profileList = useEntityList<ProfileSummary>("profiles", kind === "not-found");
  const others = (profileList.data?.items ?? []).filter((p) => p.id !== id);

  const title = {
    "not-found": "找不到这个 Profile",
    unauthorized: "登录状态已失效",
    forbidden: "没有访问权限",
    failed: "Profile 加载失败",
  }[kind];

  const description = {
    "not-found": (
      <>
        ID <Id>{id}</Id> 对应的 Profile 不存在,可能已经被删除,或者链接里的 ID 有笔误。
      </>
    ),
    unauthorized: <>会话已过期或后端重启,重新登录后回到这个页面即可继续编辑。</>,
    forbidden: (
      <>
        后端拒绝了这次请求。最常见的原因是设置页的 IP 白名单(<Id>ip_allowlist</Id>
        )没有包含你当前的 IP —— 白名单不限制登录接口,所以会出现「能登录但读不到数据」。
      </>
    ),
    failed: (
      <>
        读取 <Id>{id}</Id> 时后端没有正常返回。可能是服务重启中或网络中断,稍后重试通常就能恢复。
      </>
    ),
  }[kind];

  const soft = kind === "not-found";

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
          <Link to="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            返回仪表板
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div
                className={
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md " +
                  (soft ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive")
                }
              >
                {kind === "not-found" && <FileQuestion className="h-5 w-5" />}
                {(kind === "unauthorized" || kind === "forbidden") && (
                  <ShieldAlert className="h-5 w-5" />
                )}
                {kind === "failed" && <AlertTriangle className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <CardTitle>{title}</CardTitle>
                <CardDescription className="mt-1.5">{description}</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {!soft && (
              <div className="break-all rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
                {errorDetail(error)}
              </div>
            )}

            {kind === "not-found" && others.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">现有的 Profile</div>
                <ul className="divide-y rounded-md border">
                  {others.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/profiles/${p.id}`}
                        className="flex items-baseline gap-2 px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <span className="truncate font-medium">{p.name || "未命名 Profile"}</span>
                        <code className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {p.id}
                        </code>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {kind === "not-found" && profileList.isSuccess && others.length === 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                当前还没有任何 Profile,去仪表板点「新建 Profile」创建一个。
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {kind === "unauthorized" ? (
                <Button asChild>
                  <Link to="/login">
                    <LogIn className="h-4 w-4" />
                    重新登录
                  </Link>
                </Button>
              ) : (
                <Button asChild variant={soft ? "default" : "outline"}>
                  <Link to="/dashboard">
                    <LayoutDashboard className="h-4 w-4" />
                    去仪表板
                  </Link>
                </Button>
              )}
              {kind === "forbidden" && (
                <Button asChild variant="outline">
                  <Link to="/settings">检查 IP 白名单</Link>
                </Button>
              )}
              {kind !== "not-found" && (
                <Button onClick={onRetry} disabled={retrying} variant={soft ? "outline" : "default"}>
                  <RefreshCw className={"h-4 w-4" + (retrying ? " animate-spin" : "")} />
                  {retrying ? "重试中..." : "重试"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
