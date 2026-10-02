import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Map, Plus, Sparkles, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useScrolled } from "../../lib/a11y";
import { spring } from "../../lib/motion";
import { Button } from "../ui";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/trips", label: "Trips", icon: Map },
  { to: "/memory", label: "Memory", icon: Sparkles },
];

const isDemoEmail = (email: string) => /^explorer-[a-z0-9]+@example\.com$/.test(email);

export function AppShell({ children }: { children: ReactNode }) {
  const { meta } = useAuth();
  const scrolled = useScrolled();
  const nav = useNavigate();
  const { pathname } = useLocation();
  // the trips list and the wizard already lead with this action; everywhere else it lives in the header
  const showNewTrip = pathname !== "/trips" && pathname !== "/trips/new";
  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="fixed left-3 top-3 z-[90] -translate-y-16 rounded-control bg-ink px-3 py-2 text-sm font-semibold text-bg shadow-pop transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <header
        className={`sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-300 ${
          scrolled ? "border-line bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] shadow-[0_8px_24px_-18px_rgba(13,34,41,.35)] backdrop-blur-xl backdrop-saturate-150" : "border-transparent bg-bg"
        }`}
      >
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <NavLink to="/trips" aria-label="Waypoint, all trips" className="rounded-control">
            <Logo />
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-1">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/memory"}
                aria-label={label}
                className={({ isActive }) => `relative flex h-9 items-center gap-2 rounded-control px-2.5 text-sm font-medium transition-colors sm:px-3 ${isActive ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-control border border-line bg-surface shadow-xs" />}
                    <Icon size={16} className="relative" aria-hidden />
                    <span className="relative hidden sm:inline">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AnimatePresence initial={false}>
              {showNewTrip && (
                <motion.div key="new" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.18 }} className="hidden md:block">
                  <Button size="sm" variant="soft" icon={<Plus size={15} />} onClick={() => nav("/trips/new")}>
                    New trip
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            {meta && (
              <span
                data-tip={meta.data_mode === "demo" ? "Bundled demo places. Add a Google Maps key for live data." : "Live Google Maps places and routes"}
                data-tip-side="bottom"
                data-tip-align="end"
                tabIndex={0}
                className="tip mono hidden h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted lg:inline-flex"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.data_mode === "demo" ? "bg-warn" : "bg-good"}`} aria-hidden />
                {meta.data_mode === "demo" ? "Demo data" : "Live data"}
              </span>
            )}
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="paper flex-1 outline-none">
        {children}
      </main>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!user) return null;
  const demo = isDemoEmail(user.email);
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Account: ${user.name}`}
        className={`flex h-9 items-center gap-2 rounded-control border bg-surface pl-1 pr-1 shadow-xs transition-colors sm:pr-3 ${open ? "border-line-strong" : "border-line hover:border-line-strong"}`}
      >
        <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sea-soft text-[13px] font-semibold text-sea">{initial}</span>
        <span className="hidden max-w-[12ch] truncate text-sm font-medium sm:block">{user.name}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={spring}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-[14px] border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sea-soft font-semibold text-sea">{initial}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted">{demo ? "Demo account · this browser only" : user.email}</p>
              </div>
            </div>
            <div className="p-1.5">
              <Link to="/memory" className="flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-sm text-ink transition-colors hover:bg-surface-2">
                <UserRound size={15} className="text-muted" aria-hidden /> Preferences and memory
              </Link>
              <button type="button" onClick={logout} className="flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-sm text-ink transition-colors hover:bg-surface-2">
                <LogOut size={15} className="text-muted" aria-hidden /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
