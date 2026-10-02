import { motion } from "framer-motion";
import { ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, CountUp, Empty } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
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
    <svg viewBox="0 0 120 64" className="h-16 w-28 overflow-visible" aria-hidden>
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
    <motion.li variants={rise} layout exit={{ opacity: 0, scale: 0.94 }} className="list-none">
      <motion.div initial="rest" whileHover="hover" animate="rest" whileTap={{ scale: 0.99 }} className="card group relative overflow-hidden">
        <Link to={`/trips/${t.id}`} className="block" aria-label={`Open ${t.destination}`}>
          <div className="relative p-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label mb-2">{dateRange(t.start_date, t.end_date)}</p>
                <h3 className="display text-[44px] sm:text-[52px]">{cityName(t.destination)}</h3>
                <p className="mono mt-2 text-xs text-muted">
                  {daysBetween(t.start_date, t.end_date)} days · {t.stops} stops
                </p>
              </div>
              <MiniRoute seed={t.id} />
            </div>
            {t.open_events > 0 && (
              <span className="mono absolute right-5 top-4 inline-flex items-center gap-1.5 rounded-full bg-signal-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-signal">
                <span className="ping inline-block h-1.5 w-1.5 rounded-full bg-signal" /> {t.open_events} update{t.open_events > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="relative border-t border-dashed border-line">
            <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border border-line bg-bg" />
            <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full border border-line bg-bg" />
          </div>
          <div className="p-5 pt-4">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="mono font-medium">
                <CountUp value={t.cost_inr} format={inr} />
              </span>
              <span className="mono text-xs text-muted">of {inr(t.budget_inr)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div className={`h-full rounded-full ${over ? "bg-bad" : "bg-sea"}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: [...ease], delay: 0.2 }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {t.interests.slice(0, 4).map((i) => (
                <span key={i} className="rounded-full border border-line px-2 py-0.5 text-[11px] capitalize text-muted">
                  {i}
                </span>
              ))}
              <ArrowUpRight size={18} className="ml-auto text-faint transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-sea" />
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => (confirm ? onDelete(t.id) : setConfirm(true))}
          aria-label={confirm ? "Confirm delete" : "Delete trip"}
          className={`absolute bottom-4 right-12 grid h-8 items-center rounded-lg px-2 text-xs font-medium transition-all ${confirm ? "bg-bad text-white opacity-100" : "text-faint opacity-0 hover:bg-surface-2 hover:text-bad group-hover:opacity-100 focus-visible:opacity-100"}`}
        >
          {confirm ? "Delete?" : <Trash2 size={15} />}
        </button>
      </motion.div>
    </motion.li>
  );
}

export default function TripsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  useEffect(() => {
    api<TripSummary[]>("/trips").then(setTrips).catch((e) => { toast(e.message, "error"); setTrips([]); });
  }, [toast]);
  const remove = async (id: string) => {
    try {
      await api(`/trips/${id}`, { method: "DELETE" });
      setTrips((t) => t?.filter((x) => x.id !== id) ?? null);
      toast("Trip deleted");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    }
  };
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto max-w-[1280px] px-4 pb-20 pt-10 sm:px-6">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="label mb-3">Your trips</p>
            <h1 className="display text-[clamp(44px,6vw,76px)]">Where to next{user ? `, ${user.name.split(" ")[0]}` : ""}?</h1>
          </div>
          <Button size="lg" onClick={() => nav("/trips/new")} icon={<Plus size={18} />}>
            Plan a new trip
          </Button>
        </div>

        {trips === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-64" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <Empty title="No trips yet" body="Tell me where you are going, your dates, budget and what you enjoy. I will build a day-by-day plan and keep it flexible if conditions change." action={<Button onClick={() => nav("/trips/new")} icon={<Plus size={16} />}>Plan your first trip</Button>} />
        ) : (
          <motion.ul variants={stagger(0.08)} initial="hidden" animate="show" className="m-0 grid gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {trips.map((t) => (
              <TripCard key={t.id} t={t} onDelete={remove} />
            ))}
          </motion.ul>
        )}
      </div>
    </motion.div>
  );
}
