import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DestinationArt } from "../components/brand/DestinationArt";
import { Button } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import { cityName, daysBetween, dateRange, inrShort, parseDate } from "../lib/format";
import { ease, pageVariants, rise, stagger } from "../lib/motion";
import type { TripSummary } from "../lib/types";

const CITY_NOTES: Record<string, string> = {
  jaipur: "Forts, bazaars and Rajasthani kitchens",
  goa: "Beaches, spice farms and Portuguese lanes",
  tokyo: "Shrines, markets and late-night food",
  paris: "Museums, cafés and riverside walks",
};
const noteFor = (dest: string) => CITY_NOTES[cityName(dest).toLowerCase()] ?? "Plan it day by day";
const country = (dest: string) => dest.split(",").slice(1).join(",").trim();

function status(t: TripSummary): { text: string; tone: "now" | "soon" | "later" | "past" } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseDate(t.start_date).getTime();
  const end = parseDate(t.end_date).getTime();
  const d = Math.round((start - today.getTime()) / 86400000);
  if (end < today.getTime()) return { text: "Completed", tone: "past" };
  if (d <= 0) return { text: "On the road", tone: "now" };
  if (d === 1) return { text: "Tomorrow", tone: "soon" };
  if (d < 14) return { text: `In ${d} days`, tone: "soon" };
  if (d < 70) return { text: `In ${Math.round(d / 7)} weeks`, tone: "later" };
  return { text: `In ${Math.round(d / 30)} months`, tone: "later" };
}

