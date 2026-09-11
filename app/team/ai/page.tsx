import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { canEncrypt } from "@/lib/ai/crypto";
import { DEFAULT_SETTINGS } from "@/lib/ai/router";
import { effectiveNorms } from "@/lib/ai/norms";
import AiSettings, { type RecentRow } from "./ai-settings";

export default async function AiSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "ai.configure") || !access.orgId) redirect("/team");
  const orgId = access.orgId;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [settingsRes, keysRes, modelsRes, tasksRes, normsRes, usageRes, recentRes] = await Promise.all([
    supabase.from("ai_settings").select("ai_enabled, routing_mode, monthly_paid_spend_cap, keep_source_documents, max_upload_mb").eq("org_id", orgId).maybeSingle(),
    supabase.from("ai_provider_keys").select("provider, key_hint, base_url, updated_at").eq("org_id", orgId),
    supabase.from("ai_models").select("id, provider, model_id, display_name, cost_tier, input_cost_per_1k, output_cost_per_1k, free_monthly_token_allowance, supports_documents, max_context, is_enabled, priority").eq("org_id", orgId).order("priority"),
    supabase.from("ai_task_settings").select("task, routing_mode, model_ids").eq("org_id", orgId),
    supabase.from("ai_norm_overrides").select("norm_key, value_text, is_active").eq("org_id", orgId),
    supabase.from("ai_usage_log").select("provider, model_id, cost_tier, input_tokens, output_tokens, estimated_cost, status").eq("org_id", orgId).gte("created_at", monthStart.toISOString()),
    supabase.from("ai_usage_log").select("task, provider, model_id, cost_tier, input_tokens, output_tokens, estimated_cost, status, fallback_reason, error_message, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(25),
  ]);

  const usage: Record<string, { tokens: number; cost: number; calls: number; errors: number }> = {};
  for (const u of usageRes.data ?? []) {
    const k = `${u.provider}/${u.model_id}`;
    const row = (usage[k] ??= { tokens: 0, cost: 0, calls: 0, errors: 0 });
    row.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    row.cost += Number(u.estimated_cost ?? 0);
    row.calls += 1;
    if (u.status === "error") row.errors += 1;
  }

  const envKeys = ["anthropic", "openai", "google", "groq", "openrouter", "ollama"].filter((p) => !!process.env[`AI_${p.toUpperCase()}_API_KEY`]);

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        Which AI providers and models ComplianceHub may use for crew-matrix generation and review,
        how free and paid models are routed, catering norms, and month-to-date usage. Keys are
        encrypted on the server and never shown again after saving.
      </p>
      <AiSettings
        settings={settingsRes.data ? { ...DEFAULT_SETTINGS, ...settingsRes.data } : DEFAULT_SETTINGS}
        keys={(keysRes.data ?? []) as { provider: string; key_hint: string | null; base_url: string | null; updated_at: string }[]}
        envKeys={envKeys}
        canEncrypt={canEncrypt()}
        models={(modelsRes.data ?? []).map((m) => ({ ...m, input_cost_per_1k: Number(m.input_cost_per_1k), output_cost_per_1k: Number(m.output_cost_per_1k), free_monthly_token_allowance: m.free_monthly_token_allowance != null ? Number(m.free_monthly_token_allowance) : null }))}
        tasks={(tasksRes.data ?? []) as { task: string; routing_mode: string | null; model_ids: string[] }[]}
        norms={effectiveNorms(normsRes.data ?? [])}
        usage={usage}
        recent={(recentRes.data ?? []) as RecentRow[]}
      />
    </>
  );
}
