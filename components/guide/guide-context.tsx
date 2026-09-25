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
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getWorkflow } from "@/lib/guide/registry";
import { clearGuideState, loadGuideState, saveGuideState, type GuideState } from "@/lib/guide/state";
import type { GuidedStep, GuidedWorkflow } from "@/lib/guide/types";

function fillRoute(route: string, recordRefs: Record<string, string>): string {
  return route.replace(/\{(\w+)\}/g, (_, key: string) => recordRefs[key] ?? "");
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
  currentStepIndex: number;
  resolvedRoute: string | null;
  // Steps whose route already resolves (all record placeholders filled)
  // and whose prerequisites are complete — what the shell shows as
  // available vs. still-locked in the compact overview.
  start: (workflowId: string, startPointId: string) => void;
  pause: () => void;
  resume: () => void;
  previous: () => void;
  next: () => void;
  skip: () => void;
  changeStart: () => void;
  end: () => void;
  notifyCompletion: (eventName: string, payload?: { recordId?: string }) => boolean;
  // True while the start-point picker should be shown instead of the
  // running overlay (initial activation, or "Change starting point").
  pickingStart: boolean;
  // Which workflow the picker is choosing a start point for — set by
  // openPicker() (fresh activation) or changeStart() (mid-guide).
  pickingWorkflowId: string | null;
  // Fresh activation for a specific, already-known workflow (e.g. from an
  // assistant-panel "Guide me: <workflow title>" suggestion) — opens
  // straight to that workflow's start-point picker.
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
    if (!step) {
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
  const currentStepIndex = useMemo(
    () => (workflow && currentStep ? workflow.steps.findIndex((s) => s.id === currentStep.id) : -1),
    [workflow, currentStep]
  );
  const resolvedRoute = useMemo(() => {
    if (!currentStep || !state) return null;
    const route = fillRoute(currentStep.route, state.recordRefs);
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
      recordRefs: {},
      paused: false,
      startedAt: new Date().toISOString(),
    });
    setPickingStart(false);
    setPendingWorkflowId(null);
  }, [userScopeKey]);

  const pause = useCallback(() => setState((s) => (s ? { ...s, paused: true } : s)), []);
  const resume = useCallback(() => setState((s) => (s ? { ...s, paused: false } : s)), []);

  const goToStep = useCallback((stepId: string) => {
    setState((s) => (s ? { ...s, currentStepId: stepId, paused: false } : s));
  }, []);

  const previous = useCallback(() => {
    if (!workflow || currentStepIndex <= 0) return;
    goToStep(workflow.steps[currentStepIndex - 1].id);
  }, [workflow, currentStepIndex, goToStep]);

  const next = useCallback(() => {
    if (!workflow || !state || currentStepIndex < 0) return;
    // Only when the current step is actually done — Next never skips an
    // incomplete business action (doc 1.5: "Next (only if the step permits it)").
    if (!state.completedStepIds.includes(state.currentStepId)) return;
    if (currentStepIndex + 1 < workflow.steps.length) {
      goToStep(workflow.steps[currentStepIndex + 1].id);
    } else {
      // Reached the workflow's goal milestone.
      setState(null);
      clearGuideState();
    }
  }, [workflow, state, currentStepIndex, goToStep]);

  const skip = useCallback(() => {
    if (!currentStep?.canSkip) return;
    next();
  }, [currentStep, next]);

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
      if (!state) return false;
      const wf = getWorkflow(state.workflowId);
      const step = wf?.steps.find((st) => st.id === state.currentStepId);
      if (!wf || !step || step.completionEvent !== eventName) return false;

      setState((s) => {
        if (!s) return s;
        const completedStepIds = s.completedStepIds.includes(step.id) ? s.completedStepIds : [...s.completedStepIds, step.id];
        const recordRefs = step.producesRecord && payload?.recordId ? { ...s.recordRefs, [step.producesRecord]: payload.recordId } : s.recordRefs;
        const idx = wf.steps.findIndex((st) => st.id === step.id);
        const nextStep = wf.steps[idx + 1];
        if (!nextStep) {
          // Goal milestone reached — nothing left to advance to.
          clearGuideState();
          return null;
        }
        return { ...s, completedStepIds, recordRefs, currentStepId: nextStep.id, paused: false };
      });
      return true;
    },
    [state]
  );

  const value: GuideContextValue = {
    state,
    workflow,
    currentStep,
    currentStepIndex,
    resolvedRoute,
    start,
    pause,
    resume,
    previous,
    next,
    skip,
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