function TripRow({ t, onDelete }: { t: TripSummary; onDelete: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const pct = t.budget_inr ? Math.min(100, (t.cost_inr / t.budget_inr) * 100) : 0;
  const over = t.cost_inr > t.budget_inr;
  const st = status(t);
  const days = daysBetween(t.start_date, t.end_date);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 3200);
    return () => window.clearTimeout(id);
  }, [confirm]);
  const pill = st.tone === "now" ? "bg-good text-white" : st.tone === "soon" ? "bg-sea text-sea-ink" : "bg-black/45 text-white";
  return (
    <motion.li variants={rise} layout exit={{ opacity: 0, scale: 0.96 }} className="group relative list-none">
      <Link to={`/trips/${t.id}`} className="block overflow-hidden rounded-[var(--radius-box)] border border-line bg-surface shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-pop)]">
        <div className="relative aspect-[16/10] overflow-hidden">
          <DestinationArt destination={t.destination} className="h-full w-full transition-transform duration-700 group-hover:scale-105" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.18),transparent_40%,rgba(0,0,0,.45))]" />
          <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[12px] font-semibold backdrop-blur-sm ${pill}`}>{st.text}</span>
          {t.open_events > 0 && (
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-signal px-2.5 py-1 text-[11px] font-semibold text-[#1b0f22]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1b0f22]" aria-hidden />
              {t.open_events} to review
            </span>
          )}
          <ArrowUpRight size={18} className="absolute bottom-3 right-3 text-white/90 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
        </div>
        <div className="p-4 pb-5">
          <div className="flex items-baseline gap-2">
            <h3 className="display truncate text-[26px]">{cityName(t.destination)}</h3>
            {country(t.destination) && <span className="truncate text-[13px] text-muted">{country(t.destination)}</span>}
          </div>
          <p className="mt-1 truncate text-[13px] text-muted">{t.interests.length ? t.interests.slice(0, 4).map((i) => i[0].toUpperCase() + i.slice(1)).join(" · ") : noteFor(t.destination)}</p>
          <p className="mono mt-3 text-[12.5px] text-muted">
            {dateRange(t.start_date, t.end_date)} · <span className="text-ink">{days}</span> {days === 1 ? "day" : "days"} · <span className="text-ink">{t.stops}</span> stops
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <motion.div className={`h-full rounded-full ${over ? "bg-bad" : "bg-sea"}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [...ease], delay: 0.15 }} />
            </div>
            <span className="mono shrink-0 text-[12px] text-muted">
              <span className="text-ink">{inrShort(t.cost_inr)}</span> / {inrShort(t.budget_inr)}
            </span>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={() => (confirm ? onDelete(t.id) : setConfirm(true))}
        aria-label={confirm ? `Confirm: delete ${cityName(t.destination)}` : `Delete ${cityName(t.destination)}`}
        className={`absolute right-3 top-3 h-8 rounded-full px-2.5 text-[12px] font-semibold backdrop-blur-sm transition-all ${
          confirm ? "bg-bad text-white opacity-100" : "bg-black/45 text-white opacity-0 hover:bg-bad focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        {confirm ? "Delete?" : <Trash2 size={14} />}
      </button>
    </motion.li>
  );
}

function QuickStart({ destinations, wide }: { destinations: string[]; wide?: boolean }) {
  const nav = useNavigate();
  return (
    <ul className={`m-0 grid grid-cols-2 gap-3 p-0 ${wide ? "lg:grid-cols-4" : ""}`}>
      {destinations.map((d) => (
        <li key={d} className="list-none">
          <button type="button" onClick={() => nav(`/trips/new?to=${encodeURIComponent(d)}`)} className="group relative block aspect-[4/5] w-full overflow-hidden rounded-[var(--radius-box)] text-left shadow-[var(--shadow-sm)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-pop)]">
            <DestinationArt destination={d} className="absolute inset-0 h-full w-full transition-transform duration-700 group-hover:scale-105" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(23,17,15,.82))]" />
            <div className="absolute inset-x-0 bottom-0 p-4 text-white">
              <p className="display text-[26px] leading-none">{cityName(d)}</p>
              <p className="mt-1 text-[12px] text-white/80">{country(d)}</p>
              <p className="mt-2 text-[12.5px] leading-snug text-white/90">{noteFor(d)}</p>
            </div>
            <ArrowRight size={17} className="absolute right-3 top-3 text-white/90 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function TripsPage() {
  const { user, meta } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    api<TripSummary[]>("/trips")
      .then(setTrips)
      .catch((e) => {
        toast(e.message, "error");
        setFailed(true);
        setTrips([]);
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);
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
  const starters = meta?.destinations ?? ["Jaipur, India", "Goa, India", "Tokyo, Japan", "Paris, France"];
  const upcoming = trips?.filter((t) => status(t).tone !== "past") ?? [];
  const past = trips?.filter((t) => status(t).tone === "past") ?? [];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        {trips === null ? (
          <div aria-busy="true" aria-label="Loading trips">
            <div className="skeleton mb-3 h-4 w-24" />
            <div className="skeleton mb-10 h-11 w-72" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton mb-3 h-[84px]" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-16">
            <div>
              <p className="label mb-3">{first ? `Welcome, ${first}` : "Welcome"}</p>
              <h1 className="display text-[44px] sm:text-[52px]">Plan your first trip</h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
                Tell Waypoint where you are going, your dates, budget and what you enjoy. You get a day-by-day plan built from real places, with opening hours, travel time and cost checked before you see it.
              </p>
              {failed ? (
                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <p className="text-[14px] text-bad">Your trips could not be loaded.</p>
                  <Button variant="ghost" size="sm" onClick={load}>
                    Try again
                  </Button>
                </div>
              ) : (
                <Button size="lg" className="mt-7" onClick={() => nav("/trips/new")} icon={<Plus size={17} />}>
                  Plan a trip
                </Button>
              )}
            </div>
            <div>
              <p className="label mb-3">{meta?.destinations ? "Or start from a demo city" : "Or start from one of these"}</p>
              <QuickStart destinations={starters} />
            </div>
          </div>
        ) : (
          <>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label mb-3">Your trips</p>
                <h1 className="display text-[40px] sm:text-[48px]">Where to next{first ? `, ${first}` : ""}?</h1>
              </div>
              <p className="mono text-[13px] text-muted">
                {upcoming.length} upcoming{past.length ? ` · ${past.length} completed` : ""}
              </p>
            </div>
            <section aria-label="Upcoming trips">
              <motion.ul variants={stagger(0.05)} initial="hidden" animate="show" className="m-0 grid gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence initial={false}>
                  {[...upcoming, ...past].map((t) => (
                    <TripRow key={t.id} t={t} onDelete={remove} />
                  ))}
                </AnimatePresence>
              </motion.ul>
            </section>
            <section aria-label="Start a new trip" className="mt-14">
              <p className="label mb-3">Start another</p>
              <QuickStart destinations={starters} wide />
            </section>
          </>
        )}
      </div>
    </motion.div>
  );
}
