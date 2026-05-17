import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { RequireAuth } from "@/components/require-auth";

// 路由级 code splitting:除了 Login(必经) 与 Dashboard(默认首页) 保持 eager,
// 其它路由全部按需加载。最大收益是 Monaco / Profile 编辑器 / 各列表页的
// 大 bundle 不再进首屏 chunk,初次访问只下 ~200KB,而不是把所有页一次性塞过去。
const ProvidersPage = lazy(() =>
  import("@/pages/providers").then((m) => ({ default: m.ProvidersPage })),
);
const NodesPage = lazy(() => import("@/pages/nodes").then((m) => ({ default: m.NodesPage })));
const RulesPage = lazy(() => import("@/pages/rules").then((m) => ({ default: m.RulesPage })));
const GroupsPage = lazy(() => import("@/pages/groups").then((m) => ({ default: m.GroupsPage })));
const ModulesPage = lazy(() => import("@/pages/modules").then((m) => ({ default: m.ModulesPage })));
const GeneralsPage = lazy(() =>
  import("@/pages/generals").then((m) => ({ default: m.GeneralsPage })),
);
const ProfileEditorPage = lazy(() =>
  import("@/pages/profile-editor/index").then((m) => ({ default: m.ProfileEditorPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings").then((m) => ({ default: m.SettingsPage })),
);
const ImportPage = lazy(() => import("@/pages/import").then((m) => ({ default: m.ImportPage })));
const LogsPage = lazy(() => import("@/pages/logs").then((m) => ({ default: m.LogsPage })));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">加载中…</span>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="providers"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProvidersPage />
            </Suspense>
          }
        />
        <Route
          path="nodes"
          element={
            <Suspense fallback={<RouteFallback />}>
              <NodesPage />
            </Suspense>
          }
        />
        <Route
          path="rules"
          element={
            <Suspense fallback={<RouteFallback />}>
              <RulesPage />
            </Suspense>
          }
        />
        <Route
          path="groups"
          element={
            <Suspense fallback={<RouteFallback />}>
              <GroupsPage />
            </Suspense>
          }
        />
        <Route
          path="modules"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ModulesPage />
            </Suspense>
          }
        />
        <Route
          path="generals"
          element={
            <Suspense fallback={<RouteFallback />}>
              <GeneralsPage />
            </Suspense>
          }
        />
        <Route
          path="profiles/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ProfileEditorPage />
            </Suspense>
          }
        />
        <Route
          path="settings"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SettingsPage />
            </Suspense>
          }
        />
        <Route
          path="import"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ImportPage />
            </Suspense>
          }
        />
        <Route
          path="logs"
          element={
            <Suspense fallback={<RouteFallback />}>
              <LogsPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
