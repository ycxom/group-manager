"use client";

import * as React from "react";
import {
  api,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  type Me,
  type Group,
  type Category,
} from "@/lib/api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  groups: Group[];
  categories: Category[];
  isSuperadmin: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  setMe: (me: Me | null) => void;
}

const Ctx = React.createContext<AuthState | null>(null);

export function useAuth() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<Me | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);

  const refreshMeta = React.useCallback(async () => {
    const [gl, cl] = await Promise.all([
      api<{ groups: Group[] }>("/api/group/list").catch(() => ({ groups: [] })),
      api<{ categories: Category[] }>("/api/category/list").catch(() => ({ categories: [] })),
    ]);
    setGroups(gl.groups || []);
    setCategories(cl.categories || []);
  }, []);

  React.useEffect(() => {
    (async () => {
      const m = await fetchMe();
      setMe(m);
      if (m) await refreshMeta();
      setLoading(false);
    })();
  }, [refreshMeta]);

  const login = React.useCallback(
    async (u: string, p: string) => {
      const m = await apiLogin(u, p);
      setMe(m);
      await refreshMeta();
    },
    [refreshMeta],
  );

  const logout = React.useCallback(async () => {
    await apiLogout();
    setMe(null);
    setGroups([]);
    setCategories([]);
  }, []);

  const value: AuthState = {
    me,
    loading,
    groups,
    categories,
    isSuperadmin: me?.role === "superadmin",
    login,
    logout,
    refreshMeta,
    setMe,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
