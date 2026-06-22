"use client";

import * as React from "react";

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

function applyClass(url: string) {
  document.documentElement.classList.toggle("has-wallpaper", !!url);
}

export function WallpaperProvider({ children }: { children: React.ReactNode }) {
  const [wallpaper, setWallpaperState] = React.useState("");

  React.useEffect(() => {
    fetch("/api/settings/wallpaper")
      .then((r) => r.json())
      .then((data) => {
        const url: string = data.data?.url || "";
        setWallpaperState(url);
        applyClass(url);
      })
      .catch(() => {});
  }, []);

  const setWallpaper = React.useCallback((url: string) => {
    fetch("/api/settings/wallpaper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setWallpaperState(url);
          applyClass(url);
        }
      })
      .catch(() => {});
  }, []);

  const clearWallpaper = React.useCallback(() => setWallpaper(""), [setWallpaper]);

  return (
    <Ctx.Provider value={{ wallpaper, setWallpaper, clearWallpaper }}>
      {children}
    </Ctx.Provider>
  );
}
