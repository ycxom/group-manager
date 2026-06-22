"use client";

import * as React from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { api, ApiError, type ImageRules } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/select";

type ScopeType = "global" | "group" | "category";

const GLOBAL_ONLY_FIELDS = [
  "nsfw_url",
  "nsfw_key",
  "llm_url",
  "llm_key",
  "llm_model",
  "llm_prompt",
] as const;

function RuleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  fieldKey,
  rules,
  onChange,
  disabled,
}: {
  label: string;
  fieldKey: keyof ImageRules;
  rules: ImageRules;
  onChange: (k: keyof ImageRules, v: number) => void;
  disabled?: boolean;
}) {
  const checked = !!(rules[fieldKey] as number | undefined);
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={(v) => onChange(fieldKey, v ? 1 : 0)}
        disabled={disabled}
      />
    </label>
  );
}

function TextRow({
  label,
  fieldKey,
  rules,
  onChange,
  disabled,
  placeholder,
  type,
}: {
  label: string;
  fieldKey: keyof ImageRules;
  rules: ImageRules;
  onChange: (k: keyof ImageRules, v: string | number) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <Label className="w-28 shrink-0 text-sm">{label}</Label>
      <Input
        value={String(rules[fieldKey] ?? "")}
        onChange={(e) =>
          onChange(fieldKey, type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)
        }
        disabled={disabled}
        placeholder={placeholder}
        type={type}
        className="flex-1"
        step={type === "number" ? "0.01" : undefined}
      />
    </div>
  );
}

export default function ImageConfigPage() {
  const { isSuperadmin, groups, categories } = useAuth();
  const [scopeType, setScopeType] = React.useState<ScopeType>("global");
  const [scopeId, setScopeId] = React.useState<number>(0);
  const [rules, setRules] = React.useState<ImageRules>({});
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const isGlobal = scopeType === "global";

  React.useEffect(() => {
    if (scopeType === "group" && groups.length > 0 && scopeId === 0) {
      setScopeId(groups[0].group_id);
    }
    if (scopeType === "category" && categories.length > 0 && scopeId === 0) {
      setScopeId(categories[0].id);
    }
  }, [scopeType, groups, categories, scopeId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { scope: scopeType };
      if (!isGlobal) body.id = scopeId;
      const d = await api<{ rules: ImageRules }>("/api/image-rules/get", body);
      setRules(d.rules || {});
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [scopeType, scopeId, isGlobal]);

  React.useEffect(() => {
    if (isGlobal || scopeId !== 0) load();
  }, [load, isGlobal, scopeId]);

  function patch(k: keyof ImageRules, v: string | number) {
    setRules((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { scope: scopeType, ...rules };
      if (!isGlobal) body.id = scopeId;
      // remove global-only fields for non-global scopes
      if (!isGlobal) {
        for (const f of GLOBAL_ONLY_FIELDS) delete body[f];
      }
      await api("/api/image-rules/set", body);
      toast.success("图片规则已保存");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const rowDisabled = !isSuperadmin;

  return (
    <Card>
      <CardHeader>
        <CardTitle>图片处理规则</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Scope selector */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>作用域</Label>
            <NativeSelect
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as ScopeType);
                setScopeId(0);
              }}
            >
              <option value="global">全局</option>
              {groups.length > 0 && <option value="group">独立群组</option>}
              {categories.length > 0 && <option value="category">组别</option>}
            </NativeSelect>
          </div>

          {scopeType === "group" && (
            <div className="flex items-center gap-2">
              <Label>群组</Label>
              <NativeSelect
                value={String(scopeId)}
                onChange={(e) => setScopeId(parseInt(e.target.value))}
              >
                {groups
                  .filter((g) => !g.categories?.length)
                  .map((g) => (
                    <option key={g.group_id} value={String(g.group_id)}>
                      群 {g.group_id}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          )}

          {scopeType === "category" && (
            <div className="flex items-center gap-2">
              <Label>组别</Label>
              <NativeSelect
                value={String(scopeId)}
                onChange={(e) => setScopeId(parseInt(e.target.value))}
              >
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </div>

        {!isSuperadmin && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            仅超级管理员可修改图片处理规则，当前为只读视图
          </p>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">加载中…</p>
        ) : (
          <>
            <RuleSection title="二维码检测">
              <ToggleRow
                label="启用二维码识别"
                fieldKey="qr_enabled"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
              />
              <ToggleRow
                label="屏蔽所有二维码（不限关键词）"
                fieldKey="qr_block_all"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
              />
            </RuleSection>

            <RuleSection title="OCR 文字识别">
              <ToggleRow
                label="启用 OCR"
                fieldKey="ocr_enabled"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
              />
              <TextRow
                label="识别语言"
                fieldKey="ocr_langs"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
                placeholder="chi_sim+eng"
              />
              <TextRow
                label="OCR 服务 URL"
                fieldKey="ocr_url"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
                placeholder="http://localhost:5000/ocr"
              />
            </RuleSection>

            <RuleSection title="NSFW 图片检测">
              <ToggleRow
                label="启用 NSFW 检测"
                fieldKey="nsfw_enabled"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
              />
              <TextRow
                label="触发阈值"
                fieldKey="nsfw_threshold"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
                placeholder="0.7"
                type="number"
              />
              {isGlobal && (
                <>
                  <TextRow
                    label="NSFW 服务 URL"
                    fieldKey="nsfw_url"
                    rules={rules}
                    onChange={patch}
                    disabled={rowDisabled}
                    placeholder="http://localhost:5001/predict"
                  />
                  <TextRow
                    label="API Key"
                    fieldKey="nsfw_key"
                    rules={rules}
                    onChange={patch}
                    disabled={rowDisabled}
                    placeholder="（可选）"
                  />
                </>
              )}
            </RuleSection>

            <RuleSection title="AI 内容审核（LLM）">
              <ToggleRow
                label="启用 LLM 审核"
                fieldKey="llm_enabled"
                rules={rules}
                onChange={patch}
                disabled={rowDisabled}
              />
              {isGlobal && (
                <>
                  <TextRow
                    label="LLM 服务 URL"
                    fieldKey="llm_url"
                    rules={rules}
                    onChange={patch}
                    disabled={rowDisabled}
                    placeholder="https://api.openai.com/v1"
                  />
                  <TextRow
                    label="API Key"
                    fieldKey="llm_key"
                    rules={rules}
                    onChange={patch}
                    disabled={rowDisabled}
                    placeholder="sk-..."
                  />
                  <TextRow
                    label="模型"
                    fieldKey="llm_model"
                    rules={rules}
                    onChange={patch}
                    disabled={rowDisabled}
                    placeholder="gpt-4o-mini"
                  />
                  <div className="flex items-start gap-4">
                    <Label className="mt-2 w-28 shrink-0 text-sm">审核 Prompt</Label>
                    <textarea
                      value={String(rules.llm_prompt ?? "")}
                      onChange={(e) => patch("llm_prompt", e.target.value)}
                      disabled={rowDisabled}
                      placeholder="你是一个内容审核助手……"
                      className="min-h-[80px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-50"
                    />
                  </div>
                </>
              )}
            </RuleSection>

            {isSuperadmin && (
              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  {saving ? "保存中…" : "保存规则"}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
