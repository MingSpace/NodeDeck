import { create } from "zustand";
import { useEffect } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

interface ToastItem {
  id: string;
  variant: "success" | "error" | "info";
  title: string;
  description?: string;
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id, duration: t.duration ?? 4000, variant: t.variant, title: t.title, description: t.description },
      ],
    }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export function toast(opts: {
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
}): void {
  useToastStore.getState().push({
    title: opts.title,
    description: opts.description,
    variant: opts.variant ?? "info",
  });
}

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const tm = window.setTimeout(onDismiss, item.duration);
    return () => window.clearTimeout(tm);
  }, [item.duration, onDismiss]);

  const Icon = item.variant === "success" ? CheckCircle2 : item.variant === "error" ? AlertCircle : Info;
  const color =
    item.variant === "success"
      ? "text-emerald-600"
      : item.variant === "error"
        ? "text-destructive"
        : "text-blue-600";

  return (
    <div className="flex items-start gap-3 min-w-[280px] max-w-md rounded-lg border bg-card p-3 shadow-lg">
      <Icon className={`h-5 w-5 flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{item.title}</div>
        {item.description && <div className="text-xs text-muted-foreground mt-0.5">{item.description}</div>}
      </div>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
