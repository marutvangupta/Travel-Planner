import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { spring } from "../lib/motion";

type Kind = "ok" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}
const Ctx = createContext<((text: string, kind?: Kind) => void) | null>(null);

const ICON = {
  ok: { icon: Check, cls: "bg-good-soft text-good" },
  error: { icon: AlertTriangle, cls: "bg-bad-soft text-bad" },
  info: { icon: Info, cls: "bg-sea-soft text-sea" },
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text: string, kind: Kind = "ok") => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, kind, text }]);
      // errors stay a little longer: they usually need reading
      window.setTimeout(() => dismiss(id), kind === "error" ? 6500 : 4200);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const { icon: Icon, cls } = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 20, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.16 } }}
                transition={spring}
                className="pointer-events-auto flex max-w-md items-center gap-3 rounded-[14px] border border-line bg-surface py-2 pl-2 pr-1.5 text-sm shadow-pop"
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${cls}`}>
                  <Icon size={14} strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1 py-0.5 leading-snug">{t.text}</span>
                <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-ink">
                  <X size={14} />
                </button>
              </motion.div>
            );
          })}
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
