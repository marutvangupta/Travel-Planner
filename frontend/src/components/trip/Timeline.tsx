import { AnimatePresence, motion } from "framer-motion";
import { Ban, Lightbulb, Lock, ThumbsDown, ThumbsUp, TriangleAlert, Umbrella } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { dayName, duration, hhmm, inr, shortDate, titleCase } from "../../lib/format";
import { ease, spring } from "../../lib/motion";
import type { Day, Item, ItemChange, Itinerary } from "../../lib/types";
import { Citations, KindBadge, LegText, WeatherGlyph, categoryIcon, conditionLabel, freeTimeText, isWet } from "./parts";

type Flag = "added" | "moved" | "retimed";

export interface TimelineProps {
  itinerary: Itinerary;
  dayIndex: number;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  flags?: Map<string, Flag>;
  removed?: ItemChange[];
  flash?: Set<string>;
  feedback: Record<string, "up" | "down">;
  onFeedback?: (item: Item, signal: "up" | "down") => void;
  onLock?: (item: Item) => void;
  onClosed?: (item: Item) => void;
  readOnly?: boolean;
  emptyAction?: ReactNode;
}

function RainDrops() {
  const drops = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ left: (i * 47) % 100, d: 0.9 + ((i * 13) % 10) / 10, delay: -((i * 7) % 15) / 10 })), []);
  return (
    <div className="rain-layer" aria-hidden>
      {drops.map((r, i) => (
        <i key={i} style={{ left: `${r.left}%`, animationDuration: `${r.d}s`, animationDelay: `${r.delay}s` }} />
      ))}
    </div>
  );
}

export function DayHeader({ day }: { day: Day }) {
  const w = day.weather;
  const wet = isWet(w);
  const travel = day.items.reduce((s, i) => s + (i.travel_from_prev?.minutes ?? 0), 0);
  const cost = day.items.reduce((s, i) => s + i.est_cost_inr + (i.travel_from_prev?.cost_inr ?? 0), 0);
  const span = day.items.length ? `${hhmm(day.items[0].start)}–${hhmm(day.items[day.items.length - 1].end)}` : null;
  return (
    <header className="flex flex-col gap-3">
      <div>
        <p className="label mb-1.5">
          Day {day.index + 1} · {dayName(day.date)} {shortDate(day.date)}
        </p>
        <h2 className="display text-[30px] sm:text-[34px]">{day.theme || "Open day"}</h2>
      </div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
        {w && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Weather</dt>
            <WeatherGlyph w={w} size={16} />
            <dd className="mono">
              {w.temp_min.toFixed(0)}–{w.temp_max.toFixed(0)}°C <span className={wet ? "font-semibold text-rain" : "text-muted"}>· {w.precip_prob}% rain</span>
            </dd>
          </div>
        )}
        <Stat label="Stops" value={`${day.items.length} ${day.items.length === 1 ? "stop" : "stops"}`} />
        {span && <Stat label="Hours" value={span} />}
        {travel > 0 && <Stat label="Travel" value={`${duration(travel)} travel`} />}
        <Stat label="Spend" value={`${inr(cost)}`} strong />
      </dl>
      {wet && (
        <div className="relative overflow-hidden rounded-[var(--radius-box)] bg-rain-soft px-3.5 py-2.5">
          <RainDrops />
          <p className="relative flex items-start gap-2 text-[13px] text-rain">
            <Umbrella size={15} className="mt-px shrink-0" />
            <span>
              <strong className="font-semibold">{conditionLabel(w)} likely ({w?.precip_prob}%).</strong> Indoor stops are preferred where they fit.
            </span>
          </p>
        </div>
      )}
    </header>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center">
      <dt className="sr-only">{label}</dt>
      <dd className={`mono ${strong ? "font-semibold text-ink" : "text-muted"}`}>{value}</dd>
    </div>
  );
}

/* The rail column: a vertical route line with a node per stop. `cap` trims the line above the first or below the last node. */
const RAIL = "relative flex justify-center";
const COLS = "grid grid-cols-[3rem_2rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[3.5rem_2.25rem_minmax(0,1fr)] sm:gap-x-3";

