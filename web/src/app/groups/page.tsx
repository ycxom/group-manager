"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type Group } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function GroupsPage() {
  const { isSuperadmin, refreshMeta } = useAuth();
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newGroupId, setNewGroupId] = React.useState("");
  const [newMaxVio, setNewMaxVio] = React.useState("3");
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editMaxVio, setEditMaxVio] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ groups: Group[] }>("/api/group/list");
      setGroups(d.groups || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function addGroup() {
    const gid = parseInt(newGroupId);
    if (!gid) return toast.error("请输入有效群号");
    try {
      await api("/api/group/add", { groupId: gid, maxViolations: parseInt(newMaxVio) || 3 });
      toast.success(`已添加群 ${gid}`);
      setNewGroupId("");
      setNewMaxVio("3");
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function removeGroup(gid: number) {
    try {
      await api("/api/group/remove", { groupId: gid });
      toast.success(`已移除群 ${gid}`);
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  async function toggleEnabled(g: Group) {
    try {
      await api("/api/group/settings", { groupId: g.group_id, enabled: g.enabled ? 0 : 1 });
      toast.success(`群 ${g.group_id} 已${g.enabled ? "停用" : "启用"}`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function saveMaxVio(g: Group) {
    const v = parseInt(editMaxVio);
    if (!v || v < 1) return toast.error("请输入 ≥1 的整数");
    try {
      await api("/api/group/settings", { groupId: g.group_id, maxViolations: v });
      toast.success(`群 ${g.group_id} 违规上限已更新为 ${v}`);
      setEditingId(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <CardTitle>添加群组</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label>群号</Label>
                <Input
                  placeholder="QQ 群号"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addGroup()}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>违规上限</Label>
                <Input
                  type="number"
                  min="1"
                  value={newMaxVio}
                  onChange={(e) => setNewMaxVio(e.target.value)}
                  className="w-24"
                />
              </div>
              <Button onClick={addGroup}>添加</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>群组列表</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无群组</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>群号</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>违规上限</TableHead>
                  <TableHead>关键词</TableHead>
                  <TableHead>违规人数</TableHead>
                  <TableHead>所属组别</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.group_id}>
                    <TableCell className="font-mono">{g.group_id}</TableCell>
                    <TableCell>
                      {g.enabled ? (
                        <Badge variant="success">启用</Badge>
                      ) : (
                        <Badge variant="destructive">停用</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === g.group_id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min="1"
                            value={editMaxVio}
                            onChange={(e) => setEditMaxVio(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveMaxVio(g);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="h-7 w-16 text-xs"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => saveMaxVio(g)}
                          >
                            ✓
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setEditingId(null)}
                          >
                            ✕
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="rounded px-1 text-sm hover:bg-accent hover:text-accent-foreground"
                          title="点击编辑"
                          onClick={() => {
                            setEditingId(g.group_id);
                            setEditMaxVio(String(g.max_violations));
                          }}
                        >
                          {g.max_violations}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{g.keyword_count}</TableCell>
                    <TableCell className="text-muted-foreground">{g.violation_count}</TableCell>
                    <TableCell>
                      {g.categories?.length ? (
                        g.categories.map((c) => (
                          <Badge key={c.id} variant="outline" className="mr-1 text-xs">
                            {c.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">独立</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => toggleEnabled(g)}>
                          {g.enabled ? "停用" : "启用"}
                        </Button>
                        {isSuperadmin && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => removeGroup(g.group_id)}
                          >
                            删除
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
    </div>
  );
}
