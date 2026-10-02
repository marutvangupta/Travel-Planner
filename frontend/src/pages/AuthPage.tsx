import { motion } from "framer-motion";
import { ArrowRight, CloudRain, Eye, EyeOff, Landmark, Wallet } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { FlipBoard } from "../components/brand/FlipBoard";
import { HeroChart } from "../components/brand/HeroChart";
import { Logo } from "../components/layout/Logo";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import { Button, Field, inputCls } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { ApiError } from "../lib/api";
import { ease, rise, spring, stagger } from "../lib/motion";

const POINTS = [
  { icon: Landmark, title: "Built from real places", body: "Opening hours, travel time and distance are checked in code before you see a plan." },
  { icon: CloudRain, title: "Re-plans only what changed", body: "Rain on day 2? Only the affected stops move. The rest stays put." },
  { icon: Wallet, title: "What if, before you commit", body: "Try a smaller budget or a slower pace and compare it side by side." },
];

export default function AuthPage() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);

  if (user) return <Navigate to="/trips" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("form");
    setError(null);
    try {
      if (mode === "in") await login(email, password);
      else await register(email, password, name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const tryDemo = async () => {
    setBusy("demo");
    setError(null);
    try {
      const id = Math.random().toString(36).slice(2, 8);
      await register(`explorer-${id}@example.com`, `demo-${id}-pass`, "Explorer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start a demo account.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
      <section className="night relative isolate hidden overflow-hidden lg:block" aria-label="About Waypoint">
        <div className="absolute inset-0 -z-10">
          <HeroChart />
        </div>
        <div className="relative flex h-full flex-col justify-between p-12 xl:p-14">
          <Logo />
          <div className="max-w-xl">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="label mb-5 flex items-center gap-3">
              <span className="h-px w-8 bg-sea" /> Next departure
            </motion.p>
            <h1 className="display text-[clamp(44px,4.4vw,64px)]">
              <motion.span initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.35 }} className="block">
                Plan the trip.
              </motion.span>
              <motion.span initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.5 }} className="block text-sea">
                Keep it flexible.
              </motion.span>
            </h1>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-[22px]">
              <FlipBoard words={["Jaipur", "Goa", "Tokyo", "Paris"]} />
              <span className="label">4 days · ₹ budget · your pace</span>
            </motion.div>
          </div>
          <motion.ul variants={stagger(0.1, 1.1)} initial="hidden" animate="show" className="m-0 grid max-w-2xl gap-6 p-0 xl:grid-cols-3">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <motion.li key={title} variants={rise} className="list-none border-t border-line pt-4">
                <Icon size={17} className="mb-2.5 text-sea" aria-hidden />
                <p className="mb-1 text-[14px] font-semibold">{title}</p>
                <p className="text-[13px] leading-snug text-muted">{body}</p>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </section>

      <section className="relative flex flex-col px-5 py-5 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Logo className="lg:hidden" />
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease }}>
            <p className="label mb-2.5 lg:hidden">Plan the trip. Keep it flexible.</p>
            <h2 className="display-wide mb-2 text-[28px]">{mode === "up" ? "Create your account" : "Welcome back"}</h2>
            <p className="mb-7 text-[14px] text-muted">{mode === "up" ? "Your trips, preferences and what Waypoint learns about you stay in one place." : "Sign in to pick up where you left off."}</p>

            <div className="relative mb-6 flex rounded-[11px] border border-line bg-surface-2 p-[3px]" role="tablist" aria-label="Account">
              {(["up", "in"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`relative flex-1 rounded-lg py-2 text-[14px] font-semibold transition-colors ${mode === m ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  {mode === m && <motion.span layoutId="auth-tab" transition={spring} className="absolute inset-0 rounded-lg border border-line bg-raised shadow-[var(--shadow-sm)]" />}
                  <span className="relative">{m === "up" ? "Create account" : "Sign in"}</span>
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              {mode === "up" && (
                <Field label="Name" htmlFor="name">
                  <input id="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha" autoComplete="name" />
                </Field>
              )}
              <Field label="Email" htmlFor="email">
                <input id="email" type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
              </Field>
              <Field label="Password" htmlFor="password" hint={mode === "up" ? "At least 8 characters." : undefined}>
                <div className="relative">
                  <input
                    id="password"
                    type={reveal ? "text" : "password"}
                    required
                    minLength={8}
                    className={`${inputCls} pr-11`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "up" ? "new-password" : "current-password"}
                  />
                  <button type="button" onClick={() => setReveal((r) => !r)} aria-label={reveal ? "Hide password" : "Show password"} aria-pressed={reveal} className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                    {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>
              {error && (
                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="rounded-[var(--radius-ctl)] bg-signal-soft px-3 py-2 text-[13px] text-signal">
                  {error}
                </motion.p>
              )}
              <Button type="submit" size="lg" loading={busy === "form"} disabled={!!busy} className="mt-1 w-full">
                {mode === "up" ? "Create account" : "Sign in"} <ArrowRight size={16} />
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3 text-[12px] text-muted">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <Button variant="ghost" size="lg" className="w-full" onClick={tryDemo} loading={busy === "demo"} disabled={!!busy}>
              Explore with a demo account
            </Button>
            <p className="mt-3 text-center text-[12px] text-muted">No sign-up needed. Demo mode covers Jaipur, Goa, Tokyo and Paris.</p>
          </motion.div>
        </main>
      </section>
    </div>
  );
}
