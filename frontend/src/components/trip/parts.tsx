import { AnimatePresence, motion } from "framer-motion";
import {
  Binoculars, BookMarked, Car, Castle, Church, Cloud, CloudLightning, CloudRain, Coffee, Drama, ExternalLink, Footprints, Landmark, Library,
  MapPin, Music, Palette, Ship, Sparkles, Store, Sun, Thermometer, TrafficCone, TrainFront, Trees, Utensils, Waves, Wine, type LucideIcon,
} from "lucide-react";
import { useId } from "react";
import { inr } from "../../lib/format";
import { spring } from "../../lib/motion";
import type { DayWeather, Source, Totals, TravelLeg as Leg } from "../../lib/types";
import { CountUp, usePopover } from "../ui";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  fort: Castle, palace: Castle, monument: Landmark, observatory: Binoculars, viewpoint: Binoculars, market: Store, museum: Library,
  gallery: Palette, workshop: Palette, temple: Church, church: Church, shrine: Church, park: Trees, beach: Waves, waterfall: Waves,
  restaurant: Utensils, cafe: Coffee, bar: Wine, nightlife: Music, show: Drama, cruise: Ship, stepwell: Landmark, farm: Trees,
  spa: Sparkles, neighbourhood: MapPin, district: MapPin, aquarium: Waves, attraction: MapPin,
};
export const categoryIcon = (c: string): LucideIcon => CATEGORY_ICON[c] ?? MapPin;

export const isWet = (w: DayWeather | null | undefined, threshold = 60) => !!w && w.precip_prob >= threshold;

const CONDITION_LABEL: Record<DayWeather["condition"], string> = { clear: "Clear", cloudy: "Cloudy", rain: "Rain", storm: "Storms", hot: "Hot" };
export const conditionLabel = (w: DayWeather | null) => (w ? CONDITION_LABEL[w.condition] : "No forecast");

export function WeatherGlyph({ w, size = 16 }: { w: DayWeather | null; size?: number }) {
  const label = conditionLabel(w);
  if (!w) return <Cloud size={size} className="text-faint" aria-label={label} />;
  if (w.condition === "storm") return <CloudLightning size={size} className="text-rain" aria-label={label} />;
  if (w.condition === "rain") return <CloudRain size={size} className="text-rain" aria-label={label} />;
  if (w.condition === "hot") return <Thermometer size={size} className="text-signal" aria-label={label} />;
  if (w.condition === "cloudy") return <Cloud size={size} className="text-muted" aria-label={label} />;
  return <Sun size={size} className="text-warn" aria-label={label} />;
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

/** Source chip: each recommendation can be traced to where the data came from. */
export function Citations({ ids, sources, align = "left" }: { ids: string[]; sources: Record<string, Source>; align?: "left" | "right" }) {
  const { open, setOpen, ref, trigger } = usePopover();
  const uid = useId();
  const known = ids.map((i) => sources[i]).filter(Boolean);
  if (!known.length) return null;
  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={uid}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium transition-colors ${open ? "bg-sea-soft text-sea" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
      >
        <BookMarked size={12} />
        {known.length} {known.length === 1 ? "source" : "sources"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={uid}
            role="dialog"
            aria-label="Sources"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.14 }}
            className={`pop absolute z-30 mt-1.5 w-72 p-3 ${align === "right" ? "right-0" : "left-0"}`}
          >
            <p className="label mb-2">Where this came from</p>
            <ul className="flex flex-col gap-2.5">
              {known.map((s) => (
                <li key={s.id} className="text-[13px] leading-snug">
                  <span className="block font-medium">{s.title || s.id}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    {PROVIDER_LABEL[s.provider] ?? s.provider}
                    {s.url && (
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-sea hover:underline">
                        Open <ExternalLink size={10} />
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
const LEG_LABEL = { walk: "walk", taxi: "taxi", transit: "metro or bus" } as const;

/** One line describing the hop between two stops; sits beside the dashed part of the route rail. */
export function LegText({ leg, first }: { leg: Leg; first?: boolean }) {
  const Icon = LEG_ICON[leg.mode] ?? TrafficCone;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
      <Icon size={13} className="text-faint" aria-hidden />
      <span className="mono">{leg.minutes} min</span>
      <span>
        {LEG_LABEL[leg.mode] ?? leg.mode}
        {first ? " from the centre" : ""}
      </span>
      {leg.cost_inr > 0 && <span className="mono text-faint">· {inr(leg.cost_inr)}</span>}
    </span>
  );
}

export const freeTimeText = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}h ` : ""}${m ? `${m}m` : ""}`.trim() + " free";
};

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
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <p className="flex items-baseline gap-2">
          <span className="mono text-[22px] font-semibold leading-none tracking-tight">
            <CountUp value={totals.cost_inr} format={inr} />
          </span>
          <span className="mono text-[13px] text-muted">of {inr(totals.budget_inr)}</span>
        </p>
        <p className={`mono text-[13px] font-medium ${over ? "text-bad" : "text-good"}`}>
          <CountUp value={Math.abs(totals.remaining_inr)} format={inr} /> {over ? "over" : "left"}
        </p>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${inr(totals.cost_inr)} of a ${inr(totals.budget_inr)} budget`}>
        <div className="flex h-full gap-px" style={{ width: `${(Math.min(totals.cost_inr, scale) / scale) * 100}%` }}>
          {SEG.map((s, i) => (
            <motion.div
              key={s.key}
              initial={{ width: 0 }}
              animate={{ width: `${totals.cost_inr ? (totals[s.key] / totals.cost_inr) * 100 : 0}%` }}
              transition={{ ...spring, delay: i * 0.05 }}
              style={{ background: s.color }}
              className="h-full"
            />
          ))}
        </div>
        {over && <span className="absolute inset-y-0 w-0.5 bg-bad" style={{ left: `${(totals.budget_inr / scale) * 100}%` }} />}
      </div>
      {!compact && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {SEG.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
              {s.label} <span className="mono text-ink">{inr(totals[s.key])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_STYLE = {
  added: "bg-good-soft text-good",
  removed: "bg-signal-soft text-signal",
  moved: "bg-warn-soft text-warn",
  retimed: "bg-rain-soft text-rain",
} as const;

export function KindBadge({ kind }: { kind: keyof typeof KIND_STYLE }) {
  return <span className={`inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-semibold capitalize ${KIND_STYLE[kind]}`}>{kind}</span>;
}
