import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Cloud,
  Network,
  Filter,
  Layers,
  Puzzle,
  Settings as SettingsIcon,
  Upload,
  Power,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "仪表板", icon: LayoutDashboard },
  { to: "/providers", label: "节点源", icon: Cloud },
  { to: "/nodes", label: "节点池", icon: Network },
  { to: "/generals", label: "通用预设", icon: SettingsIcon },
  { to: "/rules", label: "规则模块", icon: Filter },
  { to: "/groups", label: "策略组", icon: Layers },
  { to: "/modules", label: "Surge 模块", icon: Puzzle },
  { to: "/import", label: "导入", icon: Upload },
  { to: "/logs", label: "日志", icon: ScrollText },
];

const STORAGE_KEY = "nodedeck:sidebar-collapsed";

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

function maybeWithTooltip(
  collapsed: boolean,
  label: string,
  node: React.ReactElement,
) {
  if (!collapsed) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarNavLink({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) {
  const link = (
    <NavLink
      to={item.to}
      aria-label={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-md text-sm font-medium transition-colors shrink-0",
          collapsed ? "justify-center h-9 w-9" : "gap-3 px-3 py-2 h-9",
          isActive
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  return maybeWithTooltip(collapsed, item.label, link);
}

export function AppLayout() {
  const { logout, mustChangePassword } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  const logoutBtn = (
    <button
      type="button"
      onClick={() => logout()}
      aria-label={collapsed ? "退出" : undefined}
      className={cn(
        "flex items-center rounded-md text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0",
        collapsed ? "justify-center h-9 w-9" : "gap-3 w-full px-3 py-2 h-9",
      )}
    >
      <Power className="h-4 w-4 shrink-0" />
      {!collapsed && <span>退出</span>}
    </button>
  );

  const settingsLink = (
    <NavLink
      to="/settings"
      aria-label={collapsed ? "设置" : undefined}
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-md text-sm font-medium transition-colors shrink-0",
          collapsed ? "justify-center h-9 w-9" : "gap-3 px-3 py-2 h-9",
          isActive
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
        )
      }
    >
      <SettingsIcon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>设置</span>}
    </NavLink>
  );

  return (
    // h-screen + overflow-hidden 把整个 app 锁死在视口高度内,避免任何内部页面溢出时撑大 body 触发整页滚动条
    // (sidebar 会跟着滚走,糟糕的体验)。所有页面要滚动都在 <main> 内部滚(main 是 overflow-auto)。
    <div className="flex h-screen overflow-hidden">
      {mustChangePassword && <ChangePasswordDialog forced />}
      <aside
        className={cn(
          "border-r bg-card flex flex-col transition-[width] duration-200 ease-out",
          collapsed ? "w-14" : "w-48",
        )}
      >
        <div
          className={cn(
            "border-b flex items-center h-14",
            collapsed ? "justify-center" : "justify-between px-4 gap-2",
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="展开侧边栏"
              className="h-9 w-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          ) : (
            <>
              <Link to="/dashboard" className="min-w-0 block">
                <h1 className="text-lg font-bold tracking-tight leading-tight truncate">
                  NodeDeck
                </h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  订阅规则配置中心
                </p>
              </Link>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="收起侧边栏"
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <nav
          className={cn(
            "flex-1 py-3 overflow-y-auto flex flex-col",
            collapsed ? "items-center gap-0.5" : "gap-0.5 px-2",
          )}
        >
          {NAV_ITEMS.map((item) => (
            <SidebarNavLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>
        <div
          className={cn(
            "border-t flex flex-col",
            collapsed ? "items-center gap-1 py-3" : "gap-1 p-3",
          )}
        >
          {maybeWithTooltip(collapsed, "设置", settingsLink)}
          {maybeWithTooltip(collapsed, "退出", logoutBtn)}
        </div>
      </aside>
      <main
        className="flex-1 overflow-auto bg-background"
        style={{ scrollbarGutter: "stable" }}
        key={location.pathname}
      >
        <Outlet />
      </main>
    </div>
  );
}
