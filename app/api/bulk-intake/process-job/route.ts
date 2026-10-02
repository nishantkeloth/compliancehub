import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyOneFile, loadClassifyContext, type ClassifyCrewRow } from "@/lib/documents/bulk-classify";

// Phase 16d — the background worker for Bulk Document Intake's classify
// step. Not triggered by a browser request directly: createBulkIntakeJob
// and the self-heal check in getBulkIntakeJobStatus (both in
// app/team/bulk-intake/document-intake-actions.ts) fire an un-awaited
// POST here, and this route fires another one at itself to keep going
// — a self-chaining serverless invocation, rather than a third-party
// queue service (Inngest/Trigger.dev/QStash). That keeps this stack
// free of a new paid dependency and an account only a person could set
// up; the trade-off is this route, plus the once-a-day watchdog cron
// (app/api/cron/bulk-intake-watchdog/route.ts) as a backstop for a
// chain that dies outright (a deploy landing mid-chain, a crashed
// invocation that never got to fire its own next hop).
//
// Each invocation claims and processes pending items — several at once
// (see CONCURRENCY below) — until either a time budget runs out or
// there's nothing left pending, then re-fires itself if there's more to
// do. An earlier version of this comment assumed Hobby-plan Vercel
// functions were hard-capped at 10s regardless of maxDuration and kept
// both constants tiny as a result; that's no longer how Vercel's limits
// work (fluid compute gives Hobby the same 300s default/maximum as
// Pro — https://vercel.com/docs/functions/limitations#max-duration), and
// that stale assumption was a big part of why a folder's classify job
// crawled one file per serverless hop. maxDuration/TIME_BUDGET_MS below
// are now set to use most of that real budget, so one invocation gets
// through many files — and several at a time — instead of one every few
// seconds. A plan with a lower actual ceiling just means more hops, not
// a correctness difference (claimNextItem's atomic claim is what makes
// concurrent/overlapping invocations safe either way).
export const maxDuration = 280;

const TIME_BUDGET_MS = 240_000;

// How many files this hop reads with AI at once. classifyOneFile's AI
// call is I/O-bound (waiting on the model provider), so running several
// concurrently is mostly free wall-clock time, not CPU — runStructured
// (lib/ai/router.ts) already falls back across models/providers on a
// 429/quota error, so a burst of concurrent calls degrades gracefully
// into slower/sequential-feeling behavior rather than failing outright
// if a provider's rate limit is hit. Kept modest rather than maximal:
// worth raising later if the provider in use comfortably allows more.
const CONCURRENCY = 4;

