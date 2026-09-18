import UploadDocumentsForm from "./upload-documents-form";

// Deliberately outside the authenticated app shell — a crew member
// opening this link has no ComplianceHub account. Mirrors
// app/accept-invite/[token]/page.tsx: a thin server wrapper that just
// hands the token to a client component, which does its own token
// validation via the get_document_upload_link_preview RPC.
export default async function UploadDocumentsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <UploadDocumentsForm token={token} />;
}
