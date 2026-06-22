"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type Keyword } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type KwType = "text" | "ocr" | "qr";
type Scope = { type: "global" | "group" | "category"; id: number };
type DFields = { d: number; h: number; m: number; s: number };

const TYPE_LABELS: Record<KwType, string> = {
  text: "文字关键词",
  ocr: "OCR 关键词",
  qr: "二维码关键词",
};

const API_BASE: Record<KwType, { grp: string; cat: string }> = {
  text: { grp: "/api/keyword", cat: "/api/category/keyword" },
  ocr: { grp: "/api/ocr-keyword", cat: "/api/category/ocr-keyword" },
  qr: { grp: "/api/qr-keyword", cat: "/api/category/qr-keyword" },
};

const MAX_MUTE = 30 * 86400; // 2,592,000 秒

function dt(s?: string) {
  return s ? s.slice(0, 16).replace("T", " ") : "—";
}

function secsToFields(secs: number): DFields {
  const s = Math.max(0, Math.floor(secs || 0));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

function fieldsToSecs({ d, h, m, s }: DFields) {
  return d * 86400 + h * 3600 + m * 60 + s;
}

function clampField(v: number, max: number) {
  return Math.max(0, Math.min(max, Math.floor(v) || 0));
}

// ─── Toggle chip ─────────────────────────────────────────────────────────────

function ToggleChip({
  checked,
  disabled,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "select-none rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-transparent text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ─── Mute duration picker ─────────────────────────────────────────────────────

function MuteDurationInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (secs: number) => void;
}) {
  const [fields, setFields] = React.useState<DFields>(() => secsToFields(value));
  const [err, setErr] = React.useState("");

  React.useEffect(() => {
    setFields(secsToFields(value));
    setErr("");
  }, [value]);

  function setField(key: keyof DFields, raw: string) {
    const n = parseInt(raw, 10);
    setFields((prev) => ({ ...prev, [key]: isNaN(n) || n < 0 ? 0 : n }));
    setErr("");
  }

  function commit() {
    const clamped: DFields = {
      d: clampField(fields.d, 30),
      h: clampField(fields.h, 23),
      m: clampField(fields.m, 59),
      s: clampField(fields.s, 59),
    };
    const total = fieldsToSecs(clamped);
    if (total <= 0) {
      setErr("须 > 0");
      setFields(clamped);
      return;
    }
    if (total > MAX_MUTE) {
      setErr("超出 30 天");
      setFields({ d: 30, h: 0, m: 0, s: 0 });
      return;
    }
    setErr("");
    setFields(clamped);
    if (total !== value) onCommit(total);
  }

  const inputCls =
    "rounded border border-border bg-background text-center font-mono text-xs py-0.5 " +
    "focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed";

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <input
          type="number"
          min={0}
          max={30}
          value={fields.d}
          onChange={(e) => setField("d", e.target.value)}
          onBlur={commit}
          disabled={disabled}
          className={cn(inputCls, "w-9")}
        />
        <span>天</span>
        <input
          type="number"
          min={0}
          max={23}
          value={fields.h}
          onChange={(e) => setField("h", e.target.value)}
          onBlur={commit}
          disabled={disabled}
          className={cn(inputCls, "w-8")}
        />
        <span>:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={fields.m}
          onChange={(e) => setField("m", e.target.value)}
          onBlur={commit}
          disabled={disabled}
          className={cn(inputCls, "w-8")}
        />
        <span>:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={fields.s}
          onChange={(e) => setField("s", e.target.value)}
          onBlur={commit}
          disabled={disabled}
          className={cn(inputCls, "w-8")}
        />
      </div>
      {err && <span className="text-[10px] text-destructive">{err}</span>}
    </div>
  );
}

// ─── Disposition cell ─────────────────────────────────────────────────────────

