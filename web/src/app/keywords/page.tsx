"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type Keyword } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

function dt(s?: string) {
  return s ? s.slice(0, 16).replace("T", " ") : "—";
}

export default function KeywordsPage() {
  const { isSuperadmin, groups, categories } = useAuth();
  const [kwType, setKwType] = React.useState<KwType>("text");
  const [scope, setScope] = React.useState<Scope | null>(null);
  const [keywords, setKeywords] = React.useState<Keyword[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newKw, setNewKw] = React.useState("");
  const [recallOnly, setRecallOnly] = React.useState(false);

  const freeGroups = React.useMemo(
    () => groups.filter((g) => !g.categories?.length),
    [groups],
  );

  // Default scope once meta is available
  React.useEffect(() => {
    if (scope) return;
    if (isSuperadmin) setScope({ type: "global", id: 0 });
    else if (categories.length) setScope({ type: "category", id: categories[0].id });
    else if (freeGroups.length) setScope({ type: "group", id: freeGroups[0].group_id });
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
    try {
      await api(base + "/add", { ...pkey, keyword: kw, recallOnly });
      toast.success(`已添加：${kw}`);
      setNewKw("");
      setRecallOnly(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function toggle(k: Keyword) {
    const next = k.recall_only ? 0 : 1;
    try {
      await api(base + "/update", { ...pkey, keyword: k.keyword, recallOnly: !!next });
      toast.success(`「${k.keyword}」已设为${next ? "仅撤回" : "撤回+计违规"}`);
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
          <label
            className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
            title="命中后仅撤回消息，不计入违规、不触发踢人"
          >
            <Switch checked={recallOnly} onCheckedChange={setRecallOnly} />
            仅撤回
          </label>
          <Button onClick={add}>添加</Button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
        ) : keywords.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无关键词</p>
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
                  <TableCell className="font-medium break-all">{k.keyword}</TableCell>
                  <TableCell>
                    {k.recall_only ? (
                      <Badge variant="warning">仅撤回</Badge>
                    ) : (
                      <Badge variant="outline">撤回+计违规</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.created_by || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dt(k.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggle(k)}
                        title="切换该关键词的处置方式"
                      >
                        {k.recall_only ? "改为计违规" : "改为仅撤回"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => remove(k)}>
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
