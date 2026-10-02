import type { Transition, Variants } from "framer-motion";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 };
export const springSoft: Transition = { type: "spring", stiffness: 240, damping: 30, mass: 0.9 };
export const ease = [0.22, 1, 0.36, 1] as const;

/** Page enter: a short rise and fade. Exits are instant so navigation never waits on an animation. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export const stagger = (delay = 0.05, start = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: delay, delayChildren: start } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: spring },
};
