import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getEffectiveAccess, can } from "@/lib/rbac";
import { getTracksConfig } from "../tracks-actions";
import TracksManager from "./tracks-manager";

export default async function MobilizationTracksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const access = await getEffectiveAccess(supabase, user.id);
  if (!can(access, "mobilization.manage")) redirect("/");

  const config = await getTracksConfig();
  if ("error" in config) redirect("/");

  return (
    <>
      <p className="text-sm mb-6" style={{ color: "var(--ch-sub)" }}>
        A track is one client&apos;s configured onboarding pathway — e.g. &quot;New Joiner&quot; vs &quot;Returning
        Crew&quot; — with an ordered checklist of steps. Assign a track to a mobilization position on its Checklist
        tab. A track with no client set is an org-wide default, used for any client without a configured process yet.
      </p>
      <TracksManager clients={config.clients} tracks={config.tracks} items={config.items} documentTypes={config.documentTypes} />
    </>
  );
}
