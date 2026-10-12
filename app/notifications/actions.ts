"use server";

// Server actions behind the notification bell. Everything is scoped to the
// signed-in person: row-level security only lets them see and update their own
// rows, and the queries filter on user_id as well.

import { createClient } from "@/lib/supabase/server";

export type BellItem = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
};

const WINDOW_DAYS = 30;
const LIMIT = 50;

export async function listMyNotifications(): Promise<{ items: BellItem[]; unread: number }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], unread: 0 };

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const [listRes, countRes] = await Promise.all([
    supabase
      .from("app_notifications")
      .select("id, kind, severity, title, body, link, created_at, read_at")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase.from("app_notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
  ]);

  // If the table is not there yet (migration not run), show an empty bell instead of failing.
  if (listRes.error) return { items: [], unread: 0 };
  const items: BellItem[] = (listRes.data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    severity: r.severity as string,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    link: (r.link as string | null) ?? null,
    createdAt: r.created_at as string,
    read: !!r.read_at,
  }));
  return { items, unread: countRes.count ?? 0 };
}

export async function getMyUnreadCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase.from("app_notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);
  return error ? { error: error.message } : {};
}

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("app_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  return error ? { error: error.message } : {};
}
