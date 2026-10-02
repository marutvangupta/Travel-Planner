import { animate, motion, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { spring } from "../../lib/motion";

type BtnProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "signal" | "soft" | "ghost" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

const variants = {
  primary: "bg-sea text-sea-ink shadow-[inset_0_1px_0_rgba(255,255,255,.14)] hover:bg-[color-mix(in_srgb,var(--sea)_86%,var(--ink))]",
  signal: "bg-signal text-white shadow-[inset_0_1px_0_rgba(255,255,255,.16)] hover:bg-[color-mix(in_srgb,var(--signal)_86%,var(--ink))]",
  soft: "bg-sea-soft text-sea hover:bg-[color-mix(in_srgb,var(--sea-soft)_80%,var(--sea))]",
  ghost: "border border-line bg-surface text-ink hover:border-line-strong",
  quiet: "bg-transparent text-muted hover:bg-surface-2 hover:text-ink",
  danger: "border border-line bg-surface text-bad hover:border-bad/50",
} as const;
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" } as const;

export function Button({ variant = "primary", size = "md", loading, icon, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      transition={spring}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-[var(--radius-ctl)] font-semibold transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={size === "sm" ? 14 : 16} className="animate-spin" aria-hidden /> : icon}
      {children as ReactNode}
    </motion.button>
  );
}

export function Chip({
  active,
  onClick,
  children,
  icon,
  tone = "sea",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  tone?: "sea" | "signal";
}) {
  const on = tone === "signal" ? "border-signal/60 bg-signal-soft text-signal" : "border-sea/60 bg-sea-soft text-sea";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-150 ${
        active ? on : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {icon}
      {children}
    </motion.button>
  );
}

/** Segmented control whose highlight glides between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // radio-group keyboard model: arrows move and select, one tab stop for the whole group
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[11px] border border-line bg-surface-2 p-[3px]">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active && <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-lg border border-line bg-raised shadow-[var(--shadow-sm)]" />}
            <span className="relative block leading-tight">{o.label}</span>
            {o.hint && <span className="relative mt-0.5 block text-[11px] font-normal text-muted">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor, aside }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string; aside?: ReactNode }) {
  const Tag = htmlFor ? "label" : "p";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Tag htmlFor={htmlFor} className="field-label">
          {label}
        </Tag>
        {aside}
      </div>
      {children}
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-[var(--radius-ctl)] border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-sea focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--sea)_20%,transparent)]";

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-box)] border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-line-strong"
    >
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
      <span className={`flex h-6 w-10 shrink-0 items-center rounded-full p-[3px] transition-colors ${checked ? "justify-end bg-sea" : "justify-start bg-line-strong"}`}>
        <motion.span layout transition={spring} className="h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)]" />
      </span>
    </button>
  );
}

/** Animates between numeric values; respects reduced motion. */
export function CountUp({ value, format, duration = 0.9, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, (v) => format(v));
  const first = useRef(true);
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: first.current ? duration * 1.3 : duration, ease: [0.22, 1, 0.36, 1] });
    first.current = false;
    return () => controls.stop();
  }, [value, duration, mv, reduce]);
  return <motion.span className={`num ${className ?? ""}`}>{text}</motion.span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} aria-hidden />;
}

/** Outside click and Escape close; Escape returns focus to the trigger. */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, close, ref, trigger };
}

/** Small status pill. Tone carries meaning; neutral by default. */
export function Pill({ children, tone = "neutral", icon, className = "" }: { children: ReactNode; tone?: "neutral" | "sea" | "signal" | "good" | "warn" | "rain"; icon?: ReactNode; className?: string }) {
  const cls = {
    neutral: "border-line text-muted",
    sea: "border-transparent bg-sea-soft text-sea",
    signal: "border-transparent bg-signal-soft text-signal",
    good: "border-transparent bg-good-soft text-good",
    warn: "border-transparent bg-warn-soft text-warn",
    rain: "border-transparent bg-rain-soft text-rain",
  }[tone];
  return <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[12px] font-medium ${cls} ${className}`}>{icon}{children}</span>;
}
