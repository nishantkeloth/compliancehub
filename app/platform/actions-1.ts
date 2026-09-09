"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";

const RESPONSE_TYPES = [
  "tri_state",
  "score",
  "text",
  "number",
  "photo",
  "signature",
  "date",
  "dropdown",
];
const RISK_LEVELS = ["low", "medium", "high", "critical"];

async function requireTemplatesManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "templates.manage")) {
    throw new Error("You don't have permission to manage templates.");
  }
  return { supabase, access, user };
}

export async function createTemplate(formData: FormData) {
  const { supabase, access } = await requireTemplatesManage();
  if (!access.orgId) return { error: "No organization on this account." };

  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const scoringType = String(formData.get("scoringType") || "checklist");
  if (!code || !name) return { error: "Code and name are required." };
  if (!["checklist", "scored"].includes(scoringType)) {
    return { error: "Invalid scoring type." };
  }

  const { data, error } = await supabase
    .from("templates")
    .insert({ org_id: access.orgId, code, name, scoring_type: scoringType })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/team/templates");
  return { id: data.id };
}

export async function updateTemplateMeta(templateId: string, formData: FormData) {
  const { supabase } = await requireTemplatesManage();

  const code = String(formData.get("code") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const revision = String(formData.get("revision") || "").trim() || "00";
  const scoringType = String(formData.get("scoringType") || "checklist");
  const status = String(formData.get("status") || "active");
  if (!code || !name) return { error: "Code and name are required." };
  if (!["checklist", "scored"].includes(scoringType)) return { error: "Invalid scoring type." };
  if (!["draft", "active", "archived"].includes(status)) return { error: "Invalid status." };

  const { error } = await supabase
    .from("templates")
    .update({ code, name, revision, scoring_type: scoringType, status })
    .eq("id", templateId);

  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  revalidatePath("/team/templates");
  return { ok: true };
}

export async function addSection(templateId: string, formData: FormData) {
  const { supabase } = await requireTemplatesManage();
  const title = String(formData.get("title") || "").trim();
  if (!title) return { error: "Title is required." };

  const { data: existing } = await supabase
    .from("template_sections")
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase
    .from("template_sections")
    .insert({ template_id: templateId, title, sort_order: nextOrder });

  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function renameSection(sectionId: string, templateId: string, title: string) {
  const { supabase } = await requireTemplatesManage();
  if (!title.trim()) return { error: "Title is required." };
  const { error } = await supabase
    .from("template_sections")
    .update({ title: title.trim() })
    .eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function deleteSection(sectionId: string, templateId: string) {
  const { supabase } = await requireTemplatesManage();
  // No ON DELETE CASCADE is assumed on the section_id FK, so clear items first.
  const { error: itemsErr } = await supabase
    .from("template_items")
    .delete()
    .eq("section_id", sectionId);
  if (itemsErr) return { error: itemsErr.message };

  const { error } = await supabase.from("template_sections").delete().eq("id", sectionId);
  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function moveSection(sectionId: string, templateId: string, direction: "up" | "down") {
  const { supabase } = await requireTemplatesManage();
  const { data: sections } = await supabase
    .from("template_sections")
    .select("id, sort_order")
    .eq("template_id", templateId)
    .order("sort_order");
  if (!sections) return { error: "Not found." };

  const idx = sections.findIndex((s) => s.id === sectionId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sections.length) return { ok: true };

  const a = sections[idx];
  const b = sections[swapIdx];
  await supabase.from("template_sections").update({ sort_order: b.sort_order }).eq("id", a.id);
  await supabase.from("template_sections").update({ sort_order: a.sort_order }).eq("id", b.id);

  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

function readItemFields(formData: FormData) {
  const prompt = String(formData.get("prompt") || "").trim();
  const responseType = String(formData.get("responseType") || "tri_state");
  const maxMarksRaw = String(formData.get("maxMarks") || "").trim();
  const riskLevelRaw = String(formData.get("riskLevel") || "").trim();
  const requiresPhotoOnFail = formData.get("requiresPhotoOnFail") === "on";

  if (!prompt) return { error: "Prompt is required." } as const;
  if (!RESPONSE_TYPES.includes(responseType)) return { error: "Invalid response type." } as const;
  if (riskLevelRaw && !RISK_LEVELS.includes(riskLevelRaw)) {
    return { error: "Invalid risk level." } as const;
  }
  if (maxMarksRaw && (!/^\d+$/.test(maxMarksRaw) || Number(maxMarksRaw) < 0)) {
    return { error: "Max marks must be a non-negative whole number." } as const;
  }

  return {
    prompt,
    response_type: responseType,
    max_marks: maxMarksRaw ? Number(maxMarksRaw) : null,
    risk_level: riskLevelRaw || null,
    requires_photo_on_fail: requiresPhotoOnFail,
  } as const;
}

export async function addItem(sectionId: string, templateId: string, formData: FormData) {
  const { supabase } = await requireTemplatesManage();
  const fields = readItemFields(formData);
  if ("error" in fields) return fields;

  const { data: existing } = await supabase
    .from("template_items")
    .select("sort_order")
    .eq("section_id", sectionId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { error } = await supabase
    .from("template_items")
    .insert({ section_id: sectionId, sort_order: nextOrder, ...fields });

  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function updateItem(itemId: string, templateId: string, formData: FormData) {
  const { supabase } = await requireTemplatesManage();
  const fields = readItemFields(formData);
  if ("error" in fields) return fields;

  const { error } = await supabase.from("template_items").update(fields).eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function deleteItem(itemId: string, templateId: string) {
  const { supabase } = await requireTemplatesManage();
  const { error } = await supabase.from("template_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}

export async function moveItem(
  itemId: string,
  sectionId: string,
  templateId: string,
  direction: "up" | "down"
) {
  const { supabase } = await requireTemplatesManage();
  const { data: items } = await supabase
    .from("template_items")
    .select("id, sort_order")
    .eq("section_id", sectionId)
    .order("sort_order");
  if (!items) return { error: "Not found." };

  const idx = items.findIndex((i) => i.id === itemId);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return { ok: true };

  const a = items[idx];
  const b = items[swapIdx];
  await supabase.from("template_items").update({ sort_order: b.sort_order }).eq("id", a.id);
  await supabase.from("template_items").update({ sort_order: a.sort_order }).eq("id", b.id);

  revalidatePath(`/team/templates/${templateId}`);
  return { ok: true };
}
