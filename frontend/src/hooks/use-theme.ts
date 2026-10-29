import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

// 与 index.html 里防闪烁的内联脚本共用这个 key,改名要两边一起改
const STORAGE_KEY = "nodedeck:theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

let preference = readPreference();

function resolve(): ResolvedTheme {
  if (preference === "system") return media.matches ? "dark" : "light";
  return preference;
}

function apply() {
  const root = document.documentElement;
  const resolved = resolve();
  root.classList.toggle("dark", resolved === "dark");
  // 让原生控件(滚动条、日期选择器等)也跟着换色
  root.style.colorScheme = resolved;
  listeners.forEach((l) => l());
}

// 「跟随系统」时,系统切换深浅色要实时跟上
media.addEventListener("change", () => {
  if (preference === "system") apply();
});
apply();

function setPreference(next: ThemePreference) {
  preference = next;
  if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, next);
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 外观偏好全站共享一份(侧边栏切换、Monaco 跟着换主题),所以用模块级 store 而不是 useState */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => preference);
  const resolved = useSyncExternalStore(subscribe, resolve);
  return { preference: pref, resolved, setPreference };
}
