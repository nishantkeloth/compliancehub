import "server-only";
import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import { decryptSecret } from "./crypto";

// Phase 9 — provider-agnostic model routing.
//
// resolveChain() turns the company's settings into an ordered list of
// candidate models for a task, honouring:
//   routing_mode  free_only | free_then_paid | paid_only
//   task model_ids (explicit order) then remaining enabled models by
//   tier + priority
//   free allowance: a free model whose month-to-date tokens ≥ its
//   free_monthly_token_allowance is skipped ("free tokens over")
//   document capability when the input includes a file
//   paid spend cap: paid models are skipped once the month's estimated
//   paid spend ≥ cap
// runStructured() walks the chain: quota / rate-limit / auth errors move
// to the next candidate (logged as fallback_reason); a schema failure is
// retried once on the same model; every attempt is written to
// ai_usage_log.

export type Provider = "anthropic" | "openai" | "google" | "groq" | "openrouter" | "ollama";
export type AiTask = "matrix_from_document" | "matrix_from_context" | "matrix_review";

export type AiModelRow = {
  id: string;
  provider: Provider;
  model_id: string;
  display_name: string;
  cost_tier: "free" | "paid";
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  free_monthly_token_allowance: number | null;
  free_reset_day: number;
  supports_documents: boolean;
  is_enabled: boolean;
  priority: number;
};
export type AiSettingsRow = {
  ai_enabled: boolean;
  routing_mode: "free_only" | "free_then_paid" | "paid_only";
  monthly_paid_spend_cap: number | null;
  keep_source_documents: boolean;
  max_upload_mb: number;
};
export type AiKeyRow = { provider: Provider; encrypted_key: string | null; base_url: string | null };
export type AiTaskRow = { task: AiTask; routing_mode: AiSettingsRow["routing_mode"] | null; model_ids: string[] };

export type AiContext = {
  orgId: string;
  settings: AiSettingsRow;
  models: AiModelRow[];
  keys: AiKeyRow[];
  tasks: AiTaskRow[];
  usage: { model_id: string; provider: string; tokens: number; cost: number; cost_tier: string }[]; // month-to-date per model
};

export const DEFAULT_SETTINGS: AiSettingsRow = { ai_enabled: true, routing_mode: "free_then_paid", monthly_paid_spend_cap: null, keep_source_documents: false, max_upload_mb: 20 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

export async function loadAiContext(supabase: Supa, orgId: string): Promise<AiContext> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [settingsRes, modelsRes, keysRes, tasksRes, usageRes] = await Promise.all([
    supabase.from("ai_settings").select("ai_enabled, routing_mode, monthly_paid_spend_cap, keep_source_documents, max_upload_mb").eq("org_id", orgId).maybeSingle(),
    supabase.from("ai_models").select("id, provider, model_id, display_name, cost_tier, input_cost_per_1k, output_cost_per_1k, free_monthly_token_allowance, free_reset_day, supports_documents, is_enabled, priority").eq("org_id", orgId).order("priority"),
    supabase.from("ai_provider_keys").select("provider, encrypted_key, base_url").eq("org_id", orgId),
    supabase.from("ai_task_settings").select("task, routing_mode, model_ids").eq("org_id", orgId),
    supabase.from("ai_usage_log").select("provider, model_id, cost_tier, input_tokens, output_tokens, estimated_cost").eq("org_id", orgId).gte("created_at", monthStart.toISOString()),
  ]);
  const usageMap: Record<string, { model_id: string; provider: string; tokens: number; cost: number; cost_tier: string }> = {};
  for (const u of usageRes.data ?? []) {
    const k = `${u.provider}/${u.model_id}`;
    const row = (usageMap[k] ??= { model_id: u.model_id, provider: u.provider, tokens: 0, cost: 0, cost_tier: u.cost_tier });
    row.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
    row.cost += Number(u.estimated_cost ?? 0);
  }
  return {
    orgId,
    settings: settingsRes.data ? { ...DEFAULT_SETTINGS, ...settingsRes.data } : DEFAULT_SETTINGS,
    models: (modelsRes.data ?? []).map((m: AiModelRow) => ({ ...m, input_cost_per_1k: Number(m.input_cost_per_1k), output_cost_per_1k: Number(m.output_cost_per_1k), free_monthly_token_allowance: m.free_monthly_token_allowance != null ? Number(m.free_monthly_token_allowance) : null })),
    keys: keysRes.data ?? [],
    tasks: tasksRes.data ?? [],
    usage: Object.values(usageMap),
  };
}

