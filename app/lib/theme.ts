import { useEffect } from "react";

export type ThemePreference = "light" | "dark" | "system";

export function applyTheme(theme: ThemePreference) {
  if (typeof window === "undefined") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = theme === "dark" || (theme === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function useThemePreference(theme: ThemePreference) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => applyTheme(theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
}
