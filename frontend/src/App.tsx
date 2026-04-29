import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/app-layout";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { ProvidersPage } from "@/pages/providers";
import { NodesPage } from "@/pages/nodes";
import { RulesPage } from "@/pages/rules";
import { GroupsPage } from "@/pages/groups";
import { ModulesPage } from "@/pages/modules";
import { GeneralsPage } from "@/pages/generals";
import { ProfilesPage } from "@/pages/profiles";
import { ProfileEditorPage } from "@/pages/profile-editor";
import { SettingsPage } from "@/pages/settings";
import { ImportPage } from "@/pages/import";
import { RequireAuth } from "@/components/require-auth";

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
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="nodes" element={<NodesPage />} />
        <Route path="rules" element={<RulesPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="modules" element={<ModulesPage />} />
        <Route path="generals" element={<GeneralsPage />} />
        <Route path="profiles" element={<ProfilesPage />} />
        <Route path="profiles/:id" element={<ProfileEditorPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="import" element={<ImportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
