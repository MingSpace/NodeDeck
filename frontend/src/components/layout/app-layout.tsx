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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { ChangePasswordDialog } from "@/components/change-password-dialog";

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

export function AppLayout() {
  const { logout, mustChangePassword } = useAuth();
  const location = useLocation();
  return (
    <div className="flex min-h-screen">
      {mustChangePassword && <ChangePasswordDialog forced />}
      <aside className="w-56 border-r bg-card flex flex-col">
        <div className="px-5 py-4 border-b">
          <Link to="/dashboard" className="block">
            <h1 className="text-xl font-bold tracking-tight">MConvert</h1>
            <p className="text-xs text-muted-foreground">订阅转换 + 配置中心</p>
          </Link>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 space-y-2">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium",
                isActive
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )
            }
          >
            <SettingsIcon className="h-4 w-4" />
            设置
          </NavLink>
          <button
            type="button"
            onClick={() => logout()}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Power className="h-4 w-4" />
            退出
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-background" key={location.pathname}>
        <Outlet />
      </main>
    </div>
  );
}
