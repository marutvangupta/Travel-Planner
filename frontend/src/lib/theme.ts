import { useCallback, useEffect, useState } from "react";
import { prefersReducedMotion } from "./a11y";

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

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => {
    apply(choice);
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* ignore */
    }
  }, [choice]);
  const cycle = useCallback(() => {
    const next: ThemeChoice = choice === "system" ? "light" : choice === "light" ? "dark" : "system";
    // cross-fade the whole page where the browser supports view transitions; a hard cut otherwise
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !prefersReducedMotion()) doc.startViewTransition(() => apply(next));
    else apply(next);
    setChoice(next);
  }, [choice]);
  return { choice, cycle };
}
