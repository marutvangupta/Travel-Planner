import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";

export function ThemeToggle() {
  const { choice, cycle } = useTheme();
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${choice}. Click to change.`}
      title={`Theme: ${choice}`}
      className="relative grid h-9 w-9 place-items-center rounded-[10px] border border-line bg-surface text-muted transition-colors hover:text-ink"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={choice} initial={{ rotate: -60, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 60, opacity: 0, scale: 0.6 }} transition={{ duration: 0.18 }}>
          <Icon size={17} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
