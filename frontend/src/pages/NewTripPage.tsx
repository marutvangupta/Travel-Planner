import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Castle, Check, Landmark, Minus, Moon, Mountain, Palette, Plus, RotateCw, ShoppingBag, Sparkles, Trees, Utensils, Waves, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Chip, CountUp, Field, FieldMessage, Perforation, Segmented, Toggle, inputCls } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useDocumentTitle } from "../lib/a11y";
import { ApiError, api, streamTrip } from "../lib/api";
import { addDays, cityName, dateRange, daysBetween, inr, titleCase, toIso } from "../lib/format";
import { ease, pageVariants, shake, spring } from "../lib/motion";
import type { Prefs, StageEvent, TripRequest } from "../lib/types";

const INTEREST_ICON: Record<string, LucideIcon> = {
  culture: Landmark, history: Castle, food: Utensils, nature: Trees, adventure: Mountain, shopping: ShoppingBag,
  nightlife: Moon, relaxation: Waves, art: Palette, architecture: Building2,
};
const COST_TIER: Record<string, [number, number]> = { jaipur: [2500, 5000], goa: [3500, 7000], tokyo: [7000, 13000], paris: [8000, 15000] };
const STEPS = ["Where and when", "Budget and pace", "What you enjoy", "Your needs"];
const TITLES = ["Where are you headed?", "What's the budget and pace?", "What do you enjoy?", "Anything we should respect?"];
const MAX_DAYS = 10;

function tierFor(dest: string): [number, number] {
  const k = Object.keys(COST_TIER).find((c) => dest.toLowerCase().includes(c));
  return k ? COST_TIER[k] : [4000, 8000];
}

const defaultStart = () => toIso(new Date(Date.now() + 21 * 86400000));

type StepErrors = { destination?: string; dates?: string; interests?: string };

function stepErrors(step: number, form: TripRequest, days: number): StepErrors {
  if (step === 0) {
    const e: StepErrors = {};
    if (form.destination.trim().length < 2) e.destination = "Where are you going? Pick a city below or type one.";
    if (!form.start_date || !form.end_date) e.dates = "Choose both dates.";
    else if (form.end_date < form.start_date) e.dates = "The trip ends before it starts. Check the dates.";
    else if (days > MAX_DAYS) e.dates = `Plans cover up to ${MAX_DAYS} days. This one is ${days}.`;
    return e;
  }
  if (step === 2 && form.interests.length === 0) return { interests: "Pick at least one, so the plan has a direction." };
  return {};
}

