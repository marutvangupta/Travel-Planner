import { AnimatePresence, motion } from "framer-motion";
import { Bike, Car, Footprints, Lightbulb, Lock, Minimize2, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dayName, duration, hhmm, inr, shortDate, titleCase } from "../../lib/format";
import { ease } from "../../lib/motion";
import type { Day, Item, Itinerary } from "../../lib/types";
import { ChartMap, DAY_COLORS } from "./ChartMap";

const MODE = { walk: Footprints, taxi: Car, transit: Bike } as const;

export function MapExpanded({
  open,
  onClose,
  itinerary,
  day,
  all,
  onDay,
  onAll,
  hoverId,
  onHover,
  highlight,
}: {
  open: boolean;
  onClose: () => void;
  itinerary: Itinerary;
  day: number;
  all: boolean;
  onDay: (i: number) => void;
  onAll: () => void;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  highlight?: Set<string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const days = itinerary.days;
  const shown: Day[] = all ? days : days.filter((d) => d.index === day);
  const items = shown.flatMap((d) => d.items);
  const sel = items.find((i) => i.id === selected) ?? null;
  const cur = days.find((d) => d.index === day) ?? days[0];

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => setSelected(null), [day, all]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/45 p-0 backdrop-blur-sm sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Expanded map and day details"
            className="card flex h-full w-full max-w-[1500px] flex-col overflow-hidden outline-none sm:rounded-2xl lg:flex-row"
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 12 }}
            transition={{ duration: 0.28, ease: [...ease] }}
          >
            <div className="relative min-h-[320px] flex-1 bg-surface-2">
              <ChartMap
                days={days}
                active={all ? "all" : day}
                base={itinerary.base}
                hoverId={hoverId}
                onHover={onHover}
                highlight={highlight}
                selectedId={selected}
                onSelect={(id) => setSelected((s) => (s === id ? null : id))}
                chrome={
                  <button type="button" onClick={onClose} aria-label="Close expanded map" className="flex h-8 items-center gap-1.5 rounded-full border border-line bg-raised/85 px-3 text-[12px] font-semibold text-ink shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-raised">
                    <Minimize2 size={14} /> Collapse
                  </button>
                }
              />
            </div>

            <aside className="flex max-h-[48%] min-h-0 w-full shrink-0 flex-col border-t border-line lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                  <p className="mono text-[11px] uppercase tracking-wider text-muted">
                    {all ? "All days" : `Day ${cur.index + 1} · ${dayName(cur.date)} ${shortDate(cur.date)}`}
                  </p>
                  <h2 className="truncate font-display text-xl font-semibold leading-tight text-ink">{all ? itinerary.destination.split(",")[0] : cur.theme || "Open day"}</h2>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                  <X size={16} />
                </button>
              </div>

              <div role="radiogroup" aria-label="Map shows" className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 text-[12px]">
                {days.map((d) => {
                  const on = !all && d.index === day;
                  return (
                    <button key={d.index} type="button" role="radio" aria-checked={on} onClick={() => onDay(d.index)} className={`mono h-7 shrink-0 rounded-md px-2.5 font-medium transition-colors ${on ? "bg-sea text-sea-ink" : "bg-surface-2 text-muted hover:text-ink"}`}>
                      Day {d.index + 1}
                    </button>
                  );
                })}
                <button type="button" role="radio" aria-checked={all} onClick={onAll} className={`h-7 shrink-0 rounded-md px-2.5 font-medium transition-colors ${all ? "bg-sea text-sea-ink" : "bg-surface-2 text-muted hover:text-ink"}`}>
                  All
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {!all && (
                  <div className="grid grid-cols-4 gap-px border-b border-line bg-line text-center">
                    {[
                      ["Stops", String(cur.items.length)],
                      ["Spend", inr(cur.items.reduce((s, i) => s + i.est_cost_inr + (i.travel_from_prev?.cost_inr ?? 0), 0))],
                      ["Temp", cur.weather ? `${Math.round(cur.weather.temp_min)}–${Math.round(cur.weather.temp_max)}°C` : "—"],
                      ["Rain", cur.weather ? `${cur.weather.precip_prob}%` : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="bg-surface px-2 py-2.5">
                        <p className="mono text-[10px] uppercase tracking-wider text-muted">{k}</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-ink">{v}</p>
                      </div>
                    ))}
                  </div>
                )}

                {items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing planned for this view yet.</p>
                ) : (
                  <ol className="divide-y divide-line">
                    {shown.flatMap((d) =>
                      d.items.map((it, i) => (
                        <StopRow key={it.id} it={it} n={i + 1} color={all ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)"} dayLabel={all ? `Day ${d.index + 1}` : null} active={selected === it.id} hover={hoverId === it.id} flagged={!!highlight?.has(it.id)} onHover={onHover} onToggle={() => setSelected((s) => (s === it.id ? null : it.id))} detail={sel?.id === it.id ? sel : null} />
                      )),
                    )}
                  </ol>
                )}

                {!all && cur.tip && (
                  <p className="m-3 flex gap-2 rounded-lg bg-sea-soft px-3 py-2.5 text-[12.5px] leading-snug text-ink">
                    <Lightbulb size={15} className="mt-0.5 shrink-0 text-sea" aria-hidden /> {cur.tip}
                  </p>
                )}
              </div>
            </aside>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StopRow({ it, n, color, dayLabel, active, hover, flagged, onHover, onToggle, detail }: { it: Item; n: number; color: string; dayLabel: string | null; active: boolean; hover: boolean; flagged: boolean; onHover: (id: string | null) => void; onToggle: () => void; detail: Item | null }) {
  const leg = it.travel_from_prev;
  const Mode = leg ? MODE[leg.mode] : null;
  return (
    <li onMouseEnter={() => onHover(it.id)} onMouseLeave={() => onHover(null)} className={`transition-colors ${active ? "bg-sea-soft" : hover ? "bg-surface-2" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={active} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={`mono mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-[11.5px] font-bold text-sea-ink ${it.indoor ? "rounded-[7px]" : "rounded-full"}`} style={{ background: color }}>
          {n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-semibold text-ink">{it.name}</span>
            {it.locked && <Lock size={12} className="shrink-0 text-muted" aria-label="Locked" />}
            {(flagged || it.warnings.length > 0) && <TriangleAlert size={13} className="shrink-0 text-signal" aria-label="Has a warning" />}
          </span>
          <span className="mono mt-0.5 block text-[11.5px] text-muted">
            {dayLabel && `${dayLabel} · `}
            {hhmm(it.start)}–{hhmm(it.end)} · {titleCase(it.category)} · {it.indoor ? "indoor" : "outdoor"}
          </span>
        </span>
        <span className="mono shrink-0 text-[12px] font-medium text-ink">{it.est_cost_inr ? inr(it.est_cost_inr) : "Free"}</span>
      </button>
      {detail && (
        <div className="space-y-2 px-4 pb-3.5 pl-[3.25rem] text-[12.5px] leading-snug text-muted">
          {it.why && <p>{it.why}</p>}
          {leg && Mode && (
            <p className="flex items-center gap-1.5 text-ink">
              <Mode size={13} aria-hidden /> {titleCase(leg.mode)} from previous stop · {duration(leg.minutes)} · {(leg.meters / 1000).toFixed(1)} km · {leg.cost_inr ? inr(leg.cost_inr) : "free"}
            </p>
          )}
          {it.tags.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {it.tags.slice(0, 6).map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
            </p>
          )}
          {it.warnings.map((w) => (
            <p key={w} className="flex gap-1.5 text-signal">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
