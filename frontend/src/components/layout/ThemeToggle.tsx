import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../../lib/theme";
import { IconButton } from "../ui";

const LABEL = { system: "Match system", light: "Light", dark: "Dark" } as const;
const NEXT = { system: "light", light: "dark", dark: "system" } as const;

export function ThemeToggle({ tipSide = "bottom" as "top" | "bottom", tipAlign = "end" as "center" | "end" }) {
  const { choice, cycle } = useTheme();
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <IconButton label={`Theme: ${LABEL[choice]}. Switch to ${LABEL[NEXT[choice]].toLowerCase()}`} tip={`Theme · ${choice === "system" ? "System" : LABEL[choice]}`} tipSide={tipSide} tipAlign={tipAlign} onClick={cycle}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={choice} initial={{ rotate: -50, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 50, opacity: 0, scale: 0.6 }} transition={{ duration: 0.16 }} className="inline-flex">
          <Icon size={17} />
        </motion.span>
      </AnimatePresence>
    </IconButton>
  );
}
