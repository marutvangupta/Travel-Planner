import { animate, AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { hhmm } from "../../lib/format";
import { ease } from "../../lib/motion";
import type { Day, Item } from "../../lib/types";

const W = 640;
const H = 520;
const PAD = 70;
const DAY_COLORS = ["var(--sea)", "var(--warn)", "var(--rain)", "var(--signal)", "var(--good)", "var(--muted)", "var(--sea)", "var(--warn)", "var(--rain)", "var(--signal)"];

type P = [number, number];

function nice(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

export function ChartMap({
  days,
  active,
  base,
  hoverId,
  onHover,
  highlight,
}: {
  days: Day[];
  active: number | "all";
  base: [number, number] | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  highlight?: Set<string>;
}) {
  const reduce = useReducedMotion();
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

  const visibleDays = active === "all" ? days : days.filter((d) => d.index === active);
  const visible = useMemo(() => visibleDays.flatMap((d) => d.items), [visibleDays]);

  const view = useMemo(() => {
    const src = visible.length ? visible.map((i) => proj.toKm(i.lat, i.lng)) : base ? [proj.toKm(base[0], base[1])] : [[0, 0] as P];
    const xs = src.map((p) => p[0]);
    const ys = src.map((p) => p[1]);
    const spanX = Math.max(Math.max(...xs) - Math.min(...xs), 3.5);
    const spanY = Math.max(Math.max(...ys) - Math.min(...ys), 3.5);
    const s = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return { s, tx: W / 2 - cx * s, ty: H / 2 - cy * s };
  }, [visible, proj, base]);

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
    const controls = animate(0, 1, { duration: 0.95, ease: [...ease], onUpdate: apply });
    return () => controls.stop();
  }, [view, reduce]);

  const toPx = (it: { lat: number; lng: number }): P => {
    const [x, y] = proj.toKm(it.lat, it.lng);
    return [x * view.s + view.tx, y * view.s + view.ty];
  };

  // graticule in km-space (drawn once, transformed by the camera)
  const grid = useMemo(() => {
    const extent = 30;
    const step = nice(extent / 7);
    const lines: number[] = [];
    for (let v = -Math.ceil(extent / step) * step; v <= extent; v += step) lines.push(v);
    return { step, lines, extent };
  }, []);
  const contours = useMemo(() => [1, 2, 3, 4, 5].map((i) => ({ r: i * 5.5, wob: i * 0.8 })), []);

  const barKm = nice((120 / view.s) * 0.9);
  const barPx = barKm * view.s;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="Map of the planned stops">
      <defs>
        <radialGradient id="cm-vignette" cx="50%" cy="50%" r="70%">
          <stop offset="60%" stopColor="var(--surface)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--surface)" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="var(--surface-2)" />
      <g ref={bgRef} transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
        {contours.map((c, i) => (
          <circle key={i} cx={0} cy={0} r={c.r} fill="none" stroke="var(--sea)" strokeOpacity={0.14} strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray={i % 2 ? "2 5" : undefined} />
        ))}
        {grid.lines.map((v) => (
          <g key={v} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke">
            <line x1={v} y1={-grid.extent} x2={v} y2={grid.extent} vectorEffect="non-scaling-stroke" />
            <line x1={-grid.extent} y1={v} x2={grid.extent} y2={v} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
      <rect width={W} height={H} fill="url(#cm-vignette)" pointerEvents="none" />

      <AnimatePresence mode="popLayout">
        <motion.g key={String(active)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {visibleDays.map((d) => {
            const pts = d.items.map(toPx);
            if (pts.length < 2) return null;
            const path = pts.map((p, i) => {
              if (i === 0) return `M ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
              const q = pts[i - 1];
              const mx = (p[0] + q[0]) / 2;
              const my = (p[1] + q[1]) / 2;
              const dx = p[0] - q[0];
              const dy = p[1] - q[1];
              const len = Math.hypot(dx, dy) || 1;
              const bend = Math.min(26, len * 0.18);
              return `Q ${(mx - (dy / len) * bend).toFixed(1)} ${(my + (dx / len) * bend).toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
            }).join(" ");
            const color = active === "all" ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)";
            return (
              <g key={d.index}>
                <motion.path d={path} fill="none" stroke="var(--surface)" strokeWidth={7} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1.1, ease: [...ease] }} />
                <motion.path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeDasharray="1 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduce ? 0 : 1.1, ease: [...ease] }} />
              </g>
            );
          })}
          {base && (
            <g transform={`translate(${toPx({ lat: base[0], lng: base[1] }).join(" ")})`} opacity={0.9}>
              <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="var(--bg)" stroke="var(--faint)" strokeWidth={1.5} />
              <text y={22} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--faint)" letterSpacing={1}>
                CENTRE
              </text>
            </g>
          )}
          {visibleDays.flatMap((d) =>
            d.items.map((it, i) => (
              <Marker key={it.id} it={it} n={i + 1} pos={toPx(it)} color={active === "all" ? DAY_COLORS[d.index % DAY_COLORS.length] : "var(--sea)"} hover={hoverId === it.id} flagged={!!highlight?.has(it.id)} delay={reduce ? 0 : 0.25 + i * 0.07} onHover={onHover} />
            )),
          )}
        </motion.g>
      </AnimatePresence>

      <g transform={`translate(24 ${H - 30})`}>
        <line x1={0} y1={0} x2={barPx} y2={0} stroke="var(--ink)" strokeWidth={1.5} />
        <line x1={0} y1={-4} x2={0} y2={4} stroke="var(--ink)" strokeWidth={1.5} />
        <line x1={barPx} y1={-4} x2={barPx} y2={4} stroke="var(--ink)" strokeWidth={1.5} />
        <text x={0} y={-9} fontFamily="var(--font-mono)" fontSize={10} fill="var(--muted)">
          {barKm} km
        </text>
      </g>
      <g transform={`translate(${W - 38} 40)`} opacity={0.8}>
        <circle r={16} fill="var(--surface)" stroke="var(--line)" />
        <path d="M0 -12 L3.5 0 L0 12 L-3.5 0 Z" fill="var(--sea)" />
        <path d="M0 -12 L3.5 0 L-3.5 0 Z" fill="var(--signal)" />
        <text y={-20} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--muted)">
          N
        </text>
      </g>
    </svg>
  );
}

