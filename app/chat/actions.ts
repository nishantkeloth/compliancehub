"use server";

// Internal chat — private 1:1 direct messages between colleagues at
// the same company. Server actions here are the "cold start" path
// (initial conversation list, colleague picker, sending a message);
// live delivery of new messages happens client-side via a Supabase
// Realtime subscription in chat-widget.tsx, not through these
// actions. Every table these touch is RLS-protected (see
// supabase/migrations/0025_internal_chat.sql) — the checks below are
// for good error messages, not the actual security boundary.

import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

export type ChatColleague = {
  id: string;
  fullName: string;
};

export type ChatConversationSummary = {
  id: string;
  otherUser: ChatColleague;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
};

type MemberCtx =
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; orgId: string }
  | { ok: false; error: string };

async function requireMember(): Promise<MemberCtx> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };
  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) return { ok: false, error: "No company on your account." };
  return { ok: true, supabase, userId: user.id, orgId: access.orgId };
}

// Colleagues at my company I can start (or already have) a DM with.
export async function listChatColleagues(): Promise<
  { colleagues: ChatColleague[] } | { error: string }
> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase, userId, orgId } = ctx;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", orgId)
    .eq("status", "active")
    .neq("id", userId)
    .order("full_name");

  if (error) return { error: error.message };
  return {
    colleagues: (data ?? []).map((p) => ({ id: p.id as string, fullName: (p.full_name as string) || "Unnamed" })),
  };
}

// My existing conversations, most recently active first, with the
// other participant's name and an unread count.
export async function listChatConversations(): Promise<
  { conversations: ChatConversationSummary[] } | { error: string }
> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase, userId, orgId } = ctx;

  const { data: convos, error: convoErr } = await supabase
    .from("chat_conversations")
    .select("id, user_lo_id, user_hi_id, last_message_at")
    .eq("org_id", orgId)
    .or(`user_lo_id.eq.${userId},user_hi_id.eq.${userId}`)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (convoErr) return { error: convoErr.message };
  if (!convos || convos.length === 0) return { conversations: [] };

  const otherIds = Array.from(
    new Set(convos.map((c) => (c.user_lo_id === userId ? c.user_hi_id : c.user_lo_id)))
  );
  const conversationIds = convos.map((c) => c.id);

  const [{ data: profiles }, { data: lastMessages }, { data: unread }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", otherIds),
    supabase
      .from("chat_messages")
      .select("conversation_id, body, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false }),
    supabase.rpc("chat_unread_counts"),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) || "Unnamed"]));
  const lastByConvo = new Map<string, { body: string; created_at: string }>();
  for (const m of lastMessages ?? []) {
    if (!lastByConvo.has(m.conversation_id as string)) {
      lastByConvo.set(m.conversation_id as string, { body: m.body as string, created_at: m.created_at as string });
    }
  }
  const unreadByConvo = new Map(
    ((unread as { conversation_id: string; unread_count: number }[] | null) ?? []).map((u) => [
      u.conversation_id,
      Number(u.unread_count),
    ])
  );

  const conversations: ChatConversationSummary[] = convos.map((c) => {
    const otherId = c.user_lo_id === userId ? c.user_hi_id : c.user_lo_id;
    const last = lastByConvo.get(c.id as string);
    return {
      id: c.id as string,
      otherUser: { id: otherId as string, fullName: nameById.get(otherId as string) || "Unnamed" },
      lastMessageBody: last?.body ?? null,
      lastMessageAt: last?.created_at ?? (c.last_message_at as string | null),
      unreadCount: unreadByConvo.get(c.id as string) ?? 0,
    };
  });

  return { conversations };
}

// Start (or resume) a DM with a specific colleague. Returns the
// conversation id — the widget then loads/subscribes to it.
export async function startChatConversation(
  otherUserId: string
): Promise<{ conversationId: string } | { error: string }> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase } = ctx;

  const { data, error } = await supabase.rpc("find_or_create_chat_conversation", {
    p_other_user_id: otherUserId,
  });
  if (error) return { error: error.message };
  return { conversationId: data as string };
}

// Full message history for a conversation (the widget then keeps it
// current via Realtime rather than re-polling this).
export async function listChatMessages(
  conversationId: string
): Promise<{ messages: ChatMessage[] } | { error: string }> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, conversation_id, sender_id, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };
  return {
    messages: (data ?? []).map((m) => ({
      id: m.id as string,
      conversationId: m.conversation_id as string,
      senderId: m.sender_id as string,
      body: m.body as string,
      createdAt: m.created_at as string,
    })),
  };
}

export async function sendChatMessage(
  conversationId: string,
  body: string
): Promise<{ message: ChatMessage } | { error: string }> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase, userId, orgId } = ctx;

  const trimmed = body.trim();
  if (!trimmed) return { error: "Message can't be empty." };
  if (trimmed.length > 4000) return { error: "Message is too long." };

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({ org_id: orgId, conversation_id: conversationId, sender_id: userId, body: trimmed })
    .select("id, conversation_id, sender_id, body, created_at")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return {
    message: {
      id: data.id as string,
      conversationId: data.conversation_id as string,
      senderId: data.sender_id as string,
      body: data.body as string,
      createdAt: data.created_at as string,
    },
  };
}

export async function markChatConversationRead(conversationId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireMember();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase } = ctx;

  const { error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) return { error: error.message };
  return { ok: true };
}
