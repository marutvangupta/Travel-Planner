import { AnimatePresence, motion } from "framer-motion";
import { Navigate, Route, Routes, useLocation, useOutlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { LogoMark } from "./components/layout/Logo";
import { useAuth } from "./context/AuthContext";
import AuthPage from "./pages/AuthPage";
import MemoryPage from "./pages/MemoryPage";
import NewTripPage from "./pages/NewTripPage";
import TripPage from "./pages/TripPage";
import TripsPage from "./pages/TripsPage";

function Splash() {
  return (
    <div role="status" aria-label="Loading Waypoint" className="grid h-full place-items-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.15 }} className="relative grid place-items-center">
        <motion.span
          className="absolute h-11 w-11 rounded-[12px] border border-sea"
          animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
        <LogoMark size={44} />
      </motion.div>
    </div>
  );
}

function Protected() {
  const { user, ready } = useAuth();
  const outlet = useOutlet();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <AppShell>
      {/* the next page starts at the top, but only once the previous one has faded out */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => window.scrollTo(0, 0)}>
        <motion.div key={loc.pathname} className="min-h-full">
          {outlet}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

export default function App() {
  const { ready } = useAuth();
  if (!ready) return <Splash />;
  return (
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
  );
}