export function apiKeyFor(ctx: AiContext, provider: Provider): { apiKey: string | null; baseUrl: string | null } {
  const row = ctx.keys.find((k) => k.provider === provider);
  const fromDb = row?.encrypted_key ? decryptSecret(row.encrypted_key) : null;
  const envName = `AI_${provider.toUpperCase()}_API_KEY`;
  return { apiKey: fromDb ?? process.env[envName] ?? null, baseUrl: row?.base_url ?? null };
}

export function monthTokens(ctx: AiContext, m: AiModelRow) {
  return ctx.usage.find((u) => u.provider === m.provider && u.model_id === m.model_id)?.tokens ?? 0;
}
export function paidSpendMtd(ctx: AiContext) {
  return ctx.usage.filter((u) => u.cost_tier === "paid").reduce((n, u) => n + u.cost, 0);
}

export type Candidate = { model: AiModelRow; skipReason?: string };

export function resolveChain(ctx: AiContext, task: AiTask, needsDocuments: boolean): { chain: AiModelRow[]; skipped: Candidate[]; mode: AiSettingsRow["routing_mode"] } {
  const taskRow = ctx.tasks.find((t) => t.task === task);
  const mode = taskRow?.routing_mode ?? ctx.settings.routing_mode;
  const enabled = ctx.models.filter((m) => m.is_enabled);
  const explicit = (taskRow?.model_ids ?? []).map((id) => enabled.find((m) => m.id === id)).filter((m): m is AiModelRow => !!m);
  const rest = enabled.filter((m) => !explicit.some((e) => e.id === m.id)).sort((a, b) => a.priority - b.priority);
  const ordered = [...explicit, ...rest];
  const free = ordered.filter((m) => m.cost_tier === "free");
  const paid = ordered.filter((m) => m.cost_tier === "paid");
  const byMode = mode === "free_only" ? free : mode === "paid_only" ? paid : [...free, ...paid];

  const spend = paidSpendMtd(ctx);
  const chain: AiModelRow[] = [];
  const skipped: Candidate[] = [];
  for (const m of byMode) {
    if (needsDocuments && !m.supports_documents) {
      skipped.push({ model: m, skipReason: "does not accept documents/images" });
      continue;
    }
    if (m.cost_tier === "free" && m.free_monthly_token_allowance != null && monthTokens(ctx, m) >= m.free_monthly_token_allowance) {
      skipped.push({ model: m, skipReason: "free monthly token allowance used up" });
      continue;
    }
    if (m.cost_tier === "paid" && ctx.settings.monthly_paid_spend_cap != null && spend >= ctx.settings.monthly_paid_spend_cap) {
      skipped.push({ model: m, skipReason: "monthly paid spend cap reached" });
      continue;
    }
    if (!apiKeyFor(ctx, m.provider).apiKey && m.provider !== "ollama") {
      skipped.push({ model: m, skipReason: `no API key for ${m.provider}` });
      continue;
    }
    chain.push(m);
  }
  return { chain, skipped, mode };
}

export function buildModel(ctx: AiContext, m: AiModelRow): LanguageModel {
  const { apiKey, baseUrl } = apiKeyFor(ctx, m.provider);
  switch (m.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: apiKey ?? undefined })(m.model_id);
    case "openai":
      return createOpenAI({ apiKey: apiKey ?? undefined })(m.model_id);
    case "google":
      return createGoogleGenerativeAI({ apiKey: apiKey ?? undefined })(m.model_id);
    case "groq":
      return createGroq({ apiKey: apiKey ?? undefined })(m.model_id);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", baseURL: baseUrl ?? "https://openrouter.ai/api/v1", apiKey: apiKey ?? undefined, headers: { "HTTP-Referer": "https://compliancehub.app", "X-Title": "ComplianceHub" } })(m.model_id);
    case "ollama":
      return createOpenAICompatible({ name: "ollama", baseURL: baseUrl ?? "http://localhost:11434/v1", apiKey: apiKey ?? "ollama" })(m.model_id);
  }
}

