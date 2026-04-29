import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { useAuth } from "@/hooks/use-auth";

export function SettingsPage() {
  const { username } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="p-8 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">设置</h1>
      <Card>
        <CardHeader>
          <CardTitle>账户</CardTitle>
          <CardDescription>当前登录: {username ?? "-"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setPwOpen(true)}>
            修改密码
          </Button>
          {pwOpen && <ChangePasswordDialog forced={false} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>关于</CardTitle>
          <CardDescription>MConvert 个人版 v0.1.0</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>替代 subconverter,只服务 Clash Meta 与 Surge 5。</p>
          <p>所有配置存储在 <code>data/</code> 目录,改完即生效,无需重启 docker 容器。</p>
        </CardContent>
      </Card>
    </div>
  );
}
