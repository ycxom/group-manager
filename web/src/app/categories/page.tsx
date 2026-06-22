"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type Category, type Group } from "@/lib/api";
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
import { ChevronDown, ChevronRight } from "lucide-react";

export default function CategoriesPage() {
  const { isSuperadmin, refreshMeta } = useAuth();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [newCatName, setNewCatName] = React.useState("");
  const [expandedId, setExpandedId] = React.useState<number | null>(null);
  const [catGroups, setCatGroups] = React.useState<Record<number, Group[]>>({});
  const [addGroupId, setAddGroupId] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ categories: Category[] }>("/api/category/list");
      setCategories(d.categories || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function loadGroups(catId: number) {
    try {
      const d = await api<{ groups: Group[] }>("/api/category/groups", { categoryId: catId });
      setCatGroups((prev) => ({ ...prev, [catId]: d.groups || [] }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载群组失败");
    }
  }

  function toggleExpand(catId: number) {
    if (expandedId === catId) {
      setExpandedId(null);
    } else {
      setExpandedId(catId);
      setAddGroupId("");
      if (!catGroups[catId]) loadGroups(catId);
    }
  }

  async function addCategory() {
    const name = newCatName.trim();
    if (!name) return toast.error("请输入组别名称");
    try {
      await api("/api/category/add", { name });
      toast.success(`已添加组别「${name}」`);
      setNewCatName("");
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function removeCategory(catId: number, name: string) {
    try {
      await api("/api/category/remove", { categoryId: catId });
      toast.success(`已删除组别「${name}」`);
      if (expandedId === catId) setExpandedId(null);
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  async function addGroupToCat(catId: number) {
    const gid = parseInt(addGroupId);
    if (!gid) return toast.error("请输入有效群号");
    try {
      await api("/api/category/groups/add", { groupId: gid, categoryId: catId });
      toast.success(`群 ${gid} 已加入组别`);
      setAddGroupId("");
      loadGroups(catId);
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function removeGroupFromCat(gid: number, catId: number) {
    try {
      await api("/api/category/groups/remove", { groupId: gid, categoryId: catId });
      toast.success(`群 ${gid} 已移出组别`);
      loadGroups(catId);
      load();
      refreshMeta();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <CardTitle>添加组别</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Input
                placeholder="组别名称"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCategory()}
                className="w-48"
              />
              <Button onClick={addCategory}>添加</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>组别列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
          ) : categories.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">暂无组别</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>名称</TableHead>
                  <TableHead>群组数</TableHead>
                  <TableHead>关键词数</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <React.Fragment key={c.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => toggleExpand(c.id)}
                    >
                      <TableCell className="text-muted-foreground">
                        {expandedId === c.id ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.group_count ?? 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{c.keyword_count ?? 0}</Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          {isSuperadmin && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => removeCategory(c.id, c.name)}
                            >
                              删除
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {expandedId === c.id && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 px-6 py-4">
                          <div className="flex flex-col gap-3">
                            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              成员群组
                            </Label>
                            {(catGroups[c.id] || []).length === 0 ? (
                              <p className="text-xs text-muted-foreground">暂无成员群组</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {(catGroups[c.id] || []).map((g) => (
                                  <div
                                    key={g.group_id}
                                    className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                                  >
                                    <span className="font-mono">{g.group_id}</span>
                                    {isSuperadmin && (
                                      <button
                                        className="ml-1 text-muted-foreground hover:text-destructive"
                                        onClick={() => removeGroupFromCat(g.group_id, c.id)}
                                        title="从组别中移除"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                            {isSuperadmin && (
                              <div className="flex items-center gap-2 pt-1">
                                <Input
                                  placeholder="群号"
                                  value={addGroupId}
                                  onChange={(e) => setAddGroupId(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && addGroupToCat(c.id)}
                                  className="h-7 w-32 text-xs"
                                  type="number"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => addGroupToCat(c.id)}
                                >
                                  加入群组
                                </Button>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
