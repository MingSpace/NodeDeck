import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  LayoutDashboard,
  Cloud,
  Network,
  Filter,
  Layers,
  Puzzle,
  Settings as SettingsIcon,
  Upload,
  Bell,
  Power,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  Waypoints,
  Menu,
  X,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme, type ThemePreference } from "@/hooks/use-theme";
import { useEntityList } from "@/api/entities";
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

// 「订阅」一节放 Profile,夹在仪表板和下面两节之间,由 ProfileNavSection 动态渲染
const CONFIG_ITEMS: NavItem[] = [
  { to: "/providers", label: "节点源", icon: Cloud },
  { to: "/nodes", label: "节点池", icon: Network },
  { to: "/egresses", label: "出口", icon: Waypoints },
  { to: "/generals", label: "通用预设", icon: SettingsIcon },
  { to: "/rules", label: "规则模块", icon: Filter },
  { to: "/groups", label: "策略组", icon: Layers },
  { to: "/modules", label: "Surge 模块", icon: Puzzle },
];

const TOOL_ITEMS: NavItem[] = [
  { to: "/import", label: "导入", icon: Upload },
  { to: "/notifications", label: "通知", icon: Bell },
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
  // 多包一层 span:Radix 的 asChild 会把 className 当字符串合并,
  // 直接套在 NavLink 上时它的函数式 className 会被拼成函数源码,激活态和尺寸样式全丢
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex">{node}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function navLinkClass(collapsed: boolean, isActive: boolean) {
  return cn(
    "flex items-center rounded-md text-sm font-medium transition-colors shrink-0",
    collapsed ? "justify-center h-9 w-9" : "gap-3 px-3 py-2 h-9",
    isActive
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
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
      className={({ isActive }) => navLinkClass(collapsed, isActive)}
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  return maybeWithTooltip(collapsed, item.label, link);
}

/** 展开时是一行小标题,收起时只剩一道分隔线 */
function NavSectionLabel({ collapsed, children }: { collapsed: boolean; children: string }) {
  if (collapsed) return <div className="my-2 h-px w-6 bg-border" aria-hidden />;
  return <div className="px-3 pb-1 pt-3 text-xs text-muted-foreground/80">{children}</div>;
}

/**
 * Profile 是最终要导入客户端的东西,以前只能从仪表板点进去;侧边栏直接列出来。
 * 收起时用名称首字当图标,几个 Profile 之间还能分得清。
 */
function ProfileNavSection({ collapsed }: { collapsed: boolean }) {
  const profiles = useEntityList<{ id: string; name: string }>("profiles");
  const items = profiles.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <>
      <NavSectionLabel collapsed={collapsed}>订阅</NavSectionLabel>
      {items.map((p) => {
        const name = p.name.trim() || p.id;
        const link = (
          <NavLink
            key={p.id}
            to={`/profiles/${encodeURIComponent(p.id)}`}
            aria-label={collapsed ? name : undefined}
            className={({ isActive }) => navLinkClass(collapsed, isActive)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted-foreground/15 text-xs font-semibold leading-none">
              {Array.from(name)[0]}
            </span>
            {!collapsed && <span className="truncate">{name}</span>}
          </NavLink>
        );
        return <div key={p.id}>{maybeWithTooltip(collapsed, name, link)}</div>;
      })}
    </>
  );
}

const THEME_NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const THEME_META: Record<ThemePreference, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  system: { label: "外观:跟随系统", icon: Monitor },
  light: { label: "外观:浅色", icon: Sun },
  dark: { label: "外观:深色", icon: Moon },
};

