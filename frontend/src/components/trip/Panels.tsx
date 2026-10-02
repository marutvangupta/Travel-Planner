import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, ArrowRight, ArrowUp, Check, CloudRain, Eye, MoonStar, Snail, TrendingDown, TrendingUp, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { inr } from "../../lib/format";
import { ease, spring } from "../../lib/motion";
import type { ChatMessage, ChatReply, Diff, Itinerary, Proposal, VersionRow } from "../../lib/types";
import { Button, CountUp, inputCls } from "../ui";
import { Citations, KindBadge } from "./parts";

/* ------------------------------------------------------------------------------------- proposal card */

export function Delta({ diff }: { diff: Diff }) {
  const d = diff.cost_delta;
  return (
    <span className="mono flex shrink-0 items-center gap-2 text-[12px]">
      <span className={d < 0 ? "text-good" : d > 0 ? "text-bad" : "text-muted"}>
        {d > 0 ? "+" : d < 0 ? "−" : "±"}
        {inr(Math.abs(d))}
      </span>
      <span className="text-faint" aria-hidden>
        ·
      </span>
      <span className="text-muted" title="Share of the other stops left exactly as they were">
        {Math.round(diff.stability * 100)}% kept
      </span>
    </span>
  );
}

export function ProposalCard({
  diff, reason, affected, notes, onPreview, onAccept, onReject, previewing, busy, applyLabel = "Apply change",
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
  applyLabel?: string;
}) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="card relative overflow-hidden">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-signal" />
      <div className="flex flex-col gap-3 py-3.5 pl-4 pr-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label !text-signal">Proposed change</p>
            <p className="mt-1 text-[14px] font-semibold leading-snug">{reason ?? diff.summary}</p>
          </div>
          <Delta diff={diff} />
        </div>
        {affected && affected.length > 0 && (
          <p className="text-[13px] text-muted">
            Affects <span className="text-ink">{affected.map((a) => a.name).join(", ")}</span>
          </p>
        )}
        {diff.changes.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
            {diff.changes.slice(0, 6).map((c) => (
              <li key={c.kind + c.place_id} className="flex items-center gap-2 text-[13px]">
                <KindBadge kind={c.kind} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="mono shrink-0 text-[12px] text-muted">{c.detail}</span>
              </li>
            ))}
            {diff.changes.length > 6 && <li className="text-[12px] text-muted">and {diff.changes.length - 6} more</li>}
          </ul>
        )}
        {notes && notes.length > 0 && (
          <ul className="flex flex-col gap-1 text-[13px] leading-snug text-muted">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {(onAccept || onPreview || onReject) && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {onAccept && (
              <Button size="sm" onClick={onAccept} loading={busy} icon={<Check size={14} />}>
                {applyLabel}
              </Button>
            )}
            {onPreview && (
              <Button size="sm" variant={previewing ? "soft" : "ghost"} onClick={onPreview} icon={<Eye size={14} />} aria-pressed={previewing}>
                {previewing ? "Previewing" : "Preview"}
              </Button>
            )}
            {onReject && (
              <Button size="sm" variant="quiet" onClick={onReject} className="ml-auto" icon={<X size={14} />}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </div>
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
  error?: boolean;
}

const THINKING = ["Reading your itinerary", "Checking opening hours", "Finding what is affected", "Re-planning only what changed", "Verifying the result"];

export function ChatPanel({
  tripId, messages, itinerary, previewId, onPreview, onAccept, onReject, onAfterSend, busyId, draft, onDraftUsed,
}: {
  tripId: string;
  messages: ChatMessage[];
  itinerary: Itinerary;
  previewId: string | null;
  onPreview: (p: Proposal, reveal?: boolean) => void;
  onAccept: (p: Proposal) => void;
  onReject: (versionId: string) => void;
  onAfterSend: () => void;
  busyId: string | null;
  /** Text to place in the composer (for example from "Ask for ideas"); `n` changes on every request. */
  draft?: { text: string; n: number } | null;
  /** Called once the draft is in the composer, so remounting the panel does not apply it again. */
  onDraftUsed?: () => void;
}) {
  const initial = useMemo<Bubble[]>(() => messages.map((m) => ({ key: m.id, role: m.role, text: m.content, citations: m.payload?.citations })), [messages]);
  const [local, setLocal] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!draft) return;
    setInput(draft.text);
    onDraftUsed?.();
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
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

  const items = itinerary.days.flatMap((d) => d.items);
  const outdoor = items.find((i) => !i.indoor);
  const busiest = [...itinerary.days].sort((a, b) => b.items.length - a.items.length)[0];
  const suggestions = [
    outdoor ? `Swap ${outdoor.name} for something indoors` : "Add more food experiences",
    "Make it more relaxed",
    `Is day ${(busiest?.index ?? 0) + 1} too packed?`,
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
      if (r.proposal?.version_id) onPreview(r.proposal, false);
    } catch (e) {
      setLocal((l) => [...l, { key: `e${Date.now()}`, role: "assistant", text: e instanceof Error ? e.message : "Something went wrong. Try again.", error: true }]);
    } finally {
      setBusy(false);
      onAfterSend();
      inputRef.current?.focus();
    }
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const all = [...initial.filter((b) => !local.some((l) => l.text === b.text && l.role === b.role)), ...local];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-busy={busy}>
        {all.length === 0 && !busy ? (
          <div className="flex h-full flex-col justify-end gap-4">
            <div>
              <p className="text-[15px] font-semibold">Change anything in plain words</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">Swap a stop, trim the budget, slow the pace or ask a question. Changes are shown as a preview before anything is applied.</p>
            </div>
            <ul className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => send(s)} className="group flex w-full items-center justify-between gap-3 rounded-[var(--radius-ctl)] border border-line bg-surface px-3 py-2.5 text-left text-[13px] font-medium transition-colors hover:border-sea/60 hover:text-sea">
                    <span className="min-w-0 truncate">{s}</span>
                    <ArrowRight size={14} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-sea" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="m-0 flex flex-col gap-3 p-0">
            {all.map((b) => (
              <motion.li key={b.key} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease }} className={`flex list-none flex-col gap-2 ${b.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-line rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug ${
                    b.role === "user" ? "rounded-br-[5px] bg-sea text-sea-ink" : b.error ? "rounded-bl-[5px] bg-signal-soft text-signal" : "rounded-bl-[5px] bg-surface-2"
                  }`}
                >
                  {b.text}
                  {b.citations && b.citations.length > 0 && (
                    <div className="-ml-1.5 mt-1.5">
                      <Citations ids={b.citations} sources={itinerary.sources} />
                    </div>
                  )}
                </div>
                {b.proposal && b.proposal.version_id && b.proposal.diff.changes.length > 0 && !dismissed.has(b.proposal.version_id) && (
                  <div className="w-full">
                    <ProposalCard
                      diff={b.proposal.diff}
                      affected={b.proposal.affected}
                      notes={b.proposal.notes}
                      previewing={previewId === b.proposal.version_id}
                      busy={busyId === b.proposal.version_id}
                      onPreview={() => onPreview(b.proposal!, true)}
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
          </ul>
        )}
        <AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 flex items-center gap-2.5 text-[13px] text-muted">
              <span className="flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.i key={i} className="block h-1.5 w-1.5 rounded-full bg-sea" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }} />
                ))}
              </span>
              <AnimatePresence mode="wait">
                <motion.span key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                  {THINKING[step]}
                </motion.span>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="border-t border-line p-3">
        {all.length > 0 && (
          <div className="no-scrollbar fade-x mb-2.5 flex gap-1.5 overflow-x-auto pr-6">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} disabled={busy} className="h-7 shrink-0 rounded-full border border-line px-2.5 text-[12px] font-medium text-muted transition-colors hover:border-sea/60 hover:text-sea disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={onSubmit} className="relative">
          <input ref={inputRef} aria-label="Ask for a change or a question" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Swap the fort for something indoors…" className={`${inputCls} pr-12`} maxLength={600} />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-[7px] bg-sea text-sea-ink transition-opacity disabled:opacity-30"
          >
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- what if */

const PRESETS: { label: string; text: string; icon: LucideIcon }[] = [
  { label: "Cut ₹10,000", text: "What if I reduce my budget by ₹10,000?", icon: TrendingDown },
  { label: "Cut ₹25,000", text: "What if I reduce my budget by ₹25,000?", icon: TrendingDown },
  { label: "Add ₹20,000", text: "What if I increase my budget by ₹20,000?", icon: TrendingUp },
  { label: "Slow the pace", text: "What if I take it slower?", icon: Snail },
  { label: "Rain on day 2", text: "What if it rains on day 2?", icon: CloudRain },
  { label: "Start later", text: "What if I start later each day?", icon: AlarmClock },
  { label: "Skip nightlife", text: "What if I skip nightlife?", icon: MoonStar },
];

function Ring({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${Math.round(value * 100)}% of other stops unchanged`} className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <motion.circle cx="28" cy="28" r={r} fill="none" stroke="var(--sea)" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="12" fontWeight="600" fill="var(--ink)">
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

function CostBars({ diff, budget }: { diff: Diff; budget: number }) {
  const max = Math.max(diff.cost_before, diff.cost_after, budget) || 1;
  const rows = [
    { label: "Now", value: diff.cost_before, color: "var(--line-strong)" },
    { label: "If applied", value: diff.cost_after, color: diff.cost_after <= diff.cost_before ? "var(--sea)" : "var(--signal)" },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-[12px]">
            <span className="text-muted">{r.label}</span>
            <span className="mono font-medium">
              <CountUp value={r.value} format={inr} />
            </span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-2">
            <motion.div className="h-full rounded-full" style={{ background: r.color }} initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.1, ease: [0.22, 1, 0.36, 1] }} />
            <span className="absolute inset-y-0 w-px bg-ink/40" style={{ left: `${(budget / max) * 100}%` }} title="Budget" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Coverage({ diff }: { diff: Diff }) {
  const keys = Array.from(new Set([...Object.keys(diff.interests_before), ...Object.keys(diff.interests_after)]))
    .sort((a, b) => (diff.interests_after[b] ?? 0) - (diff.interests_after[a] ?? 0))
    .slice(0, 5);
  const max = Math.max(1, ...keys.map((k) => Math.max(diff.interests_before[k] ?? 0, diff.interests_after[k] ?? 0)));
  return (
    <div className="flex flex-col gap-1.5">
      {keys.map((k, i) => {
        const b = diff.interests_before[k] ?? 0;
        const a = diff.interests_after[k] ?? 0;
        return (
          <div key={k} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-[12px]">
            <span className="truncate capitalize text-muted">{k}</span>
            <div className="relative h-1.5 rounded-full bg-surface-2">
              <motion.span className="absolute inset-y-0 left-0 rounded-full bg-line-strong" initial={{ width: 0 }} animate={{ width: `${(b / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.04 }} />
              <motion.span className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-sea" initial={{ width: 0 }} animate={{ width: `${(a / max) * 100}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.04 }} />
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
  tripId, budget, previewId, onPreview, onAccept, busyId, onAfterRun,
}: {
  tripId: string;
  budget: number;
  previewId: string | null;
  onPreview: (p: Proposal, reveal?: boolean) => void;
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
      <div className="px-4 pb-4 pt-4">
        <p className="text-[15px] font-semibold">Try a scenario</p>
        <p className="mb-3 mt-0.5 text-[13px] text-muted">See cost, travel time and what stays the same. Nothing is saved until you apply it.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map(({ label, text: t, icon: Icon }) => {
            const running = busy === t;
            return (
              <motion.button
                key={label}
                type="button"
                whileTap={{ scale: 0.97 }}
                disabled={!!busy}
                onClick={() => run(t)}
                aria-busy={running || undefined}
                className={`flex h-9 items-center gap-2 rounded-[var(--radius-ctl)] border px-2.5 text-left text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                  running ? "border-sea/60 bg-sea-soft text-sea" : "border-line bg-surface text-ink hover:border-sea/60 hover:text-sea disabled:opacity-50"
                }`}
              >
                <Icon size={14} className={running ? "animate-pulse" : "text-muted"} aria-hidden />
                <span className="truncate">{label}</span>
              </motion.button>
            );
          })}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(text);
          }}
          className="relative mt-2"
        >
          <input aria-label="Describe your own scenario" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or describe one: what if I cut ₹15,000?" className={`${inputCls} pr-12`} maxLength={400} />
          <button type="submit" disabled={!text.trim() || !!busy} aria-label="Run scenario" className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-[7px] bg-sea-soft text-sea transition-opacity disabled:opacity-30">
            <ArrowRight size={16} />
          </button>
        </form>
      </div>
      <div className="flex flex-1 flex-col gap-3 border-t border-line px-4 pb-6 pt-4">
        <AnimatePresence initial={false}>
          {results.map((r, idx) => (
            <motion.div key={r.key} ref={idx === 0 ? firstResult : undefined} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring} className="card overflow-hidden">
              <div className="border-b border-line px-4 py-2.5">
                <p className="text-[13px] font-semibold">{r.text}</p>
              </div>
              {r.proposal && r.proposal.diff.changes.length > 0 ? (
                <div className="flex flex-col gap-4 px-4 py-4">
                  <div className="flex items-center gap-3.5">
                    <Ring value={r.proposal.diff.stability} />
                    <div className="text-[13px] leading-snug text-muted">
                      <p className="mb-0.5 font-medium text-ink">{r.proposal.diff.summary}</p>
                      <p className="mono text-[12px]">
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
                  {r.proposal.notes.length > 0 && <p className="text-[12px] leading-snug text-muted">{r.proposal.notes.join(" ")}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onAccept(r.proposal!)} loading={busyId === r.proposal.version_id} icon={<Check size={14} />}>
                      Apply
                    </Button>
                    <Button size="sm" variant={previewId === r.proposal.version_id ? "soft" : "ghost"} onClick={() => onPreview(r.proposal!, true)} icon={<Eye size={14} />} aria-pressed={previewId === r.proposal.version_id}>
                      {previewId === r.proposal.version_id ? "Previewing" : "Preview on plan"}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="px-4 py-3.5 text-[13px] text-muted">{r.reply}</p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {results.length === 0 && (
          <div className="grid flex-1 place-items-center px-6 py-8 text-center">
            <p className="max-w-[30ch] text-[13px] text-muted">Results appear here with cost, travel time, interest coverage and how much of the plan stays put.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------- history */

const TYPE_LABEL: Record<string, string> = { create: "Created", edit: "Edited", replan: "Re-planned", whatif: "What if" };

export function HistoryPanel({ versions, loading }: { versions: VersionRow[]; loading?: boolean }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <p className="text-[15px] font-semibold">Version history</p>
      <p className="mb-5 mt-0.5 text-[13px] text-muted">Every applied change is kept, so nothing is lost.</p>
      {loading && versions.length === 0 ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12" />
          ))}
        </div>
      ) : (
        <ol className="relative m-0 flex flex-col gap-5 p-0 pl-6 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line-strong">
          {versions.map((v, i) => (
            <motion.li key={v.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.3, ease }} className="relative list-none">
              <span className={`absolute -left-6 top-[5px] h-[11px] w-[11px] rounded-full border-2 ${v.current ? "border-sea bg-sea" : v.status === "proposed" ? "border-signal bg-surface" : "border-line-strong bg-surface"}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-[13px] font-semibold">v{v.version_no}</span>
                <span className="text-[13px] text-muted">{TYPE_LABEL[v.change_type] ?? v.change_type}</span>
                {v.current && <span className="rounded bg-sea-soft px-1.5 py-px text-[11px] font-semibold text-sea">Current</span>}
                {v.status === "proposed" && <span className="rounded bg-signal-soft px-1.5 py-px text-[11px] font-semibold text-signal">Waiting for review</span>}
              </div>
              <p className="mt-1 text-[14px] leading-snug">{v.reason}</p>
              {v.diff && <p className="mono mt-0.5 text-[12px] text-muted">{v.diff.summary}</p>}
            </motion.li>
          ))}
        </ol>
      )}
    </div>
  );
}
