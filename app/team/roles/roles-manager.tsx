"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createRole, renameRole, deleteRole, setRolePermission } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";
import { buildPermissionGroups, type Permission } from "./permission-groups";

type Role = { id: string; name: string; isSystem: boolean; systemKey: string | null };

const BASE_RANK_OPTIONS = [
  { value: "inspector", label: "Inspector (baseline access)" },
  { value: "auditor", label: "Auditor (baseline access)" },
  { value: "supervisor", label: "Supervisor" },
  { value: "company_admin", label: "Company Admin (full access)" },
];

export default function RolesManager({
  roles,
  permissions,
  grants,
}: {
  roles: Role[];
  permissions: Permission[];
  grants: Record<string, string[]>;
}) {
  const router = useRouter();
  const {
    items: roleItems,
    addOptimistic: addOptimisticRole,
    updateOptimistic: updateOptimisticRole,
    removeOptimistic: removeOptimisticRole,
    restoreOptimistic: restoreOptimisticRole,
  } = useOptimisticList(roles);

  const permissionGroups = buildPermissionGroups(permissions);

  const [localGrants, setLocalGrants] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(roles.map((r) => [r.id, new Set(grants[r.id] ?? [])]))
  );
  const [rowError, setRowError] = useState<{ roleId: string; message: string } | null>(null);
  const [, startToggle] = useTransition();

  const [newName, setNewName] = useState("");
  const [newBaseRank, setNewBaseRank] = useState("inspector");
  const [createError, setCreateError] = useState<string | null>(null);
  const [, startCreating] = useTransition();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [, startRenaming] = useTransition();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ roleId: string; message: string } | null>(null);
  const [, startDeleting] = useTransition();

  // Which role's tab is showing. Tracked separately from roleItems so a
  // freshly-created role (still on its temp id) stays selected across the
  // optimistic->real id swap that happens once createRole()'s
  // router.refresh() lands new props.
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(roles[0]?.id ?? null);
  const [pendingNewRoleName, setPendingNewRoleName] = useState<string | null>(null);

  useEffect(() => {
    if (selectedRoleId && roleItems.some((r) => r.id === selectedRoleId)) return;
    if (pendingNewRoleName) {
      const match = roleItems.find((r) => r.name === pendingNewRoleName && !isTempId(r.id));
      if (match) {
        setSelectedRoleId(match.id);
        setPendingNewRoleName(null);
        return;
      }
    }
    setSelectedRoleId(roleItems[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleItems]);

  const toggle = (roleId: string, permissionKey: string, next: boolean) => {
    setRowError(null);
    setLocalGrants((prev) => {
      const set = new Set(prev[roleId]);
      if (next) set.add(permissionKey);
      else set.delete(permissionKey);
      return { ...prev, [roleId]: set };
    });
    startToggle(async () => {
      const res = await setRolePermission(roleId, permissionKey, next);
      if (res?.error) {
        setRowError({ roleId, message: res.error });
        setLocalGrants((prev) => {
          const set = new Set(prev[roleId]);
          if (next) set.delete(permissionKey);
          else set.add(permissionKey);
          return { ...prev, [roleId]: set };
        });
      }
    });
  };

  const submitCreate = () => {
    if (!newName.trim()) return;
    setCreateError(null);
    const fd = new FormData();
    const trimmedName = newName.trim();
    fd.set("name", trimmedName);
    fd.set("baseRank", newBaseRank);

    const optimisticRole: Role = { id: tempId(), name: trimmedName, isSystem: false, systemKey: null };
    addOptimisticRole(optimisticRole);
    setLocalGrants((prev) => ({ ...prev, [optimisticRole.id]: new Set() }));
    setNewName("");
    setNewBaseRank("inspector");
    setSelectedRoleId(optimisticRole.id);
    setPendingNewRoleName(trimmedName);

    startCreating(async () => {
      const res = await createRole(fd);
      if (res?.error) {
        removeOptimisticRole(optimisticRole.id);
        setCreateError(res.error);
        setPendingNewRoleName(null);
        return;
      }
      router.refresh();
    });
  };

  const submitRename = (roleId: string) => {
    if (!renameValue.trim()) return;
    const previous = roleItems.find((r) => r.id === roleId);
    updateOptimisticRole(roleId, { name: renameValue.trim() });
    setRenamingId(null);
    startRenaming(async () => {
      const res = await renameRole(roleId, renameValue.trim());
      if (res?.error) {
        if (previous) updateOptimisticRole(roleId, { name: previous.name });
        setRowError({ roleId, message: res.error });
        return;
      }
      router.refresh();
    });
  };

  const submitDelete = (roleId: string) => {
    setDeleteError(null);
    if (!window.confirm("Delete this role? This can't be undone.")) return;
    const index = roleItems.findIndex((r) => r.id === roleId);
    const role = roleItems[index];
    removeOptimisticRole(roleId);
    startDeleting(async () => {
      const res = await deleteRole(roleId);
      if (res?.error) {
        if (role) restoreOptimisticRole(role, index);
        setDeleteError({ roleId, message: res.error });
        return;
      }
      router.refresh();
    });
  };

  const selectedRole = roleItems.find((r) => r.id === selectedRoleId) ?? roleItems[0] ?? null;
  const roleGrants = selectedRole ? localGrants[selectedRole.id] ?? new Set<string>() : new Set<string>();

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--ch-sub)" }}>
          Create a role
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: "var(--ch-line)" }}
            placeholder="Role name, e.g. Site Manager"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm" style={{ color: "var(--ch-ink)" }}>
            Base tier
            <select
              className="border rounded-lg px-2 py-1.5 text-sm ml-1"
              style={{ borderColor: "var(--ch-line)" }}
              value={newBaseRank}
              onChange={(e) => setNewBaseRank(e.target.value)}
            >
              {BASE_RANK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={submitCreate}
            disabled={!newName.trim()}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Create role
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
          Then check exactly what it can do below. The base tier is just a starting point for legacy
          compatibility — the checkboxes are what actually control access.
        </p>
        {createError && (
          <div className="text-sm mt-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
            {createError}
          </div>
        )}
      </div>

      {roleItems.length === 0 ? (
        <div className="bg-white border rounded-xl p-5 text-sm" style={{ borderColor: "var(--ch-line)", color: "var(--ch-sub)" }}>
          No roles yet — create one above.
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-1.5 flex-wrap border-b mb-0" style={{ borderColor: "var(--ch-line)" }}>
            {roleItems.map((role) => {
              const active = selectedRole?.id === role.id;
              return (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className="text-sm font-semibold px-3.5 py-2 rounded-t-lg border border-b-0 -mb-px transition-colors"
                  style={
                    active
                      ? { borderColor: "var(--ch-line)", background: "#fff", color: "var(--ch-navy)" }
                      : { borderColor: "transparent", background: "transparent", color: "var(--ch-sub)" }
                  }
                >
                  {role.name}
                  {isTempId(role.id) && <span className="italic font-normal"> · saving…</span>}
                </button>
              );
            })}
          </div>

          {selectedRole && (
            <div className="bg-white border rounded-b-xl rounded-tr-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                {renamingId === selectedRole.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="border rounded-lg px-2 py-1.5 text-sm font-semibold"
                      style={{ borderColor: "var(--ch-line)" }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      onClick={() => submitRename(selectedRole.id)}
                      className="text-xs font-semibold border rounded-lg px-2.5 py-1.5"
                      style={{ borderColor: "var(--ch-line)", color: "var(--ch-navy)" }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="text-xs font-semibold px-2.5 py-1.5"
                      style={{ color: "var(--ch-sub)" }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="text-base font-semibold" style={{ color: "var(--ch-ink)" }}>
                      {selectedRole.name}
                    </div>
                    {selectedRole.isSystem && (
                      <span
                        className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5"
                        style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
                      >
                        Built-in
                      </span>
                    )}
                    {isTempId(selectedRole.id) && (
                      <span className="text-xs italic" style={{ color: "var(--ch-sub)" }}>
                        Saving…
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setRenamingId(selectedRole.id);
                        setRenameValue(selectedRole.name);
                      }}
                      disabled={isTempId(selectedRole.id)}
                      className="text-xs disabled:opacity-40"
                      style={{ color: "var(--ch-sub)" }}
                    >
                      Rename
                    </button>
                  </div>
                )}

                {!selectedRole.isSystem && (
                  <button
                    onClick={() => submitDelete(selectedRole.id)}
                    disabled={deletingId === selectedRole.id || isTempId(selectedRole.id)}
                    className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                    style={{ color: "var(--ch-fail)" }}
                  >
                    Delete role
                  </button>
                )}
              </div>

              <div className="space-y-5">
                {permissionGroups.map((group) => {
                  const gateChecked = group.gate ? roleGrants.has(group.gate.key) : false;
                  const anyChildChecked = group.items.some((p) => roleGrants.has(p.key));
                  const showChildren = !group.gate || gateChecked || anyChildChecked;

                  return (
                    <div key={group.label}>
                      <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
                        {group.label}
                      </div>

                      {group.gate && (
                        <label className="flex items-start gap-2 text-sm mb-2" style={{ color: "var(--ch-ink)" }}>
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={gateChecked}
                            disabled={isTempId(selectedRole.id)}
                            onChange={(e) => toggle(selectedRole.id, group.gate!.key, e.target.checked)}
                          />
                          <span>
                            <span className="font-medium">{group.gate.label}</span>
                            {group.gate.description && (
                              <span className="block text-xs" style={{ color: "var(--ch-sub)" }}>
                                {group.gate.description}
                              </span>
                            )}
                          </span>
                        </label>
                      )}

                      {group.items.length > 0 && showChildren && (
                        <div
                          className="grid gap-2 sm:grid-cols-2"
                          style={group.gate ? { marginLeft: "1.5rem", paddingLeft: "0.75rem", borderLeft: "2px solid var(--ch-line)" } : undefined}
                        >
                          {group.items.map((p) => (
                            <label key={p.key} className="flex items-start gap-2 text-sm" style={{ color: "var(--ch-ink)" }}>
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={roleGrants.has(p.key)}
                                disabled={isTempId(selectedRole.id)}
                                onChange={(e) => toggle(selectedRole.id, p.key, e.target.checked)}
                              />
                              <span>
                                <span className="font-medium">{p.label}</span>
                                {p.description && (
                                  <span className="block text-xs" style={{ color: "var(--ch-sub)" }}>
                                    {p.description}
                                  </span>
                                )}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}

                      {group.gate && !showChildren && (
                        <div className="text-xs italic" style={{ marginLeft: "1.5rem", color: "var(--ch-sub)" }}>
                          Check &ldquo;{group.gate.label}&rdquo; to allow specific {group.label.toLowerCase()} permissions.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {rowError?.roleId === selectedRole.id && (
                <div className="text-sm mt-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                  {rowError.message}
                </div>
              )}
              {deleteError?.roleId === selectedRole.id && (
                <div className="text-sm mt-4 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                  {deleteError.message}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
