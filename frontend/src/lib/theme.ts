import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "wp-theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable: fall through */
  }
  // honour a theme already set on the page (the inline boot script, or a host that embeds the app)
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
  }, [choice]);
  // only an explicit toggle is remembered, so following the system theme stays the default
  const cycle = useCallback(
    () =>
      setChoice((c) => {
        const next: ThemeChoice = c === "system" ? "light" : c === "light" ? "dark" : "system";
        try {
          if (next === "system") localStorage.removeItem(KEY);
          else localStorage.setItem(KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      }),
    [],
  );
  return { choice, cycle };
}