function isQuotaError(err: unknown) {
  const e = err as { statusCode?: number; status?: number; message?: string; responseBody?: string };
  const status = e?.statusCode ?? e?.status;
  const text = `${e?.message ?? ""} ${e?.responseBody ?? ""}`.toLowerCase();
  return status === 429 || status === 402 || /quota|rate limit|rate_limit|insufficient_quota|billing|exceeded/.test(text);
}
function isAuthOrModelError(err: unknown) {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const status = e?.statusCode ?? e?.status;
  const text = (e?.message ?? "").toLowerCase();
  return status === 401 || status === 403 || status === 404 || /api key|unauthorized|not found|no such model|does not exist/.test(text);
}

export type RunResult<T> = {
  object: T;
  model: AiModelRow;
  attempts: { model: string; outcome: string }[];
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number };
};

export async function runStructured<S extends z.ZodTypeAny>(
  supabase: Supa,
  ctx: AiContext,
  args: { task: AiTask; schema: S; system: string; messages: ModelMessage[]; needsDocuments: boolean; userId: string; crewMatrixId?: string | null }
): Promise<RunResult<z.infer<S>> | { error: string; attempts: { model: string; outcome: string }[] }> {
  if (!ctx.settings.ai_enabled) return { error: "AI features are disabled for this company (Settings → AI).", attempts: [] };
  const { chain, skipped, mode } = resolveChain(ctx, args.task, args.needsDocuments);
  const attempts: { model: string; outcome: string }[] = skipped.map((s) => ({ model: s.model.display_name, outcome: `skipped — ${s.skipReason}` }));
  if (chain.length === 0) {
    const why = skipped.length ? skipped.map((s) => `${s.model.display_name}: ${s.skipReason}`).join("; ") : "no enabled models configured";
    const hint = mode === "free_only" && skipped.some((s) => s.skipReason?.includes("allowance")) ? " Free quota is used up — an admin can switch routing to free-then-paid under Settings → AI." : "";
    return { error: `No AI model is available for this task (${why}).${hint}`, attempts };
  }

  for (const m of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const model = buildModel(ctx, m);
        const result = await generateObject({
          model,
          schema: args.schema,
          system: args.system,
          messages: args.messages,
          abortSignal: AbortSignal.timeout(120_000),
        });
        const inputTokens = result.usage?.inputTokens ?? 0;
        const outputTokens = result.usage?.outputTokens ?? 0;
        const estimatedCost = m.cost_tier === "paid" ? (inputTokens / 1000) * m.input_cost_per_1k + (outputTokens / 1000) * m.output_cost_per_1k : 0;
        await supabase.from("ai_usage_log").insert({
          org_id: ctx.orgId,
          task: args.task,
          provider: m.provider,
          model_id: m.model_id,
          cost_tier: m.cost_tier,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          estimated_cost: estimatedCost,
          duration_ms: Date.now() - started,
          status: "ok",
          fallback_reason: attempts.length ? attempts.map((a) => `${a.model}: ${a.outcome}`).join(" | ").slice(0, 900) : null,
          user_id: args.userId,
          crew_matrix_id: args.crewMatrixId ?? null,
        });
        attempts.push({ model: m.display_name, outcome: "ok" });
        return { object: result.object as z.infer<S>, model: m, attempts, usage: { inputTokens, outputTokens, estimatedCost } };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const name = err instanceof Error ? err.name : "";
        const schemaFailure = /NoObjectGenerated|TypeValidation|JSONParse|schema|parse/i.test(`${name} ${message}`) && !isQuotaError(err) && !isAuthOrModelError(err);
        await supabase.from("ai_usage_log").insert({
          org_id: ctx.orgId,
          task: args.task,
          provider: m.provider,
          model_id: m.model_id,
          cost_tier: m.cost_tier,
          duration_ms: Date.now() - started,
          status: "error",
          error_message: message.slice(0, 900),
          user_id: args.userId,
          crew_matrix_id: args.crewMatrixId ?? null,
        });
        if (schemaFailure && attempt === 0) {
          attempts.push({ model: m.display_name, outcome: "invalid output — retrying once" });
          continue;
        }
        const reason = isQuotaError(err) ? "quota / rate limit reached" : isAuthOrModelError(err) ? "provider rejected the key or model" : schemaFailure ? "invalid output twice" : `error: ${message.slice(0, 120)}`;
        attempts.push({ model: m.display_name, outcome: reason });
        break; // next model
      }
    }
  }
  return { error: `All configured models failed: ${attempts.map((a) => `${a.model} (${a.outcome})`).join("; ")}.`, attempts };
}

export function modelLabel(m: AiModelRow) {
  return `${m.display_name} · ${m.cost_tier}`;
}
