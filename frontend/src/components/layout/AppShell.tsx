import { motion } from "framer-motion";
import { Compass, LogOut, Map, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { spring } from "../../lib/motion";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/trips", label: "Trips", icon: Map },
  { to: "/memory", label: "Memory", icon: Sparkles },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, meta } = useAuth();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-6 px-4 sm:px-6">
          <NavLink to="/trips" aria-label="Waypoint home">
            <Logo />
          </NavLink>
          <nav className="flex items-center gap-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => `relative flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-medium transition-colors ${isActive ? "text-ink" : "text-muted hover:text-ink"}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-[10px] border border-line bg-surface" />}
                    <Icon size={16} className="relative" />
                    <span className="relative hidden sm:inline">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            {meta && (
              <span
                title={meta.data_mode === "demo" ? "Using the bundled demo dataset. Add a Google Maps key for live places and routing." : "Live Google Maps data"}
                className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${meta.data_mode === "demo" ? "border-warn/40 bg-warn-soft text-warn" : "border-good/40 bg-good-soft text-good"}`}
              >
                <Compass size={12} />
                {meta.data_mode === "demo" ? "Demo data" : "Live data"}
              </span>
            )}
            <ThemeToggle />
            <div className="flex items-center gap-2 rounded-[10px] border border-line bg-surface py-1 pl-3 pr-1">
              <span className="hidden max-w-[10ch] truncate text-sm font-medium sm:block">{user?.name}</span>
              <button type="button" onClick={logout} aria-label="Sign out" title="Sign out" className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="paper flex-1">
        {children}
      </main>
    </div>
  );
}
