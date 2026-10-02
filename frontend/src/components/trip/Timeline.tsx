import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Ban, Lightbulb, Lock, ThumbsDown, ThumbsUp, TriangleAlert, Umbrella, Sun as SunIcon } from "lucide-react";
import { useMemo } from "react";
import { dayName, duration, hhmm, inr, shortDate, titleCase } from "../../lib/format";
import { ease, spring } from "../../lib/motion";
import type { Day, Item, ItemChange, Itinerary } from "../../lib/types";
import { Citations, FreeTime, KindBadge, TravelLeg, WeatherGlyph, categoryIcon } from "./parts";

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
}

const SLOT_LABEL: Record<string, string> = { morning: "Morning", lunch: "Lunch", afternoon: "Afternoon", dinner: "Dinner", evening: "Evening" };

function RainDrops() {
  const drops = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ left: (i * 47) % 100, d: 0.9 + ((i * 13) % 10) / 10, delay: -((i * 7) % 15) / 10 })), []);
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
  const wet = !!w && w.precip_prob >= 60;
  const travel = day.items.reduce((s, i) => s + (i.travel_from_prev?.minutes ?? 0), 0);
  const cost = day.items.reduce((s, i) => s + i.est_cost_inr + (i.travel_from_prev?.cost_inr ?? 0), 0);
  return (
    <div className={`relative overflow-hidden rounded-2xl border p-5 ${wet ? "border-rain/40 bg-rain-soft" : "border-line bg-surface"}`}>
      {wet && <RainDrops />}
      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="label mb-1.5">
            Day {day.index + 1} · {dayName(day.date)} {shortDate(day.date)}
          </p>
          <h2 className="display text-[40px] sm:text-[48px]">{day.theme || "Open day"}</h2>
        </div>
        <div className="flex items-center gap-5 text-sm">
          {w && (
            <div className="flex items-center gap-2.5">
              <WeatherGlyph w={w} size={22} />
              <div className="leading-tight">
                <p className="mono text-[13px] font-medium">
                  {w.temp_min.toFixed(0)}–{w.temp_max.toFixed(0)}°C
                </p>
                <p className={`text-xs ${wet ? "font-semibold text-rain" : "text-muted"}`}>{w.precip_prob}% rain</p>
              </div>
            </div>
          )}
          <div className="hidden leading-tight sm:block">
            <p className="mono text-[13px] font-medium">{day.items.length} stops</p>
            <p className="text-xs text-muted">{duration(travel)} travelling</p>
          </div>
          <div className="leading-tight">
            <p className="mono text-[13px] font-medium">{inr(cost)}</p>
            <p className="text-xs text-muted">today</p>
          </div>
        </div>
      </div>
      {wet && (
        <p className="relative mt-3 flex items-center gap-2 text-[13px] text-rain">
          <Umbrella size={14} /> Rain is likely. Indoor stops are preferred where they fit.
        </p>
      )}
    </div>
  );
}

