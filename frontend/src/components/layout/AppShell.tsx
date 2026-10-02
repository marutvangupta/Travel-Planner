import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { spring } from "../../lib/motion";
import { Button, usePopover } from "../ui";
import { Logo, LogoMark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const links = [
  { to: "/trips", label: "Trips" },
  { to: "/memory", label: "Preferences" },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const { open, setOpen, ref, trigger } = usePopover();
  const initial = (user?.name || user?.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account"
        className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[13px] font-semibold text-bg transition-opacity hover:opacity-85"
      >
        {initial}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="pop absolute right-0 top-full z-50 mt-2 w-60 origin-top-right p-1.5"
          >
            <div className="px-2.5 pb-2 pt-1.5">
              <p className="truncate text-sm font-semibold">{user?.name}</p>
              <p className="truncate text-[13px] text-muted">{user?.email}</p>
            </div>
            <div className="my-1 h-px bg-line" />
            <button role="menuitem" type="button" onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <LogOut size={15} /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { meta } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const onWizard = loc.pathname === "/trips/new";
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-[var(--shadow-pop)]">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <NavLink to="/trips" aria-label="Waypoint, all trips" className="shrink-0 rounded-md">
            <span className="hidden sm:inline-flex">
              <Logo />
            </span>
            <span className="flex sm:hidden">
              <LogoMark size={26} />
            </span>
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-0.5">
            {links.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `relative flex h-8 items-center rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3 ${isActive ? "text-ink" : "text-muted hover:text-ink"}`}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-lg bg-surface-2" />}
                    <span className="relative">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {meta && (
              <span
                title={meta.data_mode === "demo" ? "Plans use the bundled demo dataset (Jaipur, Goa, Tokyo, Paris). Add a Google Maps key for live places and routing." : "Places and routes come from Google Maps."}
                className="hidden items-center gap-1.5 text-[12px] font-medium text-muted md:inline-flex"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.data_mode === "demo" ? "bg-warn" : "bg-good"}`} />
                {meta.data_mode === "demo" ? "Demo data" : "Live data"}
              </span>
            )}
            {!onWizard && (
              <Button size="sm" onClick={() => nav("/trips/new")} icon={<Plus size={15} />} aria-label="New trip">
                <span className="hidden sm:inline">New trip</span>
              </Button>
            )}
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
