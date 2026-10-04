import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/crew-matrix-share/[token]/file/[versionId] — the "Download"
// link beside a verified document on the public secure crew-matrix page.
// There's no session here (the recipient is a client reviewer), so this
// validates the share token itself, the same rules as the page's own
// preview RPC: recipient exists, not revoked, not expired, package not
// revoked. It then only ever serves a file that THIS package snapshotted
// as available (the versionId must appear in one of the package's own
// document rows) — never an arbitrary stored file — by redirecting to a
// 60-second signed URL for the private crew-documents bucket, and logs the
// download to the package's event trail.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; versionId: string }> }) {
  const { token, versionId } = await params;
  const notFound = () => NextResponse.json({ error: "This link has expired or the file is no longer available." }, { status: 404 });
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(versionId)) return notFound();

  const admin = createAdminClient();
  const { data: recipient } = await admin
    .from("crew_matrix_share_recipients")
    .select("id, org_id, share_package_id, revoked_at, token_expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!recipient || recipient.revoked_at || new Date(recipient.token_expires_at as string).getTime() < Date.now()) return notFound();

  const { data: pkg } = await admin.from("crew_matrix_share_packages").select("id, revoked_at").eq("id", recipient.share_package_id).maybeSingle();
  if (!pkg || pkg.revoked_at) return notFound();

  const { data: snap } = await admin
    .from("crew_matrix_share_documents")
    .select("id")
    .eq("share_package_id", pkg.id)
    .eq("document_snapshot_json->>version_id", versionId)
    .limit(1)
    .maybeSingle();
  if (!snap) return notFound();

  const { data: version } = await admin
    .from("crew_document_versions")
    .select("file_path, file_name, org_id")
    .eq("id", versionId)
    .eq("org_id", recipient.org_id)
    .maybeSingle();
  if (!version) return notFound();

  const { data: signed, error } = await admin.storage.from("crew-documents").createSignedUrl(version.file_path as string, 60, { download: (version.file_name as string | null) ?? true });
  if (error || !signed) return notFound();

  await admin.from("crew_matrix_share_events").insert({
    org_id: recipient.org_id,
    share_package_id: pkg.id,
    recipient_id: recipient.id,
    event_type: "file_downloaded",
    outcome: "success",
    detail: versionId,
  });

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
