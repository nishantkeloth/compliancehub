"use server";

// Phase 12 — configurable per-client Mobilization Tracks & checklist
// templates. Deliberately client-agnostic: nothing here names any
// specific client or step (ADNOC, T-BOSIET, CICPA, ...) — those are
// all just rows an admin enters through the Mobilization Tracks screen
// (app/mobilizations/tracks). See claude/phase12-adnoc-mobilization-
// flow-scope.md for the design this implements.
//
// A track is just a named set of steps (e.g. "New Joiner", "Returning
// Crew"). It is not tied to a client; every active track can be assigned
// to any mobilization position.
//
// A checklist item's due date is computed from one of four bases:
//  - request_created: the mobilization's created_at + due_offset_days
//  - required_onboard_date: the mobilization's required_onboard_date + due_offset_days
//  - planned_arrival_date: the person's planned arrival date + due_offset_days
//    (negative = before they arrive, positive = after)
//  - relative_to_item: due_offset_days after another item in the same
//    track/position is marked done — this is what reproduces "10 days
//    after the exam step" for any client's differently-shaped rule,
//    without a fixed enum of named business milestones.
//
// Gated on mobilization.manage throughout — the same permission that
// already gates every other mobilization write — no new permission
// introduced for this.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { VISA_TYPES } from "./visa-types";

async function requireManage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.manage")) throw new Error("You don't have permission to manage mobilization tracks.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, access, userId: user.id };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function optStr(formData: FormData, key: string) {
  const v = str(formData, key);
  return v || null;
}
function optInt(formData: FormData, key: string) {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const revalidateTracks = () => revalidatePath("/mobilizations/tracks");

export type TrackRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};
export type ChecklistTemplateItemRow = {
  id: string;
  track_id: string;
  sequence: number;
  title: string;
  description: string | null;
  is_parallel: boolean;
  due_basis: "request_created" | "required_onboard_date" | "planned_arrival_date" | "relative_to_item";
  due_offset_days: number;
  due_relative_item_id: string | null;
  linked_document_type_id: string | null;
  is_active: boolean;
  visa_types: string[] | null;
};

function visaTypesFrom(formData: FormData): string[] | null {
  const picked = formData.getAll("visaTypes").filter((v): v is string => typeof v === "string" && (VISA_TYPES as readonly string[]).includes(v));
  // none or all ticked = applies to every visa type
  return picked.length === 0 || picked.length === VISA_TYPES.length ? null : picked;
}

export async function getTracksConfig() {
  const { supabase, access } = await requireManage();

  const [{ data: tracks }, { data: items }, { data: documentTypes }] = await Promise.all([
    supabase
      .from("mobilization_tracks")
      .select("id, name, description, sort_order, is_active")
      .eq("org_id", access.orgId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("mobilization_checklist_items")
      .select("id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days, due_relative_item_id, linked_document_type_id, is_active, visa_types")
      .eq("org_id", access.orgId)
      .order("sequence", { ascending: true }),
    supabase.from("document_types").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
  ]);

  const trackRows: TrackRow[] = (tracks ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    description: t.description as string | null,
    sort_order: t.sort_order as number,
    is_active: t.is_active as boolean,
  }));

  return {
    tracks: trackRows,
    items: (items ?? []) as ChecklistTemplateItemRow[],
    documentTypes: documentTypes ?? [],
  };
}

