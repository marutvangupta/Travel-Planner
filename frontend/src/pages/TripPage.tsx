import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Ban, Check, ChevronDown, CloudRain, Cpu, Eye, FlaskConical, History, Layers, MapPinOff, MessageSquare, RotateCw, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChartMap } from "../components/trip/ChartMap";
import { DayTabs } from "../components/trip/DayTabs";
import { ChatPanel, HistoryPanel, ProposalCard, WhatIfPanel } from "../components/trip/Panels";
import { BudgetMeter } from "../components/trip/parts";
import { Timeline } from "../components/trip/Timeline";
import { Button } from "../components/ui";
import { rovingKeys, useDocumentTitle } from "../lib/a11y";
import { useToast } from "../context/ToastContext";
import { ApiError, api } from "../lib/api";
import { cityName, dateRange, duration, inr, titleCase } from "../lib/format";
import { ease, pageVariants, spring } from "../lib/motion";
import type { Item, ItemChange, Itinerary, Proposal, ProposalSummary, TripDetail, VersionRow } from "../lib/types";

type PanelKey = "chat" | "whatif" | "history";
const PANELS: { key: PanelKey; label: string; icon: typeof MessageSquare }[] = [
  { key: "chat", label: "Ask", icon: MessageSquare },
  { key: "whatif", label: "What if", icon: Zap },
  { key: "history", label: "History", icon: History },
];

