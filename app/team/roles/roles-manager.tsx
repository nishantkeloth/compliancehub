"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRole, renameRole, deleteRole, setRolePermission } from "./actions";
import { useOptimisticList, tempId, isTempId } from "@/lib/use-optimistic-list";

type Role = { id: string; name: string; isSystem: boolean; systemKey: string | null };
type Permission = { key: string; label: string; description: string | null };

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
    fd.set("name", newName.trim());
    fd.set("baseRank", newBaseRank);

    const optimisticRole: Role = { id: tempId(), name: newName.trim(), isSystem: false, systemKey: null };
    addOptimisticRole(optimisticRole);
    setLocalGrants((prev) => ({ ...prev, [optimisticRole.id]: new Set() }));
    setNewName("");
    setNewBaseRank("inspector");

    startCreating(async () => {
      const res = await createRole(fd);
      if (res?.error) {
        removeOptimisticRole(optimisticRole.id);
        setCreateError(res.error);
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

      <div className="space-y-4">
        {roleItems.map((role) => {
          const roleGrants = localGrants[role.id] ?? new Set<string>();
          return (
            <div key={role.id} className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                {renamingId === role.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="border rounded-lg px-2 py-1.5 text-sm font-semibold"
                      style={{ borderColor: "var(--ch-line)" }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      autoFocus
                    />
                    <button
                      onClick={() => submitRename(role.id)}
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
                    <div className="font-semibold" style={{ color: "var(--ch-ink)" }}>
                      {role.name}
                    </div>
                    {role.isSystem && (
                      <span
                        className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5"
                        style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
                      >
                        Built-in
                      </span>
                    )}
                    {isTempId(role.id) && (
                      <span className="text-xs italic" style={{ color: "var(--ch-sub)" }}>
                        Saving…
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setRenamingId(role.id);
                        setRenameValue(role.name);
                      }}
                      disabled={isTempId(role.id)}
                      className="text-xs disabled:opacity-40"
                      style={{ color: "var(--ch-sub)" }}
                    >
                      Rename
                    </button>
                  </div>
                )}

                {!role.isSystem && (
                  <button
                    onClick={() => submitDelete(role.id)}
                    disabled={deletingId === role.id || isTempId(role.id)}
                    className="text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                    style={{ color: "var(--ch-fail)" }}
                  >
                    Delete role
                  </button>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {permissions.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm" style={{ color: "var(--ch-ink)" }}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={roleGrants.has(p.key)}
                      disabled={isTempId(role.id)}
                      onChange={(e) => toggle(role.id, p.key, e.target.checked)}
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

              {rowError?.roleId === role.id && (
                <div className="text-sm mt-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                  {rowError.message}
                </div>
              )}
              {deleteError?.roleId === role.id && (
                <div className="text-sm mt-3 rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                  {deleteError.message}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