export default function NewTripPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { meta } = useAuth();
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState(0);
  const [dir, setDir] = useState(1);
  const [phase, setPhase] = useState<"form" | "run">("form");
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState<StepErrors>({});
  const [form, setForm] = useState<TripRequest>(() => {
    const s = defaultStart();
    return { destination: params.get("to") ?? "", start_date: s, end_date: addDays(s, 3), budget_inr: 50000, travelers: 2, interests: [], travel_style: "balanced", pace: "balanced", constraints_text: "", diet: "none", step_free: false, avoid: [], late_starts: false };
  });
  const content = useAnimationControls();
  const destRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const interestsRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const prefilled = !!params.get("to");
  useDocumentTitle(phase === "run" ? `Planning ${cityName(form.destination)}` : "Plan a trip");

  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api<Prefs>("/preferences").then((p) => setForm((f) => ({ ...f, pace: p.pace, travel_style: p.travel_style, diet: p.diet, step_free: p.step_free, interests: p.interests.length ? p.interests : f.interests, avoid: p.avoid }))).catch(() => undefined);
  }, []);

  const days = daysBetween(form.start_date, form.end_date);
  const [lean, comfy] = tierFor(form.destination);
  const perPersonDay = form.budget_inr / (Math.max(days, 1) * form.travelers);
  const tier = perPersonDay < lean ? { label: "Lean", tone: "text-warn" } : perPersonDay < comfy ? { label: "Comfortable", tone: "text-good" } : { label: "Generous", tone: "text-sea" };

  // messages appear after a Continue attempt, then update live (and clear) as the fields are fixed
  const live = stepErrors(step, form, days);
  const errors: StepErrors = {
    destination: shown.destination && live.destination,
    dates: shown.dates && live.dates,
    interests: shown.interests && live.interests,
  };

  // after a step change, put focus on the new heading: screen readers announce the step and Tab continues into it
  useEffect(() => {
    if (!moved.current) return;
    const t = window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 340);
    return () => window.clearTimeout(t);
  }, [step]);

  const goTo = (target: number) => {
    if (target === step) return;
    moved.current = true;
    setDir(target > step ? 1 : -1);
    setShown({});
    setStep(target);
    setVisited((v) => Math.max(v, target));
  };
  const next = (e?: FormEvent) => {
    e?.preventDefault();
    const errs = stepErrors(step, form, days);
    if (Object.keys(errs).length) {
      setShown(errs);
      void content.start(shake);
      if (errs.destination) destRef.current?.focus();
      else if (errs.dates) endRef.current?.focus();
      else if (errs.interests) interestsRef.current?.focus();
      return;
    }
    if (step < STEPS.length - 1) goTo(step + 1);
    else setPhase("run");
  };

  const suggestions = meta?.destinations ?? ["Jaipur, India", "Goa, India", "Tokyo, Japan", "Paris, France"];
  const budget = Math.min(Math.max(form.budget_inr, 5000), 400000);
  const last = step === STEPS.length - 1;

  if (phase === "run")
    return (
      <RunScreen
        key={attempt}
        form={form}
        onBack={() => setPhase("form")}
        onRetry={() => setAttempt((a) => a + 1)}
        onDone={(id) => nav(`/trips/${id}`, { replace: true })}
      />
    );

  const actions = (
    <>
      <Button variant="ghost" size="lg" type="button" onClick={() => goTo(step - 1)} disabled={step === 0} icon={<ArrowLeft size={17} />} aria-label="Back to the previous step">
        <span className="hidden sm:inline">Back</span>
      </Button>
      {!last ? (
        <Button size="lg" type="submit" className="flex-1 sm:flex-none" iconRight={<ArrowRight size={17} />}>
          Continue
        </Button>
      ) : (
        <Button size="lg" variant="signal" type="submit" className="flex-1 sm:flex-none" icon={<Sparkles size={17} />}>
          Build my itinerary
        </Button>
      )}
    </>
  );

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <form onSubmit={next} noValidate className="mx-auto grid max-w-[1200px] gap-10 px-4 pb-36 pt-8 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:pb-24">
        <div className="min-w-0">
          <Stepper step={step} visited={visited} onJump={goTo} />
          <div className="relative mt-9 min-h-[440px]">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={step}
                custom={dir}
                variants={{ enter: (d: number) => ({ opacity: 0, x: 28 * d }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -20 * d }) }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [...ease] }}
              >
                <p className="label mb-3">
                  Step {step + 1} of {STEPS.length}
                </p>
                <h1 ref={headingRef} tabIndex={-1} className="display mb-8 text-heading outline-none">
                  {TITLES[step]}
                </h1>

                <motion.div animate={content}>
                  {step === 0 && (
                    <div className="flex max-w-xl flex-col gap-7">
                      <Field label="Destination" htmlFor="dest" error={errors.destination} messageId="dest-msg">
                        <input
                          ref={destRef}
                          id="dest"
                          className={`${inputCls} !h-14 !rounded-[12px] !px-4 !text-lg`}
                          value={form.destination}
                          onChange={(e) => set("destination", e.target.value)}
                          placeholder="Jaipur, India"
                          autoComplete="off"
                          autoFocus={!prefilled}
                          aria-invalid={errors.destination ? true : undefined}
                          aria-describedby={errors.destination ? "dest-msg" : undefined}
                        />
                        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Demo destinations">
                          {suggestions.map((s) => (
                            <Chip key={s} active={form.destination === s} onClick={() => set("destination", s)}>
                              {s}
                            </Chip>
                          ))}
                        </div>
                      </Field>
                      <div>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="From" htmlFor="start">
                            <input
                              id="start"
                              type="date"
                              className={inputCls}
                              value={form.start_date}
                              min={toIso(new Date())}
                              aria-invalid={errors.dates ? true : undefined}
                              onChange={(e) => {
                                const v = e.target.value;
                                setForm((f) => ({ ...f, start_date: v, end_date: f.end_date < v ? addDays(v, 2) : f.end_date }));
                              }}
                            />
                          </Field>
                          <Field label="To" htmlFor="end" aside={days >= 1 && <span className="mono text-xs text-muted">{days} day{days === 1 ? "" : "s"}</span>}>
                            <input
                              ref={endRef}
                              id="end"
                              type="date"
                              className={inputCls}
                              value={form.end_date}
                              min={form.start_date}
                              aria-invalid={errors.dates ? true : undefined}
                              aria-describedby={errors.dates ? "dates-msg" : undefined}
                              onChange={(e) => set("end_date", e.target.value)}
                            />
                          </Field>
                        </div>
                        <FieldMessage id="dates-msg" error={errors.dates} hint={!errors.dates && days > MAX_DAYS - 2 && days <= MAX_DAYS ? `Up to ${MAX_DAYS} days per plan.` : undefined} />
                      </div>
                      <Field label="Travellers">
                        <div className="flex items-center gap-4">
                          <Counter value={form.travelers} onChange={(v) => set("travelers", v)} min={1} max={12} />
                          <span className="text-sm text-muted">{form.travelers === 1 ? "Solo" : form.travelers === 2 ? "A pair" : "A group"}</span>
                        </div>
                      </Field>
                    </div>
                  )}

                  {step === 1 && (
                    <div className="flex max-w-xl flex-col gap-8">
                      <Field label="Budget for activities, food and local transport" htmlFor="budget" hint="Flights and lodging are not included.">
                        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                          <span className="display-wide text-[48px] leading-none">
                            <CountUp value={form.budget_inr} format={inr} duration={0.5} />
                          </span>
                          <span className={`mb-1 text-sm font-semibold ${tier.tone}`}>
                            {tier.label} · <span className="mono">{inr(perPersonDay)}</span> <span className="font-normal text-muted">per person per day</span>
                          </span>
                        </div>
                        <input
                          id="budget"
                          type="range"
                          min={5000}
                          max={400000}
                          step={1000}
                          value={budget}
                          onChange={(e) => set("budget_inr", Number(e.target.value))}
                          className="budget-range mt-5 w-full"
                          style={{ ["--fill" as string]: `${((budget - 5000) / 395000) * 100}%` }}
                          aria-valuetext={`${inr(budget)}, ${tier.label.toLowerCase()}`}
                        />
                        <div className="mono mt-1.5 flex justify-between text-[11px] text-faint">
                          <span>₹5k</span>
                          <span>₹4L</span>
                        </div>
                      </Field>
                      <Field label="Pace">
                        <Segmented label="Pace" value={form.pace} onChange={(v) => set("pace", v)} options={[{ value: "relaxed", label: "Relaxed", hint: "2 sights a day" }, { value: "balanced", label: "Balanced", hint: "3 sights a day" }, { value: "packed", label: "Packed", hint: "5 sights a day" }]} />
                      </Field>
                      <Field label="Style">
                        <Segmented label="Style" value={form.travel_style} onChange={(v) => set("travel_style", v)} options={[{ value: "budget", label: "Budget" }, { value: "balanced", label: "Balanced" }, { value: "luxury", label: "Luxury" }]} />
                      </Field>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="max-w-2xl">
                      <p className="mb-5 text-muted">Pick a few. They decide which places come first.</p>
                      <div ref={interestsRef} tabIndex={-1} role="group" aria-label="Interests" aria-describedby={errors.interests ? "interests-msg" : undefined} className="flex flex-wrap gap-2.5 rounded-[12px] outline-none">
                        {(meta?.interests ?? Object.keys(INTEREST_ICON)).map((i) => {
                          const Icon = INTEREST_ICON[i] ?? Sparkles;
                          const on = form.interests.includes(i);
                          return (
                            <Chip key={i} active={on} icon={<Icon size={15} />} onClick={() => set("interests", on ? form.interests.filter((x) => x !== i) : [...form.interests, i])}>
                              {titleCase(i)}
                            </Chip>
                          );
                        })}
                      </div>
                      <FieldMessage id="interests-msg" error={errors.interests} hint={form.interests.length ? `${form.interests.length} selected` : undefined} />
                    </div>
                  )}

                  {step === 3 && (
                    <div className="flex max-w-xl flex-col gap-5">
                      <Field label="Diet">
                        <Segmented label="Diet" value={form.diet} onChange={(v) => set("diet", v)} options={[{ value: "none", label: "No preference" }, { value: "vegetarian", label: "Vegetarian" }, { value: "vegan", label: "Vegan" }]} />
                      </Field>
                      <Toggle checked={form.step_free} onChange={(v) => set("step_free", v)} label="Step-free access" hint="Skip places with stairs or steep climbs." />
                      <Toggle checked={form.late_starts} onChange={(v) => set("late_starts", v)} label="No early mornings" hint="Days start at 10:30 instead of 09:00." />
                      <Field label="Skip these">
                        <div className="flex flex-wrap gap-1.5">
                          {["museum", "temple", "fort", "market", "nightlife", "shopping", "beach"].map((a) => (
                            <Chip key={a} tone="signal" active={form.avoid.includes(a)} onClick={() => set("avoid", form.avoid.includes(a) ? form.avoid.filter((x) => x !== a) : [...form.avoid, a])}>
                              {titleCase(a)}
                            </Chip>
                          ))}
                        </div>
                      </Field>
                      <Field
                        label="Anything else"
                        htmlFor="notes"
                        aside={<span className="mono text-[11px] text-faint">{form.constraints_text.length}/400</span>}
                        hint="For example: we love sunsets, travelling with a toddler, no crowds."
                      >
                        <textarea id="notes" rows={3} className={`${inputCls} !h-auto resize-none py-3 leading-relaxed`} value={form.constraints_text} onChange={(e) => set("constraints_text", e.target.value)} maxLength={400} />
                      </Field>
                    </div>
                  )}
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-10 hidden items-center gap-3 sm:flex">{actions}</div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <BoardingPass form={form} days={days} tier={tier.label} />
          </div>
        </aside>

        {/* phones: the actions stay under the thumb, with the trip so far as a one-line summary */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:hidden">
          <p className="mono mb-2.5 truncate text-[11px] uppercase tracking-[0.06em] text-muted">
            {form.destination.trim() ? cityName(form.destination) : "Anywhere"} · {days} day{days === 1 ? "" : "s"} · {inr(form.budget_inr)} · {form.travelers} {form.travelers === 1 ? "traveller" : "travellers"}
          </p>
          <div className="flex items-center gap-2.5">{actions}</div>
        </div>
      </form>
    </motion.div>
  );
}

