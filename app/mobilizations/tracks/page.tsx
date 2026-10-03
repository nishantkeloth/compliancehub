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
        A track is a named set of steps &mdash; e.g. &quot;New Joiner&quot; or &quot;Returning Crew&quot;. Add the steps
        each person needs, then assign a track to a person on a mobilization&apos;s Checklist tab.
      </p>
      <TracksManager tracks={config.tracks} items={config.items} documentTypes={config.documentTypes} />
    </>
  );
}
