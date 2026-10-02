import type { Transition, Variants } from "framer-motion";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const springSoft: Transition = { type: "spring", stiffness: 220, damping: 28, mass: 0.9 };
export const ease = [0.22, 1, 0.36, 1] as const;

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 14, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease } },
  exit: { opacity: 0, y: -10, filter: "blur(4px)", transition: { duration: 0.22, ease: "easeIn" } },
};

export const stagger = (delay = 0.05, start = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: delay, delayChildren: start } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: spring },
};
