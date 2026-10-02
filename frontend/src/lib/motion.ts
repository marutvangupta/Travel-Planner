import type { Transition, Variants } from "framer-motion";

/*
  Motion system. Three speeds and one easing family:
  - micro (120–180 ms): hovers, presses, icon swaps
  - standard (240–320 ms): tabs, panels, field messages
  - entrance (400–600 ms): page and content reveals
  Only opacity and transform are animated for anything large; blur and layout-affecting properties are kept to
  small elements so pages stay on the compositor. MotionConfig reducedMotion="user" (main.tsx) turns transforms
  off for people who ask for less motion.
*/
export const ease = [0.22, 1, 0.36, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const springSoft: Transition = { type: "spring", stiffness: 220, damping: 28, mass: 0.9 };
export const springSnappy: Transition = { type: "spring", stiffness: 600, damping: 32, mass: 0.6 };

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.42, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: easeInOut } },
};

export const stagger = (delay = 0.05, start = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: delay, delayChildren: start } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: spring },
};

/** Height + opacity reveal for inline messages and optional fields. */
export const collapse: Variants = {
  hidden: { opacity: 0, height: 0 },
  show: { opacity: 1, height: "auto", transition: { height: { duration: 0.28, ease }, opacity: { duration: 0.2, delay: 0.06 } } },
  exit: { opacity: 0, height: 0, transition: { height: { duration: 0.22, ease: easeInOut }, opacity: { duration: 0.12 } } },
};

/** A short, damped horizontal shake for "that did not work" feedback. */
export const shake = { x: [0, -7, 6, -4, 3, 0], transition: { duration: 0.42, ease: easeInOut } };
