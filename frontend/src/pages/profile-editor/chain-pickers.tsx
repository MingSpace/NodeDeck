import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerOption {
  value: string;
  /** 分组标题,同 group 的选项会聚在一起并带小标题;不填则不分组 */
  group?: string;
  hint?: string;
  count?: number;
}

/** 点击外部 / Esc 关闭。ref 同时覆盖触发器与浮层,避免点触发器时"关了又开"。 */
function useDismiss(open: boolean, onClose: () => void, refs: React.RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, refs]);
}

const PANEL_MAX_HEIGHT = 288;

/**
 * 浮层用 portal + position:fixed 渲染,而不是就地 absolute。
 * 链式代理面板是内部滚动容器(overflow-auto),就地定位的下拉会被裁掉,
 * 或者把 scrollHeight 撑高导致列表跳动。
 */
function FloatingPanel({
  anchor,
  children,
  panelRef,
  minWidth = 240,
}: {
  anchor: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  panelRef: React.RefObject<HTMLDivElement>;
  minWidth?: number;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchor.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(minWidth, rect.width);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      // 下方不够就朝上翻,保证列表可见
      const top =
        spaceBelow < PANEL_MAX_HEIGHT && rect.top > spaceBelow
          ? Math.max(8, rect.top - PANEL_MAX_HEIGHT - 4)
          : rect.bottom + 4;
      setPos({ left, top, width });
    };
    compute();
    window.addEventListener("resize", compute);
    // capture=true:祖先滚动容器滚动时也要跟着重算
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [anchor, minWidth]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: PANEL_MAX_HEIGHT }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-md border bg-popover shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

function OptionList({
  options,
  isSelected,
  onPick,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyHint,
  footer,
}: {
  options: PickerOption[];
  isSelected: (value: string) => boolean;
  onPick: (value: string) => void;
  query: string;
  onQueryChange: (v: string) => void;
  searchPlaceholder: string;
  emptyHint: string;
  footer?: React.ReactNode;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.value.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  const sections = useMemo(() => {
    const map = new Map<string, PickerOption[]>();
    for (const o of filtered) {
      const key = o.group ?? "";
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <>
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-2.5 py-3 text-xs text-muted-foreground">{emptyHint}</div>
        )}
        {sections.map(([group, items]) => (
          <div key={group}>
            {group && (
              <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {group}
              </div>
            )}
            {items.map((o) => {
              const active = isSelected(o.value);
              return (
                <button
                  key={`${group}-${o.value}`}
                  type="button"
                  onClick={() => onPick(o.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                    active && "font-medium",
                  )}
                >
                  <Check
                    className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.value}</span>
                  {o.hint && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{o.hint}</span>
                  )}
                  {o.count !== undefined && (
                    <span className="shrink-0 rounded-sm bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                      {o.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {footer}
    </>
  );
}

/** 已选项以 chip 展示 + 一个「添加」按钮打开可搜索列表。空数组语义由调用方用 emptyLabel 说明。 */
export function SearchMultiSelect({
  options,
  selected,
  onChange,
  emptyLabel,
  addLabel = "添加",
  searchPlaceholder = "搜索…",
  noOptionsHint = "无可选项",
  disabled,
}: {
  options: PickerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  addLabel?: string;
  searchPlaceholder?: string;
  noOptionsHint?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [triggerRef, panelRef]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.length === 0 && (
        <span className="text-[11px] italic text-muted-foreground">{emptyLabel}</span>
      )}
      {selected.map((value) => (
        <span
          key={value}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
          title={value}
        >
          <span className="truncate">{value}</span>
          <button
            type="button"
            onClick={() => toggle(value)}
            className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
            aria-label={`移除 ${value}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-3 w-3" />
        {addLabel}
      </button>
      {open && (
        <FloatingPanel anchor={triggerRef} panelRef={panelRef} minWidth={280}>
          <OptionList
            options={options}
            isSelected={(v) => selected.includes(v)}
            onPick={toggle}
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder={searchPlaceholder}
            emptyHint={noOptionsHint}
          />
        </FloatingPanel>
      )}
    </div>
  );
}

/** 单选,支持输入不在候选里的名字(链式出口允许指向尚未拉取到的节点/组)。 */
export function SearchSingleSelect({
  value,
  options,
  onChange,
  placeholder,
  tone = "default",
  searchPlaceholder = "搜索或直接输入名称…",
}: {
  value: string;
  options: PickerOption[];
  onChange: (next: string) => void;
  placeholder: string;
  tone?: "default" | "warning";
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [triggerRef, panelRef]);

  const trimmed = query.trim();
  const canUseCustom = trimmed.length > 0 && !options.some((o) => o.value === trimmed);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        title={value || placeholder}
        className={cn(
          "inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs transition-colors hover:bg-accent",
          tone === "warning"
            ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
            : "border-input bg-background",
        )}
      >
        <span className={cn("truncate font-mono", !value && "italic text-muted-foreground")}>
          {value || placeholder}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <FloatingPanel anchor={triggerRef} panelRef={panelRef} minWidth={300}>
          <OptionList
            options={options}
            isSelected={(v) => v === value}
            onPick={(v) => {
              onChange(v);
              setOpen(false);
            }}
            query={query}
            onQueryChange={setQuery}
            searchPlaceholder={searchPlaceholder}
            emptyHint="没有匹配项 — 可直接使用下方输入的名称"
            footer={
              canUseCustom ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(trimmed);
                    setOpen(false);
                  }}
                  className="border-t px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent"
                >
                  使用自定义名称 <span className="font-mono font-medium">{trimmed}</span>
                </button>
              ) : null
            }
          />
        </FloatingPanel>
      )}
    </>
  );
}

/** 短枚举(协议/地区)用平铺 chip 直接点,比下拉快。 */
export function ChipToggles({
  options,
  selected,
  onChange,
  emptyLabel,
  tone = "primary",
}: {
  options: PickerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
  tone?: "primary" | "destructive";
}) {
  if (options.length === 0) {
    return <span className="text-[11px] italic text-muted-foreground">{emptyLabel}</span>;
  }
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  };
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium border transition-colors",
              active
                ? tone === "destructive"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {o.value}
            {o.count !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  active ? "opacity-80" : "text-muted-foreground/60",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
