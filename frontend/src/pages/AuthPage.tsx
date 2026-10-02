import { AnimatePresence, motion, useAnimationControls, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { ArrowRight, Check, CloudRain, Compass, Landmark, Loader2, Wallet } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { FlipBoard } from "../components/brand/FlipBoard";
import { HeroChart } from "../components/brand/HeroChart";
import { Logo } from "../components/layout/Logo";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import { Alert, Button, PasswordField, TextField } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { rovingKeys, useDocumentTitle } from "../lib/a11y";
import { ApiError } from "../lib/api";
import { cityName } from "../lib/format";
import { collapse, ease, rise, shake, spring, stagger } from "../lib/motion";

const POINTS = [
  { icon: Landmark, title: "Built from real places", body: "Opening hours, travel time and distance are checked in code before you see a plan." },
  { icon: CloudRain, title: "Re-plans only what changed", body: "Rain on day 2? Only the affected stops move. The rest stays put." },
  { icon: Wallet, title: "What if, before you commit", body: "Test a smaller budget or a slower pace and compare it side by side." },
];

type Mode = "up" | "in";
type Action = Mode | "demo";
type Phase = { kind: "idle" } | { kind: "busy"; action: Action } | { kind: "done"; action: Action };
interface ServerError {
  title: string;
  body?: string;
  fix?: "signin" | "retry";
}

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RETURNING_KEY = "wp-returning";
const COMMON_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "live.com", "rediffmail.com"];

/** Edit distance, small and bounded: only used to catch typos like "gmial.com". */
function distance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function suggestEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  if (!domain || COMMON_DOMAINS.includes(domain)) return null;
  const best = COMMON_DOMAINS.map((d) => [d, distance(domain, d)] as const).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] > 0 && best[1] <= 2 ? `${email.slice(0, at)}@${best[0]}` : null;
}

