"use client";

// Internal chat — floating widget for private 1:1 DMs between
// colleagues at the same company. Sibling to AssistantPanel
// (assistant-panel.tsx): same visual language, but its own bubble
// (stacked above the AI bubble at bottom-24 instead of bottom-5, so
// the two never overlap) and its own slide-over panel.
//
// Data flow: the initial conversation list / colleague list / message
// history come from the server actions in app/chat/actions.ts (each
// RLS-protected at the DB layer regardless of what this component
// sends). After that, new messages arrive live via a single Supabase
// Realtime subscription on chat_messages, opened once on mount (not
// only while the panel is open) so the unread badge on the closed
// bubble stays current. Realtime only delivers rows the subscriber's
// RLS policies would let them SELECT, so no extra filtering is done
// here beyond "is this the thread I have open right now".
//
// Like AssistantPanel, this keeps all state in memory — it resets on
// a full navigation — and uses no browser storage.

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  listChatColleagues,
  listChatConversations,
  startChatConversation,
  listChatMessages,
  sendChatMessage,
  markChatConversationRead,
  type ChatColleague,
  type ChatConversationSummary,
  type ChatMessage,
} from "./chat/actions";

type View = "list" | "new" | "thread";

function ChatIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
        <path d="M4 4 L16 16 M16 4 L4 16" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <path
        d="M3 5.5c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H8.5L4 19v-3.5H5c-1.1 0-2-.9-2-2v-8Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [colleagues, setColleagues] = useState<ChatColleague[]>([]);
  const [colleagueFilter, setColleagueFilter] = useState("");

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeOtherName, setActiveOtherName] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const panelOpenRef = useRef(false);
  activeConversationIdRef.current = activeConversationId;
  panelOpenRef.current = open && view === "thread";

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const refreshConversations = useCallback(async () => {
    const res = await listChatConversations();
    if ("error" in res) return;
    setConversations(res.conversations);
  }, []);

  // Current user id — needed client-side to tell "me" from "them" in
  // the message list. Cheap local call, not a network round trip.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
  }, []);

  // Keep the unread badge current even while the panel is closed.
  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // One Realtime subscription for the lifetime of the widget. RLS on
  // chat_messages means this only ever receives rows the signed-in
  // user is a participant in.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("chat-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };
          const incoming: ChatMessage = {
            id: row.id,
            conversationId: row.conversation_id,
            senderId: row.sender_id,
            body: row.body,
            createdAt: row.created_at,
          };
          if (activeConversationIdRef.current === incoming.conversationId) {
            setMessages((cur) => (cur.some((m) => m.id === incoming.id) ? cur : [...cur, incoming]));
            scrollToBottom();
            if (panelOpenRef.current) {
              markChatConversationRead(incoming.conversationId).catch(() => {});
            }
          }
          refreshConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshConversations]);

  const openList = async () => {
    setView("list");
    setError(null);
    setLoadingList(true);
    await refreshConversations();
    setLoadingList(false);
  };

  const openNew = async () => {
    setView("new");
    setError(null);
    setColleagueFilter("");
    setLoadingList(true);
    const res = await listChatColleagues();
    setLoadingList(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setColleagues(res.colleagues);
  };

  const openThread = async (conversationId: string, otherName: string) => {
    setView("thread");
    setActiveConversationId(conversationId);
    setActiveOtherName(otherName);
    setMessages([]);
    setError(null);
    setLoadingThread(true);
    const res = await listChatMessages(conversationId);
    setLoadingThread(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages(res.messages);
    scrollToBottom();
    markChatConversationRead(conversationId).catch(() => {});
    refreshConversations();
  };

  const startWith = async (colleague: ChatColleague) => {
    setError(null);
    setLoadingThread(true);
    const res = await startChatConversation(colleague.id);
    if ("error" in res) {
      setLoadingThread(false);
      setError(res.error);
      return;
    }
    await openThread(res.conversationId, colleague.fullName);
  };

  const send = async (text: string) => {
    const body = text.trim();
    if (!body || !activeConversationId || sending) return;
    setSending(true);
    setError(null);
    const res = await sendChatMessage(activeConversationId, body);
    setSending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setMessages((cur) => (cur.some((m) => m.id === res.message.id) ? cur : [...cur, res.message]));
    setInput("");
    scrollToBottom();
    refreshConversations();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) openList();
  };

  const filteredColleagues = colleagueFilter.trim()
    ? colleagues.filter((c) => c.fullName.toLowerCase().includes(colleagueFilter.trim().toLowerCase()))
    : colleagues;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close chat" : "Open chat"}
        className="fixed bottom-24 right-5 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, var(--ch-navy), #3a6bd9)" }}
      >
        <ChatIcon open={open} />
        {!open && unreadTotal > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
            style={{ background: "var(--ch-fail, #d64545)" }}
          >
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed top-0 right-0 h-screen w-full sm:w-[380px] z-30 flex flex-col bg-white border-l shadow-2xl"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <div className="px-4 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--ch-line)" }}>
            {view === "thread" ? (
              <button
                type="button"
                onClick={openList}
                aria-label="Back to conversations"
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ border: "1px solid var(--ch-line)", color: "var(--ch-navy)" }}
              >
                ←
              </button>
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shrink-0"
                style={{ background: "linear-gradient(135deg, var(--ch-navy), #3a6bd9)" }}
              >
                <ChatIcon open={false} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold truncate" style={{ color: "var(--ch-navy)" }}>
                {view === "thread" ? activeOtherName : view === "new" ? "New message" : "Chat"}
              </div>
              <div className="text-[11px]" style={{ color: "var(--ch-sub)" }}>
                {view === "thread" ? "Direct message" : "Colleagues at your company"}
              </div>
            </div>
            {view !== "new" && (
              <button
                type="button"
                onClick={openNew}
                className="text-xs font-semibold rounded-lg px-2.5 py-1.5 text-white shrink-0"
                style={{ background: "var(--ch-navy)" }}
              >
                New
              </button>
            )}
          </div>

          {view === "list" && (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {loadingList && conversations.length === 0 && (
                <div className="text-xs px-2 py-3" style={{ color: "var(--ch-sub)" }}>
                  Loading…
                </div>
              )}
              {!loadingList && conversations.length === 0 && (
                <div className="text-xs px-2 py-3 space-y-2" style={{ color: "var(--ch-sub)" }}>
                  <div>No conversations yet.</div>
                  <button
                    type="button"
                    onClick={openNew}
                    className="text-xs font-semibold rounded-lg px-3 py-2 text-white"
                    style={{ background: "var(--ch-navy)" }}
                  >
                    Start a conversation
                  </button>
                </div>
              )}
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openThread(c.id, c.otherUser.fullName)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left"
                  style={{ background: "transparent" }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0"
                    style={{ background: "var(--ch-navy)" }}
                  >
                    {c.otherUser.fullName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate" style={{ color: "var(--ch-ink)" }}>
                        {c.otherUser.fullName}
                      </span>
                      <span className="text-[10px] shrink-0" style={{ color: "var(--ch-sub)" }}>
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate" style={{ color: "var(--ch-sub)" }}>
                        {c.lastMessageBody ?? "No messages yet"}
                      </span>
                      {c.unreadCount > 0 && (
                        <span
                          className="min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center shrink-0"
                          style={{ background: "var(--ch-fail, #d64545)" }}
                        >
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {view === "new" && (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <div className="px-2 pb-2">
                <input
                  value={colleagueFilter}
                  onChange={(e) => setColleagueFilter(e.target.value)}
                  placeholder="Search colleagues…"
                  autoFocus
                  className="w-full text-sm rounded-lg border px-3 py-2 outline-none"
                  style={{ borderColor: "var(--ch-line)" }}
                />
              </div>
              {loadingList && <div className="text-xs px-3 py-2" style={{ color: "var(--ch-sub)" }}>Loading…</div>}
              {!loadingList && filteredColleagues.length === 0 && (
                <div className="text-xs px-3 py-2" style={{ color: "var(--ch-sub)" }}>
                  No colleagues found.
                </div>
              )}
              {filteredColleagues.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => startWith(c)}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg text-left"
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-extrabold shrink-0"
                    style={{ background: "var(--ch-navy)" }}
                  >
                    {c.fullName.slice(0, 1).toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>
                    {c.fullName}
                  </span>
                </button>
              ))}
            </div>
          )}

          {view === "thread" && (
            <>
              <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {loadingThread && (
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    Loading…
                  </div>
                )}
                {!loadingThread && messages.length === 0 && (
                  <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                    Say hello — messages appear instantly for both of you.
                  </div>
                )}
                {messages.map((m) => {
                  const mine = m.senderId === myUserId;
                  return (
                    <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                      <div
                        className="max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap"
                        style={
                          mine
                            ? { background: "var(--ch-navy)", color: "#fff" }
                            : { background: "var(--ch-paper)", color: "var(--ch-ink)", border: "1px solid var(--ch-line)" }
                        }
                      >
                        {m.body}
                      </div>
                    </div>
                  );
                })}
              </div>
              <form onSubmit={onSubmit} className="border-t px-3 py-3 flex items-center gap-2" style={{ borderColor: "var(--ch-line)" }}>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message…"
                  disabled={sending}
                  className="flex-1 text-sm rounded-lg border px-3 py-2 outline-none disabled:opacity-50"
                  style={{ borderColor: "var(--ch-line)" }}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="text-sm font-semibold rounded-lg px-3 py-2 text-white disabled:opacity-40"
                  style={{ background: "var(--ch-navy)" }}
                >
                  Send
                </button>
              </form>
            </>
          )}

          {error && (
            <div className="px-4 py-2 text-xs border-t" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)", borderColor: "var(--ch-line)" }}>
              {error}
            </div>
          )}
        </div>
      )}
    </>
  );
}
