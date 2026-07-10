// Shared auth helpers for edge functions.
// Verifies a Supabase JWT from the Authorization header and checks admin role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export type AuthContext = {
  userId: string | null;
  isAdmin: boolean;
  token: string | null;
};

export async function getAuthContext(req: Request): Promise<AuthContext> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return { userId: null, isAdmin: false, token: null };
  const token = header.slice(7);

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { userId: null, isAdmin: false, token };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: roleRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  return { userId: data.user.id, isAdmin: !!roleRow, token };
}

export function unauthorized(cors: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function forbidden(cors: Record<string, string>) {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function escapeHtml(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
