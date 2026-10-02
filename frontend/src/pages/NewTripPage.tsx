import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Building2, Castle, Check, Landmark, Minus, Moon, Mountain, Palette, Plus, ShoppingBag, Sparkles, Trees, Utensils, Waves, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DestinationField } from "../components/trip/DestinationField";
import { Button, Chip, CountUp, Field, Segmented, Toggle, inputCls } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { ApiError, api, streamTrip } from "../lib/api";
import { addDays, cityName, dateRange, daysBetween, inr, inrShort, titleCase, toIso } from "../lib/format";
import { ease, pageVariants, spring } from "../lib/motion";
import type { Prefs, StageEvent, TripRequest } from "../lib/types";

const INTEREST_ICON: Record<string, LucideIcon> = {
  culture: Landmark, history: Castle, food: Utensils, nature: Trees, adventure: Mountain, shopping: ShoppingBag,
  nightlife: Moon, relaxation: Waves, art: Palette, architecture: Building2,
};
const AVOID = ["museum", "temple", "fort", "market", "nightlife", "shopping", "beach"];
const COST_TIER: Record<string, [number, number]> = { jaipur: [2500, 5000], goa: [3500, 7000], tokyo: [7000, 13000], paris: [8000, 15000] };
const STEPS = ["Where and when", "Budget and pace", "Interests", "Needs"];
const TITLES = ["Where are you headed?", "Set the budget and pace", "What do you enjoy?", "Anything to plan around?"];
const MIN_BUDGET = 1000;
const SLIDER_MIN = 5000;
const SLIDER_MAX = 400000;

function tierFor(dest: string): [number, number] {
  const k = Object.keys(COST_TIER).find((c) => dest.toLowerCase().includes(c));
  return k ? COST_TIER[k] : [4000, 8000];
}

const defaultStart = () => toIso(new Date(Date.now() + 21 * 86400000));

