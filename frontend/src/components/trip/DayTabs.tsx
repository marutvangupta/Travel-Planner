import { motion } from "framer-motion";
import { dayName, shortDate } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { Day } from "../../lib/types";
import { WeatherGlyph } from "./parts";

export function DayTabs({ days, active, onChange, changed }: { days: Day[]; active: number; onChange: (i: number) => void; changed?: Set<number> }) {
  return (
    <div role="tablist" aria-label="Days" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {days.map((d) => {
        const on = d.index === active;
        const wet = !!d.weather && d.weather.precip_prob >= 60;
        return (
          <button
            key={d.index}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(d.index)}
            className={`relative min-w-[96px] shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${on ? "border-transparent" : "border-line bg-surface hover:border-faint"}`}
          >
            {on && <motion.span layoutId="day-tab" transition={spring} className="absolute inset-0 rounded-xl border border-sea bg-sea-soft" />}
            <span className="relative flex items-center justify-between gap-2">
              <span className="display-wide text-[17px] leading-none">Day {d.index + 1}</span>
              <WeatherGlyph w={d.weather} size={15} />
            </span>
            <span className="mono relative mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
              <span>
                {dayName(d.date)} {shortDate(d.date)}
              </span>
              {wet && <span className="font-semibold text-rain">{d.weather?.precip_prob}%</span>}
            </span>
            {changed?.has(d.index) && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-signal ring-2 ring-bg" />}
          </button>
        );
      })}
    </div>
  );
}
