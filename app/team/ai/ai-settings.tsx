"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAiSettings, saveProviderKey, deleteProviderKey, saveModel, deleteModel, seedDefaultModels, saveTaskSettings, saveNormOverride, testModel } from "./actions";

type Settings = { ai_enabled: boolean; routing_mode: string; monthly_paid_spend_cap: number | null; keep_source_documents: boolean; max_upload_mb: number };
type KeyRow = { provider: string; key_hint: string | null; base_url: string | null; updated_at: string };
type ModelRow = { id: string; provider: string; model_id: string; display_name: string; cost_tier: string; input_cost_per_1k: number; output_cost_per_1k: number; free_monthly_token_allowance: number | null; supports_documents: boolean; max_context: number | null; is_enabled: boolean; priority: number };
type TaskRow = { task: string; routing_mode: string | null; model_ids: string[] };
type Norm = { key: string; label: string; value: string; unit?: string; overridden: boolean };
type Usage = Record<string, { tokens: number; cost: number; calls: number; errors: number }>;

const inputCls = "border rounded-lg px-3 py-2 text-sm";
const inputStyle = { borderColor: "var(--ch-line)" };
const cardCls = "bg-white border rounded-xl p-5";
const cardStyle = { borderColor: "var(--ch-line)" };
const lbl = "text-xs";
const lblStyle = { color: "var(--ch-sub)" };

const PROVIDERS: { value: string; label: string; keyHint: string; baseUrl?: string }[] = [
  { value: "google", label: "Google (Gemini)", keyHint: "AI Studio API key — free tier available" },
  { value: "groq", label: "Groq", keyHint: "Groq API key — free tier available" },
  { value: "openrouter", label: "OpenRouter", keyHint: "OpenRouter key — has free models" },
  { value: "anthropic", label: "Anthropic (Claude)", keyHint: "Paid" },
  { value: "openai", label: "OpenAI", keyHint: "Paid" },
  { value: "ollama", label: "Ollama / OpenAI-compatible (self-hosted)", keyHint: "Usually no key; set the base URL", baseUrl: "http://localhost:11434/v1" },
];
const TASKS: { key: string; label: string; hint: string }[] = [
  { key: "matrix_from_document", label: "Matrix from client document", hint: "Benefits from a document-capable model for scans/images." },
  { key: "matrix_from_context", label: "Matrix from project context", hint: "Works well on free models." },
  { key: "matrix_review", label: "Review a draft matrix", hint: "Works well on free models." },
];
const ROUTING = [
  { value: "free_only", label: "Free only" },
  { value: "free_then_paid", label: "Free, then paid when free is used up" },
  { value: "paid_only", label: "Paid only" },
];

export type RecentRow = {
  task: string;
  provider: string;
  model_id: string;
  cost_tier: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | string | null;
  status: string;
  fallback_reason: string | null;
  error_message: string | null;
  created_at: string;
};

function pill(text: string, bg: string, fg: string) {
  return <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5" style={{ background: bg, color: fg }}>{text}</span>;
}

