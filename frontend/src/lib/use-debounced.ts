import { useEffect, useRef, useState } from "react";

// @business_rule: 输入防抖 — 用 JSON.stringify 做依赖,避免对象/数组引用每次 render 变化导致 setTimeout 反复重置。
// 适合 string / number / 浅层 object / array,不适合包含函数 / Symbol 的复杂值。
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [JSON.stringify(value), delay]);
  return debounced;
}

// @user_flow: 在防抖窗口内 isStale = true,可用来给候选列表加渐隐动画(让用户感知到"还没生效");
// 防抖结束、value 落地后 isStale = false,列表恢复正常显示。
export function useDebouncedWithStaleFlag<T>(
  value: T,
  delay: number,
): { value: T; isStale: boolean } {
  const debounced = useDebounced(value, delay);
  const isStale = JSON.stringify(value) !== JSON.stringify(debounced);
  return { value: debounced, isStale };
}