function Marker({ it, n, pos, color, hover, flagged, delay, onHover }: { it: Item; n: number; pos: P; color: string; hover: boolean; flagged: boolean; delay: number; onHover: (id: string | null) => void }) {
  const r = 12;
  return (
    <motion.g
      initial={{ opacity: 0, scale: 0.2 }}
      animate={{ opacity: 1, scale: hover ? 1.28 : 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 17, delay: hover ? 0 : delay }}
      style={{ x: pos[0], y: pos[1], cursor: "pointer" }}
      onMouseEnter={() => onHover(it.id)}
      onMouseLeave={() => onHover(null)}
    >
      {flagged && <circle r={r + 7} fill="none" stroke="var(--signal)" strokeWidth={2} className="ping" style={{ transformOrigin: "0 0" }} />}
      {hover && <circle r={r + 6} fill={color} opacity={0.18} />}
      {it.indoor ? (
        <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={5} fill="var(--surface)" stroke={color} strokeWidth={2.2} />
      ) : (
        <circle r={r} fill="var(--surface)" stroke={color} strokeWidth={2.2} />
      )}
      <text textAnchor="middle" dy="0.35em" fontFamily="var(--font-mono)" fontSize={11} fontWeight={600} fill="var(--ink)">
        {n}
      </text>
      {hover && (
        <g transform={`translate(0 ${-r - 12})`}>
          <rect x={-(it.name.length * 3.6 + 10)} y={-12} width={it.name.length * 7.2 + 20} height={22} rx={7} fill="var(--ink)" />
          <text textAnchor="middle" dy="0.32em" y={-1} fontFamily="var(--font-sans)" fontSize={11.5} fontWeight={600} fill="var(--bg)">
            {it.name}
          </text>
          <text textAnchor="middle" y={22} fontFamily="var(--font-mono)" fontSize={9.5} fill="var(--muted)" stroke="var(--surface)" strokeWidth={3} paintOrder="stroke">
            {hhmm(it.start)}
          </text>
        </g>
      )}
    </motion.g>
  );
}
