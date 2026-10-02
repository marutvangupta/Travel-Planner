import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, tokenStore } from "../lib/api";
import type { Meta } from "../lib/types";

interface User {
  id: string;
  email: string;
  name: string;
}
interface AuthState {
  user: User | null;
  ready: boolean;
  meta: Meta | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    api<Meta>("/meta").then(setMeta).catch(() => setMeta(null));
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api<User>("/me")
      .then(setUser)
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, [logout]);

  const finish = (r: { token: string; user: User }) => {
    tokenStore.set(r.token);
    setUser(r.user);
  };
  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      meta,
      login: async (email, password) => finish(await api("/auth/login", { method: "POST", json: { email, password } })),
      register: async (email, password, name) => finish(await api("/auth/register", { method: "POST", json: { email, password, name } })),
      logout,
    }),
    [user, ready, meta, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
