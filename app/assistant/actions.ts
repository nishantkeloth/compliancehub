"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess } from "@/lib/rbac";
import { loadAiContext, runAgent, modelLabel } from "@/lib/ai/router";
import { buildAssistantTools } from "@/lib/ai/assistant-tools";
import type { ModelMessage } from "ai";

// Phase 11 — global "Ask ComplianceHub" side panel. Any signed-in company
// member can open the panel, but the actual data tools handed to the model
// are built per-user by buildAssistantTools(), which only includes a tool
// when this user holds the matching view permission (mirroring the nav
// gating in app/app-shell.tsx) — so the assistant never surfaces more than
// this person could already reach by clicking around the app themselves.
// If the company has switched AI off entirely (Settings → AI), runAgent()
// reports that plainly.
export type AssistantMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are the ComplianceHub assistant, answering questions about this company's own live data in the ComplianceHub app: contracts, projects, offshore sites, crew, crew documents/certificates, crew matrices, mobilizations, and HSE corrective actions.

Rules:
- Always answer using the tools provided — never guess or make up numbers, names or dates.
- The tools available to you already reflect what this specific user is allowed to see. If a question falls in a data area with no matching tool, that's most likely because this user's role doesn't have access to it — say that plainly (e.g. "I don't have access to contract data for your account") rather than claiming the feature doesn't exist. If a question is about something ComplianceHub genuinely doesn't track (e.g. general knowledge, another company, weather, etc.), say that instead.
- Don't assume a request only wants a bare count. "How many X" often has a natural follow-up ("which ones", "where are they") — when a listing tool (list_crew, list_offshore_sites, list_projects, list_contracts, corrective_actions_status) covers the same ground as a counting tool, prefer the listing tool so you already have names/sites/projects on hand for a follow-up, and mention a useful breakdown (by site, by project, by status) proactively when the result naturally supports it, without waiting to be asked twice.
- Chain tool calls when one question needs two lookups (e.g. resolve a site or project name first, then filter by it) rather than asking the user to split their question up.
- Keep answers short and direct: lead with the number or fact, then at most one or two sentences of relevant detail. Don't repeat the question back.
- When a tool result is truncated (more rows matched than were returned), say the total count and mention the list was capped, rather than presenting the partial list as complete.
- If a tool returns a "note" saying a role/site/project/client/document type wasn't found, tell the user that plainly rather than substituting a guess.`;

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
  const tools = buildAssistantTools(supabase, access);
  const messages: ModelMessage[] = trimmed.map((m) => ({ role: m.role, content: m.content }));

  const result = await runAgent(supabase, ctx, {
    task: "crew_assistant",
    system: SYSTEM_PROMPT,
    messages,
    tools,
    userId: user.id,
    maxSteps: 8,
  });

  if ("error" in result) return { error: result.error };
  return { reply: result.text, modelLabel: modelLabel(result.model) };
}
