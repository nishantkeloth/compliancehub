// Plain (non-"use server") constants shared between roster-change-actions.ts
// (server actions) and the client components that render the Request
// Change form and the timeline (staffing-plan.tsx, roster-timeline.tsx).
//
// This has to live outside roster-change-actions.ts: every export from a
// "use server" file must be an async function (see
// https://nextjs.org/docs/messages/invalid-use-server-value) — exporting
// REASON_CODES as a plain array from that file passed `npm run build`
// (Turbopack didn't flag it) but threw at runtime in production:
// "A 'use server' file can only export async functions, found object."

export type ChangeType = "assign" | "replace" | "unassign";

export const REASON_CODES: { value: string; label: string }[] = [
  { value: "rotation_ended", label: "Rotation ended (6-on/1-off)" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "performance_conduct", label: "Performance / conduct" },
  { value: "client_request", label: "Client request" },
  { value: "headcount_change", label: "Headcount change" },
  { value: "other", label: "Other" },
];
