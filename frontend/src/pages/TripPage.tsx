import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Ban, Check, ChevronDown, CloudRain, Eye, Info, ListOrdered, Map as MapIcon, Maximize2, MessageSquare, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ChartMap } from "../components/trip/ChartMap";
import { MapExpanded } from "../components/trip/MapExpanded";
import { DayTabs } from "../components/trip/DayTabs";
import { ChatPanel, Delta, HistoryPanel, WhatIfPanel } from "../components/trip/Panels";
import { BudgetMeter } from "../components/trip/parts";
import { Timeline } from "../components/trip/Timeline";
import { Button, usePopover } from "../components/ui";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import { cityName, dateRange, daysBetween, duration, inr, titleCase } from "../lib/format";
import { ease, pageVariants, spring } from "../lib/motion";
import type { Item, ItemChange, Itinerary, Proposal, ProposalSummary, RunMetrics, TripDetail, VersionRow } from "../lib/types";

type PanelKey = "chat" | "whatif" | "history";
type MobileView = "plan" | "map" | "assistant";
const PANELS: { key: PanelKey; label: string }[] = [
  { key: "chat", label: "Ask" },
  { key: "whatif", label: "What if" },
  { key: "history", label: "History" },
];

export default function TripPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [mapAll, setMapAll] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const closeMap = useCallback(() => setMapOpen(false), []);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>("chat");
  const [mobileView, setMobileView] = useState<MobileView>("plan");
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api<TripDetail>(`/trips/${id}`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this trip.");
    }
  }, [id]);

  const loadVersions = useCallback(async () => {
    setVersionsLoading(true);
    try {
      setVersions(await api<VersionRow[]>(`/trips/${id}/versions`));
    } catch {
      /* history is secondary */
    } finally {
      setVersionsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setPreview(null);
    void load();
  }, [load]);
  useEffect(() => {
    if (panel === "history") void loadVersions();
  }, [panel, loadVersions, detail?.version?.id]);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const base = detail?.itinerary ?? null;
  const shown: Itinerary | null = preview?.itinerary ?? base;

  const flags = useMemo(() => {
    const m = new Map<string, "added" | "moved" | "retimed">();
    if (!preview || !shown) return m;
    const byPlace = new Map(preview.diff.changes.map((c) => [c.place_id, c.kind]));
    for (const d of shown.days)
      for (const it of d.items) {
        const k = byPlace.get(it.place_id);
        if (k && k !== "removed") m.set(it.id, k);
      }
    return m;
  }, [preview, shown]);
  const removed: ItemChange[] = useMemo(() => preview?.diff.changes.filter((c) => c.kind === "removed") ?? [], [preview]);
  const changedDays = useMemo(() => {
    const s = new Set<number>();
    if (!preview || !shown) return s;
    for (const d of shown.days) if (d.items.some((i) => flags.has(i.id))) s.add(d.index);
    for (const r of removed) if (r.day_from != null) s.add(r.day_from);
    return s;
  }, [preview, shown, flags, removed]);
  const highlight = useMemo(() => new Set(flags.keys()), [flags]);

  const switchView = (v: MobileView) => {
    setMobileView(v);
    // phones show one view at a time and each starts at its own top; on desktop every view is always visible
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };

  const doFlash = (placeIds: string[], itin: Itinerary) => {
    const ids = new Set(itin.days.flatMap((d) => d.items).filter((i) => placeIds.includes(i.place_id)).map((i) => i.id));
    setFlash(ids);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(new Set()), 3200);
  };

  const accept = async (p: Proposal) => {
    if (!p.version_id) return;
    setBusyId(p.version_id);
    try {
      await api(`/trips/${id}/versions/${p.version_id}/apply`, { method: "POST" });
      const changed = p.diff.changes.filter((c) => c.kind !== "removed").map((c) => c.place_id);
      setPreview(null);
      await load();
      doFlash(changed, p.itinerary);
      toast("Change applied. The previous version is kept in History.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not apply the change", "error");
    } finally {
      setBusyId(null);
    }
  };
  const reject = async (versionId: string) => {
    try {
      await api(`/trips/${id}/versions/${versionId}/reject`, { method: "POST" });
      if (preview?.version_id === versionId) setPreview(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not dismiss", "error");
    }
  };
  const focusFirstChange = (p: { diff: Proposal["diff"] }) => {
    const first = p.diff.changes.find((c) => c.day_to != null || c.day_from != null);
    if (first) setDayIndex(first.day_to ?? first.day_from ?? 0);
  };
  const showPreview = (p: Proposal, reveal = true) => {
    setPreview(p);
    focusFirstChange(p);
    if (reveal) switchView("plan");
  };
  const previewSummary = async (s: ProposalSummary) => {
    try {
      const v = await api<{ itinerary: Itinerary; diff: ProposalSummary["diff"]; affected: ProposalSummary["affected"]; notes: string[] }>(`/trips/${id}/versions/${s.id}`);
      if (!v.diff) return;
      showPreview({ version_id: s.id, change_type: s.change_type, reason: s.reason, affected: v.affected ?? [], diff: v.diff, itinerary: v.itinerary, violations: [], notes: s.notes ?? [] });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load the preview", "error");
    }
  };

  const sendFeedback = async (it: Item, signal: "up" | "down") => {
    setFeedback((f) => ({ ...f, [it.id]: signal }));
    try {
      const r = await api<{ new_memories: string[] }>(`/trips/${id}/feedback`, { method: "POST", json: { item_id: it.id, signal } });
      toast(r.new_memories.length ? `Learned: ${r.new_memories[0].toLowerCase()}` : signal === "up" ? "Noted. Stops like this will rank higher." : "Noted. Stops like this will rank lower.", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save feedback", "error");
    }
  };
  const toggleLock = async (it: Item) => {
    try {
      await api(`/trips/${id}/items/${it.id}/lock`, { method: "POST", json: { locked: !it.locked } });
      await load();
      toast(it.locked ? `${it.name} unlocked` : `${it.name} locked. Re-plans will leave it in place.`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change the lock", "error");
    }
  };
  const simulate = async (body: { type: "weather" | "closure"; day?: number; item_id?: string }) => {
    try {
      const r = await api<{ proposal: Proposal | null }>(`/trips/${id}/events/simulate`, { method: "POST", json: body });
      await load();
      if (r.proposal && r.proposal.diff.changes.length) {
        showPreview(r.proposal);
        toast(body.type === "weather" ? "Rain alert raised. Review the proposed change." : "Closure noted. Review the proposed change.", "info");
      } else {
        toast(r.proposal?.notes?.[0] ?? "That would not change the plan.", "info");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not simulate that", "error");
    }
  };
  const askAbout = (text: string) => {
    setPanel("chat");
    setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 }));
    switchView("assistant");
  };

  if (error)
    return (
      <div className="mx-auto max-w-xl px-5 py-24">
        <p className="label mb-3">Trip unavailable</p>
        <h1 className="display-wide mb-3 text-[28px]">We could not open this trip</h1>
        <p className="mb-6 text-muted">{error}</p>
        <div className="flex gap-2">
          <Button onClick={() => void load()} icon={<RotateCw size={15} />}>
            Try again
          </Button>
          <Link to="/trips" className="inline-flex h-10 items-center rounded-[var(--radius-ctl)] px-4 text-sm font-semibold text-muted hover:text-ink">
            Back to trips
          </Link>
        </div>
      </div>
    );
  if (!detail || !shown || !base) return <TripSkeleton />;

  const { trip } = detail;
  const req = trip.request;
  const pending = detail.proposals.filter((p) => p.diff && p.id !== preview?.version_id);
  const day = Math.min(dayIndex, shown.days.length - 1);
  const nDays = daysBetween(trip.start_date, trip.end_date);
  const facts = [
    dateRange(trip.start_date, trip.end_date),
    `${nDays} ${nDays === 1 ? "day" : "days"}`,
    `${req.travelers} ${req.travelers === 1 ? "traveller" : "travellers"}`,
    `${titleCase(req.pace)} pace`,
    req.diet !== "none" ? titleCase(req.diet) : null,
    req.step_free ? "Step-free" : null,
    req.late_starts ? "Late starts" : null,
    ...req.avoid.map((a) => `No ${a}`),
  ].filter(Boolean) as string[];

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className={`mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 lg:pb-16 ${mobileView === "plan" ? "pb-28" : "pb-20"}`}>
        {mobileView !== "plan" && (
          // phones: map and assistant views get a one-line title so the panel can fill the screen
          <div className="mb-3 flex h-11 items-center gap-1.5 lg:hidden">
            <Link to="/trips" aria-label="All trips" className="-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <ArrowLeft size={17} />
            </Link>
            <p className="display truncate text-[28px]">{cityName(trip.destination)}</p>
            <span className="mono ml-auto shrink-0 text-[12px] text-muted">{inr(shown.totals.cost_inr)} / {inr(trip.budget_inr)}</span>
          </div>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px] xl:gap-12">
          <section aria-label="Itinerary" className={`min-w-0 ${mobileView === "plan" ? "" : "max-lg:hidden"}`}>
            <Link to="/trips" className={`-ml-1 mb-3 inline-flex items-center gap-1 rounded-md px-1 text-[13px] font-medium text-muted transition-colors hover:text-ink`}>
              <ArrowLeft size={14} /> All trips
            </Link>

            <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [...ease] }} className={`mb-6 grid items-end gap-x-10 gap-y-5 border-b border-line pb-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]`}>
              <div className="min-w-0">
                <h1 className="display text-[44px] sm:text-[56px]">{cityName(trip.destination)}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] text-muted">
                  {facts.map((f, i) => (
                    <span key={f} className="inline-flex items-center gap-2">
                      {i > 0 && <span aria-hidden className="text-line-strong">·</span>}
                      <span className={i === 0 ? "mono text-ink" : ""}>{f}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-2 text-[13px]">
                  <PlanDetails itinerary={base} version={detail.version?.version_no ?? 1} run={detail.last_run} />
                </div>
              </div>
              <div>
                <p className="label mb-2 flex items-center justify-between">
                  <span>Estimated spend</span>
                  <span className="normal-case tracking-normal">{duration(shown.totals.travel_minutes)} travel · {shown.totals.items} stops</span>
                </p>
                <BudgetMeter totals={shown.totals} />
              </div>
            </motion.header>

            <AnimatePresence initial={false}>
              {pending.length > 0 && !preview && (
                <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: [...ease] }} className="overflow-hidden" aria-label="Changes waiting for review">
                  <div className="mb-6">
                    <p className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-signal">
                      <span className="relative flex h-2 w-2" aria-hidden>
                        <span className="ping absolute inline-flex h-full w-full rounded-full bg-signal" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
                      </span>
                      {pending.length === 1 ? "A change is waiting for your review" : `${pending.length} changes are waiting for your review`}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {pending.slice(0, 3).map((p) => (
                        <PendingRow key={p.id} p={p} onPreview={() => previewSummary(p)} onReject={() => reject(p.id)} />
                      ))}
                    </ul>
                    {pending.length > 3 && <p className="mt-2 text-[13px] text-muted">and {pending.length - 3} more in History</p>}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {preview && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [...ease] }}
                  className="pop sticky top-[calc(3.5rem+env(safe-area-inset-top)+0.75rem)] z-30 mb-5 overflow-hidden"
                  role="region"
                  aria-label="Previewing a proposed change"
                >
                  <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-signal" />
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 py-3 pl-4 pr-3">
                    <Eye size={16} className="shrink-0 text-signal" aria-hidden />
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-[12px] font-semibold text-signal">Previewing a proposal</p>
                      <p className="truncate text-[14px] font-medium">{preview.reason || preview.diff.summary}</p>
                    </div>
                    <Delta diff={preview.diff} />
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="signal" onClick={() => accept(preview)} loading={busyId === preview.version_id} icon={<Check size={14} />}>
                        Apply
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPreview(null)} icon={<X size={14} />}>
                        Close preview
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mb-6 flex items-end gap-2 border-b border-line">
              <div className="min-w-0 flex-1">
                <DayTabs days={shown.days} active={day} onChange={setDayIndex} changed={changedDays} panelId="day-panel" />
              </div>
              <div className="pb-2">
                <SimulateMenu days={shown.days.length} items={shown.days[day]?.items ?? []} dayIndex={day} onRain={(d) => simulate({ type: "weather", day: d })} onClose={(i) => simulate({ type: "closure", item_id: i.id })} disabled={!!preview} />
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${preview?.version_id ?? "base"}-${day}`}
                id="day-panel"
                role="tabpanel"
                aria-labelledby={`day-tab-${day}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.22, ease: [...ease] }}
              >
                <Timeline
                  itinerary={shown}
                  dayIndex={day}
                  hoverId={hoverId}
                  onHover={setHoverId}
                  flags={flags}
                  removed={removed}
                  flash={flash}
                  feedback={feedback}
                  readOnly={!!preview}
                  onFeedback={sendFeedback}
                  onLock={toggleLock}
                  onClosed={(it) => simulate({ type: "closure", item_id: it.id })}
                  emptyAction={
                    !preview && (
                      <Button size="sm" variant="ghost" onClick={() => askAbout(`Add ${req.interests[0] ?? "food"} to day ${day + 1}`)} icon={<MessageSquare size={14} />}>
                        Ask for ideas
                      </Button>
                    )
                  }
                />
              </motion.div>
            </AnimatePresence>
          </section>

          <aside aria-label="Map and assistant" className={`flex flex-col gap-4 lg:sticky lg:top-[4.75rem] lg:h-[calc(100dvh-6rem)] lg:min-h-[600px] ${mobileView === "plan" ? "max-lg:hidden" : ""}`}>
            <div className={`card shrink-0 overflow-hidden ${mobileView === "map" ? "" : "max-lg:hidden"}`}>
              <div className="h-[calc(100dvh-15.85rem-env(safe-area-inset-bottom))] min-h-[260px] lg:h-[248px] lg:min-h-0 xl:h-[272px]">
                <ChartMap days={shown.days} active={mapAll ? "all" : day} base={shown.base} hoverId={hoverId} onHover={setHoverId}
                  highlight={highlight}
                  chrome={
                    <button type="button" onClick={() => setMapOpen(true)} aria-label="Expand map" className="grid h-8 w-8 place-items-center rounded-full border border-line bg-raised/85 text-ink shadow-[var(--shadow-sm)] backdrop-blur transition-colors hover:bg-raised">
                      <Maximize2 size={14} />
                    </button>
                  }
                />
              </div>
              <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[12px] text-muted">
                <span className="flex shrink-0 items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full border-[1.5px] border-sea" /> Outdoor
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px] border-[1.5px] border-sea" /> Indoor
                </span>
                <div role="radiogroup" aria-label="Map shows" className="no-scrollbar ml-auto flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-md bg-surface-2 p-0.5">
                  <span className="shrink-0 px-1.5" aria-hidden>
                    Day
                  </span>
                  {shown.days.map((d) => {
                    const on = !mapAll && d.index === day;
                    return (
                      <button
                        key={d.index}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`Day ${d.index + 1}`}
                        onClick={() => {
                          setMapAll(false);
                          setDayIndex(d.index);
                        }}
                        className={`mono h-6 min-w-6 shrink-0 rounded px-1.5 font-medium transition-colors ${on ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "hover:text-ink"}`}
                      >
                        {d.index + 1}
                      </button>
                    );
                  })}
                  <button type="button" role="radio" aria-checked={mapAll} onClick={() => setMapAll(true)} className={`h-6 shrink-0 rounded px-2 font-medium transition-colors ${mapAll ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "hover:text-ink"}`}>
                    All
                  </button>
                </div>
              </div>
            </div>

            <div className={`card flex min-h-0 flex-col overflow-hidden max-lg:h-[calc(100dvh-13.25rem-env(safe-area-inset-bottom))] max-lg:min-h-[380px] lg:flex-1 ${mobileView === "assistant" ? "" : "max-lg:hidden"}`}>
              <div role="tablist" aria-label="Assistant" className="flex shrink-0 gap-1 border-b border-line px-2">
                {PANELS.map(({ key, label }) => (
                  <button
                    key={key}
                    role="tab"
                    id={`panel-tab-${key}`}
                    aria-selected={panel === key}
                    aria-controls="assistant-panel"
                    type="button"
                    onClick={() => setPanel(key)}
                    className={`relative px-2.5 pb-2.5 pt-3 text-[13px] font-semibold transition-colors ${panel === key ? "text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {label}
                    {panel === key && <motion.span layoutId="panel-tab" transition={spring} className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-sea" />}
                  </button>
                ))}
              </div>
              <div id="assistant-panel" role="tabpanel" aria-labelledby={`panel-tab-${panel}`} className="min-h-0 flex-1">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={panel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    {panel === "chat" && (
                      <ChatPanel tripId={id} messages={detail.messages} itinerary={base} previewId={preview?.version_id ?? null} onPreview={showPreview} onAccept={accept} onReject={reject} onAfterSend={load} busyId={busyId} draft={draft} onDraftUsed={() => setDraft(null)} />
                    )}
                    {panel === "whatif" && <WhatIfPanel tripId={id} budget={trip.budget_inr} previewId={preview?.version_id ?? null} onPreview={showPreview} onAccept={accept} busyId={busyId} onAfterRun={load} />}
                    {panel === "history" && <HistoryPanel versions={versions} loading={versionsLoading} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </aside>
          <MapExpanded
            open={mapOpen}
            onClose={closeMap}
            itinerary={shown}
            day={day}
            all={mapAll}
            onDay={(i) => {
              setMapAll(false);
              setDayIndex(i);
            }}
            onAll={() => setMapAll(true)}
            hoverId={hoverId}
            onHover={setHoverId}
            highlight={highlight}
          />
        </div>
      </div>

      <MobileBar view={mobileView} onChange={switchView} pending={pending.length > 0 || !!preview} />

      <p className="sr-only" aria-live="polite">
        {preview ? `Previewing a proposed change. Estimated spend would be ${inr(shown.totals.cost_inr)}.` : ""}
      </p>
    </motion.div>
  );
}

function PendingRow({ p, onPreview, onReject }: { p: ProposalSummary; onPreview: () => void; onReject: () => void }) {
  return (
    <li className="card relative flex flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden py-2.5 pl-4 pr-2.5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-signal" />
      <div className="min-w-0 flex-1 basis-60">
        <p className="truncate text-[14px] font-semibold">{p.reason}</p>
        <p className="truncate text-[12px] text-muted">
          {p.affected && p.affected.length > 0 ? `Affects ${p.affected.map((a) => a.name).join(", ")}` : p.diff?.summary}
        </p>
      </div>
      {p.diff && <Delta diff={p.diff} />}
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onPreview} icon={<Eye size={14} />}>
          Review
        </Button>
        <button type="button" onClick={onReject} aria-label={`Dismiss: ${p.reason}`} title="Dismiss" className="grid h-8 w-8 place-items-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-ink">
          <X size={15} />
        </button>
      </div>
    </li>
  );
}

function PlanDetails({ itinerary, version, run }: { itinerary: Itinerary; version: number; run: RunMetrics | null }) {
  const { open, setOpen, ref, trigger } = usePopover();
  const warnings = itinerary.warnings;
  const rows: [string, ReactNode][] = [
    ["Version", <span className="mono">v{version}</span>],
    ["Planner", itinerary.planner === "llm" ? "Language model, verified in code" : "Built-in planner"],
    ["Places", itinerary.data_mode === "live" ? "Live Google Maps data" : "Bundled demo dataset"],
  ];
  if (run) rows.push(["Last run", <span className="mono">{run.latency_ms} ms · {run.tool_calls} tool calls{run.input_tokens + run.output_tokens > 0 ? ` · ${(run.input_tokens + run.output_tokens).toLocaleString("en-IN")} tokens` : ""}</span>]);
  return (
    <div ref={ref} className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md font-medium text-muted transition-colors hover:text-ink">
        <Info size={13} />
        How this was planned
        {warnings.length > 0 && <span className="ml-0.5 rounded bg-warn-soft px-1 text-[11px] font-semibold text-warn">{warnings.length}</span>}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="How this plan was made"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 2 }}
            transition={{ duration: 0.14 }}
            className="pop absolute left-0 top-full z-40 mt-2 w-[min(380px,calc(100vw-2rem))] p-4 text-ink"
          >
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-[13px]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {warnings.length > 0 && (
              <>
                <p className="label mb-1.5 mt-4 !text-warn">Notes</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
            {itinerary.assumptions.length > 0 && (
              <>
                <p className="label mb-1.5 mt-4">Assumptions</p>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug text-muted">
                  {itinerary.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SimulateMenu({ days, items, dayIndex, onRain, onClose, disabled }: { days: number; items: Item[]; dayIndex: number; onRain: (d: number) => void; onClose: (i: Item) => void; disabled?: boolean }) {
  const { open, setOpen, ref, trigger } = usePopover();
  return (
    <div ref={ref} className="relative shrink-0">
      <Button ref={trigger} variant="quiet" size="sm" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" icon={<CloudRain size={14} />} title="Test how the plan reacts to rain or a closure">
        <span className="hidden sm:inline">Simulate</span>
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 2 }} transition={{ duration: 0.14 }} className="pop absolute right-0 z-40 mt-2 w-72 p-1.5">
            <p className="px-2.5 pb-2 pt-1.5 text-[12px] leading-snug text-muted">Raise a test event. You will see the proposed re-plan before anything changes.</p>
            <p className="label px-2.5 pb-1.5 pt-1">Heavy rain on</p>
            <div className="grid grid-cols-4 gap-1 px-1.5 pb-2">
              {Array.from({ length: days }, (_, d) => (
                <button
                  key={d}
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onRain(d);
                  }}
                  className={`rounded-md border px-2 py-1.5 text-[12px] font-medium transition-colors hover:border-rain/60 hover:bg-rain-soft hover:text-rain ${d === dayIndex ? "border-line-strong text-ink" : "border-line text-muted"}`}
                >
                  Day {d + 1}
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <>
                <div className="my-1 h-px bg-line" />
                <p className="label px-2.5 pb-1 pt-1.5">Close a stop on day {dayIndex + 1}</p>
                <ul className="m-0 max-h-52 overflow-y-auto p-0">
                  {items.map((it) => (
                    <li key={it.id} className="list-none">
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onClose(it);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2"
                      >
                        <Ban size={13} className="shrink-0 text-signal" />
                        <span className="truncate">{it.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const VIEWS: { key: MobileView; label: string; icon: typeof MapIcon }[] = [
  { key: "plan", label: "Itinerary", icon: ListOrdered },
  { key: "map", label: "Map", icon: MapIcon },
  { key: "assistant", label: "Assistant", icon: MessageSquare },
];

/** Phones: the map and assistant live behind a bottom bar instead of below twenty stops. */
function MobileBar({ view, onChange, pending }: { view: MobileView; onChange: (v: MobileView) => void; pending: boolean }) {
  return (
    <nav aria-label="Trip views" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[color-mix(in_srgb,var(--surface)_94%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-md">
        {VIEWS.map(({ key, label, icon: Icon }) => {
          const on = view === key;
          return (
            <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={on} className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${on ? "text-sea" : "text-muted"}`}>
              {on && <motion.span layoutId="mobile-view" transition={spring} className="absolute inset-x-6 top-0 h-[2px] rounded-full bg-sea" />}
              <span className="relative">
                <Icon size={19} />
                {key === "plan" && pending && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-signal ring-2 ring-surface" aria-label="changes waiting" />}
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function TripSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-5 sm:px-6" aria-busy="true" aria-label="Loading trip">
      <div className="skeleton mb-4 h-4 w-20" />
      <div className="mb-6 grid items-end gap-6 border-b border-line pb-6 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="skeleton mb-3 h-12 w-56" />
          <div className="skeleton h-4 w-80 max-w-full" />
        </div>
        <div className="skeleton h-12" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px] xl:grid-cols-[1fr_420px] xl:gap-12">
        <div className="flex flex-col gap-5">
          <div className="skeleton h-12" />
          <div className="skeleton h-16 w-2/3" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid grid-cols-[3.5rem_2.25rem_1fr] gap-3">
              <div className="skeleton h-8" />
              <div className="skeleton mx-auto h-7 w-7 rounded-full" />
              <div className="skeleton h-24" />
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-4 lg:flex">
          <div className="skeleton h-[272px]" />
          <div className="skeleton h-[360px]" />
        </div>
      </div>
    </div>
  );
}
