import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

  const barKm = nice((110 / view.s) * 0.9);
  const barPx = barKm * view.s;
  const label = active === "all" ? "all days" : `day ${active + 1}`;

  return (
    <div ref={ref} className={`relative h-full w-full ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="absolute inset-0 block h-full w-full" role="img" aria-label={`Chart of ${visible.length} planned stops for ${label}. The same stops are listed in the itinerary.`}>
        <defs>
          <radialGradient id="cm-vignette" cx="50%" cy="50%" r="72%">
            <stop offset="65%" stopColor="var(--surface-2)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--surface-2)" stopOpacity="0.85" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="var(--surface-2)" />
        <g ref={bgRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
          {contours.map((r, i) => (
            <circle key={r} cx={0} cy={0} r={r} fill="none" stroke="var(--sea)" strokeOpacity={0.13} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={i % 2 ? "2 5" : undefined} />
          ))}
          {grid.lines.map((v) => (
            <g key={v} stroke="var(--grid)" strokeWidth={v % 5 === 0 ? 1.5 : 1} vectorEffect="non-scaling-stroke">
              <line x1={v} y1={-grid.extent} x2={v} y2={grid.extent} vectorEffect="non-scaling-stroke" />
              <line x1={-grid.extent} y1={v} x2={grid.extent} y2={v} vectorEffect="non-scaling-stroke" />
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
                  const q = pts[i - 1];
                  const mx = (p[0] + q[0]) / 2;
                  const my = (p[1] + q[1]) / 2;
                  const dx = p[0] - q[0];
                  const dy = p[1] - q[1];
                  const len = Math.hypot(dx, dy) || 1;
                  const bend = Math.min(24, len * 0.16);
                  return `Q ${(mx - (dy / len) * bend).toFixed(1)} ${(my + (dx / len) * bend).toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
                })
                .join(" ");
              const color = active === "all" ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)";
              return (
                <g key={d.index}>
                  <path d={path} fill="none" stroke="var(--surface-2)" strokeWidth={6} strokeLinecap="round" />
                  <motion.path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1, ease: [...ease] }} />
                </g>
              );
            })}
            {basePt && (
              <g transform={`translate(${basePt.join(" ")})`} opacity={0.85}>
                <rect x={-5} y={-5} width={10} height={10} transform="rotate(45)" fill="var(--surface)" stroke="var(--faint)" strokeWidth={1.5} />
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

        <g transform={`translate(16 ${H - 18})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} stroke="var(--ink)" strokeWidth={1.25} />
          <line x1={0} y1={-3} x2={0} y2={3} stroke="var(--ink)" strokeWidth={1.25} />
          <line x1={barPx} y1={-3} x2={barPx} y2={3} stroke="var(--ink)" strokeWidth={1.25} />
          <text x={barPx + 6} y={3.5} fontFamily="var(--font-mono)" fontSize={10.5} fill="var(--muted)">
            {barKm} km
          </text>
        </g>
        <g transform={`translate(${W - 26} 30)`} opacity={0.85}>
          <circle r={13} fill="var(--surface)" stroke="var(--line)" />
          <path d="M0 -9 L2.8 0 L0 9 L-2.8 0 Z" fill="var(--sea)" />
          <path d="M0 -9 L2.8 0 L-2.8 0 Z" fill="var(--signal)" />
          <text y={-17} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--muted)">
            N
          </text>
        </g>
      </svg>
      {visible.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-muted">No stops planned for {label}</p>
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
      {hover && <circle r={r + 6} fill={color} opacity={0.16} />}
      {it.indoor ? (
        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={6} fill={hover ? color : "var(--surface)"} stroke={color} strokeWidth={1.75} />
      ) : (
        <circle r={r} fill={hover ? color : "var(--surface)"} stroke={color} strokeWidth={1.75} />
      )}
      <text textAnchor="middle" dy="0.35em" fontFamily="var(--font-mono)" fontSize={11.5} fontWeight={600} fill={hover ? "var(--surface)" : "var(--ink)"}>
        {n}
      </text>
      {hover && (
        <g transform={`translate(${shift} ${below ? r + 20 : -r - 16})`} pointerEvents="none">
          <rect x={-labelW / 2} y={-12} width={labelW} height={24} rx={6} fill="var(--ink)" />
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
