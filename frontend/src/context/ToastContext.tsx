import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { spring } from "../lib/motion";

type Kind = "ok" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}
const Ctx = createContext<((text: string, kind?: Kind) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: Kind = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={spring}
              className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-[var(--shadow-lg)]"
            >
              {t.kind === "ok" ? <Check size={16} className="text-good" /> : t.kind === "error" ? <AlertTriangle size={16} className="text-bad" /> : <Info size={16} className="text-sea" />}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside ToastProvider");
  return v;
};
