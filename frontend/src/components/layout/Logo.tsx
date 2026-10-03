/** Compass-needle mark on a sunset tile. Static: the brand should not wobble every time the cursor passes. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--sea)" />
      <circle cx="16" cy="16" r="9.5" stroke="var(--sea-ink)" strokeWidth="1.4" opacity=".85" />
      <path d="M16 6.5l3.2 9.5-3.2 9.5-3.2-9.5z" fill="var(--sea-ink)" />
      <circle cx="16" cy="16" r="1.9" fill="var(--sea)" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={26} />
      <span className="display text-[23px] leading-none tracking-[0.005em]">Waypoint</span>
    </span>
  );
}
