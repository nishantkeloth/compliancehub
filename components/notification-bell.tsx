"use client";

// The bell in the page header. The unread count comes from the server with the
// page; the list is loaded when the bell is opened, and the count is refreshed
// every minute while the page is open.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getMyUnreadCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type BellItem,
} from "@/app/notifications/actions";

type Filter = "all" | "unread" | "visa" | "document" | "system";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "visa", label: "Visas" },
  { key: "document", label: "Documents" },
  { key: "system", label: "System" },
];

const SEVERITY_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  critical: { label: "Action", bg: "var(--ch-fail-bg)", fg: "var(--ch-fail)" },
  warning: { label: "Soon", bg: "#fef3c7", fg: "#92400e" },
  info: { label: "Info", bg: "var(--ch-navy-soft)", fg: "var(--ch-navy)" },
  ok: { label: "Cleared", bg: "var(--ch-pass-bg)", fg: "var(--ch-pass)" },
};

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function matches(item: BellItem, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !item.read;
  if (filter === "visa") return item.kind === "visa";
  if (filter === "document") return item.kind === "document";
  return item.kind === "upload" || item.kind === "action" || item.kind === "system";
}

export default function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<BellItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await listMyNotifications();
    setItems(res.items);
    setUnread(res.unread);
  }, []);

  // Keep the count fresh while the page stays open.
  useEffect(() => {
    const t = setInterval(() => {
      getMyUnreadCount()
        .then(setUnread)
        .catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load().catch(() => setItems([]));
  }

  async function openItem(item: BellItem) {
    if (!item.read) {
      setItems((cur) => (cur ? cur.map((x) => (x.id === item.id ? { ...x, read: true } : x)) : cur));
      setUnread((n) => Math.max(0, n - 1));
      markNotificationRead(item.id).catch(() => {});
    }
    if (item.link) {
      setOpen(false);
      router.push(item.link);
    }
  }

  async function markAll() {
    setBusy(true);
    setItems((cur) => (cur ? cur.map((x) => ({ ...x, read: true })) : cur));
    setUnread(0);
    await markAllNotificationsRead().catch(() => {});
    setBusy(false);
  }

  const shown = (items ?? []).filter((i) => matches(i, filter));

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative w-9 h-9 rounded-lg border flex items-center justify-center bg-white hover:bg-gray-50"
        style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold text-white flex items-center justify-center"
            style={{ background: "var(--ch-fail)" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[380px] max-w-[92vw] bg-white border rounded-lg shadow-lg z-50 overflow-hidden"
          style={{ borderColor: "var(--ch-line)" }}
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: "var(--ch-line)" }}>
            <span className="text-sm font-bold" style={{ color: "var(--ch-navy)" }}>
              Notifications
            </span>
            <button
              type="button"
              onClick={markAll}
              disabled={busy || unread === 0}
              className="text-xs font-semibold disabled:opacity-40"
              style={{ color: "var(--ch-navy)" }}
            >
              Mark all read
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 px-3.5 py-2 border-b" style={{ borderColor: "var(--ch-line)" }}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className="text-xs rounded-full border px-2.5 py-0.5"
                style={
                  filter === f.key
                    ? { background: "var(--ch-navy-soft)", color: "var(--ch-navy)", borderColor: "var(--ch-navy)" }
                    : { color: "var(--ch-sub)", borderColor: "var(--ch-line)" }
                }
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items === null ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--ch-sub)" }}>
                Loading…
              </div>
            ) : shown.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--ch-sub)" }}>
                Nothing here. New alerts will appear as they happen.
              </div>
            ) : (
              shown.map((item) => {
                const sev = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openItem(item)}
                    className="w-full text-left grid grid-cols-[8px_1fr_auto] gap-2.5 px-3.5 py-2.5 border-b last:border-b-0 hover:bg-gray-50"
                    style={{ borderColor: "var(--ch-line)", background: item.read ? undefined : "var(--ch-navy-soft)" }}
                  >
                    <span className="w-2 h-2 rounded-full mt-1.5" style={{ background: item.read ? "transparent" : "var(--ch-navy)" }} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold" style={{ color: "var(--ch-ink)" }}>
                        <span className="inline-block text-[11px] font-semibold rounded-full px-1.5 mr-1.5 align-[1px]" style={{ background: sev.bg, color: sev.fg }}>
                          {sev.label}
                        </span>
                        {item.title}
                      </span>
                      {item.body && (
                        <span className="block text-xs mt-0.5" style={{ color: "var(--ch-sub)" }}>
                          {item.body}
                        </span>
                      )}
                    </span>
                    <span className="text-xs whitespace-nowrap" style={{ color: "var(--ch-sub)" }}>
                      {timeAgo(item.createdAt)}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="px-3.5 py-2 border-t text-xs" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
            Showing the last 30 days. Clicking an item opens the record and marks it read.
          </div>
        </div>
      )}
    </div>
  );
}
