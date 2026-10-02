"use client";

// Client Compliance Reports — top-level tabs: Generate (pick a site,
// review, send), Templates (the per-client column mapping), History
// (the send audit trail with a re-download link to the exact file that
// went out).

import { useState } from "react";
import GenerateReportWizard from "./generate-wizard";
import TemplateEditor from "./template-editor";
import { setReportTemplateActive, getReportFileDownloadUrl } from "./actions";
import type { ReportColumn } from "@/lib/reports/report-columns";

const cardCls = "bg-white border rounded-xl";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };
const tabBtn = (active: boolean) => `text-sm px-4 py-2 rounded-lg ${active ? "text-white" : "border"}`;
const tabBtnStyle = (active: boolean) => (active ? { background: "var(--ch-accent, #0f2c4c)" } : { borderColor: "var(--ch-line)" });

type Site = { id: string; name: string; site_type: string; clientId: string | null; clientName: string | null; crewCount: number; hasTemplate: boolean };
type ClientOpt = { id: string; name: string };
type Template = { id: string; clientId: string; clientName: string | null; siteId: string | null; siteName: string | null; name: string; columns: ReportColumn[]; isActive: boolean };
type HistoryItem = {
  id: string;
  siteName: string;
  clientName: string | null;
  templateName: string | null;
  rowCount: number;
  flaggedCount: number;
  status: string;
  fileName: string;
  createdAt: string;
  recipients: { name: string; email: string; status: string }[];
};

export default function ReportsManager({
  sites,
  clients,
  templates,
  history,
}: {
  sites: Site[];
  clients: ClientOpt[];
  templates: Template[];
  history: HistoryItem[];
}) {
  const [tab, setTab] = useState<"generate" | "templates" | "history">("generate");
  const [generatingSite, setGeneratingSite] = useState<Site | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | "new" | null>(null);
  const [templateList, setTemplateList] = useState(templates);

  const refreshTemplates = () => {
    setEditingTemplate(null);
    // The page is a server component; a hard reload keeps this simple and
    // matches the convention elsewhere of relying on revalidatePath from
    // the server action rather than client-side cache tricks.
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className={tabBtn(tab === "generate")} style={tabBtnStyle(tab === "generate")} onClick={() => setTab("generate")}>
          Generate & Send
        </button>
        <button className={tabBtn(tab === "templates")} style={tabBtnStyle(tab === "templates")} onClick={() => setTab("templates")}>
          Templates
        </button>
        <button className={tabBtn(tab === "history")} style={tabBtnStyle(tab === "history")} onClick={() => setTab("history")}>
          Send History
        </button>
      </div>

      {tab === "generate" && (
        <div className={`${cardCls} divide-y`} style={cardStyle}>
          {sites.length === 0 && <div className="p-4 text-sm" style={lblStyle}>No active sites yet.</div>}
          {sites.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{s.name}</div>
                <div className={lbl} style={lblStyle}>
                  {s.clientName ?? "No client set up"} · {s.crewCount} crew currently assigned
                </div>
              </div>
              <button
                onClick={() => setGeneratingSite(s)}
                disabled={!s.clientId || !s.hasTemplate || s.crewCount === 0}
                className="text-sm rounded-lg px-3 py-1.5 text-white disabled:opacity-40"
                style={{ background: "var(--ch-accent, #0f2c4c)" }}
                title={!s.clientId ? "No client linked" : !s.hasTemplate ? "No template set up for this client/site" : s.crewCount === 0 ? "No crew assigned" : ""}
              >
                Generate & Send
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "templates" && (
        <div className="space-y-3">
          {editingTemplate ? (
            <TemplateEditor
              clients={clients}
              sites={sites.map((s) => ({ id: s.id, name: s.name, clientId: s.clientId }))}
              existing={editingTemplate === "new" ? undefined : editingTemplate}
              onSaved={refreshTemplates}
              onCancel={() => setEditingTemplate(null)}
            />
          ) : (
            <>
              <div className="flex justify-end">
                <button
                  onClick={() => setEditingTemplate("new")}
                  disabled={clients.length === 0}
                  className="text-sm rounded-lg px-3 py-1.5 text-white disabled:opacity-40"
                  style={{ background: "var(--ch-accent, #0f2c4c)" }}
                >
                  New template
                </button>
              </div>
              <div className={`${cardCls} divide-y`} style={cardStyle}>
                {templateList.length === 0 && <div className="p-4 text-sm" style={lblStyle}>No templates yet.</div>}
                {templateList.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className={lbl} style={lblStyle}>
                        {t.clientName} {t.siteName ? `· ${t.siteName} only` : "· all sites"} · {t.columns.length} columns {!t.isActive && "· inactive"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditingTemplate(t)} className="text-sm rounded-lg px-3 py-1.5 border" style={{ borderColor: "var(--ch-line)" }}>
                        Edit
                      </button>
                      <button
                        onClick={() =>
                          setReportTemplateActive(t.id, !t.isActive).then(() => {
                            setTemplateList((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: !x.isActive } : x)));
                          })
                        }
                        className="text-sm rounded-lg px-3 py-1.5 border"
                        style={{ borderColor: "var(--ch-line)" }}
                      >
                        {t.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className={`${cardCls} divide-y`} style={cardStyle}>
          {history.length === 0 && <div className="p-4 text-sm" style={lblStyle}>No reports sent yet.</div>}
          {history.map((h) => (
            <div key={h.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">
                    {h.siteName} <span style={lblStyle}>· {new Date(h.createdAt).toLocaleString()}</span>
                  </div>
                  <div className={lbl} style={lblStyle}>
                    {h.clientName} · {h.rowCount} crew{h.flaggedCount > 0 ? ` · ${h.flaggedCount} flagged` : ""} ·{" "}
                    <span style={{ color: h.status === "sent" ? "#1a7d3d" : h.status === "failed" ? "#b3261e" : "#9a6b00" }}>{h.status}</span>
                  </div>
                </div>
                <button
                  onClick={() =>
                    getReportFileDownloadUrl(h.id).then((res) => {
                      if ("url" in res && res.url) window.open(res.url, "_blank");
                    })
                  }
                  className="text-sm rounded-lg px-3 py-1.5 border"
                  style={{ borderColor: "var(--ch-line)" }}
                >
                  Download
                </button>
              </div>
              <div className={lbl} style={{ ...lblStyle, marginTop: 4 }}>
                To: {h.recipients.map((r) => `${r.name} (${r.status})`).join(", ")}
              </div>
            </div>
          ))}
        </div>
      )}

      {generatingSite && (
        <GenerateReportWizard siteId={generatingSite.id} siteName={generatingSite.name} onClose={() => setGeneratingSite(null)} />
      )}
    </div>
  );
}