function StopCard({ it, first, prev, p }: { it: Item; first: boolean; prev: Item | null; p: TimelineProps }) {
  const Icon = categoryIcon(it.category);
  const flag = p.flags?.get(it.id);
  const hot = p.hoverId === it.id;
  const flash = p.flash?.has(it.id);
  const fb = p.feedback[it.id];
  const gap = prev ? it.start - (prev.end + (it.travel_from_prev?.minutes ?? 0)) : 0;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
      transition={{ ...spring, opacity: { duration: 0.35 } }}
      onMouseEnter={() => p.onHover(it.id)}
      onMouseLeave={() => p.onHover(null)}
      className="list-none"
    >
      {!first && <TravelLeg leg={it.travel_from_prev} />}
      {first && it.travel_from_prev && <TravelLeg leg={it.travel_from_prev} first />}
      {gap >= 75 && <FreeTime minutes={gap} />}
      <div className="grid grid-cols-[3.4rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-3">
        <div className="pt-4 text-right">
          <p className="mono text-[15px] font-semibold leading-none sm:text-[17px]">{hhmm(it.start)}</p>
          <p className="mono mt-1 text-xs text-faint">{hhmm(it.end)}</p>
          <p className="label mt-2 !text-[10px]">{SLOT_LABEL[it.slot]}</p>
        </div>
        <div
          className={`group relative rounded-2xl border bg-surface p-4 transition-[border-color,box-shadow] ${flash ? "glow-once" : ""} ${
            hot ? "border-sea shadow-[var(--shadow-lg)]" : flag === "added" ? "border-good/60" : flag ? "border-warn/50" : "border-line shadow-[var(--shadow)]"
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sea-soft text-sea">
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h3 className="display-wide text-[19px]">{it.name}</h3>
                {flag && <KindBadge kind={flag} />}
                {it.locked && (
                  <span className="mono inline-flex items-center gap-1 rounded-md bg-sea-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sea">
                    <Lock size={10} /> locked
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] text-muted">
                {titleCase(it.category)} · {it.indoor ? "indoors" : "outdoors"}
                {it.tags.length > 0 && <> · {it.tags.slice(0, 3).join(", ")}</>}
              </p>
              {it.why && <p className="mt-2 text-[14px] leading-snug text-ink/90">{it.why}</p>}
              {it.warnings.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {it.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-1.5 text-xs text-warn">
                      <TriangleAlert size={12} className="mt-0.5 shrink-0" /> {w}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="mono text-sm font-medium">{it.est_cost_inr === 0 ? "Free" : inr(it.est_cost_inr)}</span>
                <Citations ids={it.source_ids} sources={p.itinerary.sources} />
                {!p.readOnly && (
                  <div className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                    <IconBtn label="I like this" active={fb === "up"} onClick={() => p.onFeedback?.(it, "up")}>
                      <ThumbsUp size={15} />
                    </IconBtn>
                    <IconBtn label="Not for me" active={fb === "down"} tone="signal" onClick={() => p.onFeedback?.(it, "down")}>
                      <ThumbsDown size={15} />
                    </IconBtn>
                    <IconBtn label={it.locked ? "Unlock" : "Lock so re-plans leave it alone"} active={it.locked} onClick={() => p.onLock?.(it)}>
                      <Lock size={15} />
                    </IconBtn>
                    <IconBtn label="Mark as closed or sold out" tone="signal" onClick={() => p.onClosed?.(it)}>
                      <Ban size={15} />
                    </IconBtn>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function IconBtn({ children, label, onClick, active, tone = "sea" }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean; tone?: "sea" | "signal" }) {
  return (
    <motion.button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      whileTap={{ scale: 0.82 }}
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
    <div className="flex flex-col gap-5">
      <DayHeader day={day} />
      <LayoutGroup id={`day-${day.index}`}>
        <ol className="m-0 flex flex-col p-0">
          <AnimatePresence initial={false} mode="popLayout">
            {day.items.map((it, i) => (
              <StopCard key={it.id} it={it} first={i === 0} prev={i > 0 ? day.items[i - 1] : null} p={p} />
            ))}
          </AnimatePresence>
        </ol>
      </LayoutGroup>
      {day.items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">
          <SunIcon size={16} className="mb-2 text-warn" />
          Nothing planned for this day. Ask the assistant to add something, or raise the budget to fit more stops.
        </div>
      )}
      <AnimatePresence>
        {removedHere.map((r) => (
          <motion.div key={r.place_id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: [...ease] }} className="overflow-hidden">
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-signal/50 bg-signal-soft px-4 py-3">
              <KindBadge kind="removed" />
              <span className="text-sm text-signal line-through decoration-signal/60">{r.name}</span>
              <span className="ml-auto text-xs text-muted">{r.detail}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {day.tip && (
        <motion.aside initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex gap-3 rounded-2xl border border-line bg-surface-2 p-4">
          <Lightbulb size={18} className="mt-0.5 shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="label mb-1">Local tip</p>
            <p className="text-[14px] leading-snug">{day.tip}</p>
            <div className="mt-2.5">
              <Citations ids={day.tip_source_ids} sources={p.itinerary.sources} />
            </div>
          </div>
        </motion.aside>
      )}
    </div>
  );
}
