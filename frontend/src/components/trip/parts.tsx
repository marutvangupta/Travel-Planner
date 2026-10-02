import { AnimatePresence, motion } from "framer-motion";
import {
  Binoculars, Castle, Church, Cloud, CloudLightning, CloudRain, Coffee, Drama, ExternalLink, Footprints, Home, Landmark, Library,
  MapPin, Music, Palette, Ship, Sparkles, Store, Sun, Thermometer, TrafficCone, Trees, TrainFront, Utensils, Waves, Wine, BookMarked, Car, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { inr } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { DayWeather, Source, TravelLeg as Leg, Totals } from "../../lib/types";
import { CountUp } from "../ui";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  fort: Castle, palace: Castle, monument: Landmark, observatory: Binoculars, viewpoint: Binoculars, market: Store, museum: Library,
  gallery: Palette, workshop: Palette, temple: Church, church: Church, shrine: Church, park: Trees, beach: Waves, waterfall: Waves,
  restaurant: Utensils, cafe: Coffee, bar: Wine, nightlife: Music, show: Drama, cruise: Ship, stepwell: Landmark, farm: Trees,
  spa: Sparkles, neighbourhood: MapPin, district: MapPin, aquarium: Waves, attraction: MapPin,
};
export const categoryIcon = (c: string): LucideIcon => CATEGORY_ICON[c] ?? MapPin;

export function WeatherGlyph({ w, size = 16 }: { w: DayWeather | null; size?: number }) {
  if (!w) return <Cloud size={size} className="text-faint" />;
  if (w.condition === "storm") return <CloudLightning size={size} className="text-rain" />;
  if (w.condition === "rain")
    return (
      <motion.span animate={{ y: [0, 1.5, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} className="inline-flex">
        <CloudRain size={size} className="text-rain" />
      </motion.span>
    );
  if (w.condition === "hot") return <Thermometer size={size} className="text-signal" />;
  if (w.condition === "cloudy") return <Cloud size={size} className="text-muted" />;
  return <Sun size={size} className="text-warn" />;
}

const PROVIDER_LABEL: Record<string, string> = {
  "demo-dataset": "Demo place dataset",
  "curated-demo": "Curated demo guide",
  "google-places": "Google Places",
  "google-geocoding": "Google Geocoding",
  "open-meteo": "Open-Meteo forecast",
  "synthetic-climatology": "Synthetic climatology",
  simulated: "Simulated event",
};

/** Source chips: each recommendation can be traced to where the data came from. */
export function Citations({ ids, sources, align = "left" }: { ids: string[]; sources: Record<string, Source>; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();
  const known = ids.map((i) => sources[i]).filter(Boolean);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
      } else if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!known.length) return null;
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={uid}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface-2 px-2 text-[11px] font-medium text-muted transition-colors hover:border-sea hover:text-sea"
      >
        <BookMarked size={11} />
        {known.length} {known.length === 1 ? "source" : "sources"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={uid}
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={spring}
            className={`absolute z-30 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-lg)] ${align === "right" ? "right-0" : "left-0"}`}
          >
            <p className="label mb-2">Where this came from</p>
            <ul className="flex flex-col gap-2.5">
              {known.map((s) => (
                <li key={s.id} className="text-[13px] leading-snug">
                  <span className="block font-medium">{s.title || s.id}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    {PROVIDER_LABEL[s.provider] ?? s.provider}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-sea hover:underline">
                        open <ExternalLink size={10} />
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LEG_ICON = { walk: Footprints, taxi: Car, transit: TrainFront } as const;
const LEG_LABEL = { walk: "Walk", taxi: "Taxi", transit: "Metro or bus" } as const;

export function TravelLeg({ leg, first }: { leg: Leg | null; first?: boolean }) {
  if (!leg) return null;
  const Icon = LEG_ICON[leg.mode] ?? TrafficCone;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 pl-[4.2rem] text-xs text-muted sm:pl-[5.25rem]">
      <span className="h-5 w-px border-l border-dashed border-faint" aria-hidden />
      <Icon size={13} className="text-faint" />
      <span className="mono">{leg.minutes} min</span>
      <span>
        {first ? "from centre · " : ""}
        {LEG_LABEL[leg.mode].toLowerCase()}
      </span>
      {leg.cost_inr > 0 && <span className="mono text-faint">· {inr(leg.cost_inr)}</span>}
    </div>
  );
}

export function FreeTime({ minutes }: { minutes: number }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (
    <div className="flex items-center gap-2 py-1 pl-[4.2rem] text-xs text-faint sm:pl-[5.25rem]">
      <Home size={12} />
      <span className="h-px flex-1 border-t border-dashed border-line" />
      <span className="mono">{h ? `${h}h ` : ""}{m ? `${m}m` : ""} free</span>
    </div>
  );
}

const SEG: { key: keyof Pick<Totals, "activities_inr" | "food_inr" | "transport_inr">; label: string; color: string }[] = [
  { key: "activities_inr", label: "Activities", color: "var(--sea)" },
  { key: "food_inr", label: "Food", color: "var(--warn)" },
  { key: "transport_inr", label: "Transport", color: "var(--rain)" },
];

export function BudgetMeter({ totals, compact }: { totals: Totals; compact?: boolean }) {
  const over = totals.cost_inr > totals.budget_inr;
  const scale = Math.max(totals.budget_inr, totals.cost_inr) || 1;
  return (
    <div className="w-full">
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <p className="label mb-0.5">Estimated spend</p>
          <p className="display-wide text-[28px] leading-none">
            <CountUp value={totals.cost_inr} format={inr} />
            <span className="mono ml-2 text-sm font-normal text-muted">of {inr(totals.budget_inr)}</span>
          </p>
        </div>
        <p className={`mono text-sm ${over ? "text-bad" : "text-good"}`}>
          {over ? "−" : ""}
          <CountUp value={Math.abs(totals.remaining_inr)} format={inr} /> {over ? "over" : "left"}
        </p>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${inr(totals.cost_inr)} of ${inr(totals.budget_inr)} budget`}>
        <div className="flex h-full" style={{ width: `${(Math.min(totals.cost_inr, scale) / scale) * 100}%` }}>
          {SEG.map((s, i) => (
            <motion.div
              key={s.key}
              layout
              initial={{ width: 0 }}
              animate={{ width: `${totals.cost_inr ? (totals[s.key] / totals.cost_inr) * 100 : 0}%` }}
              transition={{ ...spring, delay: i * 0.06 }}
              style={{ background: s.color }}
              className="h-full first:rounded-l-full last:rounded-r-full"
            />
          ))}
        </div>
        {over && <span className="absolute inset-y-0 w-0.5 bg-bad" style={{ left: `${(totals.budget_inr / scale) * 100}%` }} />}
      </div>
      {!compact && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {SEG.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label} <span className="mono text-ink">{inr(totals[s.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KindBadge({ kind }: { kind: "added" | "removed" | "moved" | "retimed" }) {
  const map = {
    added: "bg-good-soft text-good",
    removed: "bg-signal-soft text-signal",
    moved: "bg-warn-soft text-warn",
    retimed: "bg-rain-soft text-rain",
  } as const;
  return <span className={`mono rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${map[kind]}`}>{kind}</span>;
}
