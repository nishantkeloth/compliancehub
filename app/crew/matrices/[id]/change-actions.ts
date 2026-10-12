"use server";

import { createClient } from "@/lib/supabase/server";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { compareMatrixIds, buildSummary, type FrozenSummary } from "@/lib/matrix-diff-load";
import type { MatrixDiff } from "@/lib/matrix-diff";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase rows, same pattern as the rest of the matrix code */

async function requireView() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "crew.matrix.view")) throw new Error("You don't have permission to view crew matrices.");
  if (!access.orgId) throw new Error("No company context.");
  return { supabase, orgId: access.orgId };
}

export type VersionOverviewRow = {
  id: string;
  version_number: number;
  status: string;
  created_at: string;
  reason: string | null;
  createdByName: string | null;
  /** Number of changes frozen onto this version, when known. */
  totalChanges: number | null;
};

// Every version of one matrix with the reason it was created and, once the
// version has gone for approval, how many things changed.
export async function getVersionsOverview(matrixId: string): Promise<{ rows?: VersionOverviewRow[]; error?: string }> {
  try {
    const { supabase, orgId } = await requireView();
    const { data: me } = await supabase.from("crew_matrices").select("matrix_number").eq("id", matrixId).eq("org_id", orgId).single();
    if (!me) return { error: "Could not find that crew matrix." };

    let rows: any[] | null = null;
    const full = await supabase
      .from("crew_matrices")
      .select("id, version_number, status, created_at, created_by, version_reason, change_summary_json")
      .eq("org_id", orgId)
      .eq("matrix_number", me.matrix_number)
      .order("version_number", { ascending: false });
    if (!full.error) rows = full.data as any[];
    else {
      // Migration 0043 not run yet — still show the plain list.
      const basic = await supabase
        .from("crew_matrices")
        .select("id, version_number, status, created_at, created_by")
        .eq("org_id", orgId)
        .eq("matrix_number", me.matrix_number)
        .order("version_number", { ascending: false });
      rows = (basic.data as any[]) ?? [];
    }

    const creatorIds = Array.from(new Set(rows.map((r) => r.created_by as string | null).filter((v): v is string => !!v)));
    const { data: people } = creatorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", creatorIds) : { data: [] };
    const nameById = new Map((people ?? []).map((p: any) => [p.id as string, p.full_name as string]));

    return {
      rows: rows.map((r) => ({
        id: r.id as string,
        version_number: r.version_number as number,
        status: r.status as string,
        created_at: r.created_at as string,
        reason: (r.version_reason as string | null) ?? null,
        createdByName: r.created_by ? nameById.get(r.created_by as string) ?? null : null,
        totalChanges: r.change_summary_json && typeof r.change_summary_json.total === "number" ? (r.change_summary_json.total as number) : null,
      })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load the versions." };
  }
}

export type Impact = { roleId: string; roleName: string; crewNames: string[] };

export type Comparison = {
  fromVersion: number;
  toVersion: number;
  fromStatus: string;
  toStatus: string;
  toReason: string | null;
  diff: MatrixDiff;
  /** People currently assigned at the site in a role whose line was removed or shrank. */
  impact: Impact[];
};

export async function compareVersions(fromId: string, toId: string): Promise<{ comparison?: Comparison; error?: string }> {
  try {
    const { supabase, orgId } = await requireView();
    if (fromId === toId) return { error: "Pick two different versions to compare." };

    const { data: ms } = await supabase
      .from("crew_matrices")
      .select("id, matrix_number, version_number, status, offshore_site_id")
      .in("id", [fromId, toId])
      .eq("org_id", orgId);
    const from = (ms ?? []).find((m: any) => m.id === fromId) as any;
    const to = (ms ?? []).find((m: any) => m.id === toId) as any;
    if (!from || !to) return { error: "Could not find those versions." };
    if (from.matrix_number !== to.matrix_number) return { error: "Those two versions belong to different matrices." };

    let toReason: string | null = null;
    const reasonRes = await supabase.from("crew_matrices").select("version_reason").eq("id", toId).single();
    if (!reasonRes.error) toReason = ((reasonRes.data as any)?.version_reason as string | null) ?? null;

    const diff = await compareMatrixIds(supabase, orgId, fromId, toId);
    if (!diff) return { error: "Could not load one of the versions." };

    // Who is affected? Only roles whose line was removed or whose headcount dropped.
    const shrinking = diff.lines.filter(
      (l) => l.status === "removed" || (l.status === "changed" && l.headcountFrom != null && l.headcountTo != null && l.headcountTo < l.headcountFrom)
    );
    const impact: Impact[] = [];
    if (shrinking.length) {
      try {
        const { data: assigned } = await supabase
          .from("crew_assignments")
          .select("crew_id, crew_profiles(full_name, primary_job_role_id)")
          .eq("org_id", orgId)
          .eq("offshore_site_id", to.offshore_site_id)
          .is("end_date", null);
        for (const l of shrinking) {
          const names = (assigned ?? [])
            .map((a: any) => (Array.isArray(a.crew_profiles) ? a.crew_profiles[0] : a.crew_profiles))
            .filter((p: any) => p && p.primary_job_role_id === l.roleId)
            .map((p: any) => p.full_name as string);
          if (names.length) impact.push({ roleId: l.roleId, roleName: l.roleName, crewNames: names });
        }
      } catch {
        /* impact is a courtesy; the comparison itself stands */
      }
    }

    return {
      comparison: {
        fromVersion: from.version_number,
        toVersion: to.version_number,
        fromStatus: from.status,
        toStatus: to.status,
        toReason,
        diff,
        impact,
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not compare those versions." };
  }
}

export type ChangeSummaryView = {
  fromVersion: number | null;
  reason: string | null;
  frozen: boolean;
  frozenAt: string | null;
  summary: FrozenSummary;
};

// What changed in this version, for the approver. Uses the list frozen at
// submission when there is one; otherwise works it out live.
export async function getChangeSummary(matrixId: string): Promise<{ view?: ChangeSummaryView | null; error?: string }> {
  try {
    const { supabase, orgId } = await requireView();
    let reason: string | null = null;
    let frozenJson: FrozenSummary | null = null;
    let frozenAt: string | null = null;
    const res = await supabase
      .from("crew_matrices")
      .select("version_reason, change_summary_json, change_summary_frozen_at")
      .eq("id", matrixId)
      .eq("org_id", orgId)
      .single();
    if (!res.error && res.data) {
      reason = ((res.data as any).version_reason as string | null) ?? null;
      frozenJson = ((res.data as any).change_summary_json as FrozenSummary | null) ?? null;
      frozenAt = ((res.data as any).change_summary_frozen_at as string | null) ?? null;
    }
    if (frozenJson && Array.isArray(frozenJson.sentences)) {
      return { view: { fromVersion: frozenJson.fromVersion, reason, frozen: true, frozenAt, summary: frozenJson } };
    }
    const live = await buildSummary(supabase, orgId, matrixId);
    if (!live) return { view: null };
    return { view: { fromVersion: live.fromVersion, reason, frozen: false, frozenAt: null, summary: live } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not load the changes." };
  }
}
