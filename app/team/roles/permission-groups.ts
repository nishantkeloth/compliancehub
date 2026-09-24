// Groups the flat `permissions` table into modules for the Roles &
// Permissions screen, so a role's checklist reads as "Crew Matrix: view,
// then manage/submit/approve…" instead of one long alphabetical list.
//
// This is presentation only — there is no module concept in the schema,
// and nothing here changes what setRolePermission() grants. A group is
// derived purely from its permissions' key prefixes (longest-prefix
// match, so "crew.matrix." wins over "crew."), so a brand-new permission
// key added by a future migration renders correctly without this file
// needing an update — it just falls into "Other" until a rule is added
// for it.

export type Permission = { key: string; label: string; description: string | null };
export type PermissionGroup = {
  label: string;
  // The permission that gates the rest of the group in the UI — the
  // group's own ".view" permission when it has exactly one, so checking
  // it is what reveals the group's other checkboxes. null means the
  // group has no natural gate (a single permission, or several with no
  // ".view" among them) and renders flat instead.
  gate: Permission | null;
  items: Permission[];
};

const GROUP_RULES: { prefix: string; label: string }[] = [
  { prefix: "crew.matrix.", label: "Crew Matrix" },
  { prefix: "crew.documents.", label: "Crew Documents" },
  { prefix: "crew.", label: "Crew Register" },
  { prefix: "contracts.", label: "Contracts" },
  { prefix: "projects.", label: "Projects" },
  { prefix: "mobilization.", label: "Mobilization" },
  { prefix: "containers.", label: "Containers" },
  { prefix: "ops.", label: "Operations & Billing" },
  { prefix: "team.", label: "Team & Admin" },
  { prefix: "workflows.", label: "Approval Workflows" },
  { prefix: "ai.", label: "AI" },
  { prefix: "templates.", label: "Templates" },
  { prefix: "schedules.", label: "Schedules" },
  { prefix: "actions.", label: "Corrective Actions" },
  { prefix: "notifications.", label: "Notifications & Dashboard" },
];

function groupLabelFor(key: string): string {
  let best: { prefix: string; label: string } | null = null;
  for (const rule of GROUP_RULES) {
    if (key.startsWith(rule.prefix) && (!best || rule.prefix.length > best.prefix.length)) best = rule;
  }
  return best?.label ?? "Other";
}

export function buildPermissionGroups(permissions: Permission[]): PermissionGroup[] {
  const order: string[] = [];
  const byLabel = new Map<string, Permission[]>();
  for (const p of permissions) {
    const label = groupLabelFor(p.key);
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(p);
  }

  // "Other" (unrecognized keys) always sorts last, whatever order it was
  // first encountered in.
  order.sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : 0));

  return order.map((label) => {
    const items = byLabel.get(label)!;
    const viewPerms = items.filter((p) => p.key.endsWith(".view"));
    const gate = items.length > 1 && viewPerms.length === 1 ? viewPerms[0] : null;
    return { label, gate, items: gate ? items.filter((p) => p.key !== gate.key) : items };
  });
}
