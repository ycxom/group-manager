"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type Violation } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function dt(s?: string) {
  return s ? s.slice(0, 16).replace("T", " ") : "—";
}

function CountBadge({ count, max }: { count: number; max: number }) {
  if (count >= max) return <Badge variant="destructive">{count}</Badge>;
  if (count >= Math.ceil(max / 2)) return <Badge variant="warning">{count}</Badge>;
  return <Badge variant="outline">{count}</Badge>;
}

export default function ViolationsPage() {
  const { isSuperadmin, groups } = useAuth();
  const [groupFilter, setGroupFilter] = React.useState<string>("");
  const [violations, setViolations] = React.useState<Violation[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = {};
      if (groupFilter) body.groupId = parseInt(groupFilter);
      const d = await api<{ violations: Violation[] }>("/api/violation/list", body);
      setViolations(d.violations || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [groupFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function clear(v: Violation) {
    try {
      await api("/api/violation/clear", { userId: v.user_id, groupId: v.group_id });
      toast.success(`已清除用户 ${v.user_id} 在群 ${v.group_id} 的违规记录`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function clearAll(userId: number) {
    try {
      await api("/api/violation/clear", { userId });
      toast.success(`已清除用户 ${userId} 的全部违规记录`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  const groupMaxVio = React.useMemo(() => {
    const m: Record<number, number> = {};
    for (const g of groups) m[g.group_id] = g.max_violations;
    return m;
  }, [groups]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>违规记录</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Label>群组筛选</Label>
          <NativeSelect value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="">全部群组</option>
            {groups.map((g) => (
              <option key={g.group_id} value={String(g.group_id)}>
                群 {g.group_id}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={load}>
            刷新
          </Button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
        ) : violations.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">暂无违规记录</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>QQ 号</TableHead>
                <TableHead>群号</TableHead>
                <TableHead>违规次数</TableHead>
                <TableHead>最后触发内容</TableHead>
                <TableHead>最后时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {violations.map((v) => (
                <TableRow key={`${v.user_id}-${v.group_id}`}>
                  <TableCell className="font-mono">{v.user_id}</TableCell>
                  <TableCell className="font-mono">{v.group_id}</TableCell>
                  <TableCell>
                    <CountBadge count={v.count} max={groupMaxVio[v.group_id] ?? 3} />
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-xs text-muted-foreground"
                    title={v.last_content}
                  >
                    {v.last_content || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dt(v.last_at)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => clear(v)}>
                        清除此群
                      </Button>
                      {isSuperadmin && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => clearAll(v.user_id)}
                          title="清除该用户在所有群的违规记录"
                        >
                          清除全部
                        </Button>
                      )}
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
