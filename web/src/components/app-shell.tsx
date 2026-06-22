"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useWallpaper } from "@/components/wallpaper-provider";
import { LoginForm } from "@/components/login-form";
import { EventLog } from "@/components/event-log";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquareText,
  Users2,
  ShieldOff,
  TriangleAlert,
  UserCog,
  FolderTree,
  Image as ImageIcon,
  LogOut,
  Loader2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
  superadminOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", label: "仪表板", icon: LayoutDashboard, enabled: true },
  { href: "/keywords", label: "关键词", icon: MessageSquareText, enabled: true },
  { href: "/groups", label: "群组", icon: Users2, enabled: true },
  { href: "/exempt", label: "豁免用户", icon: ShieldOff, enabled: true },
  { href: "/violations", label: "违规记录", icon: TriangleAlert, enabled: true },
  { href: "/categories", label: "组别", icon: FolderTree, enabled: true },
  { href: "/imageconfig", label: "图片规则", icon: ImageIcon, enabled: true },
  { href: "/users", label: "用户", icon: UserCog, enabled: true, superadminOnly: true },
];

// ── 壁纸背景层 ──────────────────────────────────────────────────────────────

function WallpaperBg({ url, blurred }: { url: string; blurred: boolean }) {
  if (!url) return null;
  return (
    <>
      {/* 扩展 40px 防止模糊边缘露出 */}
      <div
        style={{
          position: "fixed",
          inset: "-40px",
          zIndex: -2,
          backgroundImage: `url('${url.replace(/'/g, "\\'")}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          filter: blurred ? "blur(5px) brightness(0.8)" : "none",
          transition: "filter 0.6s ease",
        }}
      />
      {/* 登录后额外压暗遮罩，提升文字对比度 */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: -1,
          backgroundColor: blurred ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0)",
          transition: "background-color 0.6s ease",
          pointerEvents: "none",
        }}
      />
    </>
  );
}

// ── 壁纸设置面板（侧边栏底部）────────────────────────────────────────────────

function WallpaperPanel() {
  const { wallpaper, setWallpaper, clearWallpaper } = useWallpaper();
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  function applyUrl() {
    const v = url.trim();
    if (v) { setWallpaper(v); setUrl(""); }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setWallpaper(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  return (
    <div className="border-t border-border">
      <button
        className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <ImageIcon className="size-3.5 shrink-0" />
        <span className="flex-1 text-left">壁纸</span>
        {wallpaper && (
          <span className="size-1.5 rounded-full bg-primary" title="已设置壁纸" />
        )}
        {open ? (
          <ChevronUp className="size-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {/* 预览 */}
          {wallpaper && (
            <div className="relative h-20 overflow-hidden rounded-md border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={wallpaper}
                alt="壁纸预览"
                className="h-full w-full object-cover"
              />
              <button
                onClick={clearWallpaper}
                className="absolute right-1 top-1 flex items-center justify-center rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                title="移除壁纸"
              >
                <X className="size-3" />
              </button>
            </div>
          )}

          {/* URL 输入 */}
          <input
            type="url"
            placeholder="粘贴图片链接…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyUrl()}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="flex gap-2">
            <button
              onClick={applyUrl}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent"
            >
              应用链接
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs hover:bg-accent"
            >
              上传文件
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      )}
    </div>
  );
}

// ── 主 Shell ────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, isSuperadmin } = useAuth();
  const { wallpaper } = useWallpaper();
  const pathname = usePathname();

  if (loading) {
    return (
      <>
        <WallpaperBg url={wallpaper} blurred={false} />
        <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </>
    );
  }

  if (!me) {
    return (
      <>
        <WallpaperBg url={wallpaper} blurred={false} />
        <LoginForm />
      </>
    );
  }

  const nav = NAV.filter((n) => !n.superadminOnly || isSuperadmin);

  return (
    <>
    <WallpaperBg url={wallpaper} blurred={true} />
    <div className="grid h-dvh grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_320px]">
      {/* Sidebar */}
      <aside className="flex flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex size-7 items-center justify-center rounded bg-primary/10 text-primary">
            <LayoutDashboard className="size-4" />
          </div>
          <span className="text-sm font-semibold">群管理后台</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            const inner = (
              <span
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  !item.enabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{item.label}</span>
                {!item.enabled && (
                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                    待迁移
                  </Badge>
                )}
              </span>
            );
            return item.enabled ? (
              <Link key={item.href} href={item.href}>
                {inner}
              </Link>
            ) : (
              <div key={item.href} aria-disabled title="即将迁移到新界面">
                {inner}
              </div>
            );
          })}
        </nav>
        <WallpaperPanel />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-col overflow-hidden bg-card">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <h1 className="text-sm font-medium text-muted-foreground">
            {nav.find((n) => n.href === pathname)?.label ?? "群管理"}
          </h1>
          <div className="flex items-center gap-3">
            {me.isDefaultPassword && (
              <Badge variant="warning">默认密码，请尽快修改</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {me.username}
              <Badge variant="outline" className="ml-2">
                {me.role === "superadmin" ? "超级管理员" : "管理员"}
              </Badge>
            </span>
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              <LogOut className="size-4" /> 退出
            </Button>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>

      {/* Live event log (wide screens) */}
      <aside className="hidden border-l border-border bg-card xl:block">
        <EventLog />
      </aside>
    </div>
    </>
  );
}
