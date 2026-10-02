import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "wp-theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* ignore */
    }
  }, [choice]);
  const cycle = useCallback(() => setChoice((c) => (c === "system" ? "light" : c === "light" ? "dark" : "system")), []);
  return { choice, cycle };
}
