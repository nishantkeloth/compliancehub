"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveNotificationSettings, setDashboardModuleEnabled } from "./actions";
import {
  DASHBOARD_MODULE_KEYS,
  DASHBOARD_MODULE_LABELS,
  DASHBOARD_MODULE_DESCRIPTIONS,
  type DashboardModuleKey,
} from "@/lib/document-notifications";

const cardCls = "bg-white border rounded-xl p-5";
const cardStyle = { borderColor: "var(--ch-line)" };
const inputCls = "border rounded-lg px-3 py-2 text-sm w-full";
const inputStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs font-semibold mb-1 block";
const lblStyle = { color: "var(--ch-navy)" };
const hint = "text-xs mt-1";
const hintStyle = { color: "var(--ch-sub)" };

type Settings = {
  recipientEmails: string[];
  escalateAfterDays: number;
  digestEnabled: boolean;
  lastDigestSentFor: string | null;
};

export default function NotificationSettingsPanel({
  settings,
  moduleEnabled,
}: {
  settings: Settings;
  moduleEnabled: Record<DashboardModuleKey, boolean>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recipientText, setRecipientText] = useState(settings.recipientEmails.join("\n"));

  const run = (fn: () => Promise<{ error?: string } | undefined>, okMsg?: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (okMsg) setNotice(okMsg);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5 max-w-2xl">
      {error && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}>
          {notice}
        </div>
      )}

      <form
        className={cardCls}
        style={cardStyle}
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          run(() => saveNotificationSettings(formData), "Saved.");
        }}
      >
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--ch-navy)" }}>
          Document Expiry Notifications
        </div>

        <label className={lbl} style={lblStyle}>
          Recipient emails
        </label>
        <textarea
          name="recipientEmails"
          className={inputCls}
          style={{ ...inputStyle, minHeight: 100, fontFamily: "monospace" }}
          placeholder={"one address per line\nhse@ahmmarine.com\ncompliance@ahmmarine.com"}
          value={recipientText}
          onChange={(e) => setRecipientText(e.target.value)}
        />
        <p className={hint} style={hintStyle}>
          Everyone on this list gets the daily digest email and can see the Document Expiry module
          on the Operations Dashboard. One address per line (or comma-separated).
        </p>

        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div>
            <label className={lbl} style={lblStyle}>
              Escalate after (days overdue)
            </label>
            <input
              type="number"
              name="escalateAfterDays"
              min={1}
              max={30}
              defaultValue={settings.escalateAfterDays}
              className={inputCls}
              style={inputStyle}
            />
            <p className={hint} style={hintStyle}>
              An expired document still unresolved after this many days is called out as escalated
              at the top of the digest.
            </p>
          </div>
          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="digestEnabled" defaultChecked={settings.digestEnabled} />
              Send the daily digest email
            </label>
            <p className={hint} style={hintStyle}>
              {settings.lastDigestSentFor
                ? `Last sent for ${settings.lastDigestSentFor}.`
                : "No digest has been sent yet."}
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="mt-4 text-sm font-semibold px-4 py-2 rounded-lg text-white"
          style={{ background: "var(--ch-navy)" }}
        >
          Save
        </button>
      </form>

      <div className={cardCls} style={cardStyle}>
        <div className="text-sm font-semibold mb-1" style={{ color: "var(--ch-navy)" }}>
          Operations Dashboard modules
        </div>
        <p className={hint} style={{ ...hintStyle, marginBottom: 12 }}>
          Turn modules on or off for everyone in the company. Off doesn't delete anything — it just
          hides the module.
        </p>
        <div className="space-y-3">
          {DASHBOARD_MODULE_KEYS.map((key) => (
            <label key={key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={moduleEnabled[key]}
                onChange={(e) => run(() => setDashboardModuleEnabled(key, e.currentTarget.checked))}
              />
              <span>
                <span className="text-sm font-medium block">{DASHBOARD_MODULE_LABELS[key]}</span>
                <span className={hint} style={hintStyle}>
                  {DASHBOARD_MODULE_DESCRIPTIONS[key]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
