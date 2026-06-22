"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface LogEntry {
  id: number;
  cls: "recall" | "kick" | "scan" | "info";
  text: string;
}

interface GmEvent {
  type: string;
  groupId?: number;
  userId?: number;
  violations?: number;
  content?: string;
  ocr?: string;
  qr?: string;
  text?: string;
}

let _id = 0;
const ts = () => new Date().toTimeString().slice(0, 8);

function format(ev: GmEvent): LogEntry | null {
  if (ev.type === "recall")
    return {
      id: _id++,
      cls: "recall",
      text: `[${ts()}] 撤回 群${ev.groupId} 用户${ev.userId} (第${ev.violations}次) — ${ev.content}`,
    };
  if (ev.type === "kick")
    return {
      id: _id++,
      cls: "kick",
      text: `[${ts()}] 踢出 用户${ev.userId} 累计${ev.violations}次`,
    };
  if (ev.type === "scan") {
    const extra = [
      ev.ocr ? `OCR: ${ev.ocr.replace(/\n/g, " ").slice(0, 100)}` : "",
      ev.qr ? `QR: ${ev.qr.slice(0, 80)}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    return {
      id: _id++,
      cls: "scan",
      text: `[${ts()}] 群${ev.groupId} 用户${ev.userId} 扫描通过${extra ? " — " + extra : ""}`,
    };
  }
  if (ev.type === "info") return { id: _id++, cls: "info", text: `[${ts()}] ${ev.text}` };
  return null;
}

export function EventLog() {
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [connected, setConnected] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const push = React.useCallback((ev: GmEvent) => {
    const entry = format(ev);
    if (!entry) return;
    setLogs((prev) => [...prev.slice(-199), entry]);
  }, []);

  React.useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/events", { withCredentials: true });
      es.onopen = () => {
        setConnected(true);
        push({ type: "info", text: "SSE 已连接，等待实时事件…" });
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) {
          push({ type: "info", text: "连接断开，4 秒后重连…" });
          retry = setTimeout(connect, 4000);
        }
      };
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as GmEvent;
          if (ev.type !== "connected") push(ev);
        } catch {
          /* ignore */
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [push]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          实时事件
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-2 rounded-full",
              connected ? "bg-success" : "bg-muted-foreground",
            )}
          />
          {connected ? "已连接" : "断线重连…"}
        </span>
      </div>
      <div
        ref={bodyRef}
        className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-muted-foreground">暂无事件</p>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              className={cn(
                "whitespace-pre-wrap break-all",
                l.cls === "recall" && "text-warning",
                l.cls === "kick" && "text-destructive",
                (l.cls === "scan" || l.cls === "info") && "text-muted-foreground",
              )}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
