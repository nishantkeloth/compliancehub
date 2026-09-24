"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ensureWorkflowDefinition, addStage, updateStage, deleteStage, moveStage } from "./actions";

type Definition = { id: string; entityType: string; name: string };
type ApproverType = "permission" | "user";
type Stage = {
  id: string;
  definitionId: string;
  sequence: number;
  name: string;
  approverType: ApproverType;
  requiredPermission: string | null;
  approverUserId: string | null;
  skipCondition: string | null;
};
type Permission = { key: string; label: string };
type Member = { id: string; fullName: string };

// v1 recognizes exactly one skip condition literal (see lib/workflow.ts's
// evaluateSkipCondition) — this maps it to a human label for the one
// entity type it applies to.
const SKIP_CONDITIONS: Record<string, { value: string; label: string }[]> = {
  crew_matrix: [{ value: "no_lines_require_client_approval", label: "Skip automatically when no manning line on the matrix requires client approval" }],
};

type RunFn = (fn: () => Promise<{ error?: string | null } | undefined>) => void;

export default function WorkflowsManager({
  entityTypes,
  definitions,
  stages,
  permissions,
  members,
}: {
  entityTypes: { value: string; label: string }[];
  definitions: Definition[];
  stages: Stage[];
  permissions: Permission[];
  members: Member[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run: RunFn = (fn) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <div className="text-sm rounded-lg px-3 py-2" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>{error}</div>}
      {entityTypes.map((et) => {
        const definition = definitions.find((d) => d.entityType === et.value) ?? null;
        const ownStages = definition ? stages.filter((s) => s.definitionId === definition.id).sort((a, b) => a.sequence - b.sequence) : [];
        return (
          <EntityWorkflowCard
            key={et.value}
            entityType={et.value}
            entityLabel={et.label}
            definition={definition}
            stages={ownStages}
            permissions={permissions}
            members={members}
            run={run}
          />
        );
      })}
    </div>
  );
}

function EntityWorkflowCard({
  entityType,
  entityLabel,
  definition,
  stages,
  permissions,
  members,
  run,
}: {
  entityType: string;
  entityLabel: string;
  definition: Definition | null;
  stages: Stage[];
  permissions: Permission[];
  members: Member[];
  run: RunFn;
}) {
  const [newName, setNewName] = useState("");
  const [newApproverType, setNewApproverType] = useState<ApproverType>("permission");
  const [newPermission, setNewPermission] = useState(permissions[0]?.key ?? "");
  const [newMemberId, setNewMemberId] = useState(members[0]?.id ?? "");
  const [newSkip, setNewSkip] = useState(false);
  const skipOptions = SKIP_CONDITIONS[entityType] ?? [];

  if (!definition) {
    return (
      <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
        <h2 className="font-semibold mb-2" style={{ color: "var(--ch-ink)" }}>
          {entityLabel}
        </h2>
        <p className="text-sm mb-3" style={{ color: "var(--ch-sub)" }}>
          No approval workflow set up yet for this document type — it will be approved automatically on submission
          until you add at least one stage.
        </p>
        <button
          onClick={() => run(() => ensureWorkflowDefinition(entityType, `${entityLabel} Approval`))}
          className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold"
        >
          Create workflow
        </button>
      </div>
    );
  }

  const newApproverValue = newApproverType === "permission" ? newPermission : newMemberId;

  return (
    <div className="bg-white border rounded-xl p-5" style={{ borderColor: "var(--ch-line)" }}>
      <h2 className="font-semibold mb-3" style={{ color: "var(--ch-ink)" }}>
        {entityLabel}
      </h2>

      {stages.length === 0 && (
        <p className="text-sm mb-3" style={{ color: "var(--ch-sub)" }}>
          No stages configured — documents of this type will be approved automatically on submission.
        </p>
      )}

      <div className="space-y-2 mb-4">
        {stages.map((stage, i) => (
          <StageRow key={stage.id} stage={stage} permissions={permissions} members={members} isFirst={i === 0} isLast={i === stages.length - 1} run={run} />
        ))}
      </div>

      <div className="border-t pt-4" style={{ borderColor: "var(--ch-line)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--ch-sub)" }}>
          Add a stage
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            style={{ borderColor: "var(--ch-line)" }}
            placeholder="Stage name, e.g. Client Approval"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <ApproverTypeToggle value={newApproverType} onChange={setNewApproverType} />
          {newApproverType === "permission" ? (
            <select className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: "var(--ch-line)" }} value={newPermission} onChange={(e) => setNewPermission(e.target.value)}>
              {permissions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          ) : (
            <select className="border rounded-lg px-2 py-2 text-sm" style={{ borderColor: "var(--ch-line)" }} value={newMemberId} onChange={(e) => setNewMemberId(e.target.value)}>
              {members.length === 0 && <option value="">No active team members</option>}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() =>
              run(async () => {
                const res = await addStage(definition.id, newName, newApproverType, newApproverValue, newSkip && skipOptions[0] ? skipOptions[0].value : null);
                if (!res?.error) {
                  setNewName("");
                  setNewSkip(false);
                }
                return res;
              })
            }
            disabled={!newName.trim() || !newApproverValue}
            className="ch-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Add stage
          </button>
        </div>
        {skipOptions[0] && (
          <label className="flex items-center gap-2 text-xs mt-2" style={{ color: "var(--ch-sub)" }}>
            <input type="checkbox" checked={newSkip} onChange={(e) => setNewSkip(e.target.checked)} />
            {skipOptions[0].label}
          </label>
        )}
      </div>
    </div>
  );
}

