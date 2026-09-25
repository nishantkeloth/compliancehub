"use client";

// Guided Workflows — GuideProvider.
//
// Owns the active workflow/step and exposes the controls doc section
// 1.5 requires (Pause/Resume/Previous/Next/Skip/Change starting
// point/End guide) plus notifyCompletion(), which real screens call
// after a real server action succeeds — never on a bare click. This is
// the ONLY place that advances a step, and it only ever does so against
// workflows/steps defined in lib/guide/registry.ts (the allow-listed
// registry) — nothing here accepts an arbitrary route, selector or step
// from chat/AI input.
//
// Steps form a graph (see lib/guide/types.ts's `next`/`kind: "choice"`),
// not a flat array walked by index — a creation-mode choice can diverge
// into different real paths before converging back on the same goal.
// `state.history` is the ordered list of step ids actually visited on
// this run; Previous and the progress dots walk that, not
// `workflow.steps`.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getWorkflow } from "@/lib/guide/registry";
import { clearGuideState, loadGuideState, saveGuideState, type GuideState } from "@/lib/guide/state";
import type { GuidedStep, GuidedWorkflow } from "@/lib/guide/types";

function fillTemplate(input: string, recordRefs: Record<string, string>): string {
  return input.replace(/\{(\w+)\}/g, (_, key: string) => recordRefs[key] ?? "");
}

// A route template with an unresolved {placeholder} means the record it
// needs hasn't been created yet — the step isn't reachable via direct
// navigation yet (only by completing the prior step first).
function routeIsResolved(route: string): boolean {
  return !/\{(\w+)\}/.test(route);
}

type GuideContextValue = {
  state: GuideState | null;
  workflow: GuidedWorkflow | null;
  currentStep: GuidedStep | null;
  resolvedRoute: string | null;
  start: (workflowId: string, startPointId: string) => void;
  pause: () => void;
  resume: () => void;
  previous: () => void;
  next: () => void;
  skip: () => void;
  // "choice"-kind steps only — advances straight to the picked option's
  // next step id. No completion event: the pick itself is the action.
  choose: (nextStepId: string) => void;
  changeStart: () => void;
  end: () => void;
  notifyCompletion: (eventName: string, payload?: { recordId?: string }) => boolean;
  pickingStart: boolean;
  pickingWorkflowId: string | null;
  openPicker: (workflowId: string) => void;
  closePicker: () => void;
};

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuide() {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide() must be used within GuideProvider");
  return ctx;
}

// Never throws when the provider genuinely isn't mounted (defensive — it
// always is, from ShellChrome) so a screen's notifyCompletion() call is
// safe even if that ever changes.
export function useGuideMaybe() {
  return useContext(GuideContext);
}

