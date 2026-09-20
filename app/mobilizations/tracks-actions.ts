"use server";

// Phase 12 — configurable per-client Mobilization Tracks & checklist
// templates. Deliberately client-agnostic: nothing here names any
// specific client or step (ADNOC, T-BOSIET, CICPA, ...) — those are
// all just rows an admin enters through the Mobilization Tracks screen
// (app/mobilizations/tracks). See claude/phase12-adnoc-mobilization-
// flow-scope.md for the design this implements.
//
// A track belongs to one client, or to no client at all (client_id
// null) as an org-wide default/fallback for a client without a
// configured process yet.
//
// A checklist item's due date is computed from one of three bases:
//  - request_created: the mobilization's created_at + due_offset_days
//  - required_onboard_date: the mobilization's required_onboard_date + due_offset_days
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
  client_id: string | null;
  client_name: string | null;
  name: string;
  description: string | null;
  notice_days_override: number | null;
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
  due_basis: "request_created" | "required_onboard_date" | "relative_to_item";
  due_offset_days: number;
  due_relative_item_id: string | null;
  linked_document_type_id: string | null;
};

export async function getTracksConfig() {
  const { supabase, access } = await requireManage();

  const [{ data: clients }, { data: tracks }, { data: items }, { data: documentTypes }] = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", access.orgId).order("name"),
    supabase
      .from("mobilization_tracks")
      .select("id, client_id, name, description, notice_days_override, sort_order, is_active, clients(name)")
      .eq("org_id", access.orgId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("mobilization_checklist_items")
      .select("id, track_id, sequence, title, description, is_parallel, due_basis, due_offset_days, due_relative_item_id, linked_document_type_id")
      .eq("org_id", access.orgId)
      .order("sequence", { ascending: true }),
    supabase.from("document_types").select("id, name").eq("org_id", access.orgId).eq("is_active", true).order("name"),
  ]);

  const trackRows: TrackRow[] = (tracks ?? []).map((t) => ({
    id: t.id as string,
    client_id: t.client_id as string | null,
    client_name: ((Array.isArray(t.clients) ? t.clients[0] : t.clients) as { name?: string } | null)?.name ?? null,
    name: t.name as string,
    description: t.description as string | null,
    notice_days_override: t.notice_days_override as number | null,
    sort_order: t.sort_order as number,
    is_active: t.is_active as boolean,
  }));

  return {
    clients: clients ?? [],
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
      client_id: optStr(formData, "clientId"),
      name,
      description: optStr(formData, "description"),
      notice_days_override: optInt(formData, "noticeDaysOverride"),
      sort_order: optInt(formData, "sortOrder") ?? 0,
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
      client_id: optStr(formData, "clientId"),
      name,
      description: optStr(formData, "description"),
      notice_days_override: optInt(formData, "noticeDaysOverride"),
      sort_order: optInt(formData, "sortOrder") ?? 0,
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