function RailLine({ dashed, from = "0", to = "0" }: { dashed?: boolean; from?: string; to?: string }) {
  return <span aria-hidden className={`absolute left-1/2 -translate-x-1/2 ${dashed ? "border-l border-dashed border-line-strong" : "w-px bg-line-strong"}`} style={{ top: from, bottom: to }} />;
}

function Node({ n, indoor, state }: { n: number; indoor: boolean; state: "idle" | "hot" | Flag }) {
  const tone =
    state === "hot"
      ? "border-sea bg-sea text-sea-ink"
      : state === "added"
        ? "border-good bg-good-soft text-good"
        : state === "moved"
          ? "border-warn bg-warn-soft text-warn"
          : state === "retimed"
            ? "border-rain bg-rain-soft text-rain"
            : "border-sea/70 bg-surface text-ink";
  return (
    <span
      aria-hidden
      className={`relative z-10 grid h-7 w-7 place-items-center border-[1.5px] text-[12px] font-semibold transition-colors duration-150 mono ${indoor ? "rounded-[7px]" : "rounded-full"} ${tone}`}
    >
      {n}
    </span>
  );
}

function Leg({ it, first }: { it: Item; first: boolean }) {
  if (!it.travel_from_prev) return null;
  return (
    <div className={COLS}>
      <span />
      <span className={RAIL}>
        <RailLine dashed from={first ? "6px" : "0"} />
      </span>
      <div className="py-2.5 pl-1">
        <LegText leg={it.travel_from_prev} first={first} />
      </div>
    </div>
  );
}

function Gap({ minutes }: { minutes: number }) {
  return (
    <div className={COLS}>
      <span />
      <span className={RAIL}>
        <RailLine dashed />
      </span>
      <p className="flex items-center gap-2 py-1.5 pl-1 text-[12px] text-faint">
        <span className="h-px w-5 bg-line-strong" aria-hidden />
        <span className="mono">{freeTimeText(minutes)}</span>
      </p>
    </div>
  );
}

