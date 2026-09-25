// Guided Workflows — client-side pause/resume state (doc section 5.3).
//
// Kept intentionally small: workflow id/version, current step id, which
// steps are completed, and the record ids a later step's route needs
// (e.g. the matrix id, so "Add manning line" can navigate straight back
// to the matrix that was just created). No full form values, no uploaded
// documents, no chat text — exactly what 5.3 says to keep out.
//
// Persisted to sessionStorage (survives a refresh, cleared when the tab
// closes) rather than a DB table — this is ephemeral UI-navigation state,
// not a business record, and nothing here is meaningful once the browser
// tab is gone. Scoped by userScopeKey (the signed-in user's email, passed
// down from the server-rendered shell) so switching accounts in the same
// tab can't resume someone else's in-progress guide.
export type GuideState = {
  userScopeKey: string;
  workflowId: string;
  workflowVersion: number;
  currentStepId: string;
  completedStepIds: string[];
  recordRefs: Record<string, string>;
  paused: boolean;
  startedAt: string;
};

const STORAGE_KEY = "ch-guide-state-v1";

export function loadGuideState(userScopeKey: string): GuideState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuideState;
    if (!parsed || typeof parsed !== "object") return null;
    // Different (or no) user than who saved this — never resume across
    // an account switch in the same tab.
    if (parsed.userScopeKey !== userScopeKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuideState(state: GuideState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / blocked storage — guide still works, just won't resume after a refresh */
  }
}

export function clearGuideState() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
