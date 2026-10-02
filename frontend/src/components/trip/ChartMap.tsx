import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MapPin } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { hhmm } from "../../lib/format";
import { ease } from "../../lib/motion";
import type { Day, Item } from "../../lib/types";

const PAD = 52;
export const DAY_COLORS = ["var(--sea)", "var(--warn)", "var(--rain)", "var(--signal)", "var(--good)", "var(--muted)", "var(--sea)", "var(--warn)", "var(--rain)", "var(--signal)"];

type P = [number, number];

function nice(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

/** Small deterministic PRNG so the decorative landscape is identical on every render and for every trip. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth closed blob (km-space) used for parks and districts. */
function blob(cx: number, cy: number, r: number, rand: () => number): string {
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.62 + rand() * 0.55);
    return [cx + Math.cos(a) * k * 1.25, cy + Math.sin(a) * k] as P;
  });
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M ${mid(pts[n - 1], pts[0]).join(" ")}`;
  for (let i = 0; i < n; i++) d += ` Q ${pts[i].join(" ")} ${mid(pts[i], pts[(i + 1) % n]).join(" ")}`;
  return `${d} Z`;
}

/** Control point that bows a leg sideways so routes read as roads rather than ruler lines. */
function bow(p: P, q: P): P {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(24, len * 0.16);
  return [(p[0] + q[0]) / 2 - (dy / len) * bend, (p[1] + q[1]) / 2 + (dx / len) * bend];
}

/** Pushes markers apart until none overlap, so close stops keep readable numbers. Positions stay near their true spot. */
function declutter(pts: P[], min: number): P[] {
  const out = pts.map((p) => [p[0], p[1]] as P);
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        let dx = out[j][0] - out[i][0];
        let dy = out[j][1] - out[i][1];
        let d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) {
          // identical spots: fan out on a fixed angle per pair so the result is stable between renders
          const a = (i * 2.4 + j) % (Math.PI * 2);
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const push = (min - d) / 2;
        out[i][0] -= (dx / d) * push;
        out[i][1] -= (dy / d) * push;
        out[j][0] += (dx / d) * push;
        out[j][1] += (dy / d) * push;
        moved = true;
      }
    if (!moved) break;
  }
  return out;
}

/** Tracks an element's content box so the chart can draw in real pixels (constant marker size at any width). */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 640, h: 420 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function ChartMap({
  days,
  active,
  base,
  hoverId,
  onHover,
  highlight,
  className = "",
}: {
  days: Day[];
  active: number | "all";
  base: [number, number] | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  highlight?: Set<string>;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const { ref, w: W, h: H } = useSize<HTMLDivElement>();
  const all = useMemo(() => days.flatMap((d) => d.items), [days]);

  // km-space projection anchored at the centroid of everything in the trip
  const proj = useMemo(() => {
    const pts = [...all.map((i) => [i.lat, i.lng] as P), ...(base ? [base as P] : [])];
    const lat0 = pts.length ? pts.reduce((s, p) => s + p[0], 0) / pts.length : 0;
    const lng0 = pts.length ? pts.reduce((s, p) => s + p[1], 0) / pts.length : 0;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const toKm = (lat: number, lng: number): P => [(lng - lng0) * 111.32 * k, -(lat - lat0) * 110.57];
    return { toKm };
  }, [all, base]);

  const visibleDays = useMemo(() => (active === "all" ? days : days.filter((d) => d.index === active)), [days, active]);
  const visible = useMemo(() => visibleDays.flatMap((d) => d.items), [visibleDays]);

  const view = useMemo(() => {
    const src = visible.length ? visible.map((i) => proj.toKm(i.lat, i.lng)) : base ? [proj.toKm(base[0], base[1])] : [[0, 0] as P];
    const xs = src.map((p) => p[0]);
    const ys = src.map((p) => p[1]);
    const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 2.5);
    const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 2.5);
    const s = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return { s, tx: W / 2 - cx * s, ty: H / 2 - cy * s };
  }, [visible, proj, base, W, H]);

  // camera: ease the background layer between focus areas
  const bgRef = useRef<SVGGElement>(null);
  const cur = useRef({ tx: view.tx, ty: view.ty, s: view.s });
  useEffect(() => {
    const from = { ...cur.current };
    const apply = (t: number) => {
      const v = { tx: from.tx + (view.tx - from.tx) * t, ty: from.ty + (view.ty - from.ty) * t, s: from.s + (view.s - from.s) * t };
      cur.current = v;
      bgRef.current?.setAttribute("transform", `translate(${v.tx} ${v.ty}) scale(${v.s})`);
    };
    if (reduce) {
      apply(1);
      return;
    }
    const controls = animate(0, 1, { duration: 0.8, ease: [...ease], onUpdate: apply });
    return () => controls.stop();
  }, [view, reduce]);

  const toPx = (it: { lat: number; lng: number }): P => {
    const [x, y] = proj.toKm(it.lat, it.lng);
    return [x * view.s + view.tx, y * view.s + view.ty];
  };
  const placed = new Map<string, P>();
  const spread = declutter(visible.map(toPx), 30);
  visible.forEach((it, i) => placed.set(it.id, spread[i]));
  const at = (it: Item) => placed.get(it.id) ?? toPx(it);
  // the city-centre diamond is context only: drop it when the fitted view leaves it at or past the edge
  const baseRaw = base ? toPx({ lat: base[0], lng: base[1] }) : null;
  const basePt = baseRaw && baseRaw[0] > 32 && baseRaw[0] < W - 32 && baseRaw[1] > 24 && baseRaw[1] < H - 36 ? baseRaw : null;

  // graticule in km-space (drawn once, transformed by the camera)
  const grid = useMemo(() => {
    const extent = 40;
    const step = 1;
    const lines: number[] = [];
    for (let v = -extent; v <= extent; v += step) lines.push(v);
    return { lines, extent };
  }, []);
  const contours = useMemo(() => [1, 2, 3, 4, 5, 6].map((i) => i * 4.5), []);
  // decorative basemap: parks, a river and arterial roads, generated once in km-space
  const land = useMemo(() => {
    const rand = rng(20261023);
    const parks = Array.from({ length: 34 }, () => blob((rand() - 0.5) * 24, (rand() - 0.5) * 24, 0.25 + rand() * 0.7, rand));
    const river = Array.from({ length: 9 }, (_, i) => [-42 + i * 10.5, (rand() - 0.5) * 7 + Math.sin(i * 0.9) * 6] as P)
      .map((p, i, a) => (i === 0 ? `M ${p.join(" ")}` : `Q ${a[i - 1][0] + 5} ${a[i - 1][1] + (rand() - 0.5) * 9} ${p.join(" ")}`))
      .join(" ");
    const roads = Array.from({ length: 12 }, (_, i) => {
      const horiz = i % 2 === 0;
      const o = (rand() - 0.5) * 16;
      const a: P = horiz ? [-42, o + (rand() - 0.5) * 6] : [o + (rand() - 0.5) * 12, -42];
      const b: P = horiz ? [42, o + (rand() - 0.5) * 6] : [o + (rand() - 0.5) * 12, 42];
      const c: P = [(a[0] + b[0]) / 2 + (rand() - 0.5) * 14, (a[1] + b[1]) / 2 + (rand() - 0.5) * 14];
      return `M ${a.join(" ")} Q ${c.join(" ")} ${b.join(" ")}`;
    });
    return { parks, river, roads };
  }, []);

  const barKm = nice((110 / view.s) * 0.9);
  const barPx = barKm * view.s;
  const label = active === "all" ? "all days" : `day ${active + 1}`;

  return (
    <div ref={ref} className={`relative h-full w-full ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0 block h-full w-full" role="img" aria-label={`Chart of ${visible.length} planned stops for ${label}. The same stops are listed in the itinerary.`}>
        <defs>
          <radialGradient id="cm-vignette" cx="50%" cy="50%" r="75%">
            <stop offset="55%" stopColor="var(--surface-2)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--surface-2)" stopOpacity="0.9" />
          </radialGradient>
          <linearGradient id="cm-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--surface)" />
            <stop offset="100%" stopColor="var(--surface-2)" />
          </linearGradient>
          <filter id="cm-pin" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#04161a" floodOpacity="0.32" />
          </filter>
        </defs>
        <rect width={W} height={H} fill="url(#cm-land)" />
        <g ref={bgRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
          {land.parks.map((d, i) => (
            <path key={i} d={d} fill="var(--good)" fillOpacity={0.13} stroke="var(--good)" strokeOpacity={0.22} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={land.river} fill="none" stroke="var(--rain)" strokeOpacity={0.14} strokeWidth={26} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={land.river} fill="none" stroke="var(--rain)" strokeOpacity={0.22} strokeWidth={14} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {contours.map((r, i) => (
            <circle key={r} cx={0} cy={0} r={r} fill="none" stroke="var(--sea)" strokeOpacity={0.12} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={i % 2 ? "2 5" : undefined} />
          ))}
          {grid.lines.map((v) => (
            <g key={v} stroke="var(--grid)" strokeWidth={v % 5 === 0 ? 1.5 : 1} vectorEffect="non-scaling-stroke">
              <line x1={v} y1={-grid.extent} x2={v} y2={grid.extent} vectorEffect="non-scaling-stroke" />
              <line x1={-grid.extent} y1={v} x2={grid.extent} y2={v} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {land.roads.map((d, i) => (
            <g key={i} fill="none" strokeLinecap="round" vectorEffect="non-scaling-stroke">
              <path d={d} stroke="var(--raised)" strokeOpacity={0.9} strokeWidth={5} vectorEffect="non-scaling-stroke" />
              <path d={d} stroke="var(--line-strong)" strokeOpacity={0.55} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </g>
        <rect width={W} height={H} fill="url(#cm-vignette)" pointerEvents="none" />

        <AnimatePresence mode="popLayout">
          <motion.g key={String(active)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {visibleDays.map((d) => {
              const pts = d.items.map(at);
              if (pts.length < 2) return null;
              const path = pts
                .map((p, i) => {
                  if (i === 0) return `M ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
                  const c = bow(pts[i - 1], p);
                  return `Q ${c[0].toFixed(1)} ${c[1].toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
                })
                .join(" ");
              const color = active === "all" ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)";
              return (
                <g key={d.index}>
                  <path d={path} fill="none" stroke="var(--raised)" strokeOpacity={0.95} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={path} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                  <motion.path d={path} fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1, ease: [...ease] }} />
                  <path d={path} fill="none" stroke="var(--raised)" strokeOpacity={0.85} strokeWidth={1.4} strokeLinecap="round" strokeDasharray="1 11" className="route-flow" />
                  {pts.slice(1).map((p, i) => {
                    const q = pts[i];
                    const c = bow(q, p);
                    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
                    if (len < 70) return null;
                    const mx = 0.25 * q[0] + 0.5 * c[0] + 0.25 * p[0];
                    const my = 0.25 * q[1] + 0.5 * c[1] + 0.25 * p[1];
                    const ang = (Math.atan2(p[1] - q[1], p[0] - q[0]) * 180) / Math.PI;
                    return <path key={i} d="M -4 -4 L 4 0 L -4 4 Z" transform={`translate(${mx.toFixed(1)} ${my.toFixed(1)}) rotate(${ang.toFixed(1)})`} fill={color} stroke="var(--raised)" strokeWidth={1.5} strokeLinejoin="round" paintOrder="stroke" />;
                  })}
                </g>
              );
            })}
            {basePt && (
              <g transform={`translate(${basePt.join(" ")})`} opacity={0.85}>
                <rect x={-5} y={-5} width={10} height={10} rx={2} transform="rotate(45)" fill="var(--raised)" stroke="var(--faint)" strokeWidth={1.5} filter="url(#cm-pin)" />
                <text y={20} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--muted)" letterSpacing={1}>
                  CENTRE
                </text>
              </g>
            )}
            {visibleDays.flatMap((d) =>
              d.items.map((it, i) => (
                <Marker
                  key={it.id}
                  it={it}
                  n={i + 1}
                  pos={at(it)}
                  bounds={[W, H]}
                  color={active === "all" ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)"}
                  hover={hoverId === it.id}
                  flagged={!!highlight?.has(it.id)}
                  delay={reduce ? 0 : 0.2 + i * 0.06}
                  onHover={onHover}
                />
              )),
            )}
          </motion.g>
        </AnimatePresence>

        <g transform={`translate(16 ${H - 16})`}>
          <rect x={-8} y={-14} width={barPx + 62} height={24} rx={8} fill="var(--raised)" fillOpacity={0.78} stroke="var(--line)" />
          <rect x={0} y={-2} width={barPx / 2} height={4} fill="var(--ink)" />
          <rect x={barPx / 2} y={-2} width={barPx / 2} height={4} fill="var(--raised)" stroke="var(--ink)" strokeWidth={1} />
          <text x={barPx + 8} y={3.5} fontFamily="var(--font-mono)" fontSize={10.5} fill="var(--muted)">
            {barKm} km
          </text>
        </g>
        <g transform={`translate(${W - 28} ${H - 30})`} filter="url(#cm-pin)">
          <circle r={15} fill="var(--raised)" fillOpacity={0.9} stroke="var(--line)" />
          <path d="M0 -10 L3.4 0 L0 10 L-3.4 0 Z" fill="var(--faint)" fillOpacity={0.5} />
          <path d="M0 -10 L3.4 0 L-3.4 0 Z" fill="var(--signal)" />
        </g>
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-line bg-raised/80 py-1 pl-2 pr-3 text-[11.5px] font-medium text-ink shadow-[var(--shadow-sm)] backdrop-blur">
        <span aria-hidden className="h-2 w-2 rounded-full bg-sea shadow-[0_0_0_3px_color-mix(in_srgb,var(--sea)_22%,transparent)]" />
        <span className="capitalize">{label}</span>
        <span className="mono text-muted">
          {visible.length} {visible.length === 1 ? "stop" : "stops"}
        </span>
      </div>
      {visible.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-raised/85 px-3.5 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-sea-soft text-sea">
              <MapPin size={15} />
            </span>
            <span className="text-[12.5px] leading-tight text-muted">
              <b className="block font-semibold text-ink">No stops on the map</b>
              Nothing planned for {label} yet
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Marker({ it, n, pos, bounds, color, hover, flagged, delay, onHover }: { it: Item; n: number; pos: P; bounds: [number, number]; color: string; hover: boolean; flagged: boolean; delay: number; onHover: (id: string | null) => void }) {
  const r = 12;
  // keep the name label inside the frame: flip below near the top edge, shift sideways near the sides
  const labelW = Math.min(Math.min(it.name.length, 30) * 6.4 + 60, 256);
  const below = pos[1] < 54;
  const shift = Math.max(8 - (pos[0] - labelW / 2), Math.min(0, bounds[0] - 8 - (pos[0] + labelW / 2)));
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.3 }}
      animate={{ opacity: 1, scale: hover ? 1.18 : 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 22, delay: hover ? 0 : delay }}
      style={{ x: pos[0], y: pos[1], cursor: "pointer" }}
      onMouseEnter={() => onHover(it.id)}
      onMouseLeave={() => onHover(null)}
    >
      {flagged && <circle r={r + 6} fill="none" stroke="var(--signal)" strokeWidth={2} className="ping" style={{ transformOrigin: "0 0" }} />}
      <circle r={r + 7} fill={color} opacity={hover ? 0.2 : 0.1} />
      <g filter="url(#cm-pin)">
        {it.indoor ? (
          <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={7} fill={color} stroke="var(--raised)" strokeWidth={2.5} />
        ) : (
          <circle r={r} fill={color} stroke="var(--raised)" strokeWidth={2.5} />
        )}
      </g>
      <text textAnchor="middle" dy="0.35em" fontFamily="var(--font-mono)" fontSize={11.5} fontWeight={700} fill="var(--sea-ink)" pointerEvents="none">
        {n}
      </text>
      {hover && (
        <g transform={`translate(${shift} ${below ? r + 20 : -r - 16})`} pointerEvents="none">
          <path d={below ? "M -5 -12 L 0 -17 L 5 -12 Z" : "M -5 12 L 0 17 L 5 12 Z"} transform={`translate(${-shift} 0)`} fill="var(--ink)" />
          <rect x={-labelW / 2} y={-12} width={labelW} height={24} rx={8} fill="var(--ink)" filter="url(#cm-pin)" />
          <text textAnchor="middle" dy="0.34em" fontFamily="var(--font-sans)" fontSize={12} fontWeight={600} fill="var(--bg)">
            {it.name.length > 30 ? `${it.name.slice(0, 29)}…` : it.name}
            <tspan fontFamily="var(--font-mono)" fontWeight={400} fontSize={10.5} dx={6} opacity={0.7}>
              {hhmm(it.start)}
            </tspan>
          </text>
        </g>
      )}
    </motion.g>
  );
}
