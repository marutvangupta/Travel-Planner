import { motion } from "framer-motion";
import { useRef } from "react";
import { dayName, shortDate } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { Day } from "../../lib/types";
import { WeatherGlyph, isWet } from "./parts";

/** Day strip. Arrow keys move between days (tabs pattern); a signal dot marks days a previewed change touches. */
export function DayTabs({ days, active, onChange, changed, panelId }: { days: Day[]; active: number; onChange: (i: number) => void; changed?: Set<number>; panelId?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: days.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const n = Math.max(0, Math.min(days.length - 1, map[e.key]));
    onChange(days[n].index);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label="Days" className="no-scrollbar fade-x -mb-px flex gap-1 overflow-x-auto pr-6">
      {days.map((d, i) => {
        const on = d.index === active;
        const wet = isWet(d.weather);
        return (
          <button
            key={d.index}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`day-tab-${d.index}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            type="button"
            onClick={() => onChange(d.index)}
            onKeyDown={(e) => onKey(e, i)}
            className={`group relative shrink-0 rounded-t-lg px-3 pb-3 pt-2 text-left transition-colors ${on ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-semibold">Day {d.index + 1}</span>
              <WeatherGlyph w={d.weather} size={14} />
              {changed?.has(d.index) && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="h-1.5 w-1.5 rounded-full bg-signal" aria-label="changed in this proposal" />}
            </span>
            <span className="mono mt-0.5 block text-[12px] text-muted">
              {dayName(d.date)} {shortDate(d.date)}
              {wet && <span className="ml-1.5 font-semibold text-rain">{d.weather?.precip_prob}%</span>}
            </span>
            {on && <motion.span layoutId="day-tab" transition={spring} className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-sea" />}
          </button>
        );
      })}
    </div>
  );
}
