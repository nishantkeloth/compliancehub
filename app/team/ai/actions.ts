"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { encryptSecret, canEncrypt } from "@/lib/ai/crypto";
import { loadAiContext, buildModel, type Provider } from "@/lib/ai/router";
import { DEFAULT_NORMS } from "@/lib/ai/norms";
import { generateText } from "ai";

const PROVIDERS: Provider[] = ["anthropic", "openai", "google", "groq", "openrouter", "ollama"];

async function requireConfigure() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "ai.configure")) throw new Error("You don't have permission to configure AI.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, userId: user.id, orgId: access.orgId };
}
function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optNum(formData: FormData, key: string) {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const revalidate = () => {
  revalidatePath("/team/ai");
  revalidatePath("/crew/matrices/new");
};

/* ================= Settings ================= */

export async function saveAiSettings(formData: FormData) {
  const { supabase, userId, orgId } = await requireConfigure();
  const routing = str(formData, "routingMode");
  if (!["free_only", "free_then_paid", "paid_only"].includes(routing)) return { error: "Invalid routing mode." };
  const { error } = await supabase.from("ai_settings").upsert(
    {
      org_id: orgId,
      ai_enabled: formData.get("aiEnabled") === "on",
      routing_mode: routing,
      monthly_paid_spend_cap: optNum(formData, "monthlyPaidSpendCap"),
      keep_source_documents: formData.get("keepSourceDocuments") === "on",
      max_upload_mb: Math.min(50, Math.max(1, optNum(formData, "maxUploadMb") ?? 20)),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" }
  );
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Provider keys ================= */

export async function saveProviderKey(formData: FormData) {
  const { supabase, userId, orgId } = await requireConfigure();
  const provider = str(formData, "provider") as Provider;
  if (!PROVIDERS.includes(provider)) return { error: "Unknown provider." };
  const apiKey = str(formData, "apiKey");
  const baseUrl = str(formData, "baseUrl") || null;
  if (apiKey && !canEncrypt()) return { error: "AI_KEY_ENCRYPTION_SECRET is not set on the server — add it in Vercel environment variables (any long random string) and redeploy, or set AI_" + provider.toUpperCase() + "_API_KEY as an environment variable instead." };
  const row: Record<string, unknown> = { org_id: orgId, provider, base_url: baseUrl, updated_by: userId, updated_at: new Date().toISOString() };
  if (apiKey) {
    row.encrypted_key = encryptSecret(apiKey);
    row.key_hint = "…" + apiKey.slice(-4);
  }
  const { error } = await supabase.from("ai_provider_keys").upsert(row, { onConflict: "org_id,provider" });
  if (error) return { error: error.message };
  revalidate();
  return {};
}

export async function deleteProviderKey(provider: string) {
  const { supabase, orgId } = await requireConfigure();
  const { error } = await supabase.from("ai_provider_keys").delete().eq("org_id", orgId).eq("provider", provider);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Models ================= */

export async function saveModel(id: string | null, formData: FormData) {
  const { supabase, orgId } = await requireConfigure();
  const provider = str(formData, "provider") as Provider;
  if (!PROVIDERS.includes(provider)) return { error: "Unknown provider." };
  const modelId = str(formData, "modelId");
  if (!modelId) return { error: "Model ID is required (e.g. gemini-2.5-flash)." };
  const costTier = str(formData, "costTier") === "free" ? "free" : "paid";
  const row = {
    org_id: orgId,
    provider,
    model_id: modelId,
    display_name: str(formData, "displayName") || modelId,
    cost_tier: costTier,
    input_cost_per_1k: optNum(formData, "inputCostPer1k") ?? 0,
    output_cost_per_1k: optNum(formData, "outputCostPer1k") ?? 0,
    free_monthly_token_allowance: costTier === "free" ? optNum(formData, "freeMonthlyTokenAllowance") : null,
    supports_documents: formData.get("supportsDocuments") === "on",
    max_context: optNum(formData, "maxContext"),
    is_enabled: formData.get("isEnabled") !== "off",
    priority: optNum(formData, "priority") ?? 100,
  };
  const { error } = id ? await supabase.from("ai_models").update(row).eq("id", id) : await supabase.from("ai_models").insert(row);
  if (error) return { error: error.message.includes("duplicate") ? "That provider/model is already registered." : error.message };
  revalidate();
  return {};
}

export async function deleteModel(id: string) {
  const { supabase } = await requireConfigure();
  const { error } = await supabase.from("ai_models").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate();
  return {};
}

// A sensible starter registry. Costs are indicative (per 1k tokens, USD)
// and free allowances approximate the providers' free tiers — edit them.
export async function seedDefaultModels() {
  const { supabase, orgId } = await requireConfigure();
  const rows = [
    { provider: "google", model_id: "gemini-2.5-flash", display_name: "Gemini 2.5 Flash (free tier)", cost_tier: "free", free_monthly_token_allowance: 1_000_000, supports_documents: true, priority: 10 },
    { provider: "groq", model_id: "llama-3.3-70b-versatile", display_name: "Llama 3.3 70B on Groq (free tier)", cost_tier: "free", free_monthly_token_allowance: 500_000, supports_documents: false, priority: 20 },
    { provider: "openrouter", model_id: "meta-llama/llama-3.3-70b-instruct:free", display_name: "Llama 3.3 70B via OpenRouter (free)", cost_tier: "free", free_monthly_token_allowance: 300_000, supports_documents: false, priority: 30 },
    { provider: "ollama", model_id: "llama3.1", display_name: "Local Ollama — llama3.1", cost_tier: "free", free_monthly_token_allowance: null, supports_documents: false, priority: 40, is_enabled: false },
    { provider: "anthropic", model_id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5", cost_tier: "paid", input_cost_per_1k: 0.003, output_cost_per_1k: 0.015, supports_documents: true, priority: 50 },
    { provider: "openai", model_id: "gpt-4.1", display_name: "GPT-4.1", cost_tier: "paid", input_cost_per_1k: 0.002, output_cost_per_1k: 0.008, supports_documents: true, priority: 60 },
    { provider: "google", model_id: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", cost_tier: "paid", input_cost_per_1k: 0.00125, output_cost_per_1k: 0.01, supports_documents: true, priority: 70 },
  ];
  let inserted = 0;
  for (const r of rows) {
    const { error } = await supabase.from("ai_models").insert({ org_id: orgId, is_enabled: true, input_cost_per_1k: 0, output_cost_per_1k: 0, ...r });
    if (!error) inserted++;
  }
  revalidate();
  return { inserted };
}

/* ================= Task routing ================= */

export async function saveTaskSettings(task: string, formData: FormData) {
  const { supabase, orgId } = await requireConfigure();
  if (!["matrix_from_document", "matrix_from_context", "matrix_review"].includes(task)) return { error: "Unknown task." };
  const routing = str(formData, "routingMode");
  const modelIds = str(formData, "modelIds").split(",").map((s) => s.trim()).filter(Boolean);
  const { error } = await supabase.from("ai_task_settings").upsert(
    { org_id: orgId, task, routing_mode: ["free_only", "free_then_paid", "paid_only"].includes(routing) ? routing : null, model_ids: modelIds, updated_at: new Date().toISOString() },
    { onConflict: "org_id,task" }
  );
  if (error) return { error: error.message };
  revalidate();
  return {};
}

/* ================= Norms ================= */

export async function saveNormOverride(normKey: string, valueText: string) {
  const { supabase, userId, orgId } = await requireConfigure();
  if (!DEFAULT_NORMS.some((n) => n.key === normKey)) return { error: "Unknown norm." };
  const trimmed = valueText.trim();
  const def = DEFAULT_NORMS.find((n) => n.key === normKey)!;
  if (!trimmed || trimmed === def.defaultValue) {
    await supabase.from("ai_norm_overrides").delete().eq("org_id", orgId).eq("norm_key", normKey);
  } else {
    const { error } = await supabase.from("ai_norm_overrides").upsert({ org_id: orgId, norm_key: normKey, value_text: trimmed, is_active: true, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "org_id,norm_key" });
    if (error) return { error: error.message };
  }
  revalidate();
  return {};
}

/* ================= Connection test ================= */

export async function testModel(modelId: string) {
  const { supabase, orgId } = await requireConfigure();
  const ctx = await loadAiContext(supabase, orgId);
  const m = ctx.models.find((x) => x.id === modelId);
  if (!m) return { error: "Model not found." };
  const started = Date.now();
  try {
    const result = await generateText({ model: buildModel(ctx, m), prompt: "Reply with the single word OK.", abortSignal: AbortSignal.timeout(30_000) });
    return { ok: true, reply: result.text.slice(0, 40), ms: Date.now() - started };
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
