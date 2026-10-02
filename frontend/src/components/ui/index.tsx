import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform, type HTMLMotionProps } from "framer-motion";
import { AlertCircle, AlertTriangle, Check, CheckCircle2, Eye, EyeOff, Info, Loader2, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { rovingKeys } from "../../lib/a11y";
import { ease, spring, springSnappy } from "../../lib/motion";

/* ------------------------------------------------------------------------------------- buttons */

type BtnProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "signal" | "soft" | "ghost" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  /** leading icon; replaced by a spinner while loading */
  icon?: ReactNode;
  /** trailing icon; nudges forward on hover (arrows) */
  iconRight?: ReactNode;
};

const variants = {
  primary: "bg-sea text-sea-ink shadow-[var(--highlight),0_1px_2px_rgba(0,0,0,.08),0_8px_18px_-10px_var(--sea)] hover:bg-sea-hover",
  signal: "bg-signal text-signal-ink shadow-[var(--highlight),0_1px_2px_rgba(0,0,0,.08),0_8px_18px_-10px_var(--signal)] hover:brightness-[1.06]",
  soft: "bg-sea-soft text-sea hover:bg-[color-mix(in_srgb,var(--sea-soft)_82%,var(--sea))]",
  ghost: "border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-surface-2",
  quiet: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "border border-line bg-surface text-bad shadow-xs hover:border-bad/40 hover:bg-bad-soft",
} as const;
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-5 text-[15px] gap-2" } as const;
const spinnerSize = { sm: 14, md: 16, lg: 17 } as const;

export function Button({ variant = "primary", size = "md", loading, icon, iconRight, children, className = "", disabled, ...rest }: BtnProps) {
  const off = disabled || loading;
  return (
    <motion.button
      whileTap={off ? undefined : { scale: 0.975 }}
      transition={springSnappy}
      disabled={off}
      aria-busy={loading || undefined}
      className={`group/btn relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-semibold tracking-[-0.005em] transition-[background-color,border-color,color,box-shadow,filter,opacity] duration-150 disabled:shadow-none ${
        loading ? "disabled:cursor-progress" : "disabled:opacity-45"
      } ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {loading ? (
          <motion.span key="spin" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }} className="inline-flex">
            <Loader2 size={spinnerSize[size]} className="animate-spin" />
          </motion.span>
        ) : icon ? (
          <motion.span key="icon" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.15 }} className="inline-flex">
            {icon}
          </motion.span>
        ) : null}
      </AnimatePresence>
      {children as ReactNode}
      {iconRight && <span className="inline-flex transition-transform duration-200 ease-out group-hover/btn:translate-x-0.5">{iconRight}</span>}
    </motion.button>
  );
}

/** Square icon-only button. `label` is both the accessible name and the hover tooltip. */
export function IconButton({
  label, tip, children, variant = "outline", size = "md", tipSide = "top", tipAlign = "center", active, className = "", ...rest
}: HTMLMotionProps<"button"> & {
  label: string;
  /** shorter visual tooltip when the accessible name is long */
  tip?: string;
  variant?: "outline" | "quiet";
  size?: "sm" | "md";
  tipSide?: "top" | "bottom";
  tipAlign?: "center" | "end";
  active?: boolean;
}) {
  const v = variant === "outline" ? "border border-line bg-surface text-muted shadow-xs hover:border-line-strong hover:text-ink" : "text-muted hover:bg-surface-2 hover:text-ink";
  return (
    <motion.button
      type="button"
      aria-label={label}
      data-tip={tip ?? label}
      data-tip-side={tipSide}
      data-tip-align={tipAlign}
      whileTap={rest.disabled ? undefined : { scale: 0.9 }}
      transition={springSnappy}
      className={`tip relative grid shrink-0 place-items-center rounded-control transition-[background-color,border-color,color] disabled:opacity-40 ${size === "md" ? "h-9 w-9" : "h-8 w-8"} ${active ? "!text-sea" : ""} ${v} ${className}`}
      {...rest}
    >
      {children as ReactNode}
    </motion.button>
  );
}

/* ------------------------------------------------------------------------------------- selection */

export function Chip({
  active, onClick, children, icon, tone = "sea",
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  tone?: "sea" | "signal";
}) {
  const on = tone === "signal" ? "border-signal/70 bg-signal-soft text-signal" : "border-sea/70 bg-sea-soft text-sea";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      whileTap={{ scale: 0.95 }}
      transition={springSnappy}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-[background-color,border-color,color] ${
        active ? on : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
      }`}
    >
      {icon}
      {children}
    </motion.button>
  );
}