export default function AiSettings({ settings, keys, envKeys, canEncrypt, models, tasks, norms, usage, recent }: { settings: Settings; keys: KeyRow[]; envKeys: string[]; canEncrypt: boolean; models: ModelRow[]; tasks: TaskRow[]; norms: Norm[]; usage: Usage; recent: RecentRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    <div className="space-y-5 max-w-5xl">
      {error && <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      {notice && <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-pass-bg)", color: "var(--ch-pass)" }}>{notice}</div>}

      <GeneralCard settings={settings} run={run} />
      <KeysCard keys={keys} envKeys={envKeys} canEncrypt={canEncrypt} run={run} />
      <ModelsCard models={models} usage={usage} run={run} />
      <RoutingCard tasks={tasks} models={models} settings={settings} run={run} />
      <NormsCard norms={norms} run={run} />
      <UsageCard recent={recent} />
    </div>
  );
}

type Run = (fn: () => Promise<{ error?: string } | undefined>, okMsg?: string) => void;

function GeneralCard({ settings, run }: { settings: Settings; run: Run }) {
  const [v, setV] = useState({ aiEnabled: settings.ai_enabled, routingMode: settings.routing_mode, cap: settings.monthly_paid_spend_cap != null ? String(settings.monthly_paid_spend_cap) : "", keep: settings.keep_source_documents, maxMb: String(settings.max_upload_mb) });
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="font-semibold mb-3" style={{ color: "var(--ch-ink)" }}>General</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={v.aiEnabled} onChange={(e) => setV({ ...v, aiEnabled: e.target.checked })} /> AI features enabled</label>
        <label className={lbl} style={lblStyle}>
          Routing mode (default for all tasks)
          <select className={`${inputCls} w-full mt-1`} style={inputStyle} value={v.routingMode} onChange={(e) => setV({ ...v, routingMode: e.target.value })}>
            {ROUTING.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label className={lbl} style={lblStyle}>
          Monthly paid spend cap (USD, blank = none)
          <input type="number" min={0} step="0.01" className={`${inputCls} w-full mt-1`} style={inputStyle} value={v.cap} onChange={(e) => setV({ ...v, cap: e.target.value })} />
        </label>
        <label className={lbl} style={lblStyle}>
          Max upload size (MB)
          <input type="number" min={1} max={50} className={`${inputCls} w-full mt-1`} style={inputStyle} value={v.maxMb} onChange={(e) => setV({ ...v, maxMb: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={v.keep} onChange={(e) => setV({ ...v, keep: e.target.checked })} /> Keep uploaded source documents (private Supabase bucket, linked to the matrix for audit). Off = processed in memory only.</label>
      </div>
      <p className="text-[11px] mt-3" style={{ color: "var(--ch-sub)" }}>
        Data sent to models: document text, project/contract context, master-data names and catering norms. Never crew personal data, day rates or individuals&rsquo; documents.
      </p>
      <button
        onClick={() => {
          const fd = new FormData();
          if (v.aiEnabled) fd.set("aiEnabled", "on");
          fd.set("routingMode", v.routingMode);
          fd.set("monthlyPaidSpendCap", v.cap);
          if (v.keep) fd.set("keepSourceDocuments", "on");
          fd.set("maxUploadMb", v.maxMb);
          run(() => saveAiSettings(fd), "Settings saved.");
        }}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mt-3"
      >
        Save
      </button>
    </div>
  );
}

function KeysCard({ keys, envKeys, canEncrypt, run }: { keys: KeyRow[]; envKeys: string[]; canEncrypt: boolean; run: Run }) {
  const [provider, setProvider] = useState("google");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const meta = PROVIDERS.find((p) => p.value === provider)!;
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="font-semibold mb-1" style={{ color: "var(--ch-ink)" }}>Provider API keys</div>
      {!canEncrypt && (
        <div className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: "#fef3e2", color: "#b45309" }}>
          <b>AI_KEY_ENCRYPTION_SECRET</b> is not set on the server, so keys can&rsquo;t be saved here yet. Add it in Vercel → Environment Variables (any long random string) and redeploy — or set <b>AI_&lt;PROVIDER&gt;_API_KEY</b> variables instead, which work without the UI.
        </div>
      )}
      <div className="space-y-1.5 mb-3">
        {PROVIDERS.map((p) => {
          const k = keys.find((x) => x.provider === p.value);
          const env = envKeys.includes(p.value);
          return (
            <div key={p.value} className="text-xs flex items-center gap-2 flex-wrap border rounded-lg px-2.5 py-1.5" style={{ borderColor: "var(--ch-line)" }}>
              <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{p.label}</span>
              {k?.key_hint ? pill(`key saved ${k.key_hint}`, "var(--ch-pass-bg)", "var(--ch-pass)") : env ? pill("key from environment", "var(--ch-pass-bg)", "var(--ch-pass)") : p.value === "ollama" ? pill("no key needed", "var(--ch-paper)", "var(--ch-sub)") : pill("no key", "var(--ch-paper)", "var(--ch-sub)")}
              {k?.base_url && <span style={{ color: "var(--ch-sub)" }}>{k.base_url}</span>}
              <span className="ml-auto" style={{ color: "var(--ch-sub)" }}>{p.keyHint}</span>
              {k && <button onClick={() => run(() => deleteProviderKey(p.value), "Key removed.")} style={{ color: "var(--ch-fail)" }}>Remove</button>}
            </div>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={inputCls} style={inputStyle} value={provider} onChange={(e) => { setProvider(e.target.value); setBaseUrl(PROVIDERS.find((p) => p.value === e.target.value)?.baseUrl ?? ""); }}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input type="password" autoComplete="off" className={`${inputCls} sm:col-span-2`} style={inputStyle} placeholder={provider === "ollama" ? "API key (optional)" : "Paste API key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <input className={inputCls} style={inputStyle} placeholder={meta.baseUrl ? "Base URL" : "Base URL (optional)"} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </div>
      <button
        onClick={() => {
          const fd = new FormData();
          fd.set("provider", provider);
          fd.set("apiKey", apiKey);
          fd.set("baseUrl", baseUrl);
          run(() => saveProviderKey(fd), "Key saved.");
          setApiKey("");
        }}
        disabled={!apiKey && !baseUrl}
        className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold mt-2 disabled:opacity-50"
      >
        Save key
      </button>
    </div>
  );
}

function ModelsCard({ models, usage, run }: { models: ModelRow[]; usage: Usage; run: Run }) {
  const [editing, setEditing] = useState<ModelRow | null | "new">(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const test = (id: string) => {
    setTestResult((r) => ({ ...r, [id]: "testing…" }));
    startTransition(async () => {
      const res = await testModel(id);
      setTestResult((r) => ({ ...r, [id]: "error" in res ? `✕ ${res.error}` : `✓ ${res.reply} (${res.ms} ms)` }));
    });
  };
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>Model registry</div>
        <div className="ml-auto flex items-center gap-2">
          {models.length === 0 && <button onClick={() => run(() => seedDefaultModels().then((r) => ({ ...r, error: undefined })), "Default models added — add keys for the providers you'll use.")} className="rounded-lg px-3 py-1.5 text-xs font-semibold border" style={{ borderColor: "var(--ch-line)" }}>Add recommended defaults</button>}
          <button onClick={() => setEditing("new")} className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold">+ Add model</button>
        </div>
      </div>
      {editing && <ModelForm model={editing === "new" ? null : editing} onDone={() => setEditing(null)} run={run} />}
      {models.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No models yet.</div>}
      <div className="space-y-1.5">
        {models.map((m) => {
          const u = usage[`${m.provider}/${m.model_id}`];
          const pct = m.cost_tier === "free" && m.free_monthly_token_allowance ? Math.min(100, Math.round(((u?.tokens ?? 0) / m.free_monthly_token_allowance) * 100)) : null;
          return (
            <div key={m.id} className="text-xs border rounded-lg px-2.5 py-2" style={{ borderColor: "var(--ch-line)", opacity: m.is_enabled ? 1 : 0.6 }}>
              <div className="flex items-center gap-2 flex-wrap">
                {pill(m.cost_tier, m.cost_tier === "free" ? "var(--ch-pass-bg)" : "var(--ch-navy-soft)", m.cost_tier === "free" ? "var(--ch-pass)" : "var(--ch-navy)")}
                <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{m.display_name}</span>
                <span className="font-mono" style={{ color: "var(--ch-sub)" }}>{m.provider} / {m.model_id}</span>
                {m.supports_documents && pill("documents", "var(--ch-paper)", "var(--ch-sub)")}
                {!m.is_enabled && pill("disabled", "var(--ch-fail-bg)", "var(--ch-fail)")}
                <span style={{ color: "var(--ch-sub)" }}>priority {m.priority}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => test(m.id)} className="ch-link-navy font-semibold">Test</button>
                  <button onClick={() => setEditing(m)} className="ch-link-navy font-semibold">Edit</button>
                  <button onClick={() => run(() => deleteModel(m.id))} style={{ color: "var(--ch-fail)" }}>Remove</button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-3 flex-wrap" style={{ color: "var(--ch-sub)" }}>
                {m.cost_tier === "free" ? (
                  <span>Free allowance: {(u?.tokens ?? 0).toLocaleString()} / {m.free_monthly_token_allowance ? m.free_monthly_token_allowance.toLocaleString() : "∞"} tokens this month{pct != null && <> ({pct}%{pct >= 100 ? " — used up" : ""})</>}</span>
                ) : (
                  <span>Cost ${m.input_cost_per_1k}/1k in · ${m.output_cost_per_1k}/1k out · this month {(u?.tokens ?? 0).toLocaleString()} tokens ≈ ${(u?.cost ?? 0).toFixed(2)}</span>
                )}
                {u?.errors ? <span style={{ color: "var(--ch-fail)" }}>{u.errors} error(s)</span> : null}
                {testResult[m.id] && <span style={{ color: testResult[m.id].startsWith("✓") ? "var(--ch-pass)" : "var(--ch-fail)" }}>{testResult[m.id]}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelForm({ model, onDone, run }: { model: ModelRow | null; onDone: () => void; run: Run }) {
  const [v, setV] = useState({
    provider: model?.provider ?? "google",
    modelId: model?.model_id ?? "",
    displayName: model?.display_name ?? "",
    costTier: model?.cost_tier ?? "free",
    inputCost: model ? String(model.input_cost_per_1k) : "0",
    outputCost: model ? String(model.output_cost_per_1k) : "0",
    allowance: model?.free_monthly_token_allowance != null ? String(model.free_monthly_token_allowance) : "",
    supportsDocuments: model?.supports_documents ?? false,
    maxContext: model?.max_context != null ? String(model.max_context) : "",
    isEnabled: model?.is_enabled ?? true,
    priority: String(model?.priority ?? 100),
  });
  return (
    <div className="border rounded-lg p-3 mb-3" style={{ borderColor: "var(--ch-line)" }}>
      <div className="grid gap-2 sm:grid-cols-4">
        <select className={inputCls} style={inputStyle} value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value })}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <input className={inputCls} style={inputStyle} placeholder="Model ID (e.g. gemini-2.5-flash)" value={v.modelId} onChange={(e) => setV({ ...v, modelId: e.target.value })} />
        <input className={inputCls} style={inputStyle} placeholder="Display name" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        <select className={inputCls} style={inputStyle} value={v.costTier} onChange={(e) => setV({ ...v, costTier: e.target.value })}>
          <option value="free">Free tier</option>
          <option value="paid">Paid</option>
        </select>
        {v.costTier === "free" ? (
          <input type="number" min={0} className={inputCls} style={inputStyle} placeholder="Free tokens / month (blank = unlimited)" value={v.allowance} onChange={(e) => setV({ ...v, allowance: e.target.value })} />
        ) : (
          <>
            <input type="number" min={0} step="0.0001" className={inputCls} style={inputStyle} placeholder="$ per 1k input tokens" value={v.inputCost} onChange={(e) => setV({ ...v, inputCost: e.target.value })} />
            <input type="number" min={0} step="0.0001" className={inputCls} style={inputStyle} placeholder="$ per 1k output tokens" value={v.outputCost} onChange={(e) => setV({ ...v, outputCost: e.target.value })} />
          </>
        )}
        <input type="number" min={1} className={inputCls} style={inputStyle} placeholder="Priority (lower first)" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} />
        <input type="number" min={0} className={inputCls} style={inputStyle} placeholder="Max context tokens (optional)" value={v.maxContext} onChange={(e) => setV({ ...v, maxContext: e.target.value })} />
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={v.supportsDocuments} onChange={(e) => setV({ ...v, supportsDocuments: e.target.checked })} /> Accepts PDFs / images</label>
        <label className="text-xs flex items-center gap-1" style={{ color: "var(--ch-ink)" }}><input type="checkbox" checked={v.isEnabled} onChange={(e) => setV({ ...v, isEnabled: e.target.checked })} /> Enabled</label>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => {
            const fd = new FormData();
            fd.set("provider", v.provider); fd.set("modelId", v.modelId); fd.set("displayName", v.displayName); fd.set("costTier", v.costTier);
            fd.set("inputCostPer1k", v.inputCost); fd.set("outputCostPer1k", v.outputCost); fd.set("freeMonthlyTokenAllowance", v.allowance);
            if (v.supportsDocuments) fd.set("supportsDocuments", "on"); fd.set("isEnabled", v.isEnabled ? "on" : "off"); fd.set("maxContext", v.maxContext); fd.set("priority", v.priority);
            run(() => saveModel(model?.id ?? null, fd), "Model saved.");
            onDone();
          }}
          disabled={!v.modelId.trim()}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Save model
        </button>
        <button onClick={onDone} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Cancel</button>
      </div>
    </div>
  );
}

function RoutingCard({ tasks, models, settings, run }: { tasks: TaskRow[]; models: ModelRow[]; settings: Settings; run: Run }) {
  const [state, setState] = useState<Record<string, { routingMode: string; modelIds: string[] }>>(
    Object.fromEntries(TASKS.map((t) => {
      const row = tasks.find((x) => x.task === t.key);
      return [t.key, { routingMode: row?.routing_mode ?? "", modelIds: row?.model_ids ?? [] }];
    }))
  );
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="font-semibold mb-1" style={{ color: "var(--ch-ink)" }}>Task routing</div>
      <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>
        Per task: optionally override the routing mode and pin preferred models in order. Models not pinned are still used afterwards, free tier first (by priority), then paid — depending on the mode. Company default: <b>{ROUTING.find((r) => r.value === settings.routing_mode)?.label}</b>.
      </p>
      <div className="space-y-3">
        {TASKS.map((t) => {
          const s = state[t.key];
          const pinned = s.modelIds.map((id) => models.find((m) => m.id === id)).filter((m): m is ModelRow => !!m);
          return (
            <div key={t.key} className="border rounded-lg p-3" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{t.label}</span>
                <span className="text-xs" style={{ color: "var(--ch-sub)" }}>{t.hint}</span>
                <select className={`${inputCls} ml-auto`} style={inputStyle} value={s.routingMode} onChange={(e) => setState({ ...state, [t.key]: { ...s, routingMode: e.target.value } })}>
                  <option value="">Use company default</option>
                  {ROUTING.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-2 text-xs">
                <span style={{ color: "var(--ch-sub)" }}>Preferred order:</span>
                {pinned.map((m, i) => (
                  <span key={m.id} className="border rounded-full px-2 py-0.5 flex items-center gap-1" style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}>
                    {i + 1}. {m.display_name}
                    <button onClick={() => setState({ ...state, [t.key]: { ...s, modelIds: s.modelIds.filter((x) => x !== m.id) } })} style={{ color: "var(--ch-fail)" }}>✕</button>
                  </span>
                ))}
                <select className={inputCls} style={inputStyle} value="" onChange={(e) => { if (e.target.value) setState({ ...state, [t.key]: { ...s, modelIds: [...s.modelIds, e.target.value] } }); }}>
                  <option value="">+ pin a model…</option>
                  {models.filter((m) => m.is_enabled && !s.modelIds.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.display_name} ({m.cost_tier})</option>)}
                </select>
                <button
                  onClick={() => {
                    const fd = new FormData();
                    fd.set("routingMode", s.routingMode);
                    fd.set("modelIds", s.modelIds.join(","));
                    run(() => saveTaskSettings(t.key, fd), "Routing saved.");
                  }}
                  className="ch-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold ml-auto"
                >
                  Save
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NormsCard({ norms, run }: { norms: Norm[]; run: Run }) {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(norms.map((n) => [n.key, n.value])));
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="font-semibold mb-1" style={{ color: "var(--ch-ink)" }}>Catering norms</div>
      <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>Used by &ldquo;from project context&rdquo; and &ldquo;review&rdquo;. Edit a value and save; clearing it restores the default.</p>
      <div className="space-y-1.5">
        {norms.map((n) => (
          <div key={n.key} className="text-xs flex items-center gap-2 flex-wrap" style={{ color: "var(--ch-ink)" }}>
            <span className="w-72 min-w-[200px]">{n.label}{n.overridden && <> {pill("custom", "var(--ch-navy-soft)", "var(--ch-navy)")}</>}</span>
            <input className={`${inputCls} flex-1 min-w-[160px]`} style={inputStyle} value={values[n.key] ?? ""} onChange={(e) => setValues({ ...values, [n.key]: e.target.value })} />
            {n.unit && <span style={{ color: "var(--ch-sub)" }}>{n.unit}</span>}
            <button onClick={() => run(() => saveNormOverride(n.key, values[n.key] ?? ""), "Norm saved.")} className="ch-link-navy font-semibold">Save</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageCard({ recent }: { recent: RecentRow[] }) {
  return (
    <div className={cardCls} style={cardStyle}>
      <div className="font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>Recent AI calls</div>
      {recent.length === 0 && <div className="text-sm" style={{ color: "var(--ch-sub)" }}>No calls yet.</div>}
      <div className="space-y-1">
        {recent.map((r, i) => (
          <div key={i} className="text-xs flex items-center gap-2 flex-wrap border-t py-1" style={{ borderColor: "var(--ch-line)" }}>
            <span style={{ color: "var(--ch-sub)" }}>{String(r.created_at).slice(0, 16).replace("T", " ")}</span>
            <span className="font-semibold" style={{ color: "var(--ch-ink)" }}>{r.task}</span>
            <span className="font-mono" style={{ color: "var(--ch-sub)" }}>{r.provider}/{r.model_id}</span>
            {pill(r.status, r.status === "ok" ? "var(--ch-pass-bg)" : "var(--ch-fail-bg)", r.status === "ok" ? "var(--ch-pass)" : "var(--ch-fail)")}
            <span style={{ color: "var(--ch-sub)" }}>{(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} tokens{r.cost_tier === "paid" ? ` · $${Number(r.estimated_cost ?? 0).toFixed(3)}` : ""}</span>
            {r.fallback_reason && <span style={{ color: "#b45309" }}>fallback: {r.fallback_reason}</span>}
            {r.error_message && <span style={{ color: "var(--ch-fail)" }}>{String(r.error_message).slice(0, 120)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
