"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type UserRecord, type Category } from "@/lib/api";
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

function Tag({
  label,
  onRemove,
}: {
  label: string;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-mono">
      {label}
      {onRemove && (
        <button className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
          ✕
        </button>
      )}
    </span>
  );
}

export default function UsersPage() {
  const { me, isSuperadmin, groups: authGroups, categories: authCategories, setMe } = useAuth();
  const [users, setUsers] = React.useState<UserRecord[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<string | null>(null);

  // Add user form
  const [newUsername, setNewUsername] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [newRole, setNewRole] = React.useState<"admin" | "superadmin">("admin");

  // Permission management inputs
  const [addGroupId, setAddGroupId] = React.useState("");
  const [addCatId, setAddCatId] = React.useState<string>("");

  // My account
  const [oldPwd, setOldPwd] = React.useState("");
  const [newPwd, setNewPwd] = React.useState("");
  const [curPwdForName, setCurPwdForName] = React.useState("");
  const [myNewUsername, setMyNewUsername] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<{ users: UserRecord[] }>("/api/user/list");
      setUsers(d.users || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function addUser() {
    if (!newUsername.trim() || !newPassword) return toast.error("请输入用户名和密码");
    try {
      await api("/api/user/add", { username: newUsername.trim(), password: newPassword, role: newRole });
      toast.success(`已添加用户 ${newUsername.trim()}`);
      setNewUsername("");
      setNewPassword("");
      setNewRole("admin");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "添加失败");
    }
  }

  async function removeUser(username: string) {
    try {
      await api("/api/user/remove", { username });
      toast.success(`已删除用户 ${username}`);
      if (selectedUser === username) setSelectedUser(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败");
    }
  }

  async function assignGroup(username: string) {
    const gid = parseInt(addGroupId);
    if (!gid) return toast.error("请输入有效群号");
    try {
      await api("/api/user/groups/add", { username, groupId: gid });
      toast.success(`已授权群 ${gid} 给 ${username}`);
      setAddGroupId("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function revokeGroup(username: string, gid: number) {
    try {
      await api("/api/user/groups/remove", { username, groupId: gid });
      toast.success(`已撤销群 ${gid} 的授权`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function assignCategory(username: string) {
    const cid = parseInt(addCatId);
    if (!cid) return toast.error("请选择组别");
    try {
      await api("/api/user/categories/add", { username, categoryId: cid });
      toast.success(`已授权组别 ${cid} 给 ${username}`);
      setAddCatId("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function revokeCategory(username: string, catId: number) {
    try {
      await api("/api/user/categories/remove", { username, categoryId: catId });
      toast.success(`已撤销组别授权`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "操作失败");
    }
  }

  async function changePassword() {
    if (!oldPwd || !newPwd) return toast.error("请输入当前密码和新密码");
    try {
      await api("/api/user/password", { oldPassword: oldPwd, newPassword: newPwd });
      toast.success("密码已修改");
      setOldPwd("");
      setNewPwd("");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "修改失败");
    }
  }

  async function changeUsername() {
    if (!myNewUsername.trim() || !curPwdForName) return toast.error("请输入新用户名和当前密码");
    try {
      const d = await api<{ newUsername: string }>("/api/user/username", {
        newUsername: myNewUsername.trim(),
        password: curPwdForName,
      });
      toast.success(`用户名已改为 ${d.newUsername}`);
      setMyNewUsername("");
      setCurPwdForName("");
      setMe({ ...me!, username: d.newUsername });
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "修改失败");
    }
  }

  const catById = React.useMemo(() => {
    const m: Record<number, string> = {};
    for (const c of authCategories) m[c.id] = c.name;
    return m;
  }, [authCategories]);

  const selected = users.find((u) => u.username === selectedUser);

  return (
    <div className="flex flex-col gap-4">
      {isSuperadmin && (
        <Card>
          <CardHeader>
            <CardTitle>添加用户</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label>用户名</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="至少 2 位"
                  className="w-36"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>密码</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 6 位"
                  className="w-36"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>角色</Label>
                <NativeSelect
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "admin" | "superadmin")}
                >
                  <option value="admin">管理员</option>
                  <option value="superadmin">超级管理员</option>
                </NativeSelect>
              </div>
              <Button onClick={addUser}>添加</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle>用户列表</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>群组授权</TableHead>
                  <TableHead>组别授权</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <React.Fragment key={u.username}>
                    <TableRow
                      className={
                        isSuperadmin
                          ? "cursor-pointer hover:bg-accent/50"
                          : ""
                      }
                      onClick={() =>
                        isSuperadmin &&
                        setSelectedUser(selectedUser === u.username ? null : u.username)
                      }
                    >
                      <TableCell className="font-medium">
                        {u.username}
                        {u.username === me?.username && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            我
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={u.role === "superadmin" ? "warning" : "default"}
                        >
                          {u.role === "superadmin" ? "超级管理员" : "管理员"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.groups?.length ? u.groups.map((gid) => gid).join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {u.categories?.length
                          ? u.categories.map((c) => c.name).join(", ")
                          : "—"}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          {isSuperadmin && u.username !== me?.username && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => removeUser(u.username)}
                            >
                              删除
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {selectedUser === u.username && isSuperadmin && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 px-6 py-4">
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {/* Group permissions */}
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                群组授权
                              </Label>
                              <div className="flex flex-wrap gap-1">
                                {(u.groups || []).length === 0 && (
                                  <span className="text-xs text-muted-foreground">无</span>
                                )}
                                {(u.groups || []).map((gid) => (
                                  <Tag
                                    key={gid}
                                    label={String(gid)}
                                    onRemove={() => revokeGroup(u.username, gid)}
                                  />
                                ))}
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="群号"
                                  value={addGroupId}
                                  onChange={(e) => setAddGroupId(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && assignGroup(u.username)}
                                  className="h-7 w-28 text-xs"
                                  type="number"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs"
                                  onClick={() => assignGroup(u.username)}
                                >
                                  授权
                                </Button>
                              </div>
                            </div>

                            {/* Category permissions */}
                            <div className="flex flex-col gap-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                组别授权
                              </Label>
                              <div className="flex flex-wrap gap-1">
                                {(u.categories || []).length === 0 && (
                                  <span className="text-xs text-muted-foreground">无</span>
                                )}
                                {(u.categories || []).map((c) => (
                                  <Tag
                                    key={c.id}
                                    label={c.name}
                                    onRemove={() => revokeCategory(u.username, c.id)}
                                  />
                                ))}
                              </div>
                              {authCategories.length > 0 && (
                                <div className="flex items-center gap-2">
                                  <NativeSelect
                                    value={addCatId}
                                    onChange={(e) => setAddCatId(e.target.value)}
                                    className="h-7 text-xs"
                                  >
                                    <option value="">选择组别</option>
                                    {authCategories
                                      .filter((c) => !u.categories?.some((uc) => uc.id === c.id))
                                      .map((c) => (
                                        <option key={c.id} value={String(c.id)}>
                                          {c.name}
                                        </option>
                                      ))}
                                  </NativeSelect>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => assignCategory(u.username)}
                                  >
                                    授权
                                  </Button>
                                </div>
                              )}
                            </div>
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

      {/* My account */}
      <Card>
        <CardHeader>
          <CardTitle>我的账户</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">修改密码</h3>
            <div className="flex flex-col gap-2">
              <Label>当前密码</Label>
              <Input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                placeholder="当前密码"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>新密码（至少 6 位）</Label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="新密码"
              />
            </div>
            <Button onClick={changePassword} variant="outline" className="self-start">
              修改密码
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">修改用户名</h3>
            <div className="flex flex-col gap-2">
              <Label>新用户名（至少 2 位）</Label>
              <Input
                value={myNewUsername}
                onChange={(e) => setMyNewUsername(e.target.value)}
                placeholder="新用户名"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>当前密码（确认身份）</Label>
              <Input
                type="password"
                value={curPwdForName}
                onChange={(e) => setCurPwdForName(e.target.value)}
                placeholder="当前密码"
              />
            </div>
            <Button onClick={changeUsername} variant="outline" className="self-start">
              修改用户名
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
