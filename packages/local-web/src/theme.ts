export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem("theme");
    const dark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch {}
}