export default function NewTripPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { meta } = useAuth();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [dir, setDir] = useState(1);
  const [phase, setPhase] = useState<"form" | "run">("form");
  const [form, setForm] = useState<TripRequest>(() => {
    const s = defaultStart();
    return {
      destination: params.get("to") ?? "", start_date: s, end_date: addDays(s, 3), budget_inr: 50000, travelers: 2, interests: [], travel_style: "balanced",
      pace: "balanced", constraints_text: "", diet: "none", step_free: false, avoid: [], late_starts: false,
    };
  });
  const set = <K extends keyof TripRequest>(k: K, v: TripRequest[K]) => setForm((f) => ({ ...f, [k]: v }));
  // after a step change, focus the new question once it mounts (the old step animates out first)
  const wantFocus = useRef(false);
  const focusOnMount = (el: HTMLHeadingElement | null) => {
    if (el && wantFocus.current) {
      wantFocus.current = false;
      el.focus({ preventScroll: true });
    }
  };

  useEffect(() => {
    api<Prefs>("/preferences")
      .then((p) => setForm((f) => ({ ...f, pace: p.pace, travel_style: p.travel_style, diet: p.diet, step_free: p.step_free, interests: p.interests.length ? p.interests : f.interests, avoid: p.avoid })))
      .catch(() => undefined);
  }, []);

  const days = daysBetween(form.start_date, form.end_date);
  const [lean, comfy] = tierFor(form.destination);
  const perPersonDay = form.budget_inr / Math.max(days * form.travelers, 1);
  const tier = perPersonDay < lean ? { label: "Lean", tone: "text-warn" } : perPersonDay < comfy ? { label: "Comfortable", tone: "text-good" } : { label: "Generous", tone: "text-sea" };

  const problems = [
    form.destination.trim().length < 2 ? "Choose a destination." : days < 1 ? "The trip must end on or after the day it starts." : days > 10 ? "Plans cover up to 10 days." : null,
    form.budget_inr < MIN_BUDGET ? `The budget needs to be at least ${inr(MIN_BUDGET)}.` : null,
    form.interests.length < 1 ? "Pick at least one interest." : null,
    null,
  ];
  const valid = problems[step] === null;
  const go = (to: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, to));
    setDir(n >= step ? 1 : -1);
    setStep(n);
    setReached((r) => Math.max(r, n));
    wantFocus.current = n !== step;
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) return;
    if (step < STEPS.length - 1) go(step + 1);
    else setPhase("run");
  };
  // Enter advances from anywhere in the form, not only from text fields (focus sits on the heading after each step)
  const onFormKey = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    const textLike = t instanceof HTMLInputElement && !["range", "checkbox", "radio", "button"].includes(t.type);
    if (textLike || ["TEXTAREA", "BUTTON", "A"].includes(t.tagName)) return;
    e.preventDefault();
    submit();
  };

  if (phase === "run") return <RunScreen form={form} onBack={() => setPhase("form")} onDone={(id) => nav(`/trips/${id}`, { replace: true })} />;

  const last = step === STEPS.length - 1;
  const primary = (
    <Button type="submit" size="lg" disabled={!valid} icon={last ? <Sparkles size={16} /> : undefined} className="max-sm:flex-1">
      {last ? "Build my itinerary" : "Continue"}
      {!last && <ArrowRight size={16} />}
    </Button>
  );

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <form onSubmit={submit} onKeyDown={onFormKey} noValidate className="mx-auto grid max-w-[1120px] gap-12 px-4 pb-32 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-20 xl:gap-20">
        <div className="min-w-0">
          <Stepper step={step} reached={reached} onJump={(i) => go(i)} />
          <div className="relative mt-10">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={step}
                custom={dir}
                variants={{ enter: (d: number) => ({ opacity: 0, x: 24 * d }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -24 * d }) }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.24, ease: [...ease] }}
              >
                <p className="label mb-2.5">
                  Step {step + 1} of {STEPS.length}
                </p>
                <h1 ref={focusOnMount} tabIndex={-1} className="display mb-8 text-[36px] outline-none sm:text-[44px]">
                  {TITLES[step]}
                </h1>

                {step === 0 && (
                  <div className="flex max-w-xl flex-col gap-7">
                    <Field label="Destination" htmlFor="dest" hint={meta?.destinations ? "Demo mode covers Jaipur, Goa, Tokyo and Paris." : "Any city works. Pick a suggestion or type your own."}>
                      <DestinationField id="dest" value={form.destination} onChange={(v) => set("destination", v)} demoCities={meta?.destinations ?? null} autoFocus />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="From" htmlFor="start">
                        <input
                          id="start"
                          type="date"
                          className={inputCls}
                          value={form.start_date}
                          min={toIso(new Date())}
                          onChange={(e) => {
                            const v = e.target.value;
                            setForm((f) => ({ ...f, start_date: v, end_date: f.end_date < v ? addDays(v, Math.max(0, days - 1)) : f.end_date }));
                          }}
                        />
                      </Field>
                      <Field label="To" htmlFor="end" aside={<span className={`mono text-[12px] ${days > 10 || days < 1 ? "text-bad" : "text-muted"}`}>{days >= 1 ? `${days} day${days > 1 ? "s" : ""}` : "—"}</span>}>
                        <input id="end" type="date" className={inputCls} value={form.end_date} min={form.start_date} onChange={(e) => set("end_date", e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Travellers">
                      <div className="flex items-center gap-4">
                        <Counter value={form.travelers} onChange={(v) => set("travelers", v)} min={1} max={12} />
                        <span className="text-[14px] text-muted">{form.travelers === 1 ? "Solo" : form.travelers === 2 ? "A pair" : "A group"}</span>
                      </div>
                    </Field>
                  </div>
                )}

                {step === 1 && (
                  <div className="flex max-w-xl flex-col gap-8">
                    <BudgetField value={form.budget_inr} onChange={(v) => set("budget_inr", v)} tier={tier} perPersonDay={perPersonDay} />
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
                    <p className="mb-5 text-[15px] text-muted">Pick a few. They decide which places are considered first and how each day is themed.</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Interests">
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
                    <p className="mono mt-4 text-[12px] text-muted" aria-live="polite">
                      {form.interests.length ? `${form.interests.length} selected` : "None selected yet"}
                    </p>
                  </div>
                )}

                {step === 3 && (
                  <div className="flex max-w-xl flex-col gap-6">
                    <Field label="Diet">
                      <Segmented label="Diet" value={form.diet} onChange={(v) => set("diet", v)} options={[{ value: "none", label: "No preference" }, { value: "vegetarian", label: "Vegetarian" }, { value: "vegan", label: "Vegan" }]} />
                    </Field>
                    <div className="flex flex-col gap-2">
                      <Toggle checked={form.step_free} onChange={(v) => set("step_free", v)} label="Step-free access" hint="Skip places with stairs or steep climbs." />
                      <Toggle checked={form.late_starts} onChange={(v) => set("late_starts", v)} label="No early mornings" hint="Days start at 10:30 instead of 09:00." />
                    </div>
                    <Field label="Skip these">
                      <div className="flex flex-wrap gap-1.5">
                        {AVOID.map((a) => (
                          <Chip key={a} tone="signal" active={form.avoid.includes(a)} onClick={() => set("avoid", form.avoid.includes(a) ? form.avoid.filter((x) => x !== a) : [...form.avoid, a])}>
                            {titleCase(a)}
                          </Chip>
                        ))}
                      </div>
                    </Field>
                    <Field label="Anything else" htmlFor="notes" hint="For example: we love sunsets, travelling with a toddler, no crowds.">
                      <textarea id="notes" rows={3} className={`${inputCls} !h-auto resize-none py-3`} value={form.constraints_text} onChange={(e) => set("constraints_text", e.target.value)} maxLength={400} />
                    </Field>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {!valid && problems[step] && (step > 0 || form.destination.length > 0) && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 text-[13px] text-bad" role="status">
                {problems[step]}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="mt-8 hidden items-center gap-2 sm:flex">
            {primary}
            {step > 0 && (
              <Button type="button" variant="quiet" size="lg" onClick={() => go(step - 1)} icon={<ArrowLeft size={16} />}>
                Back
              </Button>
            )}
            <span className="ml-3 hidden text-[12px] text-muted md:inline">
              or press <kbd className="mono rounded border border-line bg-surface px-1.5 py-0.5 text-[11px]">Enter</kbd>
            </span>
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <BoardingPass form={form} days={days} tier={tier.label} />
          </div>
        </aside>

        {/* phones: a summary of the trip so far, with the step action always in reach */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[color-mix(in_srgb,var(--surface)_95%,transparent)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:hidden">
          <p className="mono mb-2.5 truncate text-[12px] text-muted">
            <span className="font-semibold text-ink">{form.destination.trim() ? cityName(form.destination) : "Anywhere"}</span> · {days >= 1 ? `${days}d` : "—"} · {inrShort(form.budget_inr)} · {form.travelers} {form.travelers === 1 ? "traveller" : "travellers"}
          </p>
          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" variant="ghost" size="lg" onClick={() => go(step - 1)} aria-label="Back" className="!px-3.5">
                <ArrowLeft size={16} />
              </Button>
            )}
            {primary}
          </div>
        </div>
      </form>
    </motion.div>
  );
}

function BudgetField({ value, onChange, tier, perPersonDay }: { value: number; onChange: (v: number) => void; tier: { label: string; tone: string }; perPersonDay: number }) {
  const [text, setText] = useState(() => value.toLocaleString("en-IN"));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value.toLocaleString("en-IN"));
  }, [value]);
  const clamped = Math.min(Math.max(value, SLIDER_MIN), SLIDER_MAX);
  // the slider is logarithmic so the useful low range (₹5k to ₹1L) gets most of the travel
  const toPos = (v: number) => Math.log(v / SLIDER_MIN) / Math.log(SLIDER_MAX / SLIDER_MIN);
  const fromPos = (p: number) => {
    const raw = SLIDER_MIN * Math.pow(SLIDER_MAX / SLIDER_MIN, p);
    const step = raw < 20000 ? 500 : raw < 100000 ? 1000 : 5000;
    return Math.round(raw / step) * step;
  };
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="budget" className="field-label">
        Total budget
      </label>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <div className="relative flex items-baseline border-b-2 border-line pb-1 transition-colors focus-within:border-sea">
          <span className="mono text-[34px] font-semibold leading-none text-muted">₹</span>
          <input
            id="budget"
            inputMode="numeric"
            className="mono w-[9ch] bg-transparent text-[40px] font-semibold leading-none tracking-tight text-ink outline-none"
            value={text}
            onFocus={() => (editing.current = true)}
            onBlur={() => {
              editing.current = false;
              setText(value.toLocaleString("en-IN"));
            }}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
              setText(digits ? Number(digits).toLocaleString("en-IN") : "");
              onChange(Number(digits || 0));
            }}
            aria-describedby="budget-hint"
          />
        </div>
        <p className={`mb-1.5 text-[13px] font-semibold ${tier.tone}`}>
          {tier.label} <span className="font-normal text-muted">· </span>
          <span className="mono font-medium text-muted">{inr(perPersonDay)}</span>
          <span className="font-normal text-muted"> per person per day</span>
        </p>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(toPos(clamped) * 1000)}
        onChange={(e) => onChange(fromPos(Number(e.target.value) / 1000))}
        className="budget-range mt-3 w-full"
        style={{ ["--fill" as string]: `${toPos(clamped) * 100}%` }}
        aria-label="Budget"
        aria-valuetext={inr(value)}
      />
      <div className="mono flex justify-between text-[11px] text-muted">
        <span>₹5k</span>
        <span>₹50k</span>
        <span>₹4L</span>
      </div>
      <p id="budget-hint" className="text-[13px] text-muted">
        Covers activities, food and local transport for everyone. Flights and lodging are not included.
      </p>
    </div>
  );
}

