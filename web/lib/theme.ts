export const isDark = (): boolean => document.documentElement.classList.contains("dark");

export function setTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
}
