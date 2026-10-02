import { AnimatePresence, motion } from "framer-motion";
import { Brain, Check, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Chip, Segmented, Toggle, inputCls } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDocumentTitle } from "../lib/a11y";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";
import { ease, pageVariants, rise, spring, stagger } from "../lib/motion";
import type { Memory, Prefs } from "../lib/types";

const AVOID = ["museum", "temple", "fort", "market", "nightlife", "shopping", "beach"];

function WeightBars({ weights }: { weights: Record<string, number> }) {
  const rows = Object.entries(weights).filter(([, v]) => Math.abs(v) >= 0.05).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  if (!rows.length) return <p className="text-sm text-faint">Nothing yet. Give a thumbs up or down on a stop and your taste profile starts to take shape.</p>;
  return (
    <ul className="m-0 flex flex-col gap-2.5 p-0">
      {rows.map(([k, v], i) => (
        <li key={k} className="grid list-none grid-cols-[6.5rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate capitalize text-muted">{k}</span>
          <span className="relative h-2.5 rounded-full bg-surface-2">
            <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line" />
            <motion.span
              className={`absolute inset-y-0 rounded-full ${v >= 0 ? "bg-sea" : "bg-signal"}`}
              style={v >= 0 ? { left: "50%" } : { right: "50%" }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.abs(v) * 50}%` }}
              transition={{ duration: 0.9, ease: [...ease], delay: i * 0.06 }}
            />
          </span>
          <span className={`mono text-right text-xs ${v >= 0 ? "text-sea" : "text-signal"}`}>{v > 0 ? "+" : ""}{v.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function MemoryPage() {
  const { meta } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState<Prefs | null>(null);
  const [mems, setMems] = useState<Memory[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useDocumentTitle("Preferences and memory");

  // compare everything the form edits (order-insensitive for the lists) to what the server last confirmed
  const dirty = useMemo(() => {
    if (!prefs || !saved) return false;
    const norm = (p: Prefs) => JSON.stringify([p.pace, p.travel_style, p.diet, p.step_free, [...p.interests].sort(), [...p.avoid].sort()]);
    return norm(prefs) !== norm(saved);
  }, [prefs, saved]);
  useEffect(() => {
    if (dirty) setJustSaved(false);
  }, [dirty]);

  useEffect(() => {
    api<Prefs>("/preferences")
      .then((p) => {
        setPrefs(p);
        setSaved(p);
      })
      .catch((e) => toast(e.message, "error"));
    api<Memory[]>("/memories").then(setMems).catch(() => setMems([]));
  }, [toast]);

  const patch = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => (p ? { ...p, [k]: v } : p));
  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const { category_weights: _w, ...body } = prefs;
      void _w;
      const next = await api<Prefs>("/preferences", { method: "PUT", json: body });
      setPrefs(next);
      setSaved(next);
      setJustSaved(true);
      toast("Preferences saved. New trips start from these.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };
  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3 || adding) return;
    setAdding(true);
    try {
      const m = await api<Memory>("/memories", { method: "POST", json: { content: note.trim() } });
      setMems((l) => [m, ...(l ?? [])]);
      setNote("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that", "error");
    } finally {
      setAdding(false);
    }
  };
  const forget = async (id: string) => {
    try {
      await api(`/memories/${id}`, { method: "DELETE" });
      setMems((l) => l?.filter((m) => m.id !== id) ?? null);
      toast("Forgotten");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not delete", "error");
    }
  };

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" className="min-h-full">
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <p className="label mb-3">What I know about you</p>
        <h1 className="display mb-3 text-title">Preferences and memory</h1>
        <p className="mb-10 max-w-2xl text-[16px] text-muted">New trips start from your preferences. I also learn from the stops you like, dislike or remove, and everything I learn is listed here with the evidence. You can delete any of it.</p>

        <div className="grid items-start gap-8 lg:grid-cols-2">
          <motion.section variants={stagger(0.06)} initial="hidden" animate="show" className="card flex flex-col gap-6 rounded-panel p-6 sm:p-7">
            <motion.h2 variants={rise} className="display-wide flex items-center gap-2 text-2xl">
              <UserRound size={20} className="text-sea" /> Your defaults
            </motion.h2>
            {!prefs ? (
              <div className="skeleton h-72" />
            ) : (
              <>
                <motion.div variants={rise}>
                  <p className="label mb-2">Pace</p>
                  <Segmented label="Pace" value={prefs.pace} onChange={(v) => patch("pace", v)} options={[{ value: "relaxed", label: "Relaxed" }, { value: "balanced", label: "Balanced" }, { value: "packed", label: "Packed" }]} />
                </motion.div>
                <motion.div variants={rise}>
                  <p className="label mb-2">Style</p>
                  <Segmented label="Style" value={prefs.travel_style} onChange={(v) => patch("travel_style", v)} options={[{ value: "budget", label: "Budget" }, { value: "balanced", label: "Balanced" }, { value: "luxury", label: "Luxury" }]} />
                </motion.div>
                <motion.div variants={rise}>
                  <p className="label mb-2">Diet</p>
                  <Segmented label="Diet" value={prefs.diet} onChange={(v) => patch("diet", v)} options={[{ value: "none", label: "No preference" }, { value: "vegetarian", label: "Vegetarian" }, { value: "vegan", label: "Vegan" }]} />
                </motion.div>
                <motion.div variants={rise}>
                  <Toggle checked={prefs.step_free} onChange={(v) => patch("step_free", v)} label="Step-free access" hint="Skip places with stairs or steep climbs." />
                </motion.div>
                <motion.div variants={rise}>
                  <p className="label mb-2">Usually into</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(meta?.interests ?? []).map((i) => (
                      <Chip key={i} active={prefs.interests.includes(i)} onClick={() => patch("interests", prefs.interests.includes(i) ? prefs.interests.filter((x) => x !== i) : [...prefs.interests, i])}>
                        {titleCase(i)}
                      </Chip>
                    ))}
                  </div>
                </motion.div>
                <motion.div variants={rise}>
                  <p className="label mb-2">Usually skip</p>
                  <div className="flex flex-wrap gap-1.5">
                    {AVOID.map((a) => (
                      <Chip key={a} tone="signal" active={prefs.avoid.includes(a)} onClick={() => patch("avoid", prefs.avoid.includes(a) ? prefs.avoid.filter((x) => x !== a) : [...prefs.avoid, a])}>
                        {titleCase(a)}
                      </Chip>
                    ))}
                  </div>
                </motion.div>
                <motion.div variants={rise} className="flex items-center gap-3 border-t border-line pt-5">
                  <Button onClick={save} loading={saving} disabled={!dirty && !saving} icon={!dirty && justSaved ? <Check size={16} /> : undefined}>
                    {saving ? "Saving…" : !dirty && justSaved ? "Saved" : "Save preferences"}
                  </Button>
                  <AnimatePresence initial={false}>
                    {dirty && !saving && (
                      <motion.span key="dirty" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[13px] text-muted">
                        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden /> Unsaved changes
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </>
            )}
          </motion.section>

          <div className="flex flex-col gap-8">
            <section className="card rounded-panel p-6 sm:p-7">
              <h2 className="display-wide mb-1 flex items-center gap-2 text-2xl">
                <Sparkles size={20} className="text-sea" /> Taste profile
              </h2>
              <p className="mb-5 text-sm text-muted">Built from thumbs up, thumbs down and removed stops. Positive leans toward, negative leans away.</p>
              {prefs ? <WeightBars weights={prefs.category_weights} /> : <div className="skeleton h-32" />}
            </section>

            <section className="card rounded-panel p-6 sm:p-7">
              <h2 className="display-wide mb-1 flex items-center gap-2 text-2xl">
                <Brain size={20} className="text-sea" /> What I have learned
              </h2>
              <p className="mb-4 text-sm text-muted">Used when planning, ranked by how relevant they are to the trip.</p>
              <form onSubmit={addNote} className="mb-5 flex gap-2">
                <input aria-label="Tell me something about how you travel" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="I get tired of long drives" maxLength={200} />
                <Button type="submit" variant="soft" disabled={note.trim().length < 3} loading={adding} icon={<Plus size={16} />} className="shrink-0">
                  Add
                </Button>
              </form>
              <ul className="m-0 flex flex-col gap-3 p-0">
                <AnimatePresence initial={false}>
                  {(mems ?? []).map((m) => (
                    <motion.li key={m.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, height: 0, marginBottom: -12 }} transition={spring} className="group list-none overflow-hidden rounded-xl border border-line bg-surface-2 p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium leading-snug">{m.content}</p>
                          <p className="mt-1 text-xs text-muted">{m.evidence ?? (m.kind === "explicit" ? "You told me this" : "Inferred")}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.kind === "explicit" ? "bg-sea-soft text-sea" : "bg-warn-soft text-warn"}`}>{m.kind}</span>
                            <span className="h-1 w-16 overflow-hidden rounded-full bg-line">
                              <motion.span className="block h-full bg-sea" initial={{ width: 0 }} animate={{ width: `${m.confidence * 100}%` }} transition={{ duration: 0.8, ease: [...ease] }} />
                            </span>
                            <span className="mono text-[11px] text-faint">{Math.round(m.confidence * 100)}%</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => forget(m.id)} aria-label={`Forget: ${m.content}`} data-tip="Forget this" data-tip-align="end" className="tip relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-bad-soft hover:text-bad">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
              {mems === null && (
                <div className="flex flex-col gap-3" aria-hidden>
                  <div className="skeleton h-[84px] rounded-xl" />
                  <div className="skeleton h-[84px] rounded-xl opacity-70" />
                </div>
              )}
              {mems && mems.length === 0 && (
                <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-muted">Nothing learned yet. Rate a few stops in a trip, or add a note above.</p>
              )}
            </section>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