function Stepper({ step, reached, onJump }: { step: number; reached: number; onJump: (i: number) => void }) {
  return (
    <ol className="m-0 flex items-center gap-2 p-0" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < step;
        const on = i === step;
        const canJump = i <= reached && !on;
        return (
          <li key={s} className="flex min-w-0 flex-1 list-none flex-col gap-2">
            <span className="relative h-[3px] overflow-hidden rounded-full bg-line">
              <motion.span className="absolute inset-y-0 left-0 rounded-full bg-sea" initial={false} animate={{ width: done || on ? "100%" : "0%" }} transition={{ duration: 0.4, ease: [...ease] }} />
            </span>
            <button
              type="button"
              disabled={!canJump}
              onClick={() => onJump(i)}
              aria-current={on ? "step" : undefined}
              className={`flex items-center gap-1.5 truncate text-left text-[12px] font-medium transition-colors disabled:cursor-default ${on ? "text-ink" : done || canJump ? "text-muted hover:text-ink" : "text-faint"}`}
            >
              {done ? <Check size={12} className="shrink-0 text-sea" /> : <span className="mono shrink-0">{i + 1}</span>}
              <span className="hidden truncate sm:inline">{s}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Counter({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <div className="inline-flex items-center rounded-[var(--radius-ctl)] border border-line bg-surface">
      <button type="button" aria-label="Fewer travellers" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} className="grid h-11 w-11 place-items-center rounded-l-[var(--radius-ctl)] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30">
        <Minus size={16} />
      </button>
      <span className="relative grid h-11 w-10 place-items-center overflow-hidden" aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} transition={{ duration: 0.16 }} className="mono text-[17px] font-semibold">
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <button type="button" aria-label="More travellers" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} className="grid h-11 w-11 place-items-center rounded-r-[var(--radius-ctl)] text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30">
        <Plus size={16} />
      </button>
    </div>
  );
}

