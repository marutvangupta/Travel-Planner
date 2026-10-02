import { useEffect, useState, type KeyboardEvent } from "react";

/**
 * Arrow-key navigation for tablists and radio groups (WAI-ARIA roving focus): Left/Right and Up/Down move,
 * Home/End jump. Selection follows focus. Attach to the container's onKeyDown; items need role tab or radio.
 */
export function rovingKeys<T>(e: KeyboardEvent<HTMLElement>, values: readonly T[], current: T, select: (v: T) => void) {
  const n = values.length;
  const i = Math.max(0, values.indexOf(current));
  let next = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % n;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + n) % n;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = n - 1;
  if (next < 0) return;
  e.preventDefault();
  select(values[next]);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"],[role="radio"]')[next]?.focus();
}

/** Sets the tab title as "<page> · Waypoint" while the page is mounted. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · Waypoint`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

/** True once the window has scrolled past `threshold`; only re-renders when that flips. */
export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
