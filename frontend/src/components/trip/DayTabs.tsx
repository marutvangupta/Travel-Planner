import { motion } from "framer-motion";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { rovingKeys } from "../../lib/a11y";
import { dayName, shortDate } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { Day } from "../../lib/types";
import { WeatherGlyph } from "./parts";

export function DayTabs({ days, active, onChange, changed }: { days: Day[]; active: number; onChange: (i: number) => void; changed?: Set<number> }) {
  const ref = useRef<HTMLDivElement>(null);
  // keep the selected day visible when the strip scrolls (long trips, phones)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Days"
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => rovingKeys(e, days.map((d) => d.index), active, onChange)}
      className="no-scrollbar fade-x -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1"
    >
      {days.map((d) => {
        const on = d.index === active;
        const wet = !!d.weather && d.weather.precip_prob >= 60;
        const isChanged = changed?.has(d.index);
        return (
          <button
            key={d.index}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            type="button"
            onClick={() => onChange(d.index)}
            aria-label={`Day ${d.index + 1}, ${dayName(d.date)} ${shortDate(d.date)}${wet ? `, ${d.weather?.precip_prob}% chance of rain` : ""}${isChanged ? ", has proposed changes" : ""}`}
            className={`relative min-w-[100px] shrink-0 rounded-xl border px-3.5 py-2.5 text-left transition-[border-color,background-color,box-shadow] ${
              on ? "border-transparent" : "border-line bg-surface shadow-xs hover:border-line-strong"
            }`}
          >
            {on && <motion.span layoutId="day-tab" transition={spring} className="absolute inset-0 rounded-xl border border-sea/70 bg-sea-soft shadow-[0_0_0_3px_color-mix(in_srgb,var(--sea)_10%,transparent)]" />}
            <span className="relative flex items-center justify-between gap-2">
              <span className={`display-wide text-[17px] leading-none ${on ? "text-sea" : ""}`}>Day {d.index + 1}</span>
              <WeatherGlyph w={d.weather} size={15} />
            </span>
            <span className="mono relative mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
              <span>
                {dayName(d.date)} {shortDate(d.date)}
              </span>
              {wet && <span className="font-semibold text-rain">{d.weather?.precip_prob}%</span>}
            </span>
            {isChanged && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-signal ring-2 ring-bg" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
