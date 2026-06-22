"use client";

import * as React from "react";

const KEY = "gm_wallpaper";

interface WallpaperCtx {
  wallpaper: string;
  setWallpaper: (url: string) => void;
  clearWallpaper: () => void;
}

const Ctx = React.createContext<WallpaperCtx | null>(null);

export function useWallpaper() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useWallpaper must be used within WallpaperProvider");
  return v;
}

export function WallpaperProvider({ children }: { children: React.ReactNode }) {
  const [wallpaper, setWallpaperState] = React.useState("");

  React.useEffect(() => {
    const saved = localStorage.getItem(KEY) || "";
    setWallpaperState(saved);
    document.documentElement.classList.toggle("has-wallpaper", !!saved);
  }, []);

  const setWallpaper = React.useCallback((url: string) => {
    setWallpaperState(url);
    if (url) {
      localStorage.setItem(KEY, url);
      document.documentElement.classList.add("has-wallpaper");
    } else {
      localStorage.removeItem(KEY);
      document.documentElement.classList.remove("has-wallpaper");
    }
  }, []);

  const clearWallpaper = React.useCallback(() => setWallpaper(""), [setWallpaper]);

  return (
    <Ctx.Provider value={{ wallpaper, setWallpaper, clearWallpaper }}>
      {children}
    </Ctx.Provider>
  );
}