function Stop({ it, n, last, prev, p }: { it: Item; n: number; last: boolean; prev: Item | null; p: TimelineProps }) {
  const Icon = categoryIcon(it.category);
  const flag = p.flags?.get(it.id);
  const hot = p.hoverId === it.id;
  const fb = p.feedback[it.id];
  const gap = prev ? it.start - (prev.end + (it.travel_from_prev?.minutes ?? 0)) : 0;
  // added and moved stops are the substance of a proposal; a retime is minor, so it gets the badge only
  const rowTone = flag === "added" ? "bg-good-soft/60" : flag === "moved" ? "bg-warn-soft/50" : hot ? "bg-surface" : "";
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
      transition={{ ...spring, opacity: { duration: 0.3 } }}
      onMouseEnter={() => p.onHover(it.id)}
      onMouseLeave={() => p.onHover(null)}
      onFocus={() => p.onHover(it.id)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onHover(null);
      }}
      className="list-none"
    >
      <Leg it={it} first={!prev} />
      {gap >= 75 && <Gap minutes={gap} />}
      <article aria-label={`${hhmm(it.start)} ${it.name}`} className={COLS}>
        <div className="pt-[15px] text-right">
          <p className="mono text-[14px] font-semibold leading-none">{hhmm(it.start)}</p>
          <p className="mono mt-1.5 text-[12px] leading-none text-faint">{hhmm(it.end)}</p>
        </div>
        <div className={RAIL}>
          <RailLine from={prev || it.travel_from_prev ? "0" : "22px"} to={last ? "calc(100% - 22px)" : "0"} />
          <span className="pt-2">
            <Node n={n} indoor={it.indoor} state={flag ?? (hot ? "hot" : "idle")} />
          </span>
        </div>
        <div className={`group relative -mx-1 rounded-[var(--radius-box)] px-3 pb-3 pt-2.5 transition-colors duration-150 ${rowTone} ${p.flash?.has(it.id) ? "glow-once" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-[16px] font-semibold leading-snug tracking-[-0.005em]">{it.name}</h3>
                {flag && <KindBadge kind={flag} />}
                {it.locked && (
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-sea">
                    <Lock size={11} /> Locked
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
                <Icon size={13} className="text-faint" aria-hidden />
                <span>{titleCase(it.category)}</span>
                <span aria-hidden>·</span>
                <span>{it.indoor ? "Indoors" : "Outdoors"}</span>
                {it.tags.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{it.tags.slice(0, 3).join(", ")}</span>
                  </>
                )}
              </p>
            </div>
            <p className="mono shrink-0 pt-0.5 text-[14px] font-medium">{it.est_cost_inr === 0 ? <span className="text-good">Free</span> : inr(it.est_cost_inr)}</p>
          </div>
          {it.why && <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-muted">{it.why}</p>}
          {it.warnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {it.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-[13px] text-warn">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" /> {w}
                </li>
              ))}
            </ul>
          )}
          <div className="-mb-1 -ml-1.5 mt-2 flex min-h-8 flex-wrap items-center gap-x-1 gap-y-1">
            <Citations ids={it.source_ids} sources={p.itinerary.sources} />
            {!p.readOnly && (
              <div className="ml-auto flex items-center gap-0.5 transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                <IconBtn label="More like this" active={fb === "up"} onClick={() => p.onFeedback?.(it, "up")}>
                  <ThumbsUp size={15} />
                </IconBtn>
                <IconBtn label="Less like this" active={fb === "down"} tone="signal" onClick={() => p.onFeedback?.(it, "down")}>
                  <ThumbsDown size={15} />
                </IconBtn>
                <IconBtn label={it.locked ? "Unlock this stop" : "Lock this stop so re-plans keep it"} active={it.locked} onClick={() => p.onLock?.(it)}>
                  <Lock size={15} />
                </IconBtn>
                <IconBtn label="It's closed or sold out: re-plan around it" tone="signal" onClick={() => p.onClosed?.(it)}>
                  <Ban size={15} />
                </IconBtn>
              </div>
            )}
          </div>
        </div>
      </article>
    </motion.li>
  );
}

function IconBtn({ children, label, onClick, active, tone = "sea" }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean; tone?: "sea" | "signal" }) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      whileTap={{ scale: 0.86 }}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${active ? (tone === "signal" ? "bg-signal-soft text-signal" : "bg-sea-soft text-sea") : "text-faint hover:bg-surface-2 hover:text-ink"}`}
    >
      {children}
    </motion.button>
  );
}

export function Timeline(p: TimelineProps) {
  const day = p.itinerary.days.find((d) => d.index === p.dayIndex);
  if (!day) return null;
  const removedHere = (p.removed ?? []).filter((r) => r.day_from === day.index);
  return (
    <div className="flex flex-col gap-6">
      <DayHeader day={day} />
      {day.items.length > 0 ? (
        <ol className="m-0 flex flex-col p-0" aria-label={`Stops on day ${day.index + 1}`}>
          <AnimatePresence initial={false} mode="popLayout">
            {day.items.map((it, i) => (
              <Stop key={it.id} it={it} n={i + 1} last={i === day.items.length - 1} prev={i > 0 ? day.items[i - 1] : null} p={p} />
            ))}
          </AnimatePresence>
        </ol>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-[var(--radius-box)] border border-dashed border-line-strong px-5 py-6">
          <p className="font-semibold">A free day</p>
          <p className="max-w-md text-[14px] text-muted">Nothing is planned yet, usually because the budget or the pace left no room. Ask for something to fill it, or keep it open for wandering.</p>
          {p.emptyAction}
        </div>
      )}
      <AnimatePresence>
        {removedHere.map((r) => (
          <motion.div key={r.place_id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [...ease] }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-box)] border border-dashed border-signal/50 px-4 py-2.5">
              <KindBadge kind="removed" />
              <span className="text-[14px] text-muted line-through decoration-signal/60">{r.name}</span>
              <span className="ml-auto text-[12px] text-muted">{r.detail}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {day.tip && (
        <aside className="flex gap-3 border-t border-line pt-5">
          <Lightbulb size={17} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <p className="label mb-1">Local tip</p>
            <p className="max-w-[66ch] text-[14px] leading-relaxed">{day.tip}</p>
            <div className="-ml-1.5 mt-1.5">
              <Citations ids={day.tip_source_ids} sources={p.itinerary.sources} />
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