type Supa = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function workerUrl() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/bulk-intake/process-job`;
}

function chainNext(jobId: string) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  fetch(workerUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ jobId }),
  }).catch(() => {
    // If this fetch itself fails to even fire, the job's heartbeat will
    // go stale and the next status poll (or the daily watchdog) re-kicks
    // it — same recovery path as any other stalled chain.
  });
}

// Claims exactly one pending item for this job, atomically: the WHERE
// status='pending' on the UPDATE means a concurrent invocation (the
// normal chain overlapping with a self-heal re-kick, say) can never
// claim the same row twice — one of them gets the row back from
// .select(), the other gets nothing and moves on.
async function claimNextItem(admin: Supa, jobId: string) {
  const { data: candidates } = await admin
    .from("bulk_intake_job_items")
    .select("id")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  const candidateId = candidates?.[0]?.id as string | undefined;
  if (!candidateId) return null;

  const { data: claimed } = await admin
    .from("bulk_intake_job_items")
    .update({ status: "processing" })
    .eq("id", candidateId)
    .eq("status", "pending")
    .select("id, filename, storage_path, content_type");
  return (claimed?.[0] as { id: string; filename: string; storage_path: string; content_type: string | null } | undefined) ?? null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let jobId: string | undefined;
  try {
    const body = await req.json();
    jobId = typeof body?.jobId === "string" ? body.jobId : undefined;
  } catch {
    // fall through to the missing-jobId response below
  }
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const resolvedJobId: string = jobId; // narrowed once here — closing over the `let` above loses that narrowing inside runWorkerLoop below

  const admin = createAdminClient();

  const { data: job } = await admin.from("bulk_intake_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  // Already finished, failed, cancelled, or waiting on a human reviewer
  // — nothing for this hop to do. Most commonly this is a chain's final
  // hop landing after the previous one already saw zero pending items,
  // or a self-heal kick that arrived after the normal chain finished.
  if (job.status !== "processing") return NextResponse.json({ ok: true, status: job.status });

  await admin.from("bulk_intake_jobs").update({ last_heartbeat_at: new Date().toISOString() }).eq("id", jobId);

  const { data: crewRow } = await admin
    .from("crew_profiles")
    .select("id, full_name, nationality, date_of_birth")
    .eq("id", job.crew_id)
    .maybeSingle();
  if (!crewRow) {
    await admin.from("bulk_intake_jobs").update({ status: "failed", error: "Crew member no longer exists." }).eq("id", jobId);
    return NextResponse.json({ ok: true, status: "failed" });
  }
  const crewForClassify: ClassifyCrewRow = { full_name: crewRow.full_name, nationality: crewRow.nationality, date_of_birth: crewRow.date_of_birth };

  const { ctx, documentTypes, documentTypeNames, aliases } = await loadClassifyContext(admin, job.org_id);
  if (!ctx.settings.ai_enabled) {
    await admin.from("bulk_intake_jobs").update({ status: "failed", error: "AI features are disabled for this company (Administration → AI Settings)." }).eq("id", jobId);
    return NextResponse.json({ ok: true, status: "failed" });
  }

  const deadline = Date.now() + TIME_BUDGET_MS;

  // One worker loop: claim one item, process it, repeat until the
  // deadline or nothing's left — then CONCURRENCY of these run at once.
  // claimNextItem's atomic conditional UPDATE means two loops can never
  // walk away with the same row, so this is safe without any extra
  // locking: each loop just gets back null once there's nothing left to
  // claim and exits.
  async function runWorkerLoop() {
    while (Date.now() < deadline) {
      const item = await claimNextItem(admin, resolvedJobId);
      if (!item) return; // nothing left pending

      try {
        const { data: blob, error: dlErr } = await admin.storage.from("bulk-intake-staging").download(item.storage_path);
        if (dlErr || !blob) throw new Error(dlErr?.message || "Could not download the staged file.");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const file = new File([bytes], item.filename, { type: item.content_type || "application/octet-stream" });

        const classified = await classifyOneFile(admin, ctx, job.org_id, job.created_by, job.crew_id, crewForClassify, documentTypes, documentTypeNames, aliases, file);
        await admin.from("bulk_intake_job_items").update({ status: "done", classified, processed_at: new Date().toISOString() }).eq("id", item.id);
      } catch (e) {
        await admin
          .from("bulk_intake_job_items")
          .update({ status: "error", error: e instanceof Error ? e.message : String(e), processed_at: new Date().toISOString() })
          .eq("id", item.id);
      }

      // Harmless to race across concurrent loops — it's just a
      // timestamp, and the self-heal check in getBulkIntakeJobStatus
      // only cares that it's recent, not which loop set it last.
      await admin.from("bulk_intake_jobs").update({ last_heartbeat_at: new Date().toISOString() }).eq("id", resolvedJobId);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorkerLoop()));

  const { count: doneOrErrorCount } = await admin
    .from("bulk_intake_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .in("status", ["done", "error"]);
  await admin.from("bulk_intake_jobs").update({ processed_files: doneOrErrorCount ?? 0 }).eq("id", jobId);

  const { count: remaining } = await admin
    .from("bulk_intake_job_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "pending");

  if ((remaining ?? 0) > 0) {
    chainNext(jobId);
  } else {
    await admin.from("bulk_intake_jobs").update({ status: "awaiting_review" }).eq("id", jobId);
  }

  return NextResponse.json({ ok: true });
}
