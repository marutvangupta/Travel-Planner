import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";

const NEXT = { system: "light", light: "dark", dark: "system" } as const;

export function ThemeToggle() {
  const { choice, cycle } = useTheme();
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${choice}. Switch to ${NEXT[choice]}.`}
      title={`Theme: ${choice}`}
      className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={choice} initial={{ rotate: -45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 45, opacity: 0 }} transition={{ duration: 0.15 }} className="grid">
          <Icon size={16} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
