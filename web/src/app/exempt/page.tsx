"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type ExemptUser } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Scope = { type: "global" | "group" | "category"; id: number };

function dt(s?: string) {
  return s ? s.slice(0, 16).replace("T", " ") : "—";
}

export default function ExemptPage() {
  const { isSuperadmin, groups, categories } = useAuth();
  const [scope, setScope] = React.useState<Scope | null>(null);
  const [exempts, setExempts] = React.useState<ExemptUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newUserId, setNewUserId] = React.useState("");

  const freeGroups = React.useMemo(
    () => groups.filter((g) => !g.categories?.length),
    [groups],
  );

  React.useEffect(() => {
    if (scope) return;
    if (isSuperadmin) setScope({ type: "global", id: 0 });
    else if (categories.length) setScope({ type: "category", id: categories[0].id });
    else if (freeGroups.length) setScope({ type: "group", id: freeGroups[0].group_id });
  }, [scope, isSuperadmin, categories, freeGroups]);

  const isCat = scope?.type === "category";
  const base = isCat ? "/api/category/exempt" : "/api/exempt";
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
      const d = await api<{ users: ExemptUser[] }>(base + "/list", pkey);
      setExempts(d.users || []);
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
    const uid = parseInt(newUserId);
    if (!uid) return toast.error("请输入有效 QQ 号");
    try {
      await api(base + "/add", { ...pkey, userId: uid });
      toast.success(`已豁免 ${uid}`);
      setNewUserId("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function remove(uid: number) {
    try {
      await api(base + "/remove", { ...pkey, userId: uid });
      toast.success(`已移除豁免 ${uid}`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  const scopeValue = scope ? JSON.stringify(scope) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>豁免用户</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        <p className="text-xs text-muted-foreground">
          豁免用户发送的消息不会触发关键词检测和图片规则，但仍可手动撤回
        </p>

        <div className="flex items-center gap-3 rounded-md border border-border bg-background/40 p-3">
          <Input
            placeholder="QQ 号"
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="w-40"
            type="number"
          />
          <Button onClick={add}>添加豁免</Button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
        ) : exempts.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无豁免用户</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>QQ 号</TableHead>
                <TableHead>添加时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exempts.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-mono">{u.user_id}</TableCell>
                  <TableCell className="text-muted-foreground">{dt(u.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button variant="destructive" size="sm" onClick={() => remove(u.user_id)}>
                        移除
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
