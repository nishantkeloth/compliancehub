"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess } from "@/lib/rbac";
import { loadAiContext, runAgent, modelLabel } from "@/lib/ai/router";
import { buildAssistantTools } from "@/lib/ai/assistant-tools";
import type { ModelMessage } from "ai";

// Phase 11 — global "Ask ComplianceHub" side panel. Any signed-in company
// member can use it (unlike the AI configuration screen at /team/ai, which
// is gated behind ai.configure): this only reads data the user could
// already see elsewhere in the app via a different route, scoped to their
// own org_id, so there's no separate permission to check beyond being a
// member of a company at all. If the company has switched AI off entirely
// (Settings → AI), runAgent() reports that plainly.
export type AssistantMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are the ComplianceHub assistant, answering an offshore-crew and HSE-compliance manager's questions about their own company's live data.

Rules:
- Always answer using the tools provided — never guess or make up numbers, names or dates. If no tool fits the question, say so plainly and suggest what you can help with instead.
- Keep answers short and direct: lead with the number or fact, then at most one or two sentences of relevant detail. Don't repeat the question back.
- When a tool result is truncated (more rows matched than were returned), say the total count and mention the list was capped, rather than presenting the partial list as complete.
- Only discuss this company's crew, documents, crew matrices and mobilizations. Politely decline anything else (general knowledge, other companies, unrelated topics).
- If a tool returns a "note" saying a role/site/document type wasn't found, tell the user that plainly rather than substituting a guess.`;

export async function askAssistant(history: AssistantMessage[]): Promise<{ reply: string; modelLabel?: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const access = await getEffectiveAccess(supabase, user.id);
  if (!access.orgId) return { error: "No company context for this account." };

  const trimmed = history.filter((m) => m.content.trim().length > 0).slice(-20);
  if (trimmed.length === 0) return { error: "Ask a question first." };

  const ctx = await loadAiContext(supabase, access.orgId);
  const tools = buildAssistantTools(supabase, access.orgId);
  const messages: ModelMessage[] = trimmed.map((m) => ({ role: m.role, content: m.content }));

  const result = await runAgent(supabase, ctx, {
    task: "crew_assistant",
    system: SYSTEM_PROMPT,
    messages,
    tools,
    userId: user.id,
  });

  if ("error" in result) return { error: result.error };
  return { reply: result.text, modelLabel: modelLabel(result.model) };
}
