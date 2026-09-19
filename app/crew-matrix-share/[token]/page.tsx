import ShareView from "./share-view";

// Deliberately outside the authenticated app shell — the person opening
// this link (a client reviewer) has no ComplianceHub account. Mirrors
// app/resource-profile/[token]/page.tsx: a thin server wrapper that just
// hands the token to a client component, which does its own token
// validation via the get_crew_matrix_share_preview RPC.
export default async function CrewMatrixSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareView token={token} />;
}