// A small "Permission | Person" segmented toggle, reused by both the
// add-stage form and each existing StageRow's inline editor.
function ApproverTypeToggle({ value, onChange }: { value: ApproverType; onChange: (v: ApproverType) => void }) {
  const opt = (v: ApproverType, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border"
      style={
        value === v
          ? { background: "var(--ch-navy)", color: "#fff", borderColor: "var(--ch-navy)" }
          : { background: "transparent", color: "var(--ch-sub)", borderColor: "var(--ch-line)" }
      }
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1">
      {opt("permission", "By permission")}
      {opt("user", "By person")}
    </div>
  );
}

function StageRow({
  stage,
  permissions,
  members,
  isFirst,
  isLast,
  run,
}: {
  stage: Stage;
  permissions: Permission[];
  members: Member[];
  isFirst: boolean;
  isLast: boolean;
  run: RunFn;
}) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(stage.name);
  // Local draft of the approver type/value, so switching the toggle
  // doesn't save anything until a value is actually picked below it.
  const [approverType, setApproverType] = useState<ApproverType>(stage.approverType);

  const memberName = stage.approverUserId ? members.find((m) => m.id === stage.approverUserId)?.fullName ?? "Unknown person" : null;
  const permissionLabel = stage.requiredPermission ? permissions.find((p) => p.key === stage.requiredPermission)?.label ?? stage.requiredPermission : null;

  return (
    <div className="flex items-center gap-2 flex-wrap border rounded-lg px-3 py-2" style={{ borderColor: "var(--ch-line)" }}>
      <span
        className="text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0"
        style={{ background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
      >
        {stage.sequence}
      </span>
      {editingName ? (
        <>
          <input
            className="border rounded-lg px-2 py-1 text-sm"
            style={{ borderColor: "var(--ch-line)" }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button
            onClick={() => {
              setEditingName(false);
              run(() => updateStage(stage.id, { name }));
            }}
            className="text-xs font-semibold"
            style={{ color: "var(--ch-navy)" }}
          >
            Save
          </button>
        </>
      ) : (
        <button onClick={() => setEditingName(true)} className="text-sm font-medium" style={{ color: "var(--ch-ink)" }}>
          {stage.name}
        </button>
      )}

      <ApproverTypeToggle
        value={approverType}
        onChange={(next) => {
          setApproverType(next);
          // Switching type needs a value picked before it can save — for
          // "by permission" default straight to the first permission (a
          // safe, always-valid choice); for "by person" wait for the
          // dropdown below to be touched, since there's no safe default.
          if (next === "permission" && permissions[0]) {
            run(() => updateStage(stage.id, { approverType: "permission", requiredPermission: permissions[0].key }));
          }
        }}
      />

      {approverType === "permission" ? (
        <select
          className="border rounded-lg px-2 py-1 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={stage.approverType === "permission" ? stage.requiredPermission ?? "" : ""}
          onChange={(e) => run(() => updateStage(stage.id, { approverType: "permission", requiredPermission: e.target.value }))}
        >
          {stage.approverType !== "permission" && <option value="">Choose a permission…</option>}
          {permissions.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="border rounded-lg px-2 py-1 text-sm"
          style={{ borderColor: "var(--ch-line)" }}
          value={stage.approverType === "user" ? stage.approverUserId ?? "" : ""}
          onChange={(e) => run(() => updateStage(stage.id, { approverType: "user", approverUserId: e.target.value }))}
        >
          <option value="">Choose a person…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </select>
      )}

      {stage.approverType === "user" && memberName && (
        <span className="text-[10px] italic" style={{ color: "var(--ch-sub)" }}>
          assigned to {memberName}
        </span>
      )}
      {stage.approverType === "permission" && permissionLabel && stage.skipCondition && (
        <span className="text-[10px] italic" style={{ color: "var(--ch-sub)" }}>
          conditional
        </span>
      )}

      <div className="flex items-center gap-1 ml-auto">
        <button onClick={() => run(() => moveStage(stage.id, "up"))} disabled={isFirst} className="text-xs px-1.5 disabled:opacity-30" style={{ color: "var(--ch-sub)" }}>
          ↑
        </button>
        <button onClick={() => run(() => moveStage(stage.id, "down"))} disabled={isLast} className="text-xs px-1.5 disabled:opacity-30" style={{ color: "var(--ch-sub)" }}>
          ↓
        </button>
        <button
          onClick={() => {
            if (!window.confirm(`Remove the "${stage.name}" stage?`)) return;
            run(() => deleteStage(stage.id));
          }}
          className="text-xs font-semibold px-1.5"
          style={{ color: "var(--ch-fail)" }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
