"use client";

import * as React from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { ShieldCheck } from "lucide-react";

export function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/50" style={{ backgroundColor: "color-mix(in srgb, var(--card) 60%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-6" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">群管理后台</h1>
            <p className="text-xs text-muted-foreground">请登录以继续</p>
          </div>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u">用户名</Label>
              <Input
                id="u"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p">密码</Label>
              <Input
                id="p"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "登录中…" : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