function Stepper({ step, visited, onJump }: { step: number; visited: number; onJump: (i: number) => void }) {
  return (
    <nav aria-label="Trip steps">
      <ol className="m-0 flex items-center p-0">
        {STEPS.map((s, i) => {
          const done = i < step;
          const on = i === step;
          const reachable = i <= visited && !on;
          return (
            <li key={s} className={`flex list-none items-center ${i < STEPS.length - 1 ? "min-w-0 flex-1" : ""}`}>
              <button
                type="button"
                onClick={() => reachable && onJump(i)}
                disabled={!reachable && !on}
                aria-current={on ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${s}${done ? ", done" : ""}`}
                className={`group flex shrink-0 items-center gap-2.5 rounded-full py-1 pr-1 transition-opacity disabled:cursor-default ${reachable ? "" : "cursor-default"}`}
              >
                <motion.span
                  animate={{ scale: on ? 1.06 : 1, backgroundColor: done || on ? "var(--sea)" : "var(--surface)" }}
                  transition={spring}
                  className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold transition-shadow ${done || on ? "border-sea text-sea-ink" : "border-line-strong text-faint"} ${on ? "shadow-[0_0_0_4px_color-mix(in_srgb,var(--sea)_16%,transparent)]" : ""} ${reachable ? "group-hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--sea)_12%,transparent)]" : ""}`}
                >
                  {done ? <Check size={14} strokeWidth={2.6} /> : <span className="mono">{i + 1}</span>}
                </motion.span>
                <span className={`hidden whitespace-nowrap text-[13px] font-medium transition-colors md:block ${on ? "text-ink" : reachable ? "text-muted group-hover:text-ink" : "text-faint"}`}>{s}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span className="relative mx-3 h-px min-w-4 flex-1 bg-line">
                  <motion.span className="absolute inset-0 origin-left bg-sea" initial={false} animate={{ scaleX: done ? 1 : 0 }} transition={{ duration: 0.5, ease: [...ease] }} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Counter({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="inline-flex items-center rounded-[12px] border border-line bg-surface shadow-xs" role="group" aria-label="Travellers">
      <button type="button" aria-label="Fewer travellers" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="grid h-11 w-11 place-items-center rounded-l-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">
        <Minus size={16} />
      </button>
      <span className="relative grid h-11 w-12 place-items-center overflow-hidden border-x border-line" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ duration: 0.18 }} className="mono text-lg font-semibold">
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <button type="button" aria-label="More travellers" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="grid h-11 w-11 place-items-center rounded-r-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">
        <Plus size={16} />
      </button>
    </div>
  );
}

function BoardingPass({ form, days, tier }: { form: TripRequest; days: number; tier: string }) {
  const city = form.destination.trim() ? cityName(form.destination) : "Anywhere";
  return (
    <motion.div layout className="card overflow-hidden rounded-panel" aria-label="Trip summary">
      <div className="night relative px-6 pb-6 pt-5">
        <p className="label mb-3 flex items-center justify-between">
          <span>Boarding pass</span>
          <span className="mono">WP·{String(Math.max(days, 0)).padStart(2, "0")}</span>
        </p>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h2 key={city} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }} transition={{ duration: 0.36, ease: [...ease] }} className={`display truncate text-[64px] ${city === "Anywhere" ? "text-faint" : ""}`}>
            {city}
          </motion.h2>
        </AnimatePresence>
        <p className="mono mt-3 text-sm text-muted">{form.start_date && form.end_date && form.end_date >= form.start_date ? dateRange(form.start_date, form.end_date) : "Choose dates"}</p>
      </div>
      <Perforation />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-6 text-sm">
        <div>
          <dt className="label mb-1">Days</dt>
          <dd className="mono text-lg font-semibold">{Math.max(days, 0)}</dd>
        </div>
        <div>
          <dt className="label mb-1">Travellers</dt>
          <dd className="mono text-lg font-semibold">{form.travelers}</dd>
        </div>
        <div className="col-span-2">
          <dt className="label mb-1">Budget</dt>
          <dd className="display-wide text-3xl">
            <CountUp value={form.budget_inr} format={inr} duration={0.5} />
            <span className="ml-2 text-sm font-medium text-muted">{tier}</span>
          </dd>
        </div>
        <div>
          <dt className="label mb-1">Pace</dt>
          <dd className="font-medium capitalize">{form.pace}</dd>
        </div>
        <div>
          <dt className="label mb-1">Style</dt>
          <dd className="font-medium capitalize">{form.travel_style}</dd>
        </div>
        <div className="col-span-2">
          <dt className="label mb-2">Interests</dt>
          <dd className="flex min-h-7 flex-wrap gap-1.5">
            <AnimatePresence initial={false}>
              {form.interests.length === 0 && (
                <motion.span key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-faint">
                  None picked yet
                </motion.span>
              )}
              {form.interests.map((i) => (
                <motion.span key={i} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={spring} className="rounded-full bg-sea-soft px-2.5 py-0.5 text-xs font-medium capitalize text-sea">
                  {i}
                </motion.span>
              ))}
            </AnimatePresence>
          </dd>
        </div>
      </dl>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------------------- generation */

const ORDER = ["intake", "research", "plan", "validate", "ground"];
const DEFAULT_LABEL: Record<string, string> = {
  intake: "Reading your trip request", research: "Checking places, routes, weather and local guides", plan: "Drafting the itinerary",
  validate: "Checking opening hours, travel time and budget", ground: "Verifying sources and finishing",
  repair_llm: "Asking the model to fix the issues", fix: "Repairing remaining issues",
};

function RunScreen({ form, onBack, onRetry, onDone }: { form: TripRequest; onBack: () => void; onRetry: () => void; onDone: (id: string) => void }) {
  const reduce = useReducedMotion();
  const [stages, setStages] = useState<Record<string, StageEvent>>({});
  const [order, setOrder] = useState<string[]>(ORDER);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [places, setPlaces] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    // Stage events are shown with a short minimum dwell so each step is readable even when the server is instant
    // (the built-in planner finishes in well under a second). Reported timings are still the real ones.
    const queue: (() => void)[] = [];
    let draining = false;
    let timer: number | undefined;
    const drain = () => {
      const next = queue.shift();
      if (!next) {
        draining = false;
        return;
      }
      draining = true;
      next();
      timer = window.setTimeout(drain, reduce ? 0 : 420);
    };
    const enqueue = (fn: () => void) => {
      queue.push(fn);
      if (!draining) drain();
    };
    streamTrip(form, (e) => {
      if (e.type === "stage") {
        enqueue(() => {
          setStages((s) => ({ ...s, [e.node]: e }));
          setOrder((o) => {
            if (o.includes(e.node)) return o;
            const next = [...o];
            next.splice(next.indexOf("ground"), 0, e.node);
            return next;
          });
          if (e.node === "research" && e.status === "done") {
            const m = /(\d+) places/.exec(e.detail ?? "");
            if (m) setPlaces(Number(m[1]));
          }
        });
      } else if (e.type === "itinerary") {
        enqueue(() => {
          setReady(e.trip_id);
          timer = window.setTimeout(() => onDone(e.trip_id), reduce ? 200 : 1300);
        });
      } else if (e.type === "error") {
        enqueue(() => setError({ code: e.code, message: e.message }));
      }
    }, ctl.signal).catch((err) => {
      if (ctl.signal.aborted) return;
      setError({ code: "network", message: err instanceof ApiError ? err.message : "The connection dropped before the plan finished." });
    });
    return () => {
      ctl.abort();
      queue.length = 0;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = order.filter((n) => stages[n]?.status === "done").length;
  const progress = ready ? 1 : doneCount / order.length;
  const dots = useMemo(() => Array.from({ length: 34 }, (_, i) => ({ a: (i * 137.5) % 360, r: 30 + ((i * 53) % 62) })), []);

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-14 sm:px-6 lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="label mb-3" aria-live="polite">
            {error ? "Something stopped the plan" : ready ? "Ready" : "Building your itinerary"}
          </p>
          <h1 className="display mb-3 text-title">{cityName(form.destination)}</h1>
          <p className="mono mb-10 text-sm text-muted">
            {dateRange(form.start_date, form.end_date)} · {inr(form.budget_inr)} · {form.travelers} traveller{form.travelers > 1 ? "s" : ""}
          </p>

          {error ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} role="alert" className="card max-w-lg rounded-panel p-6">
              <p className="display-wide mb-2 text-2xl">{error.code === "destination_unsupported_in_demo" ? "That destination needs live data" : "We could not finish the plan"}</p>
              <p className="mb-5 text-muted">{error.message}</p>
              <div className="flex flex-wrap gap-2.5">
                {error.code === "destination_unsupported_in_demo" ? (
                  <Button onClick={onBack} icon={<ArrowLeft size={16} />}>
                    Choose another city
                  </Button>
                ) : (
                  <>
                    <Button onClick={onRetry} icon={<RotateCw size={16} />}>
                      Try again
                    </Button>
                    <Button variant="ghost" onClick={onBack} icon={<ArrowLeft size={16} />}>
                      Edit my request
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          ) : (
            <ol className="relative m-0 flex max-w-lg flex-col gap-1 p-0">
              <span className="absolute bottom-4 left-[13px] top-4 w-px bg-line" />
              <motion.span className="absolute left-[13px] top-4 w-px origin-top bg-sea" style={{ bottom: "1rem" }} initial={{ scaleY: 0 }} animate={{ scaleY: progress }} transition={{ duration: 0.6, ease: [...ease] }} />
              {order.map((n) => {
                const s = stages[n];
                const state = s?.status === "done" ? "done" : s?.status === "start" ? "active" : "wait";
                return (
                  <motion.li key={n} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: state === "wait" ? 0.45 : 1, x: 0 }} transition={{ duration: 0.4 }} className="relative flex list-none items-start gap-4 py-2.5">
                    <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-bg" style={{ borderColor: state === "wait" ? "var(--line)" : "var(--sea)" }}>
                      {state === "done" && (
                        <motion.svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--sea)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
                        </motion.svg>
                      )}
                      {state === "active" && (
                        <>
                          <span className="ping absolute inset-0 rounded-full bg-sea/40" />
                          <span className="h-2.5 w-2.5 rounded-full bg-sea" />
                        </>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] font-medium ${state === "active" ? "text-ink" : "text-ink/90"}`}>{s?.label ?? DEFAULT_LABEL[n] ?? n}</p>
                      <AnimatePresence>
                        {s?.detail && (
                          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mono text-xs text-muted">
                            {s.detail}
                            {s.ms != null && <span className="text-faint"> · {s.ms} ms</span>}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="night relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-[32px] border border-line shadow-pop">
          <svg viewBox="-110 -110 220 220" className="h-full w-full" aria-hidden>
            {[30, 58, 86, 104].map((r) => (
              <circle key={r} r={r} fill="none" stroke="var(--sea)" strokeOpacity={0.22} strokeDasharray={r % 2 ? "2 4" : undefined} />
            ))}
            <line x1="-104" x2="104" stroke="var(--grid)" />
            <line y1="-104" y2="104" stroke="var(--grid)" />
            {!error && !ready && !reduce && (
              <g className="origin-center">
                <motion.g animate={{ rotate: 360 }} transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}>
                  <defs>
                    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="var(--sea)" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="var(--sea)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 0 L104 0 A104 104 0 0 0 98 -35 Z" fill="url(#sweep)" />
                  <line x2="104" stroke="var(--sea)" strokeWidth="1.5" />
                </motion.g>
              </g>
            )}
            {dots.slice(0, Math.min(34, places * 1.4 || (stages.research ? 10 : 0))).map((d, i) => {
              const x = Math.cos((d.a * Math.PI) / 180) * d.r;
              const y = Math.sin((d.a * Math.PI) / 180) * d.r;
              return <motion.circle key={i} cx={x} cy={y} r="2.2" fill={i % 5 === 0 ? "var(--signal)" : "var(--sea)"} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: i * 0.04 }} />;
            })}
            <circle r="4" fill="var(--sea)" />
          </svg>
          <AnimatePresence>
            {ready && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] backdrop-blur-[3px]">
                <div className="text-center">
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring, delay: 0.1 }} className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-sea text-sea-ink">
                    <Check size={30} strokeWidth={3} />
                  </motion.span>
                  <p className="display text-4xl">Itinerary ready</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
