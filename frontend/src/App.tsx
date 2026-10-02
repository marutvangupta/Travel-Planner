import { AnimatePresence, motion } from "framer-motion";
import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigationType, useOutlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { LogoMark } from "./components/layout/Logo";
import { useAuth } from "./context/AuthContext";

// Each page is its own chunk so the first load only carries the shell; the rest are prefetched once the browser is idle.
const pages = {
  auth: () => import("./pages/AuthPage"),
  trips: () => import("./pages/TripsPage"),
  newTrip: () => import("./pages/NewTripPage"),
  trip: () => import("./pages/TripPage"),
  memory: () => import("./pages/MemoryPage"),
};
const AuthPage = lazy(pages.auth);
const TripsPage = lazy(pages.trips);
const NewTripPage = lazy(pages.newTrip);
const TripPage = lazy(pages.trip);
const MemoryPage = lazy(pages.memory);

function usePrefetchPages() {
  useEffect(() => {
    const run = () => Object.values(pages).forEach((load) => void load().catch(() => undefined));
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(run);
    else window.setTimeout(run, 1200);
  }, []);
}

function Splash() {
  return (
    <div className="grid h-full place-items-center" aria-busy="true" aria-label="Loading">
      <motion.div animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}>
        <LogoMark size={36} />
      </motion.div>
    </div>
  );
}

/** New pages start at the top; back and forward keep the browser's own scroll restoration. */
function ScrollToTop() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    if (type !== "POP") window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}

function Protected() {
  const { user, ready } = useAuth();
  const outlet = useOutlet();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <AppShell>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={loc.pathname} className="min-h-full">
          <Suspense fallback={null}>{outlet}</Suspense>
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

export default function App() {
  const { ready } = useAuth();
  usePrefetchPages();
  if (!ready) return <Splash />;
  return (
    <Suspense fallback={<Splash />}>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route element={<Protected />}>
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/new" element={<NewTripPage />} />
          <Route path="/trips/:id" element={<TripPage />} />
          <Route path="/memory" element={<MemoryPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/trips" replace />} />
      </Routes>
    </Suspense>
  );
}