export function GuideProvider({ userScopeKey, children }: { userScopeKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuideState | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [pendingWorkflowId, setPendingWorkflowId] = useState<string | null>(null);

  // Resume on mount — revalidate against the current registry rather than
  // trusting the stored ids blindly (doc 5.3: "Revalidate all references,
  // permissions, prerequisites and step versions on resume").
  useEffect(() => {
    const saved = loadGuideState(userScopeKey);
    if (!saved) return;
    const wf = getWorkflow(saved.workflowId);
    if (!wf || wf.version !== saved.workflowVersion) {
      clearGuideState();
      return;
    }
    const step = wf.steps.find((s) => s.id === saved.currentStepId);
    if (!step || !Array.isArray(saved.history) || saved.history.length === 0) {
      clearGuideState();
      return;
    }
    setState(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userScopeKey]);

  useEffect(() => {
    if (state) saveGuideState(state);
  }, [state]);

  const workflow = useMemo(() => (state ? getWorkflow(state.workflowId) : null), [state]);
  const currentStep = useMemo(
    () => (state && workflow ? workflow.steps.find((s) => s.id === state.currentStepId) ?? null : null),
    [state, workflow]
  );
  const resolvedRoute = useMemo(() => {
    if (!currentStep || !state) return null;
    const route = fillTemplate(currentStep.route, state.recordRefs);
    return routeIsResolved(route) ? route : null;
  }, [currentStep, state]);

  // Navigate to the current step's route whenever it changes (and isn't
  // paused / mid start-point-picking) — mirrors doc 4.6: use the app's
  // own router, and this is the only place the guide ever drives navigation.
  useEffect(() => {
    if (!state || state.paused || pickingStart) return;
    if (!resolvedRoute) return;
    if (pathname !== resolvedRoute) router.push(resolvedRoute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRoute, state?.paused, pickingStart]);

  const start = useCallback((workflowId: string, startPointId: string) => {
    const wf = getWorkflow(workflowId);
    if (!wf) return;
    const startPoint = wf.startPoints.find((p) => p.id === startPointId) ?? wf.startPoints[0];
    if (!startPoint) return;
    setState({
      userScopeKey,
      workflowId: wf.id,
      workflowVersion: wf.version,
      currentStepId: startPoint.firstStepId,
      completedStepIds: [],
      history: [startPoint.firstStepId],
      recordRefs: {},
      paused: false,
      startedAt: new Date().toISOString(),
    });
    setPickingStart(false);
    setPendingWorkflowId(null);
  }, [userScopeKey]);

  const pause = useCallback(() => setState((s) => (s ? { ...s, paused: true } : s)), []);
  const resume = useCallback(() => setState((s) => (s ? { ...s, paused: false } : s)), []);

  const previous = useCallback(() => {
    setState((s) => {
      if (!s || s.history.length <= 1) return s;
      const history = s.history.slice(0, -1);
      return { ...s, history, currentStepId: history[history.length - 1], paused: false };
    });
  }, []);

  // Shared by notifyCompletion, skip and choose: marks `stepId` done and
  // moves to `nextId` (undefined = the workflow's own goal — end it).
  const advanceTo = useCallback((wf: GuidedWorkflow, stepId: string, nextId: string | undefined, recordRefs: Record<string, string>) => {
    setState((s) => {
      if (!s) return s;
      const completedStepIds = s.completedStepIds.includes(stepId) ? s.completedStepIds : [...s.completedStepIds, stepId];
      if (!nextId || !wf.steps.some((st) => st.id === nextId)) {
        clearGuideState();
        return null;
      }
      return { ...s, completedStepIds, recordRefs, currentStepId: nextId, history: [...s.history, nextId], paused: false };
    });
  }, []);

  const next = useCallback(() => {
    if (!workflow || !state) return;
    // Only when the current step is actually done — Next never skips an
    // incomplete business action (doc 1.5: "Next (only if the step permits it)").
    if (!state.completedStepIds.includes(state.currentStepId)) return;
    const step = workflow.steps.find((s) => s.id === state.currentStepId);
    if (!step) return;
    advanceTo(workflow, step.id, step.next, state.recordRefs);
  }, [workflow, state, advanceTo]);

  const skip = useCallback(() => {
    if (!currentStep?.canSkip || !workflow || !state) return;
    advanceTo(workflow, currentStep.id, currentStep.next, state.recordRefs);
  }, [currentStep, workflow, state, advanceTo]);

  const choose = useCallback((nextStepId: string) => {
    if (!currentStep || currentStep.kind !== "choice" || !workflow || !state) return;
    const valid = currentStep.options?.some((o) => o.next === nextStepId);
    if (!valid) return;
    advanceTo(workflow, currentStep.id, nextStepId, state.recordRefs);
  }, [currentStep, workflow, state, advanceTo]);

  const changeStart = useCallback(() => {
    if (state) setPendingWorkflowId(state.workflowId);
    setPickingStart(true);
  }, [state]);

  const openPicker = useCallback((workflowId: string) => {
    setPendingWorkflowId(workflowId);
    setPickingStart(true);
  }, []);

  const closePicker = useCallback(() => {
    setPickingStart(false);
    setPendingWorkflowId(null);
  }, []);

  const end = useCallback(() => {
    setState(null);
    setPickingStart(false);
    setPendingWorkflowId(null);
    clearGuideState();
  }, []);

  // Returns whether an active guide step actually matched and advanced —
  // callers (the real create/save handlers) use this to skip their own
  // usual post-save navigation when the guide is about to take over and
  // navigate to the next step itself, so a save during an active guide
  // doesn't flash to the "normal" destination before the guide redirects.
  const notifyCompletion = useCallback(
    (eventName: string, payload?: { recordId?: string }): boolean => {
      // Matched against the live `state`, not a stale closure — this
      // function is recreated whenever `state` changes (see deps below),
      // so the check below always reflects the current step.
      if (!state || !workflow) return false;
      const step = workflow.steps.find((st) => st.id === state.currentStepId);
      if (!step || step.kind === "choice" || step.completionEvent !== eventName) return false;

      const recordRefs = step.producesRecord && payload?.recordId ? { ...state.recordRefs, [step.producesRecord]: payload.recordId } : state.recordRefs;
      advanceTo(workflow, step.id, step.next, recordRefs);
      return true;
    },
    [state, workflow, advanceTo]
  );

  const value: GuideContextValue = {
    state,
    workflow,
    currentStep,
    resolvedRoute,
    start,
    pause,
    resume,
    previous,
    next,
    skip,
    choose,
    changeStart,
    end,
    notifyCompletion,
    pickingStart,
    pickingWorkflowId: pendingWorkflowId ?? state?.workflowId ?? null,
    openPicker,
    closePicker,
  };

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}