function BoardingPass({ form, days, tier }: { form: TripRequest; days: number; tier: string }) {
  const city = form.destination.trim() ? cityName(form.destination) : "Anywhere";
  return (
    <div className="overflow-hidden rounded-[14px] border border-line bg-surface" aria-label="Trip summary">
      <div className="night relative px-5 pb-5 pt-4">
        <p className="label mb-4 flex items-center justify-between">
          <span>Boarding pass</span>
          <span className="mono">WP·{String(Math.max(days, 0)).padStart(2, "0")}</span>
        </p>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h2 key={city} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.3, ease: [...ease] }} className="display truncate text-[52px]">
            {city}
          </motion.h2>
        </AnimatePresence>
        <p className="mono mt-2 text-[13px] text-muted">{days >= 1 ? dateRange(form.start_date, form.end_date) : "Choose dates"}</p>
      </div>
      <div className="relative border-t border-dashed border-line-strong">
        <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full border border-line bg-bg" />
        <span className="absolute -right-2 -top-2 h-4 w-4 rounded-full border border-line bg-bg" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 text-[13px]">
        <div>
          <dt className="label mb-1">Days</dt>
          <dd className="mono text-[17px] font-semibold">{Math.max(days, 0)}</dd>
        </div>
        <div>
          <dt className="label mb-1">Travellers</dt>
          <dd className="mono text-[17px] font-semibold">{form.travelers}</dd>
        </div>
        <div className="col-span-2">
          <dt className="label mb-1">Budget</dt>
          <dd className="flex items-baseline gap-2">
            <span className="mono text-[24px] font-semibold tracking-tight">
              <CountUp value={form.budget_inr} format={inr} duration={0.4} />
            </span>
            <span className="text-[13px] text-muted">{tier}</span>
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
          <dd className="flex min-h-6 flex-wrap gap-1">
            <AnimatePresence initial={false}>
              {form.interests.length === 0 && (
                <motion.span key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-muted">
                  None picked yet
                </motion.span>
              )}
              {form.interests.map((i) => (
                <motion.span key={i} layout initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }} transition={spring} className="rounded-full bg-sea-soft px-2 py-0.5 text-[12px] font-medium capitalize text-sea">
                  {i}
                </motion.span>
              ))}
            </AnimatePresence>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- generation */

