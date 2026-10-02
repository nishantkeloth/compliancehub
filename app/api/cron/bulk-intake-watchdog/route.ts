import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Phase 16d — the backstop for the self-chaining worker at
// app/api/bulk-intake/process-job/route.ts. The normal recovery path is
// already in getBulkIntakeJobStatus (document-intake-actions.ts): any
// time someone's browser polls a job and its heartbeat looks stale, that
// poll re-kicks the worker right then. This cron only matters for a job
// nobody is watching — the reviewer closed the tab and never came back
// — which the poll-based check can never catch on its own.
//
// Two different staleness thresholds on purpose: a few minutes of
// silence just means the chain probably dropped a hop (a cold start, a
// deploy) and is worth one more kick; several hours of silence despite
// that means something is actually broken, and leaving the job as
// "processing" forever would make it look like it's still working when
// nothing is happening. The second case gives up and marks the job
// failed with a plain explanation, rather than lying to the reviewer.
//
// Protected the same way as the existing send-reminders cron —
// CRON_SECRET must be set and match. Triggered by Vercel Cron, see
// vercel.json.
export const maxDuration = 60;

const RECHECK_STALE_MS = 5 * 60 * 1000;
const GIVE_UP_STALE_MS = 6 * 60 * 60 * 1000;

function workerUrl() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/bulk-intake/process-job`;
}

function kickWorker(jobId: string) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  return fetch(workerUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ jobId }),
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = Date.now();

  const { data: stuckJobs } = await admin.from("bulk_intake_jobs").select("id, last_heartbeat_at").eq("status", "processing");

  let rekicked = 0;
  let gaveUp = 0;
  for (const job of stuckJobs ?? []) {
    const age = now - new Date(job.last_heartbeat_at as string).getTime();
    if (age > GIVE_UP_STALE_MS) {
      await admin
        .from("bulk_intake_jobs")
        .update({ status: "failed", error: "This job stopped making progress and wasn't picked back up — try re-uploading this folder." })
        .eq("id", job.id);
      gaveUp++;
    } else if (age > RECHECK_STALE_MS) {
      await kickWorker(job.id as string);
      rekicked++;
    }
  }

  return NextResponse.json({ ok: true, checked: (stuckJobs ?? []).length, rekicked, gaveUp });
}