/** Segmented control whose highlight glides between options. Arrow keys move the selection. */
export function Segmented<T extends string>({
  value, onChange, options, label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => rovingKeys(e, options.map((o) => o.value), value, onChange)}
      className="flex rounded-[12px] border border-line bg-surface-2 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            type="button"
            onClick={() => onChange(o.value)}
            className={`relative flex-1 rounded-[9px] px-3 py-2 text-sm font-medium transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            {active && <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-[9px] border border-line bg-surface shadow-xs" />}
            <span className="relative block leading-tight">{o.label}</span>
            {o.hint && <span className={`relative mt-0.5 block text-[11px] font-normal transition-colors ${active ? "text-muted" : "text-faint"}`}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group flex w-full items-center justify-between gap-4 rounded-[12px] border px-4 py-3 text-left transition-[background-color,border-color] ${
        checked ? "border-sea/40 bg-[color-mix(in_srgb,var(--sea-soft)_45%,var(--surface))]" : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-muted">{hint}</span>}
      </span>
      <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${checked ? "justify-end bg-sea" : "justify-start bg-line-strong"}`}>
        <motion.span layout transition={springSnappy} className="h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.25)]" />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------------------------- fields */

export const inputCls =
  "h-11 w-full rounded-control border border-line bg-surface px-3.5 text-[15px] text-ink shadow-xs outline-none transition-[border-color,box-shadow,background-color] duration-200 hover:border-line-strong focus:border-sea focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--sea)_15%,transparent)] focus-visible:outline-none aria-[invalid=true]:border-bad aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--bad)_14%,transparent)] read-only:cursor-default disabled:opacity-60";

/** Animated message line under a field: error beats warning beats hint. Height eases so the form never jumps. */
export function FieldMessage({ id, error, warning, hint }: { id?: string; error?: ReactNode; warning?: ReactNode; hint?: ReactNode }) {
  const content = error || warning || hint;
  const kind = error ? "error" : warning ? "warning" : "hint";
  const Icon = error ? AlertCircle : warning ? AlertTriangle : null;
  return (
    <motion.div
      initial={false}
      animate={{ height: content ? "auto" : 0, opacity: content ? 1 : 0 }}
      transition={{ height: { duration: 0.26, ease }, opacity: { duration: 0.18 } }}
      className="overflow-hidden"
      aria-live="polite"
    >
      <AnimatePresence mode="wait" initial={false}>
        {content && (
          <motion.p
            key={kind + (typeof content === "string" ? content : "")}
            id={id}
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.16 }}
            className={`flex items-start gap-1.5 pt-2 text-[13px] leading-snug ${error ? "text-bad" : warning ? "text-warn" : "text-muted"}`}
          >
            {Icon && <Icon size={14} className="mt-[2px] shrink-0" aria-hidden />}
            <span className="min-w-0">{content}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function Field({
  label, hint, error, warning, children, htmlFor, aside, messageId, className = "",
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  warning?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  aside?: ReactNode;
  messageId?: string;
  className?: string;
}) {
  return (
    <div className={`field flex flex-col ${className}`} data-invalid={error ? "true" : undefined}>
      <div className="field-head mb-2 flex items-baseline justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="label">
            {label}
          </label>
        ) : (
          <span className="label">{label}</span>
        )}
        {aside}
      </div>
      {children}
      <FieldMessage id={messageId} error={error} warning={warning} hint={hint} />
    </div>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  warning?: ReactNode;
  aside?: ReactNode;
  /** element pinned inside the right edge of the input (icon button, unit) */
  trailing?: ReactNode;
  /** shows a quiet check once the value is known to be good */
  valid?: boolean;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ id, label, hint, error, warning, aside, trailing, valid, inputClassName = "", className = "", ref, ...rest }: TextFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const msgId = `${fid}-msg`;
  const showCheck = !!valid && !error;
  return (
    <Field label={label} htmlFor={fid} aside={aside} error={error} warning={warning} hint={hint} messageId={msgId} className={className}>
      <div className="relative">
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || warning || hint ? msgId : undefined}
          className={`${inputCls} ${trailing ? "pr-12" : showCheck ? "pr-10" : ""} ${inputClassName}`}
          {...rest}
        />
        <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5 [&>*]:pointer-events-auto">
          <AnimatePresence initial={false}>
            {showCheck && !trailing && (
              <motion.span key="ok" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }} transition={springSnappy} className="grid h-8 w-8 place-items-center text-good" aria-hidden>
                <Check size={16} strokeWidth={2.6} />
              </motion.span>
            )}
          </AnimatePresence>
          {trailing}
        </div>
      </div>
    </Field>
  );
}

