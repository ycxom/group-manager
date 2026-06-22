"use client";

import * as React from "react";
import { useAuth } from "@/components/auth-provider";
import { api, type Violation, type Keyword } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card className="flex-1" style={{ borderTop: `2px solid ${color}` }}>
      <CardContent className="p-4 text-center">
        <div className="text-3xl font-bold" style={{ color }}>
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { isSuperadmin, groups, categories, me } = useAuth();
  const [violations, setViolations] = React.useState<Violation[]>([]);
  const [globalKw, setGlobalKw] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!me) return;
    api<{ violations: Violation[] }>("/api/violation/list")
      .then((d) => setViolations(d.violations || []))
      .catch(() => {});
    if (isSuperadmin) {
      api<{ keywords: Keyword[] }>("/api/keyword/list", { groupId: 0 })
        .then((d) => setGlobalKw((d.keywords || []).length))
        .catch(() => {});
    }
  }, [me, isSuperadmin]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <Stat label="监控群组" value={groups.length} color="var(--primary)" />
        <Stat label="组别" value={categories.length} color="var(--success)" />
        {isSuperadmin && (
          <Stat label="全局关键词" value={globalKw ?? 0} color="var(--warning)" />
        )}
        <Stat label="违规用户" value={violations.length} color="var(--destructive)" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>监控群组</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
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
                    <TableCell>{g.max_violations}</TableCell>
                    <TableCell>{g.keyword_count}</TableCell>
                    <TableCell>{g.violation_count}</TableCell>
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
