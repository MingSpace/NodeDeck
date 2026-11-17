import * as React from "react";
import { cn } from "@/lib/utils";

export interface AutoGrowTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  /** 撑到这么多行后改为内部滚动,避免一段超长文本把弹窗顶出屏幕 */
  maxRows?: number;
  /** 回车不换行:用于最终会被压成单行的字段(如 sgmodule 的 #!desc=) */
  singleParagraph?: boolean;
}

/**
 * 与 Input 同高起步、随内容自动长高的 textarea。
 * 不用 CSS `field-sizing: content`:Safari / Firefox 正式版还不支持。
 */
const AutoGrowTextarea = React.forwardRef<HTMLTextAreaElement, AutoGrowTextareaProps>(
  ({ className, maxRows = 6, singleParagraph = false, value, onChange, onKeyDown, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    const fit = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      const style = getComputedStyle(el);
      const lineHeight = parseFloat(style.lineHeight) || 20;
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      // box-sizing: border-box(Tailwind preflight),scrollHeight 含 padding 不含 border
      const max = lineHeight * maxRows + padding + border;
      el.style.height = "auto";
      const natural = el.scrollHeight + border;
      el.style.height = `${Math.min(natural, max)}px`;
      el.style.overflowY = natural > max + 1 ? "auto" : "hidden";
    }, [maxRows]);

    React.useLayoutEffect(fit, [fit, value]);

    // 弹窗宽度变化(窗口缩放 / 响应式断点)会改变折行,需要重算高度
    React.useEffect(() => {
      const el = innerRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let lastWidth = el.clientWidth;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth !== lastWidth) {
          lastWidth = el.clientWidth;
          fit();
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [fit]);

    return (
      <textarea
        ref={innerRef}
        rows={1}
        value={value}
        onChange={(e) => {
          if (singleParagraph && /[\r\n]/.test(e.target.value)) {
            e.target.value = e.target.value.replace(/[\r\n]+/g, " ");
          }
          onChange?.(e);
        }}
        onKeyDown={(e) => {
          if (singleParagraph && e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
          onKeyDown?.(e);
        }}
        className={cn(
          "flex min-h-9 w-full resize-none rounded-md border border-input bg-background px-3 py-[7px] text-sm leading-5 shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
AutoGrowTextarea.displayName = "AutoGrowTextarea";

export { AutoGrowTextarea };
