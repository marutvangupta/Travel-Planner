import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, CheckCircle2, Eye, History, MessageSquare, Send, Sparkles, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { inr } from "../../lib/format";
import { rise, spring, stagger } from "../../lib/motion";
import type { ChatMessage, ChatReply, Diff, Itinerary, Proposal, VersionRow } from "../../lib/types";
import { Button, CountUp, inputCls } from "../ui";
import { Citations, KindBadge } from "./parts";

/* ------------------------------------------------------------------------------------- proposal card */

export function ProposalCard({
  diff, reason, affected, notes, onPreview, onAccept, onReject, previewing, busy, applied, applyLabel = "Apply change",
}: {
  diff: Diff;
  reason?: string;
  affected?: { item_id: string; name: string; reason: string }[];
  notes?: string[];
  onPreview?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  previewing?: boolean;
  busy?: boolean;
  /** once applied, the card becomes a record: no actions, just the outcome */
  applied?: boolean;
  applyLabel?: string;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="overflow-hidden rounded-2xl border border-signal/40 bg-surface shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-signal-soft px-4 py-3">
        <div className="min-w-0">
          <p className="label !text-signal">Proposed change</p>
          <p className="mt-1 text-sm font-medium leading-snug">{reason ?? diff.summary}</p>
        </div>
        <div className="mono shrink-0 text-right text-xs">
          <p className={diff.cost_delta <= 0 ? "text-good" : "text-bad"}>{diff.cost_delta > 0 ? "+" : diff.cost_delta < 0 ? "−" : "±"}{inr(Math.abs(diff.cost_delta))}</p>
          <p className="text-muted">{Math.round(diff.stability * 100)}% kept</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3">
        {affected && affected.length > 0 && (
          <p className="text-[13px] text-muted">
            Affected: <span className="text-ink">{affected.map((a) => a.name).join(", ")}</span>
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {diff.changes.slice(0, 6).map((c) => (
            <li key={c.kind + c.place_id} className="flex items-center gap-2 text-[13px]">
              <KindBadge kind={c.kind} />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="mono shrink-0 text-xs text-faint">{c.detail}</span>
            </li>
          ))}
          {diff.changes.length > 6 && <li className="text-xs text-faint">and {diff.changes.length - 6} more</li>}
        </ul>
        {notes && notes.length > 0 && <p className="text-xs text-muted">{notes.join(" ")}</p>}
      </div>
      {applied ? (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 border-t border-line bg-good-soft/50 px-4 py-3 text-[13px] font-semibold text-good">
          <CheckCircle2 size={15} /> Applied to your plan
        </motion.p>
      ) : (onAccept || onPreview || onReject) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {onAccept && (
            <Button size="sm" variant="signal" onClick={onAccept} loading={busy} icon={<Check size={14} />}>
              {applyLabel}
            </Button>
          )}
          {onPreview && (
            <Button size="sm" variant={previewing ? "soft" : "ghost"} onClick={onPreview} icon={<Eye size={14} />}>
              {previewing ? "Previewing" : "Preview"}
            </Button>
          )}
          {onReject && (
            <Button size="sm" variant="ghost" onClick={onReject} className="ml-auto" icon={<X size={14} />}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------------------------- chat */

interface Bubble {
  key: string;
  role: "user" | "assistant";
  text: string;
  proposal?: Proposal | null;
  citations?: string[];
}

const THINKING = ["Reading your itinerary", "Checking opening hours", "Finding what is affected", "Re-planning only what changed", "Verifying the result"];

export function ChatPanel({
  tripId, messages, itinerary, previewId, appliedId, onPreview, onAccept, onReject, onAfterSend, busyId,
}: {
  tripId: string;
  appliedId: string | null;
  messages: ChatMessage[];
  itinerary: Itinerary;
  previewId: string | null;
  onPreview: (p: Proposal) => void;
  onAccept: (p: Proposal) => void;
  onReject: (versionId: string) => void;
  onAfterSend: () => void;
  busyId: string | null;
}) {
  const initial = useMemo<Bubble[]>(() => messages.map((m) => ({ key: m.id, role: m.role, text: m.content, citations: m.payload?.citations })), [messages]);
  const [local, setLocal] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % THINKING.length), 900);
    return () => window.clearInterval(t);
  }, [busy]);
  useEffect(() => {
    // scroll only the chat list; scrollIntoView would also move the whole page
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [local.length, busy, initial.length]);

  const outdoor = itinerary.days.flatMap((d) => d.items).find((i) => !i.indoor);
  const suggestions = [
    outdoor ? `Swap ${outdoor.name} for something indoors` : "Add more food experiences",
    "Make it more relaxed",
    "Is day 1 too packed?",
    "How much will this cost?",
  ];

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setLocal((l) => [...l, { key: `u${Date.now()}`, role: "user", text: msg }]);
    setBusy(true);
    setStep(0);
    try {
      const r = await api<ChatReply>(`/trips/${tripId}/chat`, { method: "POST", json: { message: msg } });
      setLocal((l) => [...l, { key: `a${Date.now()}`, role: "assistant", text: r.reply, proposal: r.proposal, citations: r.citations }]);
      if (r.proposal?.version_id) onPreview(r.proposal);
    } catch (e) {
      setLocal((l) => [...l, { key: `e${Date.now()}`, role: "assistant", text: e instanceof Error ? e.message : "Something went wrong." }]);
    } finally {
      setBusy(false);
      onAfterSend();
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const all = [...initial.filter((b) => !local.some((l) => l.text === b.text && l.role === b.role)), ...local];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {all.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="mb-4 flex gap-3 rounded-2xl border border-dashed border-line-strong p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sea-soft text-sea">
              <Sparkles size={17} />
            </span>
            <div>
              <p className="display-wide mb-1 text-lg">Change anything in plain words</p>
              <p className="text-sm text-muted">Swap a stop, cut the budget, slow the pace, or say it's going to rain. You'll see the change before anything is applied.</p>
            </div>
          </motion.div>
        )}
        <motion.ul variants={stagger(0.04)} initial="hidden" animate="show" className="m-0 flex flex-col gap-3 p-0">
          {all.map((b) => (
            <motion.li key={b.key} layout variants={rise} className={`flex list-none flex-col gap-2 ${b.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[92%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug ${b.role === "user" ? "rounded-br-md bg-sea text-sea-ink" : "rounded-bl-md border border-line bg-surface"}`}>
                {b.text}
                {b.citations && b.citations.length > 0 && (
                  <div className="mt-2">
                    <Citations ids={b.citations} sources={itinerary.sources} />
                  </div>
                )}
              </div>
              {b.proposal && b.proposal.version_id && !dismissed.has(b.proposal.version_id) && (
                <div className="w-full">
                  <ProposalCard
                    diff={b.proposal.diff}
                    affected={b.proposal.affected}
                    notes={b.proposal.notes}
                    previewing={previewId === b.proposal.version_id}
                    busy={busyId === b.proposal.version_id}
                    applied={appliedId === b.proposal.version_id}
                    onPreview={() => onPreview(b.proposal!)}
                    onAccept={() => onAccept(b.proposal!)}
                    onReject={() => {
                      onReject(b.proposal!.version_id!);
                      setDismissed((s) => new Set(s).add(b.proposal!.version_id!));
                    }}
                  />
                </div>
              )}
            </motion.li>
          ))}
        </motion.ul>
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-2.5 text-sm text-muted">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.i key={i} className="block h-1.5 w-1.5 rounded-full bg-sea" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </span>
              <AnimatePresence mode="wait">
                <motion.span key={step} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
                  {THINKING[step]}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="border-t border-line p-3">
        <div className="no-scrollbar fade-x -mx-3 mb-2.5 flex gap-1.5 overflow-x-auto px-3" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => send(s)} disabled={busy} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-sea/60 hover:bg-sea-soft/40 hover:text-sea disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <input aria-label="Message" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Swap the fort for something indoors…" className={inputCls} maxLength={600} />
          <Button type="submit" disabled={!input.trim()} loading={busy} aria-label="Send" className="w-11 !px-0" icon={busy ? undefined : <Send size={16} />} />
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- what if */

const PRESETS = [
  { label: "Cut ₹10,000", text: "What if I reduce my budget by ₹10,000?" },
  { label: "Cut ₹25,000", text: "What if I reduce my budget by ₹25,000?" },
  { label: "Add ₹20,000", text: "What if I increase my budget by ₹20,000?" },
  { label: "Slow the pace", text: "What if I take it slower?" },
  { label: "Rain on day 2", text: "What if it rains on day 2?" },
  { label: "Start later", text: "What if I start later each day?" },
  { label: "Skip nightlife", text: "What if I skip nightlife?" },
];

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`${Math.round(value * 100)}% of other stops unchanged`}>
      <circle cx="34" cy="34" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <motion.circle cx="34" cy="34" r={r} fill="none" stroke="var(--sea)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} transform="rotate(-90 34 34)" />
      <text x="34" y="38" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="14" fontWeight="600" fill="var(--ink)">
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

function CostBars({ diff, budget }: { diff: Diff; budget: number }) {
  const max = Math.max(diff.cost_before, diff.cost_after, budget) || 1;
  const rows = [
    { label: "Now", value: diff.cost_before, color: "var(--faint)" },
    { label: "If applied", value: diff.cost_after, color: diff.cost_after <= diff.cost_before ? "var(--sea)" : "var(--signal)" },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">{r.label}</span>
            <span className="mono font-medium">
              <CountUp value={r.value} format={inr} />
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
            <motion.div className="h-full rounded-full" style={{ background: r.color }} initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ duration: 0.9, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Coverage({ diff }: { diff: Diff }) {
  const keys = Array.from(new Set([...Object.keys(diff.interests_before), ...Object.keys(diff.interests_after)])).sort((a, b) => (diff.interests_after[b] ?? 0) - (diff.interests_after[a] ?? 0)).slice(0, 5);
  const max = Math.max(1, ...keys.map((k) => Math.max(diff.interests_before[k] ?? 0, diff.interests_after[k] ?? 0)));
  return (
    <div className="flex flex-col gap-1.5">
      {keys.map((k, i) => {
        const b = diff.interests_before[k] ?? 0;
        const a = diff.interests_after[k] ?? 0;
        return (
          <div key={k} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate capitalize text-muted">{k}</span>
            <div className="relative h-2 rounded-full bg-surface-2">
              <motion.span className="absolute inset-y-0 left-0 rounded-full bg-line" initial={{ width: 0 }} animate={{ width: `${(b / max) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.05 }} />
              <motion.span className="absolute inset-y-0 left-0 rounded-full bg-sea/80" style={{ height: "55%", top: "22%" }} initial={{ width: 0 }} animate={{ width: `${(a / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.05 }} />
            </div>
            <span className={`mono text-right ${a > b ? "text-good" : a < b ? "text-signal" : "text-faint"}`}>
              {a - b > 0 ? "+" : ""}
              {a - b}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface WhatIfResult {
  key: string;
  text: string;
  reply: string;
  proposal: Proposal | null;
}

export function WhatIfPanel({
  tripId, budget, previewId, appliedId, onPreview, onAccept, busyId, onAfterRun,
}: {
  tripId: string;
  appliedId: string | null;
  budget: number;
  previewId: string | null;
  onPreview: (p: Proposal) => void;
  onAccept: (p: Proposal) => void;
  busyId: string | null;
  onAfterRun: () => void;
}) {
  const [results, setResults] = useState<WhatIfResult[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstResult = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // bring the newest result into view inside the panel (not the page)
    const box = scrollRef.current;
    const card = firstResult.current;
    if (box && card) box.scrollTo({ top: Math.max(card.offsetTop - 12, 0), behavior: "smooth" });
  }, [results[0]?.key]);

  const run = async (scenario: string) => {
    const s = scenario.trim();
    if (!s || busy) return;
    setBusy(s);
    try {
      const r = await api<ChatReply>(`/trips/${tripId}/whatif`, { method: "POST", json: { scenario: s } });
      setResults((l) => [{ key: String(Date.now()), text: s, reply: r.reply, proposal: r.proposal }, ...l].slice(0, 4));
      setText("");
    } catch (e) {
      setResults((l) => [{ key: String(Date.now()), text: s, reply: e instanceof Error ? e.message : "Could not run that scenario.", proposal: null }, ...l].slice(0, 4));
    } finally {
      setBusy(null);
      onAfterRun();
    }
  };

  return (
    <div ref={scrollRef} className="relative flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="px-4 pb-3 pt-4">
        <p className="display-wide mb-0.5 text-lg">What if…</p>
        <p className="mb-3 text-[13px] text-muted">Test a change. Nothing is saved until you apply it.</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <motion.button key={p.label} type="button" whileTap={{ scale: 0.94 }} disabled={!!busy} onClick={() => run(p.text)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-60 ${busy === p.text ? "border-sea bg-sea-soft text-sea" : "border-line bg-surface text-muted hover:border-sea hover:text-sea"}`}>
              <Zap size={12} /> {p.label}
            </motion.button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void run(text); }} className="mt-3 flex gap-2">
          <input aria-label="Describe a scenario" value={text} onChange={(e) => setText(e.target.value)} placeholder="What if I cut the budget by ₹15,000?" className={inputCls} maxLength={400} />
          <Button type="submit" variant="soft" disabled={!text.trim()} loading={!!busy && busy === text.trim()} aria-label="Run scenario" className="w-11 !px-0" icon={<ArrowRight size={16} />} />
        </form>
      </div>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-6">
        <AnimatePresence initial={false}>
          {results.map((r, idx) => (
            <motion.div key={r.key} ref={idx === 0 ? firstResult : undefined} layout initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={spring} className="card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <p className="label mb-1">Scenario</p>
                <p className="text-sm font-medium">{r.text}</p>
              </div>
              {r.proposal && r.proposal.diff.changes.length > 0 ? (
                <div className="flex flex-col gap-4 px-4 py-4">
                  <div className="flex items-center gap-4">
                    <Ring value={r.proposal.diff.stability} />
                    <div className="text-[13px] leading-snug text-muted">
                      <p className="mb-0.5 font-medium text-ink">{r.proposal.diff.summary}</p>
                      <p>
                        {r.proposal.diff.items_before} → {r.proposal.diff.items_after} stops · travel {r.proposal.diff.travel_delta >= 0 ? "+" : "−"}
                        {Math.abs(r.proposal.diff.travel_delta)} min
                      </p>
                    </div>
                  </div>
                  <CostBars diff={r.proposal.diff} budget={budget} />
                  <div>
                    <p className="label mb-2">Interest coverage</p>
                    <Coverage diff={r.proposal.diff} />
                  </div>
                  {r.proposal.notes.length > 0 && <p className="text-xs text-muted">{r.proposal.notes.join(" ")}</p>}
                  {appliedId === r.proposal.version_id ? (
                    <p className="flex items-center gap-2 rounded-[10px] bg-good-soft px-3 py-2 text-[13px] font-semibold text-good">
                      <CheckCircle2 size={15} /> Applied to your plan
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="signal" onClick={() => onAccept(r.proposal!)} loading={busyId === r.proposal.version_id} icon={<Check size={14} />}>
                        Apply change
                      </Button>
                      <Button size="sm" variant={previewId === r.proposal.version_id ? "soft" : "ghost"} onClick={() => onPreview(r.proposal!)} icon={<Eye size={14} />}>
                        {previewId === r.proposal.version_id ? "Previewing" : "Preview on timeline"}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="px-4 py-4 text-sm text-muted">{r.reply}</p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {results.length === 0 && (
          <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-line p-6 text-center text-sm text-faint">
            <div>
              <Sparkles size={18} className="mx-auto mb-2 text-sea" />
              Pick a scenario above. Results show cost, travel and what stays the same.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- history */

const TYPE_LABEL: Record<string, string> = { create: "Created", edit: "Edited", replan: "Re-planned", whatif: "What if" };

export function HistoryPanel({ versions }: { versions: VersionRow[] }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <p className="display-wide mb-1 text-lg">Version history</p>
      <p className="mb-4 text-sm text-muted">Every accepted change is kept, so nothing is lost.</p>
      <ol className="relative m-0 flex flex-col gap-4 p-0 pl-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
        {versions.map((v, i) => (
          <motion.li key={v.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="relative list-none">
            <span className={`absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full border-2 ${v.current ? "border-sea bg-sea" : "border-faint bg-bg"}`} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono text-sm font-semibold">v{v.version_no}</span>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{TYPE_LABEL[v.change_type] ?? v.change_type}</span>
              {v.current && <span className="rounded-md bg-sea-soft px-1.5 py-0.5 text-[11px] font-semibold text-sea">current</span>}
              {v.status === "proposed" && <span className="rounded-md bg-signal-soft px-1.5 py-0.5 text-[11px] font-semibold text-signal">pending</span>}
            </div>
            <p className="mt-1 text-[13px] leading-snug">{v.reason}</p>
            {v.diff && <p className="mono mt-0.5 text-xs text-faint">{v.diff.summary}</p>}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

export const PanelIcons = { chat: MessageSquare, whatif: Zap, history: History };
