import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button, Chip, Segmented, Toggle, inputCls } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";
import { ease, pageVariants, spring } from "../lib/motion";
import type { Memory, Prefs } from "../lib/types";

const AVOID = ["museum", "temple", "fort", "market", "nightlife", "shopping", "beach"];
type Editable = Omit<Prefs, "category_weights">;
const editable = (p: Prefs): Editable => ({ pace: p.pace, travel_style: p.travel_style, diet: p.diet, step_free: p.step_free, interests: [...p.interests].sort(), avoid: [...p.avoid].sort() });

function Row({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-3 border-t border-line py-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <div>
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {body && <p className="mt-1 text-[13px] leading-snug text-muted">{body}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SectionHead({ title, body, id }: { title: string; body: string; id?: string }) {
  return (
    <div className="mb-2">
      <h2 id={id} className="display-wide text-[22px]">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-[14px] text-muted">{body}</p>
    </div>
  );
}

function WeightBars({ weights }: { weights: Record<string, number> }) {
  const rows = Object.entries(weights)
    .filter(([, v]) => Math.abs(v) >= 0.05)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8);
  if (!rows.length)
    return <p className="rounded-[var(--radius-box)] border border-dashed border-line-strong px-4 py-5 text-[14px] text-muted">Nothing yet. Use the thumbs on any stop in a trip and your taste profile starts to take shape here.</p>;
  return (
    <ul className="m-0 flex flex-col gap-2.5 p-0" aria-label="Category weights">
      <li className="grid list-none grid-cols-[7rem_1fr_3rem] gap-3 text-[11px] text-muted">
        <span />
        <span className="flex justify-between">
          <span>Leans away</span>
          <span>Leans toward</span>
        </span>
        <span />
      </li>
      {rows.map(([k, v], i) => (
        <li key={k} className="grid list-none grid-cols-[7rem_1fr_3rem] items-center gap-3 text-[13px]">
          <span className="truncate capitalize">{k}</span>
          <span className="relative h-2 rounded-full bg-surface-2">
            <span className="absolute inset-y-[-3px] left-1/2 w-px bg-line-strong" />
            <motion.span
              className={`absolute inset-y-0 rounded-full ${v >= 0 ? "bg-sea" : "bg-signal"}`}
              style={v >= 0 ? { left: "50%" } : { right: "50%" }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(Math.abs(v), 1) * 50}%` }}
              transition={{ duration: 0.8, ease: [...ease], delay: i * 0.05 }}
            />
          </span>
          <span className={`mono text-right text-[12px] ${v >= 0 ? "text-sea" : "text-signal"}`}>
            {v > 0 ? "+" : ""}
            {v.toFixed(2)}
          </span>
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

  useEffect(() => {
    api<Prefs>("/preferences")
      .then((p) => {
        setPrefs(p);
        setSaved(p);
      })
      .catch((e) => toast(e.message, "error"));
    api<Memory[]>("/memories")
      .then(setMems)
      .catch(() => setMems([]));
  }, [toast]);

  const dirty = useMemo(() => !!prefs && !!saved && JSON.stringify(editable(prefs)) !== JSON.stringify(editable(saved)), [prefs, saved]);
  const patch = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => (p ? { ...p, [k]: v } : p));
  const toggleIn = (k: "interests" | "avoid", v: string) => prefs && patch(k, prefs[k].includes(v) ? prefs[k].filter((x) => x !== v) : [...prefs[k], v]);

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const next = await api<Prefs>("/preferences", { method: "PUT", json: editable(prefs) });
      setPrefs(next);
      setSaved(next);
      toast("Preferences saved. New trips start from these.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  };
  const addNote = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return;
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
      <div className="mx-auto max-w-[960px] px-4 pb-32 pt-10 sm:px-6 sm:pt-14">
        <p className="label mb-3">Preferences and memory</p>
        <h1 className="display text-[40px] sm:text-[48px]">Your travel profile</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          New trips start from these defaults. Waypoint also learns from the stops you like, dislike or remove. Everything it learns is listed here with the evidence, and you can delete any of it.
        </p>

        <section className="mt-12" aria-labelledby="defaults-h">
          <SectionHead id="defaults-h" title="Defaults for new trips" body="You can still change any of these when planning a specific trip." />
          {!prefs ? (
            <div className="flex flex-col gap-3 border-t border-line pt-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-12" />
              ))}
            </div>
          ) : (
            <>
              <Row title="Pace" body="How many sights fit in a day.">
                <Segmented label="Pace" value={prefs.pace} onChange={(v) => patch("pace", v)} options={[{ value: "relaxed", label: "Relaxed" }, { value: "balanced", label: "Balanced" }, { value: "packed", label: "Packed" }]} />
              </Row>
              <Row title="Style" body="Shapes how much is spent on each stop and meal.">
                <Segmented label="Style" value={prefs.travel_style} onChange={(v) => patch("travel_style", v)} options={[{ value: "budget", label: "Budget" }, { value: "balanced", label: "Balanced" }, { value: "luxury", label: "Luxury" }]} />
              </Row>
              <Row title="Diet" body="Meals that do not fit are never planned.">
                <Segmented label="Diet" value={prefs.diet} onChange={(v) => patch("diet", v)} options={[{ value: "none", label: "No preference" }, { value: "vegetarian", label: "Vegetarian" }, { value: "vegan", label: "Vegan" }]} />
              </Row>
              <Row title="Access">
                <Toggle checked={prefs.step_free} onChange={(v) => patch("step_free", v)} label="Step-free access" hint="Skip places with stairs or steep climbs." />
              </Row>
              <Row title="Usually into" body="Considered first when choosing places.">
                <div className="flex flex-wrap gap-1.5">
                  {(meta?.interests ?? []).map((i) => (
                    <Chip key={i} active={prefs.interests.includes(i)} onClick={() => toggleIn("interests", i)}>
                      {titleCase(i)}
                    </Chip>
                  ))}
                </div>
              </Row>
              <Row title="Usually skip" body="Never planned unless you ask.">
                <div className="flex flex-wrap gap-1.5">
                  {AVOID.map((a) => (
                    <Chip key={a} tone="signal" active={prefs.avoid.includes(a)} onClick={() => toggleIn("avoid", a)}>
                      {titleCase(a)}
                    </Chip>
                  ))}
                </div>
              </Row>
            </>
          )}
        </section>

        <section className="mt-14" aria-labelledby="taste-h">
          <SectionHead id="taste-h" title="Taste profile" body="Built from thumbs up, thumbs down and removed stops. It nudges which places rank first." />
          <div className="border-t border-line pt-6">{prefs ? <WeightBars weights={prefs.category_weights} /> : <div className="skeleton h-28" />}</div>
        </section>

        <section className="mt-14" aria-labelledby="learned-h">
          <SectionHead id="learned-h" title="What Waypoint has learned" body="Used when planning, ranked by how relevant each one is to the trip." />
          <div className="border-t border-line pt-6">
            <form onSubmit={addNote} className="relative mb-6">
              <input aria-label="Tell Waypoint something about how you travel" className={`${inputCls} pr-28`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Tell it something, for example: I get tired of long drives" maxLength={200} />
              <Button type="submit" size="sm" variant="soft" disabled={note.trim().length < 3} loading={adding} icon={<Plus size={14} />} className="absolute right-1.5 top-1.5">
                Remember
              </Button>
            </form>
            {mems === null ? (
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton h-16" />
                ))}
              </div>
            ) : mems.length === 0 ? (
              <p className="text-[14px] text-muted">Nothing learned yet. Rate a few stops in a trip, or add a note above.</p>
            ) : (
              <ul className="m-0 flex flex-col p-0">
                <AnimatePresence initial={false}>
                  {mems.map((m) => (
                    <motion.li
                      key={m.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
                      transition={spring}
                      className="group flex list-none items-start gap-4 overflow-hidden border-b border-line py-4 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium leading-snug">{m.content}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                          <span className={`rounded px-1.5 py-px font-semibold ${m.kind === "explicit" ? "bg-sea-soft text-sea" : "bg-warn-soft text-warn"}`}>{m.kind === "explicit" ? "You said" : "Inferred"}</span>
                          <span>{m.evidence ?? (m.kind === "explicit" ? "You told me this" : "From your feedback")}</span>
                          <span aria-hidden>·</span>
                          <span className="inline-flex items-center gap-1.5" title="Confidence">
                            <span className="h-1 w-12 overflow-hidden rounded-full bg-line">
                              <motion.span className="block h-full bg-sea" initial={{ width: 0 }} animate={{ width: `${m.confidence * 100}%` }} transition={{ duration: 0.7, ease: [...ease] }} />
                            </span>
                            <span className="mono">{Math.round(m.confidence * 100)}%</span>
                          </span>
                        </p>
                      </div>
                      <button type="button" onClick={() => forget(m.id)} aria-label={`Forget: ${m.content}`} title="Forget this" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-surface-2 hover:text-bad">
                        <Trash2 size={15} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </section>
      </div>

      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={spring} className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="pop mx-auto flex max-w-[640px] items-center gap-3 py-2.5 pl-4 pr-2.5" role="region" aria-label="Unsaved changes">
              <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-[14px] font-medium">Unsaved changes</p>
              <Button size="sm" variant="quiet" onClick={() => setPrefs(saved)} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" onClick={save} loading={saving}>
                Save
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
