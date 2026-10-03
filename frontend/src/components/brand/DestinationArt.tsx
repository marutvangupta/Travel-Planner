import { useId, type ReactNode } from "react";

type Scene = { sky: [string, string, string]; sun: [number, number, number]; sunColor: string; far: string; mid: string; near: string; draw: (c: { mid: string; near: string }) => ReactNode };

const SCENES: Record<string, Scene> = {
  jaipur: {
    sky: ["#f6c177", "#ee8f6a", "#b4476a"], sun: [270, 150, 46], sunColor: "#fff1c9", far: "#c76a63", mid: "#9c4458", near: "#5b2a45",
    draw: ({ near }) => (
      <g fill={near}>
        <path d="M60 300V200q0-26 20-26t20 26v100zM110 300V176q0-34 28-34t28 34v124zM176 300V210l16-44 16 44v100zM214 300V190q0-30 24-30t24 30v110zM272 300V204q0-22 18-22t18 22v96z" />
        <rect x="0" y="262" width="400" height="38" />
        <circle cx="138" cy="138" r="5" /><path d="M138 130v-14" stroke={near} strokeWidth="3" />
      </g>
    ),
  },
  goa: {
    sky: ["#ffd68a", "#ff9b6a", "#d9577b"], sun: [200, 168, 54], sunColor: "#fff3d1", far: "#f08a78", mid: "#c9546f", near: "#6b2f5a",
    draw: ({ near }) => (
      <g>
        <path d="M0 222c40-8 60 8 100 0s60-8 100 0 60 8 100 0 70-8 100 0v78H0z" fill="#8c3d68" opacity=".75" />
        <path d="M0 252c50-10 80 8 130 0s90-10 140 0 80 8 130 0v48H0z" fill={near} />
        <g stroke={near} strokeWidth="5" strokeLinecap="round" fill="none"><path d="M318 262q-4-70 8-108" /><path d="M326 154q-30-22-58-12M326 154q-6-34-38-42M326 154q22-26 52-20M326 154q26-6 40 14" /></g>
      </g>
    ),
  },
  tokyo: {
    sky: ["#7a74c8", "#e68db0", "#ffc3a0"], sun: [300, 124, 30], sunColor: "#fff0e6", far: "#8a74b8", mid: "#5d4b94", near: "#2c2458",
    draw: ({ mid, near }) => (
      <g>
        <path d="M30 262L150 96q12-16 24 0l120 166z" fill={mid} />
        <path d="M138 114l12-16q12-14 24 0l12 16q-12 10-24 4t-24-4z" fill="#f4e6f2" opacity=".9" />
        <path d="M0 262h400v38H0z" fill={near} />
        <g fill="#c7452f"><rect x="62" y="206" width="6" height="56" /><rect x="108" y="206" width="6" height="56" /><path d="M52 200h72l-6 10H58z" /><rect x="64" y="216" width="48" height="5" /></g>
      </g>
    ),
  },
  paris: {
    sky: ["#c9b6ea", "#f3b6b0", "#ffd9a8"], sun: [110, 150, 38], sunColor: "#fff4e0", far: "#b99ac6", mid: "#8c76aa", near: "#3f3560",
    draw: ({ near }) => (
      <g>
        <path d="M0 262h400v38H0z" fill={near} />
        <g fill="none" stroke={near} strokeWidth="5" strokeLinejoin="round"><path d="M244 262l26-92 6-40 6 40 26 92" /><path d="M262 214h28M258 238h36M268 170h16" /></g>
        <path d="M276 130v-24" stroke={near} strokeWidth="3" />
        <path d="M0 262c30-30 44-30 70-8s46-30 76-4 40-24 70 4z" fill="#6c5a92" opacity=".7" />
      </g>
    ),
  },
};

const FALLBACK: Scene = {
  sky: ["#f3c98b", "#ec9a6e", "#a8527a"], sun: [250, 150, 44], sunColor: "#fff1cf", far: "#c1647a", mid: "#8b4466", near: "#4a2a4f",
  draw: ({ mid, near }) => (
    <g>
      <path d="M0 250L90 150l60 70 70-110 90 130 90-60v140H0z" fill={mid} />
      <path d="M0 280l80-50 70 34 80-52 90 60 80-30v38H0z" fill={near} />
    </g>
  ),
};

/** Illustrated "postcard" for a destination: dusk sky, sun, layered landscape. Decorative, no photo licensing to manage. */
export function DestinationArt({ destination, className = "", tall }: { destination: string; className?: string; tall?: boolean }) {
  const key = destination.split(",")[0].trim().toLowerCase();
  const sc = SCENES[key] ?? FALLBACK;
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox={tall ? "0 -230 400 530" : "0 0 400 300"} preserveAspectRatio="xMidYMid slice" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sc.sky[2]} />
          <stop offset=".55" stopColor={sc.sky[1]} />
          <stop offset="1" stopColor={sc.sky[0]} />
        </linearGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor={sc.sunColor} stopOpacity=".55" />
          <stop offset="1" stopColor={sc.sunColor} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect y="-230" width="400" height="530" fill={`url(#${id}s)`} />
      <circle cx={sc.sun[0]} cy={sc.sun[1]} r={sc.sun[2] * 3} fill={`url(#${id}g)`} />
      <circle cx={sc.sun[0]} cy={sc.sun[1]} r={sc.sun[2]} fill={sc.sunColor} />
      <path d="M0 230c60-30 110-8 170-24s110-36 230 4v90H0z" fill={sc.far} opacity=".55" />
      {sc.draw({ mid: sc.mid, near: sc.near })}
    </svg>
  );
}
