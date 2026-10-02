import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

function Cell({ ch, index }: { ch: string; index: number }) {
  return (
    <span className={`mono relative block h-[1.25em] w-[0.82em] overflow-hidden rounded-[3px] text-[0.9em] font-semibold text-ink transition-colors [perspective:200px] ${ch === " " ? "bg-transparent" : "bg-surface-2 shadow-[inset_0_-1px_0_rgba(0,0,0,.35),inset_0_1px_0_rgba(255,255,255,.06)]"}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={ch}
          initial={{ rotateX: -90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          exit={{ rotateX: 90, opacity: 0 }}
          transition={{ duration: 0.34, delay: index * 0.045, ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 grid place-items-center"
        >
          {ch === " " ? "\u00a0" : ch}
        </motion.span>
      </AnimatePresence>
      {ch !== " " && <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/40" />}
    </span>
  );
}

/** Split-flap style departure board: fixed-size cells, each character flips independently. */
export function FlipBoard({ words, hold = 3200, className = "" }: { words: string[]; hold?: number; className?: string }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || words.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % words.length), hold);
    return () => window.clearInterval(t);
  }, [words, hold, reduce]);
  const width = Math.max(...words.map((w) => w.length));
  const chars = words[i].toUpperCase().padEnd(width, " ").split("");
  return (
    <span className={`inline-flex shrink-0 gap-[3px] ${className}`} role="img" aria-label={words[i]}>
      {chars.map((ch, k) => (
        <Cell key={k} ch={ch} index={k} />
      ))}
    </span>
  );
}
