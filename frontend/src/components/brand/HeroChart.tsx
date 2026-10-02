import { motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";

/** Catmull-Rom -> cubic Bezier closed blob, used to draw topographic contour lines. */
function blob(cx: number, cy: number, r: number, seed: number): string {
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wob = 1 + 0.16 * Math.sin(3 * t + seed) + 0.09 * Math.sin(5 * t + seed * 1.7) + 0.05 * Math.sin(8 * t + seed * 0.6);
    pts.push([cx + Math.cos(t) * r * wob * 1.25, cy + Math.sin(t) * r * wob]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d + " Z";
}

/*
  Composition: the copy sits on the left two-thirds of the panel, so the route arcs across the top (Paris → Tokyo)
  and drops down the right edge (Jaipur → Goa), framing the headline instead of crossing it. Labels sit on the side of
  each pin the route does not pass through. Cities are listed in route order so they light up as the line arrives.
*/
const CITIES = [
  { name: "PARIS", x: 140, y: 130, label: [-10, 28] as const, anchor: "start", coord: "48.86°N 2.35°E" },
  { name: "TOKYO", x: 490, y: 175, label: [-16, 28] as const, anchor: "end", coord: "35.68°N 139.65°E" },
  { name: "JAIPUR", x: 470, y: 330, label: [16, 18] as const, anchor: "start", coord: "26.91°N 75.79°E" },
  { name: "GOA", x: 440, y: 500, label: [16, 8] as const, anchor: "start", coord: "15.50°N 73.83°E" },
] as const;
const ROUTE = "M140 130 C 250 50, 390 70, 490 175 S 510 280, 470 330 S 410 440, 440 500";

export function HeroChart() {
  const reduce = useReducedMotion();
  const contours = useMemo(() => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ d: blob(375, 330, 40 + i * 34, i * 0.9), i })), []);
  const grid = useMemo(() => Array.from({ length: 13 }, (_, i) => i * 50), []);
  return (
    <svg viewBox="0 0 620 720" className="h-full w-full" role="img" aria-label="Animated route chart connecting Paris, Jaipur, Goa and Tokyo" preserveAspectRatio="xMaxYMid slice">
      <defs>
        <radialGradient id="hc-glow" cx="68%" cy="44%" r="62%">
          <stop offset="0%" stopColor="var(--sea)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--sea)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hc-route" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--sea)" />
          <stop offset="100%" stopColor="var(--signal)" />
        </linearGradient>
      </defs>
      <rect width="620" height="720" fill="url(#hc-glow)" />
      <g stroke="var(--grid)" strokeWidth="1">
        {grid.map((v, k) => (
          <motion.g key={v} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: k * 0.04, duration: 0.8 }}>
            <line x1={v * 1.1} y1="0" x2={v * 1.1} y2="720" />
            <line x1="0" y1={v * 1.2} x2="620" y2={v * 1.2} />
          </motion.g>
        ))}
      </g>
      <g>
      <g fill="none" stroke="var(--sea)" strokeLinecap="round">
        {contours.map(({ d, i }) => (
          <motion.path
            key={i}
            d={d}
            strokeWidth={i % 4 === 0 ? 1.4 : 0.8}
            strokeOpacity={0.55 - i * 0.045}
            initial={reduce ? false : { pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 2.4, delay: 0.2 + i * 0.16, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
      </g>
      <motion.path
        id="hero-route"
        d={ROUTE}
        fill="none"
        stroke="url(#hc-route)"
        strokeWidth="2.5"
        strokeDasharray="2 7"
        strokeLinecap="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 3.2, delay: 1.1, ease: "easeInOut" }}
      />
      {!reduce && (
        <circle r="5" fill="var(--signal)">
          <animateMotion dur="16s" begin="3s" repeatCount="indefinite" rotate="auto">
            <mpath href="#hero-route" />
          </animateMotion>
        </circle>
      )}
      {CITIES.map((c, k) => (
        <g key={c.name}>
          <motion.circle cx={c.x} cy={c.y} r="6" fill="none" stroke="var(--sea)" initial={false} className={reduce ? "" : "ping"} style={{ transformOrigin: `${c.x}px ${c.y}px`, animationDelay: `${k * 0.6}s` }} />
          <motion.circle cx={c.x} cy={c.y} r="4.5" fill="var(--bg)" stroke="var(--sea)" strokeWidth="2" initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16, delay: 1.2 + k * 0.4 }} style={{ transformOrigin: `${c.x}px ${c.y}px` }} />
          <motion.g initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 + k * 0.4, duration: 0.6 }}>
            <text x={c.x + c.label[0]} y={c.y + c.label[1]} textAnchor={c.anchor} fill="var(--ink)" fontFamily="var(--font-mono)" fontSize="12" fontWeight="600" letterSpacing="1.4">
              {c.name}
            </text>
            <text x={c.x + c.label[0]} y={c.y + c.label[1] + 13} textAnchor={c.anchor} fill="var(--muted)" fontFamily="var(--font-mono)" fontSize="9" letterSpacing=".6">
              {c.coord}
            </text>
          </motion.g>
        </g>
      ))}
      </g>
      <g transform="translate(556 78)" opacity=".7">
        <circle r="26" fill="none" stroke="var(--faint)" strokeWidth="1" />
        <motion.g animate={reduce ? undefined : { rotate: [0, 6, -4, 0] }} transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}>
          <path d="M0 -22 L5 0 L0 22 L-5 0 Z" fill="var(--sea)" opacity=".9" />
          <path d="M0 -22 L5 0 L-5 0 Z" fill="var(--signal)" />
        </motion.g>
        <text y="-32" textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-mono)" fontSize="9">
          N
        </text>
      </g>
    </svg>
  );
}
