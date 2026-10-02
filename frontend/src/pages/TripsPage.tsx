import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Plus, RotateCw, Trash2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, CountUp, Perforation } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDocumentTitle } from "../lib/a11y";
import { api } from "../lib/api";
import { cityName, daysBetween, dateRange, inr } from "../lib/format";
import { ease, pageVariants, rise, spring, stagger } from "../lib/motion";
import type { TripSummary } from "../lib/types";

function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function MiniRoute({ seed }: { seed: string }) {
  const { d, pts } = useMemo(() => {
    const r = seeded(seed);
    const pts = Array.from({ length: 5 }, (_, i) => [14 + i * 21 + r() * 10, 12 + r() * 40] as [number, number]);
    const d = pts.map((p, i) => (i ? `S ${(p[0] - 10).toFixed(1)} ${(p[1] + (r() - 0.5) * 20).toFixed(1)}, ${p[0].toFixed(1)} ${p[1].toFixed(1)}` : `M ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)).join(" ");
    return { d, pts };
  }, [seed]);
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-28 shrink-0 overflow-visible" aria-hidden>
      <motion.path d={d} fill="none" stroke="var(--sea)" strokeWidth="2" strokeDasharray="1 5" strokeLinecap="round" variants={{ rest: { pathLength: 0.45, opacity: 0.6 }, hover: { pathLength: 1, opacity: 1 } }} transition={{ duration: 0.9, ease: [...ease] }} />
      {pts.map((p, i) => (
        <motion.circle key={i} cx={p[0]} cy={p[1]} r="3.2" fill="var(--surface)" stroke="var(--sea)" strokeWidth="1.6" variants={{ rest: { scale: 0.7, opacity: 0.5 }, hover: { scale: 1, opacity: 1 } }} transition={{ ...spring, delay: i * 0.05 }} />
      ))}
    </svg>
  );
}

function TripCard({ t, onDelete }: { t: TripSummary; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const pct = Math.min(100, (t.cost_inr / t.budget_inr) * 100);
  const over = t.cost_inr > t.budget_inr;
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirm]);
  return (
    <motion.li variants={rise} layout exit={{ opacity: 0, scale: 0.96 }} className="list-none">
      <motion.div
        initial="rest"
        whileHover="hover"
        animate="rest"
        className="card group relative overflow-hidden transition-[box-shadow,border-color,transform] duration-300 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
      >
        <Link to={`/trips/${t.id}`} className="block rounded-card focus-visible:outline-offset-[3px]" aria-label={`Open ${cityName(t.destination)}, ${dateRange(t.start_date, t.end_date)}`}>
          <div className="relative p-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label mb-2">{dateRange(t.start_date, t.end_date)}</p>
                <h3 className="display truncate text-[44px]">{cityName(t.destination)}</h3>
                <p className="mono mt-2 text-xs text-muted">
                  {daysBetween(t.start_date, t.end_date)} days · {t.stops} stops
                </p>
              </div>
              <MiniRoute seed={t.id} />
            </div>
            {t.open_events > 0 && (
              <span className="mono absolute right-5 top-4 inline-flex items-center gap-1.5 rounded-full bg-signal-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-signal">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="ping absolute inline-flex h-full w-full rounded-full bg-signal" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-signal" />
                </span>
                {t.open_events} update{t.open_events > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <Perforation />
          <div className="p-5 pt-4">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="mono font-medium">
                <CountUp value={t.cost_inr} format={inr} />
              </span>
              <span className={`mono text-xs ${over ? "text-bad" : "text-muted"}`}>
                {over ? "over " : "of "}
                {inr(t.budget_inr)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <motion.div className={`h-full origin-left rounded-full ${over ? "bg-bad" : "bg-sea"}`} initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={{ duration: 1, ease: [...ease], delay: 0.2 }} />
            </div>
            <div className="mt-4 flex min-h-8 flex-wrap items-center gap-1.5 pr-20">
              {t.interests.slice(0, 4).map((i) => (
                <span key={i} className="rounded-full border border-line px-2 py-0.5 text-[11px] capitalize text-muted">
                  {i}
                </span>
              ))}
            </div>
          </div>
        </Link>
        <ArrowUpRight size={18} className="pointer-events-none absolute bottom-[26px] right-5 text-faint transition-[color,transform] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sea" aria-hidden />
        <button
          type="button"
          onClick={() => (confirm ? onDelete(t.id) : setConfirm(true))}
          aria-label={confirm ? `Confirm: delete ${cityName(t.destination)}` : `Delete ${cityName(t.destination)}`}
          className={`absolute bottom-[19px] right-12 grid h-8 items-center rounded-lg px-2 text-xs font-semibold transition-[opacity,background-color,color] ${
            confirm ? "bg-bad text-white opacity-100" : "text-faint opacity-100 hover:bg-bad-soft hover:text-bad focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
          }`}
        >
          {confirm ? "Delete?" : <Trash2 size={15} />}
        </button>
      </motion.div>
    </motion.li>
  );
}

function NewTripTile() {
  return (
    <motion.li variants={rise} className="list-none">
      <Link
        to="/trips/new"
        className="group grid h-full min-h-[236px] place-items-center rounded-card border border-dashed border-line-strong bg-surface/40 p-6 text-center transition-[background-color,border-color] duration-200 hover:border-sea/60 hover:bg-sea-soft/30"
      >
        <span>
          <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full border border-line bg-surface text-sea shadow-xs transition-transform duration-300 ease-out group-hover:rotate-90">
            <Plus size={20} />
          </span>
          <span className="block font-semibold">Plan another trip</span>
          <span className="mt-1 block text-sm text-muted">Dates, budget and pace in four short steps</span>
        </span>
      </Link>
    </motion.li>
  );
}

const CITY_NOTES: Record<string, { line: string; coord: string }> = {
  jaipur: { line: "Forts, bazaars and rooftop dinners", coord: "26.91°N 75.79°E" },
  goa: { line: "Beaches, spice farms and old Panjim", coord: "15.50°N 73.83°E" },
  tokyo: { line: "Shrines, food halls and late nights", coord: "35.68°N 139.65°E" },
  paris: { line: "Museums, markets and long walks", coord: "48.86°N 2.35°E" },
};

function FirstTrip({ destinations, onPlan }: { destinations: string[]; onPlan: () => void }) {
  return (
    <motion.section variants={stagger(0.06)} initial="hidden" animate="show" className="card overflow-hidden rounded-panel" aria-labelledby="first-trip">
      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <motion.div variants={rise} className="flex flex-col justify-center gap-4 p-7 sm:p-10">
          <p className="label">Your first trip</p>
          <h2 id="first-trip" className="display-wide text-[30px] sm:text-[34px]">
            Pick a city and get a plan in under a minute
          </h2>
          <p className="max-w-md text-muted">
            Tell Waypoint your dates, budget and what you enjoy. It builds a day-by-day itinerary from real places and re-plans only the parts that change.
          </p>
          <div className="mt-2">
            <Button size="lg" icon={<Plus size={18} />} onClick={onPlan}>
              Plan a trip
            </Button>
          </div>
        </motion.div>
        <div className="border-t border-line bg-surface-2/60 p-4 sm:p-6 lg:border-l lg:border-t-0">
          <p className="label mb-3 px-1">Or start from a demo city</p>
          <ul className="m-0 grid gap-2.5 p-0 sm:grid-cols-2">
            {destinations.map((d) => {
              const note = CITY_NOTES[cityName(d).toLowerCase()];
              return (
                <motion.li key={d} variants={rise} className="list-none">
                  <Link
                    to={`/trips/new?to=${encodeURIComponent(d)}`}
                    className="group flex h-full flex-col justify-between gap-6 rounded-[14px] border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-sea/50 hover:shadow-card"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="mono text-[10px] uppercase tracking-[0.08em] text-faint">{note?.coord ?? d.split(",")[1]?.trim()}</span>
                      <ArrowRight size={16} className="shrink-0 text-faint transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-sea" aria-hidden />
                    </span>
                    <span>
                      <span className="display block text-[34px]">{cityName(d)}</span>
                      <span className="mt-1 block text-[13px] text-muted">{note?.line ?? d}</span>
                    </span>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </div>
    </motion.section>
  );
}

function TripsSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="card overflow-hidden" style={{ opacity: 1 - i * 0.22 }}>
          <div className="p-5">
            <div className="skeleton mb-3 h-3 w-28" />
            <div className="skeleton h-10 w-40" />
            <div className="skeleton mt-3 h-3 w-24" />
          </div>
          <Perforation />
          <div className="p-5">
            <div className="skeleton mb-3 h-3 w-full" />
            <div className="skeleton h-1.5 w-full" />
            <div className="mt-4 flex gap-1.5">
              <div className="skeleton h-5 w-14 rounded-full" />
              <div className="skeleton h-5 w-12 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TripsPage() {
  const { user, meta } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useDocumentTitle("Trips");

  const load = useCallback(async () => {
    try {
      setTrips(await api<TripSummary[]>("/trips"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your trips.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const retry = async () => {
    setRetrying(true);
    await load();
    setRetrying(false);
  };

  const remove = async (id: string) => {
    try {
      await api(`/trips/${id}`, { method: "DELETE" });
      setTrips((t) => t?.filter((x) => x.id !== id) ?? null);
      toast("Trip deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  };

  const first = user?.name.split(" ")[0];
  const count = trips?.length ?? 0;
  const destinations = meta?.destinations ?? ["Jaipur, India", "Goa, India", "Tokyo, Japan", "Paris, France"];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-5 sm:mb-10">
          <div>
            <p className="label mb-3">{trips && count > 0 ? `${count} trip${count > 1 ? "s" : ""} planned` : "Your trips"}</p>
            <h1 className="display text-title">Where to next{first ? `, ${first}` : ""}?</h1>
          </div>
          {trips && count > 0 && (
            <Button size="lg" onClick={() => nav("/trips/new")} icon={<Plus size={18} />}>
              Plan a new trip
            </Button>
          )}
        </div>

        {error && !trips ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card flex max-w-xl flex-col items-start gap-4 rounded-panel p-7" role="alert">
            <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-bad-soft text-bad">
              <WifiOff size={20} />
            </span>
            <div>
              <p className="display-wide text-2xl">Your trips didn't load</p>
              <p className="mt-1.5 text-muted">{error}</p>
            </div>
            <Button variant="ghost" onClick={retry} loading={retrying} icon={<RotateCw size={15} />}>
              Try again
            </Button>
          </motion.div>
        ) : trips === null ? (
          <TripsSkeleton />
        ) : trips.length === 0 ? (
          <FirstTrip destinations={destinations} onPlan={() => nav("/trips/new")} />
        ) : (
          <motion.ul variants={stagger(0.07)} initial="hidden" animate="show" className="m-0 grid gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <TripCard key={t.id} t={t} onDelete={remove} />
            ))}
            <NewTripTile />
          </motion.ul>
        )}
      </div>
    </motion.div>
  );
}