function validate(mode: Mode, field: "email" | "password", email: string, password: string): string | null {
  if (field === "email") {
    if (!email.trim()) return "Enter your email address.";
    if (!EMAIL_RE.test(email.trim())) return "That email doesn't look complete. Check for typos.";
    return null;
  }
  if (!password) return mode === "up" ? "Choose a password." : "Enter your password.";
  if (mode === "up" && password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  return null;
}

const readReturning = () => {
  try {
    return localStorage.getItem(RETURNING_KEY) === "1";
  } catch {
    return false;
  }
};
const markReturning = () => {
  try {
    localStorage.setItem(RETURNING_KEY, "1");
  } catch {
    /* ignore */
  }
};

export default function AuthPage() {
  const { user, meta, login, register } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const reduce = useReducedMotion();
  const dest = (loc.state as { from?: string } | null)?.from ?? "/trips";

  const [mode, setMode] = useState<Mode>(() => (readReturning() ? "in" : "up"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [lockHeight, setLockHeight] = useState<number | undefined>();
  const [lastAction, setLastAction] = useState<Action>("up");

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fields = useAnimationControls();

  useDocumentTitle(mode === "up" ? "Create your account" : "Sign in");

  // after a success, hold the confirmation long enough to register, then move on
  useEffect(() => {
    if (phase.kind !== "done") return;
    const wait = reduce ? 450 : phase.action === "in" ? 950 : 1600;
    const t = window.setTimeout(() => nav(dest, { replace: true }), wait);
    return () => window.clearTimeout(t);
  }, [phase, reduce, nav, dest]);

  if (user && phase.kind === "idle") return <Navigate to={dest} replace />;

  const busy = phase.kind === "busy";
  const busyWith = (a: Action) => phase.kind === "busy" && phase.action === a;
  // errors.email is undefined until the field has been left with something in it; null means it checked out
  const suggestion = errors.email !== undefined ? suggestEmail(email.trim()) : null;
  const emailOk = mode === "up" && errors.email === null && !suggestion;

  const switchMode = (m: Mode) => {
    if (m === mode || busy) return;
    setMode(m);
    setErrors({});
    setServerError(null);
  };

  const onBlurField = (field: "email" | "password") => {
    const value = field === "email" ? email : password;
    // an empty field you just tabbed through is not an error yet; it becomes one on submit
    if (!value) return;
    setErrors((e) => ({ ...e, [field]: validate(mode, field, email, password) }));
  };
  const onChangeField = (field: "email" | "password", value: string) => {
    if (field === "email") setEmail(value);
    else setPassword(value);
    if (serverError && serverError.fix !== "retry") setServerError(null);
    // reward early: once a message is showing, it updates (and clears) as you type
    if (errors[field] != null) {
      const e2 = field === "email" ? value : email;
      const p2 = field === "password" ? value : password;
      setErrors((e) => ({ ...e, [field]: validate(mode, field, e2, p2) }));
    }
  };

  const succeed = (action: Action) => {
    if (cardRef.current) setLockHeight(cardRef.current.offsetHeight);
    if (action !== "demo") markReturning();
    setPhase({ kind: "done", action });
  };

  const fail = (err: unknown, action: Action) => {
    setPhase({ kind: "idle" });
    setLastAction(action);
    if (!(err instanceof ApiError)) {
      setServerError({ title: "Something went wrong", body: "Please try again in a moment.", fix: "retry" });
      return;
    }
    if (err.status === 0) setServerError({ title: "Can't reach Waypoint", body: "Check your connection, or that the API is running, then try again.", fix: "retry" });
    else if (err.status === 409) setServerError({ title: "That email already has an account", body: "Sign in instead, or use a different email.", fix: "signin" });
    else if (err.status === 401) {
      setServerError({ title: "Email or password is incorrect", body: "Check both and try again. Passwords are case-sensitive." });
      void fields.start(shake);
      requestAnimationFrame(() => passwordRef.current?.select());
    } else if (action === "demo") setServerError({ title: "Couldn't start a demo", body: err.message, fix: "retry" });
    else setServerError({ title: "Couldn't complete that", body: err.message });
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const next = { email: validate(mode, "email", email, password), password: validate(mode, "password", email, password) };
    setErrors(next);
    if (next.email || next.password) {
      void fields.start(shake);
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setServerError(null);
    setPhase({ kind: "busy", action: mode });
    try {
      if (mode === "in") await login(email.trim(), password);
      else await register(email.trim(), password, name.trim());
      succeed(mode);
    } catch (err) {
      fail(err, mode);
    }
  };

  const tryDemo = async () => {
    if (busy) return;
    setServerError(null);
    setErrors({});
    setPhase({ kind: "busy", action: "demo" });
    try {
      const id = Math.random().toString(36).slice(2, 8);
      await register(`explorer-${id}@example.com`, `demo-${id}-pass`, "Explorer");
      succeed("demo");
    } catch (err) {
      fail(err, "demo");
    }
  };

  const retry = () => (lastAction === "demo" ? tryDemo() : submit());
  const cities = (meta?.destinations ?? ["Jaipur, India", "Goa, India", "Tokyo, Japan", "Paris, France"]).map(cityName);

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.12fr)_minmax(460px,0.88fr)]">
      <Hero />

      <section className="paper relative flex min-h-full flex-col px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
        <div className="flex h-14 items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>

        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-6 sm:py-10">
          {/* phone and tablet: the hero is hidden, so carry the promise and the shortest path to a demo up here */}
          <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="mb-7 lg:hidden">
            <motion.h1 variants={rise} className="display text-[clamp(40px,11vw,56px)]">
              Plan the trip. <span className="block text-sea">Keep it flexible.</span>
            </motion.h1>
            <motion.p variants={rise} className="mt-3 text-[15px] text-muted">
              Day-by-day plans from real places that re-plan when the weather, a closure or your budget changes.{" "}
              <button type="button" onClick={tryDemo} disabled={busy} className="font-semibold text-sea underline decoration-sea/30 underline-offset-[3px] transition-colors hover:decoration-sea">
                Try the demo
              </button>
            </motion.p>
          </motion.div>

          <motion.div
            ref={cardRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease, delay: 0.05 }}
            style={{ minHeight: lockHeight }}
            className="card flex flex-col rounded-panel p-5 shadow-pop sm:p-7"
          >
            <AnimatePresence mode="wait" initial={false}>
              {phase.kind === "done" ? (
                <Success key="done" action={phase.action} name={user?.name ?? ""} onContinue={() => nav(dest, { replace: true })} />
              ) : (
                <motion.div key="form" exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }} className="flex flex-col">
                  <div className="mb-6">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                        <h2 className="display-wide text-[28px] sm:text-[30px]">{mode === "up" ? "Create your account" : "Welcome back"}</h2>
                        <p className="mt-1.5 text-[15px] text-muted">{mode === "up" ? "Save your trips and let Waypoint learn how you travel." : "Sign in to pick up where you left off."}</p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <div
                    role="tablist"
                    aria-label="Account"
                    onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => rovingKeys(e, ["up", "in"] as const, mode, switchMode)}
                    className="mb-6 flex rounded-[12px] border border-line bg-surface-2 p-1"
                  >
                    {(["up", "in"] as const).map((m) => (
                      <button
                        key={m}
                        id={`auth-tab-${m}`}
                        role="tab"
                        aria-selected={mode === m}
                        aria-controls="auth-panel"
                        tabIndex={mode === m ? 0 : -1}
                        type="button"
                        onClick={() => switchMode(m)}
                        className={`relative flex-1 rounded-[9px] py-2 text-sm font-semibold transition-colors ${mode === m ? "text-ink" : "text-muted hover:text-ink"}`}
                      >
                        {mode === m && <motion.span layoutId="auth-tab" transition={spring} className="absolute inset-0 rounded-[9px] border border-line bg-surface shadow-xs" />}
                        <span className="relative">{m === "up" ? "Create account" : "Sign in"}</span>
                      </button>
                    ))}
                  </div>

                  <form id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`} onSubmit={submit} noValidate aria-busy={busy} className="flex flex-col">
                    <motion.div animate={fields} className="flex flex-col">
                      <AnimatePresence initial={false}>
                        {mode === "up" && (
                          <motion.div key="name" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                            <TextField
                              id="name"
                              label="Name"
                              aside={<span className="text-xs text-faint">Optional</span>}
                              className="pb-5"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="What should we call you?"
                              autoComplete="name"
                              readOnly={busy}
                              maxLength={80}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <TextField
                        ref={emailRef}
                        id="email"
                        type="email"
                        label="Email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@example.com"
                        value={email}
                        readOnly={busy}
                        onChange={(e) => onChangeField("email", e.target.value)}
                        onBlur={() => onBlurField("email")}
                        error={errors.email}
                        valid={emailOk}
                        hint={
                          suggestion ? (
                            <>
                              Did you mean{" "}
                              <button
                                type="button"
                                className="font-semibold text-sea underline decoration-sea/30 underline-offset-2 hover:decoration-sea"
                                onClick={() => {
                                  onChangeField("email", suggestion);
                                  setErrors((e) => ({ ...e, email: null }));
                                }}
                              >
                                {suggestion}
                              </button>
                              ?
                            </>
                          ) : undefined
                        }
                      />

                      <PasswordField
                        ref={passwordRef}
                        id="password"
                        label="Password"
                        className="pt-5"
                        autoComplete={mode === "up" ? "new-password" : "current-password"}
                        placeholder={mode === "up" ? "At least 8 characters" : "Your password"}
                        value={password}
                        readOnly={busy}
                        onChange={(e) => onChangeField("password", e.target.value)}
                        onBlur={() => onBlurField("password")}
                        error={errors.password}
                        hint={mode === "up" && password ? <LengthMeter length={password.length} /> : undefined}
                      />
                    </motion.div>

                    <AnimatePresence initial={false}>
                      {serverError && (
                        <motion.div key="server" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                          <Alert
                            className="mt-5"
                            title={serverError.title}
                            action={
                              serverError.fix === "signin" ? (
                                <Button size="sm" variant="ghost" type="button" onClick={() => { switchMode("in"); requestAnimationFrame(() => passwordRef.current?.focus()); }} iconRight={<ArrowRight size={14} />}>
                                  Sign in instead
                                </Button>
                              ) : serverError.fix === "retry" ? (
                                <Button size="sm" variant="ghost" type="button" onClick={retry}>
                                  Try again
                                </Button>
                              ) : undefined
                            }
                          >
                            {serverError.body}
                          </Alert>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <Button type="submit" size="lg" loading={busyWith(mode)} disabled={busy && !busyWith(mode)} className="mt-6 w-full" iconRight={busyWith(mode) ? undefined : <ArrowRight size={17} />}>
                      <Swap k={`${mode}-${busyWith(mode)}`}>{busyWith(mode) ? (mode === "up" ? "Creating your account…" : "Signing in…") : mode === "up" ? "Create account" : "Sign in"}</Swap>
                    </Button>
                  </form>

                  <div className="my-6 flex items-center gap-3 text-xs text-faint" aria-hidden>
                    <span className="h-px flex-1 bg-line" /> or skip sign-up <span className="h-px flex-1 bg-line" />
                  </div>

                  <DemoCard cities={cities} busy={busyWith("demo")} disabled={busy} onClick={tryDemo} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- pieces */

function Swap({ k, children }: { k: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={k} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.14 }} className="inline-block">
        {children}
      </motion.span>
    </AnimatePresence>
  );
}

/** Quiet progress toward the minimum length; turns into a check when it is met. */
function LengthMeter({ length }: { length: number }) {
  const done = length >= MIN_PASSWORD;
  const r = 6;
  const c = 2 * Math.PI * r;
  const left = MIN_PASSWORD - length;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative grid h-4 w-4 shrink-0 place-items-center" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 16 16" className="absolute inset-0">
          <circle cx="8" cy="8" r={r} fill="none" stroke="var(--line)" strokeWidth="2" />
          <motion.circle
            cx="8" cy="8" r={r} fill={done ? "var(--good)" : "none"} stroke={done ? "var(--good)" : "var(--sea)"} strokeWidth="2" strokeLinecap="round" strokeDasharray={c}
            initial={false} animate={{ strokeDashoffset: c * (1 - Math.min(length / MIN_PASSWORD, 1)) }} transition={{ duration: 0.25, ease }} transform="rotate(-90 8 8)"
          />
        </svg>
        <AnimatePresence>
          {done && (
            <motion.span key="ok" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.3, opacity: 0 }} transition={spring} className="relative inline-flex text-surface">
              <Check size={10} strokeWidth={3.5} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span aria-hidden className={done ? "font-medium text-good" : ""}>
        {done ? "Good length" : `${left} more character${left === 1 ? "" : "s"}`}
      </span>
      <span className="sr-only">Passwords need at least {MIN_PASSWORD} characters.</span>
    </span>
  );
}

function DemoCard({ cities, busy, disabled, onClick }: { cities: string[]; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      transition={spring}
      className={`group relative w-full overflow-hidden rounded-[14px] border p-4 text-left transition-[border-color,background-color,box-shadow] duration-200 ${
        busy ? "border-sea/50 bg-sea-soft/50" : "border-line bg-surface-2/70 hover:border-sea/45 hover:bg-[color-mix(in_srgb,var(--sea-soft)_40%,var(--surface))] hover:shadow-card disabled:opacity-55"
      }`}
    >
      <span className="flex items-center gap-3.5">
        <span className="night relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line">
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.span key="spin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex text-sea">
                <Loader2 size={19} className="animate-spin" />
              </motion.span>
            ) : (
              <motion.span key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex text-sea transition-transform duration-500 ease-out group-hover:rotate-[22deg]">
                <Compass size={20} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{busy ? "Preparing your demo…" : "Explore the demo"}</span>
          <span className="block text-[13px] text-muted">No account needed. Plan a real trip in under a minute.</span>
        </span>
        <ArrowRight size={18} className="shrink-0 text-faint transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-sea" />
      </span>
      <span className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-3">
        <span className="label mr-1 hidden !text-[10px] sm:inline">Ready to plan</span>
        {cities.map((c) => (
          <span key={c} className="mono rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
            {c}
          </span>
        ))}
      </span>
    </motion.button>
  );
}

const SUCCESS: Record<Action, { title: (n: string) => string; body: string }> = {
  up: { title: (n) => (n ? `Welcome aboard, ${n}` : "Welcome aboard"), body: "Your account is ready. Let's plan the first trip." },
  in: { title: (n) => (n ? `Welcome back, ${n}` : "Welcome back"), body: "Opening your trips." },
  demo: { title: () => "Your demo is ready", body: "Jaipur, Goa, Tokyo and Paris are loaded with real places. Opening your workspace." },
};

function Success({ action, name, onContinue }: { action: Action; name: string; onContinue: () => void }) {
  const first = name.split(" ")[0];
  const copy = SUCCESS[action];
  const dur = action === "in" ? 0.9 : 1.55;
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease }}
      className="flex flex-1 flex-col items-center justify-center py-8 text-center"
    >
      <div className="relative grid h-[68px] w-[68px] place-items-center">
        <motion.span className="absolute inset-0 rounded-full bg-sea/25" initial={{ scale: 0.7, opacity: 0.9 }} animate={{ scale: 2, opacity: 0 }} transition={{ duration: 1.3, ease, delay: 0.25 }} />
        <motion.span className="absolute inset-0 rounded-full bg-sea shadow-[0_10px_30px_-10px_var(--sea)]" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 20 }} />
        <svg viewBox="0 0 24 24" className="relative h-8 w-8" fill="none" stroke="var(--sea-ink)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, delay: 0.22, ease }} />
        </svg>
      </div>
      <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.4, ease }} className="display-wide mt-7 text-[28px]">
        {copy.title(first)}
      </motion.h2>
      <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.4, ease }} className="mt-2 max-w-[32ch] text-muted">
        {copy.body}
      </motion.p>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-8 flex flex-col items-center gap-3">
        <span className="block h-1 w-40 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <motion.span className="block h-full origin-left rounded-full bg-sea" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: dur, ease: [0.4, 0, 0.2, 1] }} />
        </span>
        <button type="button" onClick={onContinue} className="text-[13px] font-medium text-muted transition-colors hover:text-ink">
          Continue now
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------------------- hero */

function Hero() {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  // a few pixels of drift behind the copy gives the chart depth without ever pulling focus
  const x = useSpring(px, { stiffness: 60, damping: 20, mass: 0.8 });
  const y = useSpring(py, { stiffness: 60, damping: 20, mass: 0.8 });
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set(((e.clientX - r.left) / r.width - 0.5) * -18);
    py.set(((e.clientY - r.top) / r.height - 0.5) * -12);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };
  return (
    <section onPointerMove={onMove} onPointerLeave={onLeave} className="night relative isolate hidden overflow-hidden lg:block" aria-label="About Waypoint">
      <motion.div style={{ x, y }} className="absolute -inset-6 -z-20 will-change-transform">
        <HeroChart />
      </motion.div>
      {/* scrim: keeps the copy legible where it crosses the chart */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(100deg,var(--bg)_0%,color-mix(in_srgb,var(--bg)_82%,transparent)_34%,transparent_62%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-[linear-gradient(0deg,var(--bg),transparent)]" />

      <div className="relative flex h-full min-h-[640px] flex-col justify-between p-12 xl:p-16">
        <Logo />
        <div className="max-w-xl">
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="label mb-5 flex items-center gap-3">
            <span className="h-px w-8 bg-sea" /> Next departure
          </motion.p>
          <h1 className="display text-hero">
            <motion.span initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.4 }} className="block">
              Plan the trip.
            </motion.span>
            <motion.span initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.52 }} className="block text-sea">
              Keep it flexible.
            </motion.span>
          </h1>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.7 }} className="mt-6 max-w-md text-[16px] leading-relaxed text-muted">
            Day-by-day itineraries from real places. When the weather turns or a stop closes, only the affected part of the plan changes.
          </motion.p>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-[24px]">
            <FlipBoard words={["Jaipur", "Goa", "Tokyo", "Paris"]} />
            <span className="label">4 days · ₹ budget · your pace</span>
          </motion.div>
        </div>
        <motion.ul variants={stagger(0.1, 1.1)} initial="hidden" animate="show" className="m-0 grid max-w-2xl grid-cols-3 gap-6 p-0">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <motion.li key={title} variants={rise} className="list-none border-t border-line pt-4">
              <Icon size={17} className="mb-2.5 text-sea" aria-hidden />
              <p className="mb-1 text-sm font-semibold">{title}</p>
              <p className="text-[13px] leading-snug text-muted">{body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>
    </section>
  );
}
