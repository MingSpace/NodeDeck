import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

export function ChangePasswordDialog({
  forced,
  open: openProp,
  onOpenChange,
}: {
  forced: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [openState, setOpenState] = useState(forced);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.post("/api/auth/change-password", { current_password: current, new_password: next }),
    onSuccess: () => {
      toast({ title: "密码已更新", variant: "success" });
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      void queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 6) {
      setError("新密码至少 6 个字符");
      return;
    }
    if (next !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (forced ? setOpen(true) : setOpen(v))}>
      <DialogContent className="sm:max-w-sm" onPointerDownOutside={forced ? (e) => e.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>{forced ? "首次登录,请修改密码" : "修改密码"}</DialogTitle>
          <DialogDescription>
            {forced ? "为了安全,请将默认初始密码替换为强密码" : "完成后下次登录使用新密码"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur">当前密码</Label>
            <Input id="cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">新密码</Label>
            <Input id="new" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf">确认新密码</Label>
            <Input id="conf" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
          </div>
          {error && <div className="text-sm text-destructive bg-destructive/10 rounded p-2">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            {!forced && (
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "保存中..." : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
