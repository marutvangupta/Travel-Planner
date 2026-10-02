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
    <div className="grid h-full place-items-center">
      <motion.div animate={{ scale: [1, 1.12, 1], rotate: [0, 12, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}>
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
      <AnimatePresence mode="wait" initial={false}>
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
