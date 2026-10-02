import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, MapPin } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { api } from "../../lib/api";
import { inputCls } from "../ui";

export interface Suggestion {
  label: string;
  name: string;
  detail: string;
}

// Shown before typing in live mode, and used as an offline fallback if the lookup fails.
const POPULAR: Suggestion[] = [
  { label: "Jaipur, India", name: "Jaipur", detail: "India" },
  { label: "Goa, India", name: "Goa", detail: "India" },
  { label: "Udaipur, India", name: "Udaipur", detail: "India" },
  { label: "Tokyo, Japan", name: "Tokyo", detail: "Japan" },
  { label: "Paris, France", name: "Paris", detail: "France" },
  { label: "Dubai, United Arab Emirates", name: "Dubai", detail: "United Arab Emirates" },
  { label: "Singapore", name: "Singapore", detail: "Singapore" },
  { label: "Bali, Indonesia", name: "Bali", detail: "Indonesia" },
];

const fromLabel = (label: string): Suggestion => {
  const [name, ...rest] = label.split(",");
  return { label, name: name.trim(), detail: rest.join(",").trim() };
};
/** Matches ranked the way people type: city-name prefix, then any word prefix, then anywhere ("pa" is Paris before Japan). */
function rank(list: Suggestion[], query: string): Suggestion[] {
  const q = query.toLowerCase();
  if (!q) return list;
  const score = (s: Suggestion) => {
    const name = s.name.toLowerCase();
    const label = s.label.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (label.split(/[\s,]+/).some((w) => w.startsWith(q))) return 1;
    if (name.includes(q)) return 2;
    return label.includes(q) ? 3 : -1;
  };
  return list
    .map((s) => ({ s, k: score(s) }))
    .filter((x) => x.k >= 0)
    .sort((a, b) => a.k - b.k)
    .map((x) => x.s);
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-transparent text-sea">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * Destination combobox. Demo mode filters the supported cities locally; live mode asks the API for matching cities
 * once typing settles. Free text is always accepted, so a failed lookup never blocks planning.
 */
export function DestinationField({ id, value, onChange, demoCities, autoFocus }: { id: string; value: string; onChange: (v: string) => void; demoCities: string[] | null; autoFocus?: boolean }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<{ q: string; items: Suggestion[]; failed: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const demo = demoCities !== null;
  const q = value.trim();

  useEffect(() => {
    if (demo || !open || q.length < 2 || remote?.q === q) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ suggestions: Suggestion[]; error?: string }>(`/destinations?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => setRemote({ q, items: r.suggestions, failed: !!r.error }))
        .catch(() => {
          if (!ctl.signal.aborted) setRemote({ q, items: [], failed: true });
        })
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [q, demo, open, remote?.q]);

  const { heading, items, message } = useMemo(() => {
    if (demoCities) {
      const found = rank(demoCities.map(fromLabel), q);
      return {
        heading: "Demo cities",
        items: found,
        message: found.length ? "" : "Demo mode covers Jaipur, Goa, Tokyo and Paris. Add a Google Maps key to plan anywhere else.",
      };
    }
    if (q.length >= 2 && remote?.q === q && remote.items.length) return { heading: "Cities", items: remote.items, message: "" };
    const local = rank(POPULAR, q);
    const settled = q.length >= 2 && remote?.q === q && !loading;
    return {
      heading: local.length ? "Popular destinations" : "",
      items: local,
      message: loading && !local.length ? "Searching…" : settled && remote?.failed ? "City suggestions are unavailable right now. Type the city and continue." : settled ? "No matching cities. You can still type any destination." : "",
    };
  }, [demo, demoCities, q, remote, loading]);

  useEffect(() => setActive(-1), [q, items.length]);

  const pick = (s: Suggestion) => {
    onChange(s.label);
    setOpen(false);
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Enter" && open && active >= 0 && items[active]) {
      // choose the highlighted city; with nothing highlighted, Enter falls through and submits the step
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab" || e.key === "Enter") {
      setOpen(false);
    }
  };
  const showList = open && (items.length > 0 || !!message);

  return (
    <div className="relative">
      <MapPin size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        className={`${inputCls} !h-12 pl-10 pr-10 !text-[17px]`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="City, country"
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
      />
      {loading && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-faint" aria-hidden />}
      <AnimatePresence>
        {showList && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.12 }}
            className="pop absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden"
            // keep focus in the input while choosing with the mouse
            onMouseDown={(e) => e.preventDefault()}
          >
            {heading && <p className="label px-3.5 pb-1 pt-3">{heading}</p>}
            {items.length > 0 && (
              <ul role="listbox" id={listId} aria-label="Destination suggestions" className="m-0 max-h-72 overflow-y-auto p-1.5">
                {items.map((s, i) => {
                  const chosen = s.label === value;
                  return (
                    <li
                      key={s.label}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onClick={() => pick(s)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer list-none items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${i === active ? "bg-surface-2" : ""}`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sea-soft text-sea" aria-hidden>
                        <MapPin size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">
                          <Highlight text={s.name} q={q} />
                        </span>
                        {s.detail && <span className="block truncate text-[12px] text-muted">{s.detail}</span>}
                      </span>
                      {chosen && <Check size={16} className="shrink-0 text-sea" aria-label="Selected" />}
                    </li>
                  );
                })}
              </ul>
            )}
            {message && (
              <p className="px-3.5 pb-3 pt-1 text-[13px] text-muted" role="status">
                {message}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