function ActionCell({
  k,
  onUpdate,
}: {
  k: Keyword;
  onUpdate: (opts: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToggleChip
        checked={!!k.do_recall}
        onChange={(v) => onUpdate({ doRecall: v ? 1 : 0 })}
        title="命中后撤回消息"
      >
        撤回
      </ToggleChip>
      <ToggleChip
        checked={!k.recall_only}
        onChange={(v) => onUpdate({ recallOnly: v ? 0 : 1 })}
        title="计入违规次数，达上限踢出"
      >
        记违规
      </ToggleChip>
      <ToggleChip
        checked={!!k.do_mute}
        onChange={(v) => onUpdate({ doMute: v ? 1 : 0 })}
        title="命中后立即禁言（不计违规次数）"
      >
        禁言
      </ToggleChip>
      <MuteDurationInput
        value={k.mute_duration ?? 600}
        disabled={!k.do_mute}
        onCommit={(secs) => onUpdate({ muteDuration: secs })}
      />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function KeywordsPage() {
  const { isSuperadmin, groups, categories } = useAuth();
  const [kwType, setKwType] = React.useState<KwType>("text");
  const [scope, setScope] = React.useState<Scope | null>(null);
  const [keywords, setKeywords] = React.useState<Keyword[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newKw, setNewKw] = React.useState("");
  const [addRecall, setAddRecall] = React.useState(true);
  const [addViolation, setAddViolation] = React.useState(true);
  const [addMute, setAddMute] = React.useState(false);
  const [addDurationSecs, setAddDurationSecs] = React.useState(600);

  const freeGroups = React.useMemo(
    () => groups.filter((g) => !g.categories?.length),
    [groups],
  );

  React.useEffect(() => {
    if (scope) return;
    if (isSuperadmin) setScope({ type: "global", id: 0 });
    else if (categories.length)
      setScope({ type: "category", id: categories[0].id });
    else if (freeGroups.length)
      setScope({ type: "group", id: freeGroups[0].group_id });
  }, [scope, isSuperadmin, categories, freeGroups]);

  const isCat = scope?.type === "category";
  const base = isCat ? API_BASE[kwType].cat : API_BASE[kwType].grp;
  const pkey = React.useMemo<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    if (!scope) return p;
    if (isCat) p.categoryId = scope.id;
    else p.groupId = scope.type === "global" ? 0 : scope.id;
    return p;
  }, [scope, isCat]);

  const load = React.useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    try {
      const d = await api<{ keywords: Keyword[] }>(base + "/list", pkey);
      setKeywords(d.keywords || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [base, pkey, scope]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const kw = newKw.trim();
    if (!kw) return toast.error("请输入关键词");
    if (addMute && (addDurationSecs <= 0 || addDurationSecs > MAX_MUTE)) {
      return toast.error("禁言时长不合法（1 秒 ~ 30 天）");
    }
    try {
      await api(base + "/add", {
        ...pkey,
        keyword: kw,
        doRecall: addRecall ? 1 : 0,
        recallOnly: addViolation ? 0 : 1,
        doMute: addMute ? 1 : 0,
        muteDuration: addDurationSecs,
      });
      toast.success(`已添加：${kw}`);
      setNewKw("");
      setAddRecall(true);
      setAddViolation(true);
      setAddMute(false);
      setAddDurationSecs(600);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function update(k: Keyword, opts: Record<string, unknown>) {
    try {
      await api(base + "/update", { ...pkey, keyword: k.keyword, ...opts });
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失败");
    }
  }

  async function remove(k: Keyword) {
    try {
      await api(base + "/remove", { ...pkey, keyword: k.keyword });
      toast.success(`已删除：${k.keyword}`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  const scopeValue = scope ? JSON.stringify(scope) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>关键词管理</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Type + scope selectors */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>类型</Label>
            <NativeSelect
              value={kwType}
              onChange={(e) => setKwType(e.target.value as KwType)}
            >
              {(Object.keys(TYPE_LABELS) as KwType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2">
            <Label>作用域</Label>
            <NativeSelect
              value={scopeValue}
              onChange={(e) => setScope(JSON.parse(e.target.value) as Scope)}
            >
              {isSuperadmin && (
                <option value={JSON.stringify({ type: "global", id: 0 })}>
                  全局 (group_id=0)
                </option>
              )}
              {categories.length > 0 && (
                <optgroup label="── 组别 ──">
                  {categories.map((c) => (
                    <option
                      key={`c${c.id}`}
                      value={JSON.stringify({ type: "category", id: c.id })}
                    >
                      组别: {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {freeGroups.length > 0 && (
                <optgroup label="── 独立群组 ──">
                  {freeGroups.map((g) => (
                    <option
                      key={`g${g.group_id}`}
                      value={JSON.stringify({ type: "group", id: g.group_id })}
                    >
                      群 {g.group_id}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </div>
        </div>

        {kwType === "ocr" && (
          <p className="text-xs text-muted-foreground">
            OCR 关键词仅匹配图片文字识别结果，与文字关键词相互独立
          </p>
        )}
        {kwType === "qr" && (
          <p className="text-xs text-muted-foreground">
            二维码关键词仅匹配二维码解析内容，与文字关键词相互独立
          </p>
        )}

        {/* Add row */}
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/40 p-3">
          <Input
            placeholder="关键词"
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="min-w-[180px] flex-1"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <ToggleChip
              checked={addRecall}
              onChange={setAddRecall}
              title="命中后撤回消息"
            >
              撤回
            </ToggleChip>
            <ToggleChip
              checked={addViolation}
              onChange={setAddViolation}
              title="计入违规次数，达上限踢出"
            >
              记违规
            </ToggleChip>
            <ToggleChip
              checked={addMute}
              onChange={setAddMute}
              title="命中后立即禁言"
            >
              禁言
            </ToggleChip>
            <MuteDurationInput
              value={addDurationSecs}
              disabled={!addMute}
              onCommit={setAddDurationSecs}
            />
          </div>
          <Button onClick={add}>添加</Button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            加载中…
          </p>
        ) : keywords.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            暂无关键词
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>关键词</TableHead>
                <TableHead>处置</TableHead>
                <TableHead>添加者</TableHead>
                <TableHead>时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keywords.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="break-all font-medium">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{k.keyword}</span>
                      {!!k.recall_only && !k.do_recall && !k.do_mute && !k.do_kick && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                          已停用
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ActionCell k={k} onUpdate={(opts) => update(k, opts)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.created_by || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dt(k.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(k)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