export async function createTrack(formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const name = str(formData, "name");
  if (!name) return { error: "Track name is required." };

  const { data, error } = await supabase
    .from("mobilization_tracks")
    .insert({
      org_id: access.orgId,
      client_id: null,
      name,
      description: optStr(formData, "description"),
      created_by: userId,
      updated_by: userId,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidateTracks();
  return { id: data?.id };
}

export async function updateTrack(id: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const name = str(formData, "name");
  if (!name) return { error: "Track name is required." };

  const { error } = await supabase
    .from("mobilization_tracks")
    .update({
      name,
      description: optStr(formData, "description"),
      is_active: formData.get("isActive") === "on",
      updated_by: userId,
    })
    .eq("id", id)
    .eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}

export async function deleteTrack(id: string) {
  const { supabase, access } = await requireManage();
  const { count } = await supabase
    .from("mobilization_positions")
    .select("id", { count: "exact", head: true })
    .eq("mobilization_track_id", id);
  if ((count ?? 0) > 0) {
    return { error: "This track is already assigned to one or more mobilization positions and can't be deleted. Deactivate it instead." };
  }
  const { error } = await supabase.from("mobilization_tracks").delete().eq("id", id).eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}

export async function createChecklistItem(trackId: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const title = str(formData, "title");
  if (!title) return { error: "Step title is required." };
  const dueBasis = str(formData, "dueBasis") || "request_created";
  const dueRelativeItemId = optStr(formData, "dueRelativeItemId");
  if (dueBasis === "relative_to_item" && !dueRelativeItemId) {
    return { error: "Pick which step this one is relative to." };
  }

  const { error } = await supabase.from("mobilization_checklist_items").insert({
    org_id: access.orgId,
    track_id: trackId,
    sequence: optInt(formData, "sequence") ?? 1,
    title,
    description: optStr(formData, "description"),
    is_parallel: formData.get("isParallel") === "on",
    due_basis: dueBasis,
    due_offset_days: optInt(formData, "dueOffsetDays") ?? 0,
    due_relative_item_id: dueBasis === "relative_to_item" ? dueRelativeItemId : null,
    linked_document_type_id: optStr(formData, "linkedDocumentTypeId"),
    visa_types: visaTypesFrom(formData),
    created_by: userId,
    updated_by: userId,
  });
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}

export async function updateChecklistItem(id: string, formData: FormData) {
  const { supabase, access, userId } = await requireManage();
  const title = str(formData, "title");
  if (!title) return { error: "Step title is required." };
  const dueBasis = str(formData, "dueBasis") || "request_created";
  const dueRelativeItemId = optStr(formData, "dueRelativeItemId");
  if (dueBasis === "relative_to_item" && !dueRelativeItemId) {
    return { error: "Pick which step this one is relative to." };
  }
  if (dueRelativeItemId === id) {
    return { error: "A step can't be relative to itself." };
  }

  const { error } = await supabase
    .from("mobilization_checklist_items")
    .update({
      sequence: optInt(formData, "sequence") ?? 1,
      title,
      description: optStr(formData, "description"),
      is_parallel: formData.get("isParallel") === "on",
      due_basis: dueBasis,
      due_offset_days: optInt(formData, "dueOffsetDays") ?? 0,
      due_relative_item_id: dueBasis === "relative_to_item" ? dueRelativeItemId : null,
      linked_document_type_id: optStr(formData, "linkedDocumentTypeId"),
      visa_types: visaTypesFrom(formData),
      updated_by: userId,
    })
    .eq("id", id)
    .eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}

export async function deleteChecklistItem(id: string) {
  const { supabase, access } = await requireManage();
  const { count } = await supabase
    .from("mobilization_checklist_items")
    .select("id", { count: "exact", head: true })
    .eq("due_relative_item_id", id);
  if ((count ?? 0) > 0) {
    return { error: "Another step's due date is relative to this one — update or delete that step first." };
  }
  const { error } = await supabase.from("mobilization_checklist_items").delete().eq("id", id).eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}

// Switch a step on or off for this pathway. Off steps are not copied onto
// new people's checklists; checklists already created keep their steps.
export async function setChecklistItemActive(id: string, isActive: boolean) {
  const { supabase, access, userId } = await requireManage();
  const { error } = await supabase
    .from("mobilization_checklist_items")
    .update({ is_active: isActive, updated_by: userId })
    .eq("id", id)
    .eq("org_id", access.orgId);
  if (error) return { error: error.message };
  revalidateTracks();
  return {};
}