const ORDER = ["intake", "research", "plan", "validate", "ground"];
const DEFAULT_LABEL: Record<string, string> = {
  intake: "Reading your trip request", research: "Checking places, routes, weather and local guides", plan: "Drafting the itinerary",
  validate: "Checking opening hours, travel time and budget", ground: "Verifying sources and finishing",
  repair_llm: "Asking the model to fix the issues", fix: "Repairing remaining issues",
};

function RunScreen({ form, onBack, onDone }: { form: TripRequest; onBack: () => void; onDone: (id: string) => void }) {
  const reduce = useReducedMotion();
  const [stages, setStages] = useState<Record<string, StageEvent>>({});
  const [order, setOrder] = useState<string[]>(ORDER);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const [places, setPlaces] = useState(0);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setStages({});
    setOrder(ORDER);
    setError(null);
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
    streamTrip(
      form,
      (e) => {
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
            timer = window.setTimeout(() => onDone(e.trip_id), reduce ? 200 : 1200);
          });
        } else if (e.type === "error") {
          enqueue(() => setError({ code: e.code, message: e.message }));
        }
      },
      ctl.signal,
    ).catch((err) => {
      if (ctl.signal.aborted) return;
      setError({ code: "network", message: err instanceof ApiError ? err.message : "The connection dropped before the plan finished." });
    });
    return () => {
      ctl.abort();
      queue.length = 0;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const doneCount = order.filter((n) => stages[n]?.status === "done").length;
  const progress = ready ? 1 : doneCount / order.length;
  const dots = useMemo(() => Array.from({ length: 34 }, (_, i) => ({ a: (i * 137.5) % 360, r: 30 + ((i * 53) % 62) })), []);
  const status = error ? "Something stopped the plan" : ready ? "Itinerary ready" : "Building your itinerary";

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto grid max-w-[1120px] items-center gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:min-h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
        <div>
          <p className="label mb-2.5" role="status">
            {status}
          </p>
          <h1 className="display text-[44px] sm:text-[56px]">{cityName(form.destination)}</h1>
          <p className="mono mb-10 mt-3 text-[13px] text-muted">
            {dateRange(form.start_date, form.end_date)} · {inr(form.budget_inr)} · {form.travelers} {form.travelers > 1 ? "travellers" : "traveller"}
          </p>

          {error ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card relative max-w-lg overflow-hidden p-5 pl-6" role="alert">
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-bad" />
              <p className="mb-1.5 text-[16px] font-semibold">{error.code === "destination_unsupported_in_demo" ? "That destination needs live data" : "The plan could not be finished"}</p>
              <p className="mb-5 text-[14px] text-muted">{error.message}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={onBack} icon={<ArrowLeft size={15} />}>
                  Edit my request
                </Button>
                {error.code !== "destination_unsupported_in_demo" && (
                  <Button variant="ghost" onClick={() => setAttempt((a) => a + 1)}>
                    Try again
                  </Button>
                )}
              </div>
            </motion.div>
          ) : (
            <ol className="relative m-0 flex max-w-lg flex-col p-0" aria-label="Planning steps">
              <span className="absolute bottom-5 left-[13px] top-5 w-px bg-line" aria-hidden />
              <motion.span className="absolute bottom-5 left-[13px] top-5 w-px origin-top bg-sea" initial={{ scaleY: 0 }} animate={{ scaleY: progress }} transition={{ duration: 0.5, ease: [...ease] }} aria-hidden />
              {order.map((n) => {
                const s = stages[n];
                const state = s?.status === "done" ? "done" : s?.status === "start" ? "active" : "wait";
                return (
                  <motion.li key={n} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: state === "wait" ? 0.5 : 1, x: 0 }} transition={{ duration: 0.3 }} className="relative flex list-none items-start gap-4 py-2.5">
                    <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-bg" style={{ borderColor: state === "wait" ? "var(--line-strong)" : "var(--sea)" }}>
                      {state === "done" && (
                        <motion.svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--sea)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
                        </motion.svg>
                      )}
                      {state === "active" && (
                        <>
                          <span className="ping absolute inset-0 rounded-full bg-sea/35" />
                          <span className="h-2 w-2 rounded-full bg-sea" />
                        </>
                      )}
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-[15px] font-medium">{s?.label ?? DEFAULT_LABEL[n] ?? n}</p>
                      <AnimatePresence>
                        {s?.detail && (
                          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mono mt-0.5 text-[12px] text-muted">
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

        <div className="night relative mx-auto aspect-square w-full max-w-[300px] overflow-hidden rounded-[24px] border border-line sm:max-w-[440px] lg:max-w-[480px]" aria-hidden>
          <svg viewBox="-110 -110 220 220" className="h-full w-full">
            {[30, 58, 86, 104].map((r) => (
              <circle key={r} r={r} fill="none" stroke="var(--sea)" strokeOpacity={0.2} strokeDasharray={r % 2 ? "2 4" : undefined} />
            ))}
            <line x1="-104" x2="104" stroke="var(--grid)" />
            <line y1="-104" y2="104" stroke="var(--grid)" />
            {!error && !ready && !reduce && (
              <motion.g animate={{ rotate: 360 }} transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }}>
                <defs>
                  <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--sea)" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="var(--sea)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0 0 L104 0 A104 104 0 0 0 98 -35 Z" fill="url(#sweep)" />
                <line x2="104" stroke="var(--sea)" strokeWidth="1.25" />
              </motion.g>
            )}
            {dots.slice(0, Math.min(34, places * 1.4 || (stages.research ? 10 : 0))).map((d, i) => {
              const x = Math.cos((d.a * Math.PI) / 180) * d.r;
              const y = Math.sin((d.a * Math.PI) / 180) * d.r;
              return <motion.circle key={i} cx={x} cy={y} r="2.1" fill={i % 5 === 0 ? "var(--signal)" : "var(--sea)"} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: i * 0.035 }} />;
            })}
            <circle r="3.5" fill="var(--sea)" />
          </svg>
          <AnimatePresence>
            {ready && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_80%,transparent)]">
                <div className="text-center">
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring, delay: 0.08 }} className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-sea text-sea-ink">
                    <Check size={26} strokeWidth={3} />
                  </motion.span>
                  <p className="display text-[30px]">Itinerary ready</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
