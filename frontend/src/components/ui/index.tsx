import { animate, motion, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { spring } from "../../lib/motion";

type BtnProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "ghost" | "soft" | "danger" | "signal";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

const variants = {
  primary: "bg-sea text-sea-ink hover:brightness-110 shadow-[inset_0_1px_0_rgba(255,255,255,.18),0_6px_16px_-8px_var(--sea)]",
  signal: "bg-signal text-white hover:brightness-110 shadow-[inset_0_1px_0_rgba(255,255,255,.2),0_6px_16px_-8px_var(--signal)]",
  soft: "bg-sea-soft text-sea hover:brightness-[.97]",
  ghost: "bg-transparent text-ink hover:bg-surface-2 border border-line",
  danger: "bg-transparent text-bad hover:bg-surface-2 border border-line",
} as const;
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2.5" } as const;

export function Button({ variant = "primary", size = "md", loading, icon, children, className = "", disabled, ...rest }: BtnProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={spring}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-[10px] font-semibold transition-[filter,background-color] disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
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
  const on = tone === "signal" ? "border-signal bg-signal-soft text-signal" : "border-sea bg-sea-soft text-sea";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      whileTap={{ scale: 0.94 }}
      animate={{ scale: active ? 1 : 1 }}
      transition={spring}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
        active ? on : "border-line bg-surface text-muted hover:border-faint hover:text-ink"
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
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active && (
              <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-lg border border-line bg-surface shadow-[var(--shadow)]" />
            )}
            <span className="relative block leading-tight">{o.label}</span>
            {o.hint && <span className="relative block text-[11px] font-normal text-faint">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "h-11 w-full rounded-[10px] border border-line bg-surface px-3.5 text-[15px] text-ink placeholder:text-faint transition-[border-color,box-shadow] focus:border-sea focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--sea)_18%,transparent)]";

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-faint"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-faint">{hint}</span>}
      </span>
      <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "justify-end bg-sea" : "justify-start bg-line"}`}>
        <motion.span layout transition={spring} className="h-5 w-5 rounded-full bg-white shadow" />
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
  return <Loader2 className={`animate-spin ${className}`} size={18} />;
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-8">
      <p className="display-wide text-2xl">{title}</p>
      <p className="max-w-md text-muted">{body}</p>
      {action}
    </div>
  );
}