function SidebarBody({
  collapsed,
  header,
}: {
  collapsed: boolean;
  header: React.ReactNode;
}) {
  const { logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const theme = THEME_META[preference];

  const footerBtnClass = cn(
    "flex items-center rounded-md text-sm font-medium text-muted-foreground transition-colors shrink-0",
    collapsed ? "justify-center h-9 w-9" : "gap-3 w-full px-3 py-2 h-9",
  );

  const themeBtn = (
    <button
      type="button"
      onClick={() => setPreference(THEME_NEXT[preference])}
      aria-label={theme.label}
      title={collapsed ? undefined : "点击切换"}
      className={cn(footerBtnClass, "hover:bg-secondary/60 hover:text-foreground")}
    >
      <theme.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{theme.label}</span>}
    </button>
  );

  const logoutBtn = (
    <button
      type="button"
      onClick={() => logout()}
      aria-label={collapsed ? "退出" : undefined}
      className={cn(footerBtnClass, "hover:bg-destructive/10 hover:text-destructive")}
    >
      <Power className="h-4 w-4 shrink-0" />
      {!collapsed && <span>退出</span>}
    </button>
  );

  return (
    <>
      <div
        className={cn(
          "border-b flex items-center h-14 shrink-0",
          collapsed ? "justify-center" : "justify-between px-4 gap-2",
        )}
      >
        {header}
      </div>
      <nav
        className={cn(
          "flex-1 py-3 overflow-y-auto flex flex-col",
          collapsed ? "items-center gap-0.5" : "gap-0.5 px-2",
        )}
      >
        <SidebarNavLink item={{ to: "/dashboard", label: "仪表板", icon: LayoutDashboard }} collapsed={collapsed} />
        <ProfileNavSection collapsed={collapsed} />
        <NavSectionLabel collapsed={collapsed}>配置</NavSectionLabel>
        {CONFIG_ITEMS.map((item) => (
          <SidebarNavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        <NavSectionLabel collapsed={collapsed}>工具</NavSectionLabel>
        {TOOL_ITEMS.map((item) => (
          <SidebarNavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
      </nav>
      <div
        className={cn(
          "border-t flex flex-col shrink-0",
          collapsed ? "items-center gap-1 py-3" : "gap-1 px-2 py-3",
        )}
      >
        <SidebarNavLink item={{ to: "/settings", label: "设置", icon: SettingsIcon }} collapsed={collapsed} />
        {maybeWithTooltip(collapsed, theme.label, themeBtn)}
        {maybeWithTooltip(collapsed, "退出", logoutBtn)}
      </div>
    </>
  );
}

function Brand() {
  return (
    <Link to="/dashboard" className="min-w-0 block">
      <div className="text-lg font-bold tracking-tight leading-tight truncate">NodeDeck</div>
      <p className="text-xs text-muted-foreground truncate">订阅规则配置中心</p>
    </Link>
  );
}

const iconBtnClass =
  "flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0";

export function AppLayout() {
  const { mustChangePassword } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 抽屉里点了链接就该收起来
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    // h-dvh + overflow-hidden 把整个 app 锁死在视口高度内,避免任何内部页面溢出时撑大 body 触发整页滚动条
    // (sidebar 会跟着滚走,糟糕的体验)。所有页面要滚动都在 <main> 内部滚(main 是 overflow-auto)。
    // 用 dvh 而不是 vh:手机浏览器地址栏收放时 100vh 会比可见区域高一截。
    // 窄屏(< md)侧边栏收进抽屉,顶部换成一条带菜单按钮的顶栏。
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {mustChangePassword && <ChangePasswordDialog forced />}
      <aside
        className={cn(
          "hidden md:flex border-r bg-card flex-col transition-[width] duration-200 ease-out",
          collapsed ? "w-14" : "w-48",
        )}
      >
        <SidebarBody
          collapsed={collapsed}
          header={
            collapsed ? (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label="展开侧边栏"
                className={cn(iconBtnClass, "h-9 w-9")}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            ) : (
              <>
                <Brand />
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label="收起侧边栏"
                  className={cn(iconBtnClass, "h-7 w-7")}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </>
            )
          }
        />
      </aside>

      <header className="md:hidden flex h-12 shrink-0 items-center gap-2 border-b bg-card px-2">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="打开菜单"
          className={cn(iconBtnClass, "h-9 w-9")}
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/dashboard" className="text-base font-bold tracking-tight">
          NodeDeck
        </Link>
      </header>
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col border-r bg-card shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden"
          >
            <DialogPrimitive.Title className="sr-only">导航菜单</DialogPrimitive.Title>
            <SidebarBody
              collapsed={false}
              header={
                <>
                  <Brand />
                  <DialogPrimitive.Close aria-label="关闭菜单" className={cn(iconBtnClass, "h-8 w-8")}>
                    <X className="h-4 w-4" />
                  </DialogPrimitive.Close>
                </>
              }
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <main
        className="flex-1 min-h-0 overflow-auto bg-background"
        style={{ scrollbarGutter: "stable" }}
        key={location.pathname}
      >
        <Outlet />
      </main>
    </div>
  );
}
