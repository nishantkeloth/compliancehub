/* ============================================================
   ComplianceHub — Sample inspection generator
   Creates realistic completed inspections for BOTH templates,
   writing through the same tables the real app uses — so the
   auto-corrective-action trigger fires exactly as it would from
   the browser. Good for populating the dashboard/actions screens
   without manually clicking through 94 or 174 items.

   Run from the project root:
     node --env-file=.env.local scripts/seed-sample-inspections.mjs

   Requires the same .env.local as seed-templates.mjs
   (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
   Safe to re-run — each run creates NEW inspections (it does not
   dedupe), so run it once, or delete old sample data if you want
   a clean slate (see cleanup query at the bottom of this file).
   ============================================================ */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key);

const SITES = ["Camp A", "Vessel X", "Site 3 - Warehouse"];

async function getOrg() {
  const { data, error } = await db
    .from("organizations").select("id").eq("name", "AHM Marine").single();
  if (error) throw new Error("AHM Marine org not found — run seed-templates.mjs first.");
  return data.id;
}

async function getInspector(orgId) {
  const { data } = await db
    .from("profiles").select("id, full_name").eq("org_id", orgId).limit(1).maybeSingle();
  return data; // may be null — inspections allow a null inspector_id
}

async function getOrCreateSite(orgId, name) {
  let { data } = await db
    .from("sites").select("id").eq("org_id", orgId).eq("name", name).maybeSingle();
  if (data) return data.id;
  const { data: created, error } = await db
    .from("sites").insert({ org_id: orgId, name }).select("id").single();
  if (error) throw error;
  return created.id;
}

async function getTemplateWithItems(orgId, code) {
  const { data: tpl, error } = await db
    .from("templates").select("id, scoring_type").eq("org_id", orgId).eq("code", code).single();
  if (error) throw new Error(`Template ${code} not found — run seed-templates.mjs first.`);

  const { data: sections } = await db
    .from("template_sections")
    .select("id, title, template_items(id, prompt, max_marks)")
    .eq("template_id", tpl.id);

  const items = sections.flatMap((s) =>
    s.template_items.map((it) => ({ ...it, section: s.title }))
  );
  return { ...tpl, items };
}

const NOTES = [
  "Observed during walk-through, corrected on the spot pending verification",
  "Reported by site team, awaiting parts/supplies",
  "Recurring issue from last cycle — needs root-cause fix",
  "Minor deviation, low risk, scheduled for next maintenance window",
];

function pickFailures(items, count) {
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function runInspection({ orgId, siteName, code, failCount, inspectorId }) {
  const site_id = await getOrCreateSite(orgId, siteName);
  const tpl = await getTemplateWithItems(orgId, code);
  const scored = tpl.scoring_type === "scored";

  const { data: insp, error: iErr } = await db
    .from("inspections")
    .insert({
      org_id: orgId, template_id: tpl.id, site_id,
      inspector_id: inspectorId, status: "in_progress",
    })
    .select("id").single();
  if (iErr) throw iErr;

  const failing = new Set(pickFailures(tpl.items, failCount).map((it) => it.id));

  let pass = 0, fail = 0, na = 0, att = 0, max = 0;
  const rows = tpl.items.map((it) => {
    const isFail = failing.has(it.id);
    if (scored) {
      max += it.max_marks;
      const attained = isFail ? Math.max(0, it.max_marks - 1 - Math.floor(Math.random() * (it.max_marks - 1 || 1))) : it.max_marks;
      att += attained;
      return {
        inspection_id: insp.id, item_id: it.id, marks_attained: attained,
        note: isFail ? NOTES[Math.floor(Math.random() * NOTES.length)] : null,
      };
    } else {
      const result = isFail ? "fail" : "ok";
      if (result === "ok") pass++; else fail++;
      return {
        inspection_id: insp.id, item_id: it.id, result,
        note: isFail ? NOTES[Math.floor(Math.random() * NOTES.length)] : null,
      };
    }
  });

  const { error: rErr } = await db.from("inspection_responses").insert(rows);
  if (rErr) throw rErr;

  const score = scored ? (att / max) * 100 : (pass / (pass + fail)) * 100;

  const { error: uErr } = await db
    .from("inspections")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      score_pct: Math.round(score * 100) / 100,
      marks_attained: scored ? att : null,
      marks_max: scored ? max : null,
      count_pass: pass, count_fail: fail, count_na: na,
    })
    .eq("id", insp.id);
  if (uErr) throw uErr;

  console.log(
    `  ${code} @ ${siteName} — score ${Math.round(score)}% — ${failCount} finding(s) raised`
  );
}

async function main() {
  const orgId = await getOrg();
  const inspector = await getInspector(orgId);
  if (inspector) console.log(`Using inspector: ${inspector.full_name}`);
  else console.log("No profile found — inspections will have no inspector attached (fine for sample data).");

  console.log("\nGenerating sample inspections...");

  await runInspection({ orgId, siteName: SITES[0], code: "AHM MS 90", failCount: 4, inspectorId: inspector?.id });
  await runInspection({ orgId, siteName: SITES[1], code: "AHM MS 90", failCount: 1, inspectorId: inspector?.id });
  await runInspection({ orgId, siteName: SITES[1], code: "AHM MS 33", failCount: 3, inspectorId: inspector?.id });
  await runInspection({ orgId, siteName: SITES[2], code: "AHM MS 33", failCount: 6, inspectorId: inspector?.id });

  console.log("\nDone. Refresh the dashboard — you should see 4 inspections and their");
  console.log("corrective actions already populated under /actions.");
}

main().catch((e) => { console.error("Failed:", e.message ?? e); process.exit(1); });

/* ============================================================
   CLEANUP — run in Supabase SQL editor if you want to wipe all
   sample/test data and start fresh (does NOT touch templates):

     delete from corrective_actions where org_id = '<your-org-uuid>';
     delete from inspection_responses where inspection_id in
       (select id from inspections where org_id = '<your-org-uuid>');
     delete from inspections where org_id = '<your-org-uuid>';
   ============================================================ */