export default function TripPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [mapAll, setMapAll] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelKey>("chat");
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const flashTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const d = await api<TripDetail>(`/trips/${id}`);
      setDetail(d);
      setError(null);
    } catch (e) {
      setError({ status: e instanceof ApiError ? e.status : 0, message: e instanceof Error ? e.message : "Could not load this trip." });
    }
  }, [id]);

  const loadVersions = useCallback(async () => {
    try {
      setVersions(await api<VersionRow[]>(`/trips/${id}/versions`));
    } catch {
      /* history is secondary */
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

  useDocumentTitle(detail ? cityName(detail.trip.destination) : "Trip");
  const base = detail?.itinerary ?? null;
  const shown: Itinerary | null = preview?.itinerary ?? base;

  const flags = useMemo(() => {
    const m = new Map<string, "added" | "moved" | "retimed">();
    if (!preview || !shown) return m;
    const byPlace = new Map(preview.diff.changes.map((c) => [c.place_id, c.kind]));
    for (const d of shown.days) for (const it of d.items) {
      const k = byPlace.get(it.place_id);
      if (k && k !== "removed") m.set(it.id, k);
    }
    return m;
  }, [preview, shown]);
  const removed: ItemChange[] = useMemo(() => preview?.diff.changes.filter((c) => c.kind === "removed") ?? [], [preview]);
  const highlight = useMemo(() => new Set(flags.keys()), [flags]);
  const changedDays = useMemo(() => {
    const s = new Set<number>();
    if (!preview || !shown) return s;
    for (const d of shown.days) if (d.items.some((i) => flags.has(i.id))) s.add(d.index);
    for (const r of removed) if (r.day_from != null) s.add(r.day_from);
    return s;
  }, [preview, shown, flags, removed]);

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
      toast("Change applied. Your previous version is kept in History.");
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
  const previewSummary = async (s: ProposalSummary) => {
    try {
      const v = await api<{ itinerary: Itinerary; diff: ProposalSummary["diff"]; affected: ProposalSummary["affected"]; notes: string[]; violations: [] }>(`/trips/${id}/versions/${s.id}`);
      if (!v.diff) return;
      setPreview({ version_id: s.id, change_type: s.change_type, reason: s.reason, affected: v.affected ?? [], diff: v.diff, itinerary: v.itinerary, violations: [], notes: s.notes ?? [] });
      const first = v.diff.changes.find((c) => c.day_to != null || c.day_from != null);
      if (first) setDayIndex(first.day_to ?? first.day_from ?? 0);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load the preview", "error");
    }
  };
  const showPreview = (p: Proposal) => {
    setPreview(p);
    const first = p.diff.changes.find((c) => c.day_to != null || c.day_from != null);
    if (first) setDayIndex(first.day_to ?? first.day_from ?? 0);
  };

  const sendFeedback = async (it: Item, signal: "up" | "down") => {
    setFeedback((f) => ({ ...f, [it.id]: signal }));
    try {
      const r = await api<{ new_memories: string[] }>(`/trips/${id}/feedback`, { method: "POST", json: { item_id: it.id, signal } });
      toast(r.new_memories.length ? `Learned: ${r.new_memories[0].toLowerCase()}` : signal === "up" ? "Noted. I will weigh this kind of stop higher." : "Noted. I will weigh this kind of stop lower.", "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save feedback", "error");
    }
  };
  const toggleLock = async (it: Item) => {
    try {
      await api(`/trips/${id}/items/${it.id}/lock`, { method: "POST", json: { locked: !it.locked } });
      await load();
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

  if (error) {
    const missing = error.status === 404;
    return (
      <motion.div variants={pageVariants} initial="initial" animate="animate" className="mx-auto max-w-xl px-4 py-20 sm:py-28">
        <div className="card flex flex-col items-start gap-4 rounded-panel p-7" role="alert">
          <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-surface-2 text-muted">
            <MapPinOff size={20} />
          </span>
          <div>
            <p className="display-wide text-[26px]">{missing ? "This trip isn't here anymore" : "We couldn't open this trip"}</p>
            <p className="mt-1.5 text-muted">{missing ? "It may have been deleted, or the link is from another account." : error.message}</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {!missing && (
              <Button
                onClick={async () => {
                  setRetrying(true);
                  await load();
                  setRetrying(false);
                }}
                loading={retrying}
                icon={<RotateCw size={15} />}
              >
                Try again
              </Button>
            )}
            <Button variant={missing ? "primary" : "ghost"} icon={<ArrowLeft size={15} />} onClick={() => nav("/trips")}>
              All trips
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }
  if (!detail || !shown || !base) return <TripSkeleton />;

  const { trip } = detail;
  const req = trip.request;
  const pending = detail.proposals;
  const day = Math.min(dayIndex, shown.days.length - 1);
  const run = detail.last_run;

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6">
        <Link to="/trips" className="group mb-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted transition-colors hover:text-ink">
          <ArrowLeft size={15} className="transition-transform duration-200 group-hover:-translate-x-0.5" /> All trips
        </Link>

        <motion.header initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [...ease] }} className="mb-6 grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
          <div className="min-w-0">
            <p className="label mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{dateRange(trip.start_date, trip.end_date)}</span>
              <span className="text-faint">·</span>
              <span>
                {req.travelers} {req.travelers === 1 ? "traveller" : "travellers"}
              </span>
              <span className="text-faint">·</span>
              <span>{titleCase(req.pace)} pace</span>
            </p>
            <h1 className="display text-[clamp(52px,7vw,92px)]">{cityName(trip.destination)}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge icon={<Layers size={12} />}>v{detail.version?.version_no ?? 1}</Badge>
              <Badge icon={<Cpu size={12} />}>{base.planner === "llm" ? "Planned by language model" : "Built-in planner"}</Badge>
              <Badge tone={base.data_mode === "live" ? "good" : "warn"}>{base.data_mode === "live" ? "Live Google data" : "Demo data"}</Badge>
              {req.diet !== "none" && <Badge>{titleCase(req.diet)}</Badge>}
              {req.step_free && <Badge>Step-free</Badge>}
              {req.avoid.map((a) => (
                <Badge key={a}>No {a}</Badge>
              ))}
              {run && (
                <Badge icon={<FlaskConical size={12} />}>
                  {run.latency_ms} ms · {run.tool_calls} tool calls · {run.input_tokens + run.output_tokens} tokens
                </Badge>
              )}
            </div>
          </div>
          <div className="card rounded-panel p-5">
            <BudgetMeter totals={shown.totals} />
            <p className="mono mt-3 text-xs text-muted">{duration(shown.totals.travel_minutes)} of local travel across {shown.totals.items} stops</p>
          </div>
        </motion.header>

        {(base.warnings.length > 0 || base.assumptions.length > 0) && !preview && (
          <details className="group mb-5 rounded-[14px] border border-line bg-surface text-sm shadow-xs transition-colors hover:border-line-strong">
            <summary className="flex list-none items-center justify-between gap-3 rounded-[14px] px-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                {base.warnings.length > 0 && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-semibold text-warn">{base.warnings.length} note{base.warnings.length > 1 ? "s" : ""}</span>}
                Assumptions and notes
              </span>
              <ChevronDown size={16} className="text-faint transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mb-3 flex list-disc flex-col gap-1 pl-9 pr-4 text-[13px] text-muted">
              {[...base.warnings, ...base.assumptions].map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        )}

        <AnimatePresence initial={false}>
          {pending.filter((p) => p.id !== preview?.version_id).length > 0 && !preview && (
            <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden" aria-label="Pending changes">
              <p className="label mb-2.5 flex items-center gap-2 !text-signal">
                <span className="relative flex h-2 w-2">
                  <span className="ping absolute inline-flex h-full w-full rounded-full bg-signal" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
                </span>
                {pending.length} change{pending.length > 1 ? "s" : ""} waiting for your review
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {pending.slice(0, 4).map((p) => (
                  <ProposalCard key={p.id} diff={p.diff!} reason={p.reason} affected={p.affected ?? []} notes={p.notes} onPreview={() => previewSummary(p)} onReject={() => reject(p.id)} />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <section className="min-w-0">
            <AnimatePresence initial={false}>
              {preview && (
                <motion.div initial={{ opacity: 0, y: -12, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, y: -8, height: 0 }} transition={{ duration: 0.35, ease: [...ease] }} className="sticky top-[4.5rem] z-30 mb-4 overflow-hidden rounded-2xl border border-signal/50 bg-signal-soft shadow-[var(--shadow-lg)]">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Eye size={16} className="text-signal" />
                    <div className="min-w-0 flex-1">
                      <p className="label !text-signal">Previewing a proposal</p>
                      <p className="truncate text-sm font-medium">{preview.diff.summary}</p>
                    </div>
                    <Button size="sm" variant="signal" onClick={() => accept(preview)} loading={busyId === preview.version_id} icon={<Check size={14} />}>
                      Apply change
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPreview(null)} icon={<X size={14} />}>
                      Back to current
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mb-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <DayTabs days={shown.days} active={day} onChange={setDayIndex} changed={changedDays} />
              </div>
              <SimulateMenu days={shown.days.length} items={shown.days[day]?.items ?? []} onRain={(d) => simulate({ type: "weather", day: d })} onClose={(i) => simulate({ type: "closure", item_id: i.id })} disabled={!!preview} />
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${preview?.version_id ?? "base"}-${day}`} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.28, ease: [...ease] }}>
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
                />
              </motion.div>
            </AnimatePresence>
          </section>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-[5rem] lg:h-[calc(100vh-6.5rem)] lg:min-h-[640px]">
            <div className="card relative overflow-hidden">
              <div className="aspect-[640/520] max-h-[330px] w-full">
                <ChartMap days={shown.days} active={mapAll ? "all" : day} base={shown.base} hoverId={hoverId} onHover={setHoverId} highlight={highlight} />
              </div>
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-line bg-surface/90 px-2.5 py-1.5 text-[11px] text-muted shadow-xs backdrop-blur" aria-hidden>
                <span className="inline-block h-3 w-3 rounded-full border-2 border-sea" /> Outdoor
                <span className="ml-1 inline-block h-3 w-3 rounded-[3px] border-2 border-sea" /> Indoor
              </div>
              <div role="radiogroup" aria-label="Map shows" className="absolute bottom-3 right-3 flex rounded-lg border border-line bg-surface/90 p-0.5 text-[11px] font-semibold shadow-xs backdrop-blur">
                {[false, true].map((all) => (
                  <button key={String(all)} type="button" role="radio" aria-checked={mapAll === all} onClick={() => setMapAll(all)} className={`relative rounded-[6px] px-2.5 py-1 transition-colors ${mapAll === all ? "text-sea" : "text-muted hover:text-ink"}`}>
                    {mapAll === all && <motion.span layoutId="map-scope" transition={spring} className="absolute inset-0 rounded-[6px] bg-sea-soft" />}
                    <span className="relative">{all ? "All days" : `Day ${day + 1}`}</span>
                  </button>
                ))}
              </div>
            </div>

            <div ref={panelRef} id="assistant" className="card flex min-h-[520px] flex-1 scroll-mt-24 flex-col overflow-hidden lg:min-h-0">
              <div role="tablist" aria-label="Assistant" onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => rovingKeys(e, PANELS.map((p) => p.key), panel, setPanel)} className="flex border-b border-line p-1.5">
                {PANELS.map(({ key, label, icon: Icon }) => (
                  <button key={key} id={`panel-tab-${key}`} role="tab" aria-selected={panel === key} aria-controls="panel-body" tabIndex={panel === key ? 0 : -1} type="button" onClick={() => setPanel(key)} className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-2 text-sm font-semibold transition-colors ${panel === key ? "text-ink" : "text-muted hover:text-ink"}`}>
                    {panel === key && <motion.span layoutId="panel-tab" transition={spring} className="absolute inset-0 rounded-[9px] bg-surface-2" />}
                    <Icon size={15} className="relative" />
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
              <div id="panel-body" role="tabpanel" aria-labelledby={`panel-tab-${panel}`} className="min-h-0 flex-1">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={panel} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} className="h-full">
                    {panel === "chat" && (
                      <ChatPanel tripId={id} messages={detail.messages} itinerary={base} previewId={preview?.version_id ?? null} appliedId={detail.version?.id ?? null} onPreview={showPreview} onAccept={accept} onReject={reject} onAfterSend={load} busyId={busyId} />
                    )}
                    {panel === "whatif" && (
                      <WhatIfPanel tripId={id} budget={trip.budget_inr} previewId={preview?.version_id ?? null} appliedId={detail.version?.id ?? null} onPreview={showPreview} onAccept={accept} busyId={busyId} onAfterRun={load} />
                    )}
                    {panel === "history" && <HistoryPanel versions={versions} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </aside>
        </div>
      </div>
      {/* phones: the assistant sits below the whole timeline, so keep a way to it under the thumb */}
      <AssistantShortcut target={panelRef} onOpen={() => setPanel("chat")} />
      <p className="sr-only" aria-live="polite">
        {preview ? "Previewing a proposed change" : ""} {inr(shown.totals.cost_inr)}
      </p>
    </motion.div>
  );
}

function Badge({ children, icon, tone }: { children: React.ReactNode; icon?: React.ReactNode; tone?: "good" | "warn" }) {
  const cls = tone === "good" ? "border-good/40 bg-good-soft text-good" : tone === "warn" ? "border-warn/40 bg-warn-soft text-warn" : "border-line bg-surface text-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}>
      {icon}
      {children}
    </span>
  );
}

function SimulateMenu({ days, items, onRain, onClose, disabled }: { days: number; items: Item[]; onRain: (d: number) => void; onClose: (i: Item) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" icon={<CloudRain size={14} />} iconRight={<ChevronDown size={13} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />}>
        Simulate
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }} transition={spring} style={{ transformOrigin: "top right" }} className="absolute right-0 z-40 mt-2 w-64 rounded-[14px] border border-line bg-surface p-2 shadow-pop">
            <p className="label px-2 pb-1 pt-1.5">Heavy rain on</p>
            <div className="flex flex-wrap gap-1 px-1 pb-2">
              {Array.from({ length: days }, (_, d) => (
                <button key={d} type="button" onClick={() => { setOpen(false); onRain(d); }} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-rain hover:bg-rain-soft hover:text-rain">
                  Day {d + 1}
                </button>
              ))}
            </div>
            <p className="label border-t border-line px-2 pb-1 pt-2">Close a stop today</p>
            <ul className="m-0 max-h-48 overflow-y-auto p-0">
              {items.map((it) => (
                <li key={it.id} className="list-none">
                  <button type="button" onClick={() => { setOpen(false); onClose(it); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-2">
                    <Ban size={13} className="shrink-0 text-signal" />
                    <span className="truncate">{it.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssistantShortcut({ target, onOpen }: { target: React.RefObject<HTMLDivElement | null>; onOpen: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el || !("IntersectionObserver" in window)) return;
    // show only while the panel is off screen
    const io = new IntersectionObserver(([e]) => setVisible(!e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={spring}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            onOpen();
            target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.setTimeout(() => target.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }), 450);
          }}
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-30 inline-flex h-12 items-center gap-2 rounded-full bg-ink pl-4 pr-5 text-sm font-semibold text-bg shadow-pop lg:hidden"
        >
          <MessageSquare size={17} /> Ask or change
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function TripSkeleton() {
  return (
    <div className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6" aria-busy="true" aria-label="Loading trip">
      <div className="skeleton mb-6 h-4 w-20" />
      <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)]">
        <div>
          <div className="skeleton mb-3 h-3 w-64" />
          <div className="skeleton h-20 w-72 max-w-full" />
          <div className="mt-4 flex gap-2">
            {[56, 120, 84].map((w) => (
              <div key={w} className="skeleton h-6 rounded-full" style={{ width: w }} />
            ))}
          </div>
        </div>
        <div className="skeleton h-[132px] rounded-panel" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex flex-col gap-4">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-[58px] w-24 rounded-xl" />
            ))}
          </div>
          <div className="skeleton h-28 rounded-2xl" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3" style={{ opacity: 1 - i * 0.25 }}>
              <div className="skeleton ml-auto mt-4 h-4 w-12" />
              <div className="skeleton h-32 rounded-2xl" />
            </div>
          ))}
        </div>
        <div className="hidden flex-col gap-4 lg:flex">
          <div className="skeleton h-[330px] rounded-card" />
          <div className="skeleton h-[300px] rounded-card" />
        </div>
      </div>
    </div>
  );
}
