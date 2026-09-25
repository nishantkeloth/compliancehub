// Guided Workflows — Phase 1 vertical slice.
//
// A GuidedStep never carries a raw selector, script or arbitrary route —
// only a stable `targetId` (matched against a `data-guide-id` attribute
// already rendered by the real screen) and a `route` path that uses the
// app's own Next.js routes. Nothing here can point at an invented field:
// if `targetId` isn't actually on the page, GuideOverlay reports it as
// missing rather than guessing at a position. See app/crew/matrices for
// the reference on how a completion event is fired only after a real
// server action succeeds (never on click/input alone).
export type GuidedStep = {
  id: string;
  label: string;
  // Path this step's target lives on. Relative, no query string — the
  // guide only ever pushes routes the app itself defines.
  route: string;
  // Matches a `data-guide-id="<id>"` attribute on the real DOM node. An
  // array, not a single id, because one guided step often spans a
  // reveal-then-fill sequence on the same screen (e.g. open a tab, click
  // "+ Add", then Save) — authored earliest-element-first,
  // most-specific-element-last. GuideOverlay highlights the LAST id in
  // this list that's currently present in the DOM, so the highlight
  // tracks how far the user has actually gotten rather than assuming a
  // fixed layout or that earlier elements have unmounted.
  targetIds: string[];
  // Short instruction shown in the tooltip/shell. Kept as plain text (not
  // an instructionKey/i18n table) since this app has no i18n layer yet —
  // a real deployment with one would swap this for a lookup.
  instruction: string;
  // Optional longer "why" shown when the user asks "Why is this needed?"
  why?: string;
  // step ids that must be in `completed` before this step is reachable.
  prerequisites: string[];
  // The event name this step waits for (fired by notifyCompletion() from
  // the real component after its real server action returns success).
  // Advancement never happens on a bare click or route change.
  completionEvent: string;
  // When this step's completion fires with a record id in its payload,
  // store it under this key (e.g. "matrixId") so a later step's `route`
  // can reference it as "{matrixId}" — the only templating this engine
  // does; the id always comes from a real server action's own return
  // value, never guessed.
  producesRecord?: string;
  canSkip: boolean;
  onMissingTarget: "wait" | "recover" | "unsupported";
  // Shown when onMissingTarget is "unsupported" and the target truly isn't
  // reachable (e.g. the user lacks permission, so the real button never
  // rendered in the first place — the guide defers to that, it never
  // grants access itself).
  unsupportedMessage?: string;
};

export type StartPoint = {
  id: string;
  label: string;
  description: string;
  // Which step id this start point resumes from.
  firstStepId: string;
};

export type GuidedWorkflow = {
  id: string;
  version: number;
  title: string;
  // Goal milestone shown in the progress shell, e.g. "Draft matrix created".
  goal: string;
  startPoints: StartPoint[];
  steps: GuidedStep[];
};

// A small, allow-listed set of phrases that route a chat message to a
// workflow + start point WITHOUT any model call — see
// lib/guide/intent.ts. The AI/model is never asked to emit a route,
// selector or workflow id itself (doc section 5.2); this is the
// deterministic fallback the spec requires, used here as the only path
// for v1 rather than as a fallback.
export type GuideIntentMatch = {
  workflowId: string;
  startPointId: string;
};
