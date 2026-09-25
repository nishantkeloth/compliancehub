"use client";

// Guided Workflows — GuideShell.
//
// The progress chrome doc section 1.5 asks for: a compact overview, and
// Pause/Resume/Previous/Next/Skip/Change starting point/End guide.
// Docked bottom-left (AssistantPanel already owns bottom-right) as a
// slim bar on desktop; below sm it becomes a full-width bottom sheet so
// it never sits over the highlighted control on a phone screen (doc 4.8).
//
// Progress is shown as "Step N" (N = state.history.length, the steps
// actually visited on this run) rather than "Step N of TOTAL" — steps
// form a graph (see lib/guide/types.ts), so a workflow with a creation-
// mode choice doesn't have one fixed total step count to claim.
import { getWorkflow } from "@/lib/guide/registry";
import { useGuide } from "./guide-context";

const barCls = "fixed z-[80] bg-white border shadow-xl";
const barStyle = { borderColor: "var(--ch-line)" };

export default function GuideShell() {
  const guide = useGuide();
  const { state, workflow, currentStep, pickingStart, pickingWorkflowId } = guide;

  if (pickingStart && pickingWorkflowId) {
    const wf = getWorkflow(pickingWorkflowId);
    if (!wf) return null;
    return (
      <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.45)" }}>
        <div className={`${barCls} w-full sm:max-w-sm rounded-xl p-4`} style={barStyle}>
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-bold" style={{ color: "var(--ch-navy)" }}>{wf.title}</div>
            <button onClick={guide.closePicker} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Close</button>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--ch-sub)" }}>Where should we start?</p>
          <div className="space-y-1.5">
            {wf.startPoints.map((sp) => (
              <button
                key={sp.id}
                onClick={() => guide.start(wf.id, sp.id)}
                className="block w-full text-left rounded-lg border px-3 py-2 hover:bg-[var(--ch-paper)]"
                style={{ borderColor: "var(--ch-line)" }}
              >
                <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{sp.label}</div>
                <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{sp.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!state || !workflow || !currentStep) return null;

  const stepNum = state.history.length;
  const currentDone = state.completedStepIds.includes(currentStep.id);
  const isChoice = currentStep.kind === "choice";

  return (
    <div
      className={`${barCls} bottom-0 left-0 right-0 sm:right-auto sm:bottom-5 sm:left-5 sm:rounded-xl sm:w-[360px] px-4 py-3`}
      style={barStyle}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy)", color: "#fff" }}>
            ✦ GUIDE
          </span>
          <span className="text-xs font-bold" style={{ color: "var(--ch-navy)" }}>{workflow.title}</span>
        </div>
        <button onClick={guide.end} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>End guide</button>
      </div>

      <div className="text-xs mb-2" style={{ color: "var(--ch-sub)" }}>
        Step {stepNum}: {currentStep.label}
        {state.paused && <span className="ml-1.5 font-semibold" style={{ color: "var(--ch-fail)" }}>· Paused</span>}
        {currentDone && !state.paused && <span className="ml-1.5 font-semibold" style={{ color: "var(--ch-pass)" }}>· Done</span>}
      </div>

      {/* Progress dots — one per step actually visited this run; filled = a
          past step (all past steps are, by definition, done — the engine
          only ever advances on a real completion event), ringed = current. */}
      <div className="flex items-center gap-1 mb-2.5">
        {state.history.map((stepId, i) => (
          <span
            key={`${stepId}-${i}`}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i < stepNum - 1 ? "var(--ch-pass)" : "var(--ch-navy)" }}
          />
        ))}
      </div>

      {isChoice ? (
        <div className="space-y-1.5 mb-2.5">
          <p className="text-xs" style={{ color: "var(--ch-ink)" }}>{currentStep.instruction}</p>
          {currentStep.options?.map((opt) => (
            <button
              key={opt.next}
              onClick={() => guide.choose(opt.next)}
              className="block w-full text-left rounded-lg border px-3 py-2 hover:bg-[var(--ch-paper)]"
              style={{ borderColor: "var(--ch-line)" }}
            >
              <div className="text-sm font-semibold" style={{ color: "var(--ch-ink)" }}>{opt.label}</div>
              {opt.description && <div className="text-xs" style={{ color: "var(--ch-sub)" }}>{opt.description}</div>}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={guide.previous} disabled={state.history.length <= 1} className="text-xs font-semibold disabled:opacity-30" style={{ color: "var(--ch-navy)" }}>
          ← Previous
        </button>
        {!isChoice && (
          <button onClick={guide.next} disabled={!currentDone} className="text-xs font-semibold disabled:opacity-30" style={{ color: "var(--ch-navy)" }}>
            Next →
          </button>
        )}
        {currentStep.canSkip && (
          <button onClick={guide.skip} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Skip</button>
        )}
        {state.paused ? (
          <button onClick={guide.resume} className="text-xs font-semibold ml-auto" style={{ color: "var(--ch-pass)" }}>Resume</button>
        ) : (
          <button onClick={guide.pause} className="text-xs font-semibold ml-auto" style={{ color: "var(--ch-sub)" }}>Pause</button>
        )}
        <button onClick={guide.changeStart} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>Change start</button>
      </div>
    </div>
  );
}
