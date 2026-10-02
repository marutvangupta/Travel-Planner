import { motion } from "framer-motion";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      whileHover={{ rotate: 18 }}
      transition={{ type: "spring", stiffness: 260, damping: 14 }}
    >
      <rect width="32" height="32" rx="9" fill="var(--sea)" />
      <circle cx="16" cy="16" r="9.5" stroke="var(--sea-ink)" strokeWidth="1.5" opacity=".9" />
      <path d="M16 6.5l3.2 9.5-3.2 9.5-3.2-9.5z" fill="var(--sea-ink)" />
      <circle cx="16" cy="16" r="1.9" fill="var(--sea)" />
    </motion.svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="display text-[26px] leading-none">Waypoint</span>
    </span>
  );
}
