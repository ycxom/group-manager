// 与后端 http-server.js 的 REST 约定：所有接口 POST JSON，返回 { ok, data, error }，
// 会话基于 HttpOnly cookie（gm_session），由 Next 的 rewrites 代理到后端。

export interface Me {
  username: string;
  role: "superadmin" | "admin";
  isDefaultPassword?: boolean;
}

export interface Category {
  id: number;
  name: string;
  group_count?: number;
  keyword_count?: number;
}

export interface Group {
  group_id: number;
  enabled: number;
  max_violations: number;
  keyword_count: number;
  violation_count: number;
  categories?: { id: number; name: string }[];
}

export interface Keyword {
  id: number;
  group_id?: number;
  category_id?: number;
  keyword: string;
  do_recall: number;
  recall_only: number;
  do_kick: number;
  do_mute: number;
  mute_duration: number;
  created_by?: string | number | null;
  created_at?: string;
}

export interface Violation {
  user_id: number;
  group_id: number;
  count: number;
  last_content?: string;
  last_at?: string;
}

export interface ExemptUser {
  id: number;
  group_id?: number;
  category_id?: number;
  user_id: number;
  created_at?: string;
}

export interface UserRecord {
  id: number;
  username: string;
  role: "superadmin" | "admin";
  created_at?: string;
  groups?: number[];
  categories?: { id: number; name: string }[];
}

export interface ImageRules {
  qr_enabled?: number;
  qr_block_all?: number;
  ocr_enabled?: number;
  ocr_langs?: string;
  ocr_url?: string;
  nsfw_enabled?: number;
  nsfw_url?: string;
  nsfw_key?: string;
  nsfw_threshold?: number;
  llm_enabled?: number;
  llm_url?: string;
  llm_key?: string;
  llm_model?: string;
  llm_prompt?: string;
}

export class ApiError extends Error {}

/** POST 一个接口，成功返回 data，失败抛出 ApiError。 */
export async function api<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : "网络错误");
  }
  let json: { ok?: boolean; data?: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new ApiError(`请求失败 (${res.status})`);
  }
  if (!json.ok) throw new ApiError(json.error || `请求失败 (${res.status})`);
  return json.data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<Me> {
  return api<Me>("/login", { username, password });
}

export async function logout(): Promise<void> {
  await fetch("/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: "{}",
  });
}

export async function fetchMe(): Promise<Me | null> {
  try {
    return await api<Me>("/me");
  } catch {
    return null;
  }
}