/** Password input with a reveal toggle and a Caps Lock warning. */
export function PasswordField({ warning, onKeyUp, onKeyDown, onBlur, ...rest }: Omit<TextFieldProps, "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  const { ref, ...props } = rest;
  return (
    <TextField
      {...props}
      ref={(el) => {
        inputRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
      }}
      type={shown ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      warning={warning ?? (caps ? "Caps Lock is on." : undefined)}
      onKeyDown={(e) => {
        readCaps(e);
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        readCaps(e);
        onKeyUp?.(e);
      }}
      onBlur={(e) => {
        setCaps(false);
        onBlur?.(e);
      }}
      trailing={
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          aria-controls={props.id}
          // keep focus (and the caret) in the input when toggling with a pointer
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setShown((s) => !s);
            const el = inputRef.current;
            if (el && document.activeElement === el) {
              const pos = el.selectionStart;
              requestAnimationFrame(() => el.setSelectionRange(pos, pos));
            }
          }}
          className="grid h-8 w-9 place-items-center rounded-[8px] text-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={shown ? "hide" : "show"} initial={{ opacity: 0, scale: 0.7, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.7, rotate: 20 }} transition={{ duration: 0.14 }} className="inline-flex">
              {shown ? <EyeOff size={17} /> : <Eye size={17} />}
            </motion.span>
          </AnimatePresence>
        </button>
      }
    />
  );
}

/* ------------------------------------------------------------------------------------- feedback */

const ALERT: Record<"error" | "warn" | "info" | "success", { cls: string; icon: LucideIcon; iconCls: string }> = {
  error: { cls: "border-bad/25 bg-bad-soft", icon: AlertCircle, iconCls: "text-bad" },
  warn: { cls: "border-warn/30 bg-warn-soft", icon: AlertTriangle, iconCls: "text-warn" },
  info: { cls: "border-line bg-surface-2", icon: Info, iconCls: "text-sea" },
  success: { cls: "border-good/30 bg-good-soft", icon: CheckCircle2, iconCls: "text-good" },
};

export function Alert({ tone = "error", title, children, action, className = "" }: { tone?: keyof typeof ALERT; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon, iconCls } = ALERT[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-3 rounded-[12px] border px-3.5 py-3 text-[14px] leading-snug ${cls} ${className}`}>
      <Icon size={17} className={`mt-px shrink-0 ${iconCls}`} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-muted" : "text-ink"}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
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
    const controls = animate(mv, value, { duration: first.current ? duration * 1.3 : duration, ease: [...ease] });
    first.current = false;
    return () => controls.stop();
  }, [value, duration, mv, reduce]);
  return <motion.span className={`num ${className ?? ""}`}>{text}</motion.span>;
}

export function Spinner({ className = "", size = 18 }: { className?: string; size?: number }) {
  return <Loader2 className={`animate-spin ${className}`} size={size} aria-hidden />;
}

export function Empty({ icon, title, body, action, className = "" }: { icon?: ReactNode; title: string; body: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-start gap-3 rounded-panel border border-dashed border-line-strong bg-surface/60 p-8 ${className}`}>
      {icon && <span className="mb-1 grid h-11 w-11 place-items-center rounded-[12px] bg-sea-soft text-sea">{icon}</span>}
      <p className="display-wide text-2xl">{title}</p>
      <div className="max-w-md text-muted">{body}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Ticket-stub perforation between the two halves of a card (boarding pass, trip cards). */
export function Perforation() {
  return (
    <div className="relative border-t border-dashed border-line" aria-hidden>
      <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border border-line bg-bg" />
      <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full border border-line bg-bg" />
    </div>
  );
}
