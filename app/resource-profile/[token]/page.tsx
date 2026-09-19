import ResourceProfileView from "./resource-profile-view";

// Deliberately outside the authenticated app shell — the person opening
// this link (a client reviewer) has no ComplianceHub account. Mirrors
// app/upload-documents/[token]/page.tsx: a thin server wrapper that just
// hands the token to a client component, which does its own token
// validation via the get_resource_profile_preview RPC.
export default async function ResourceProfilePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ResourceProfileView token={token} />;
}
