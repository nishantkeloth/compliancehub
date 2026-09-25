import type { GuidedWorkflow } from "./types";

// Guided Workflows registry.
//
// This is the allow-listed source of truth the doc's section 5.1/5.2
// requires: a step GRAPH (via each step's `next`), not a single
// hard-coded linear tour, and the ONLY place a workflow/step id is
// defined. The chat entry point (see lib/guide/intent.ts) can only ever
// resolve to a (workflowId, startPointId) pair that exists here — it
// never emits a route, selector or step definition itself.
//
// Coverage note (see the Phase 0 discovery report for the full picture
// on the app as a whole, and the Phase 15 discovery report addendum for
// this branch): the New Crew Matrix screen's "Blank draft" mode always
// creates a brand new offshore site as part of creating the matrix —
// there is no way to pick an existing site there. So this workflow's
// "vessel/site" and "create the matrix" steps are genuinely the same
// screen in this app for that mode, not two — the guide reflects that
// honestly rather than pretending a separate site-picker step exists.
//
// Crew matrix creation offers three real modes on one screen (Blank
// draft / Generate from manning requirements / AI Create from
// Documents); only two are wired into this workflow as a genuine
// branch (matrix.mode.choice). "Generate from manning requirements" is
// deliberately left out of the branch: as currently built it always
// pairs a brand-new, requirement-less site with the generate call, so it
// can never actually succeed (see the discovery report) — offering it
// here would be guiding the user into a dead end. The two branches that
// DO work:
//   - Blank draft → add the manning line yourself, then set that
//     line's requirements (matrix.create.blank → matrix.line.add →
//     matrix.line.requirements): manual, always available. The guide
//     doesn't stop at "role + headcount, Save" — matrix.line.add's own
//     instruction walks every field on that form (shift split,
//     rotation, employment/nationality/language preferences, minimum
//     experience, mobilization lead time, and especially the Client
//     approval required flag), and matrix.line.requirements is a
//     dedicated, skippable follow-on step for the line's required
//     documents/skills/competencies/client requirements — the actual
//     eligibility checks candidates get screened against later, not
//     just the headline role/headcount.
//   - AI Create from Documents (matrix.create.ai): upload/paste a
//     requirement, review the AI's proposed lines — resolve any
//     unmapped role/document/skill, tick every assumption and open
//     question — then save. Nothing is written until that review is
//     confirmed (AiGenerate's own proposal/save split already enforces
//     this; the guide just points at it). Converges on the same goal as
//     the manual path, since saving a generated proposal creates the
//     matrix AND its lines AND their requirements together in one step
//     — there's no separate "add a line"/"set requirements" step after
//     it.
// Both branches converge on an optional (skippable) "assign crew to a
// slot" continuation on the Staffing Plan tab, matching the spec's
// "show later stages as optional continuation" — the workflow's real
// goal, "Draft matrix created", is already reached before that point.
export const CREW_MATRIX_FULL_WORKFLOW: GuidedWorkflow = {
  id: "crew-matrix-full",
  version: 3,
  title: "Create a crew matrix",
  goal: "Draft matrix created",
  startPoints: [
    { id: "contract", label: "Start from Client/Contract", description: "Create or choose a contract first.", firstStepId: "contract.create" },
    { id: "project", label: "Start from Project", description: "I already have a contract — create the project.", firstStepId: "project.create" },
    { id: "matrix", label: "Start from Crew Matrix", description: "I already have a project — create the draft matrix.", firstStepId: "matrix.mode.choice" },
  ],
  steps: [
    {
      id: "contract.create",
      label: "Create the contract",
      route: "/contracts",
      targetIds: ["contracts.new-button", "contracts.form.save"],
      instruction: "Click “+ Add contract”, pick the Client, give it a title, then Save.",
      why: "Every project sits under a contract or work order — this is where that record starts.",
      prerequisites: [],
      completionEvent: "contract.saved",
      producesRecord: "contractId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage contracts, or a client needs to exist first (Clients).",
      next: "project.create",
    },
    {
      id: "project.create",
      label: "Create the project",
      route: "/projects",
      targetIds: ["projects.new-button", "projects.form.save"],
      instruction: "Click “+ Add project”, choose the Contract you just created, fill in the required fields (Country, Operating region, planned dates, Expected POB), then Save.",
      why: "The crew matrix you're heading toward is created under a project, not directly under a contract.",
      prerequisites: ["contract.create"],
      completionEvent: "project.saved",
      producesRecord: "projectId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage projects, or no contract exists yet.",
      next: "matrix.mode.choice",
    },
    {
      id: "matrix.mode.choice",
      label: "Choose how to build the matrix",
      route: "/crew/matrices/new",
      kind: "choice",
      instruction: "Fill in Project and give the new site a name first — both apply either way — then pick how to build it:",
      prerequisites: ["project.create"],
      canSkip: false,
      options: [
        { label: "Blank draft", description: "Add manning lines yourself afterward.", next: "matrix.create.blank" },
        { label: "✦ AI Create from Documents", description: "Upload or paste a requirement — review the AI's proposal before anything saves.", next: "matrix.create.ai" },
      ],
    },
    {
      id: "matrix.create.blank",
      label: "Create the draft crew matrix",
      route: "/crew/matrices/new",
      targetIds: ["matrix.mode.blank", "matrix.form.save"],
      instruction:
        "Blank draft mode is selected. Site type defaults to “vessel” — change it if this site is a rig/platform/barge/camp/FPSO/other. Title is required. Effective from/to and Expected POB come pre-filled from the project (confirm or adjust them); Notes is optional. Then Create draft matrix.",
      why: "This creates a new offshore site together with the draft matrix in one step — there's no separate site-picker on this screen. Effective dates and POB drive downstream compliance/readiness checks, so it's worth confirming them here rather than leaving the project's defaults unchecked.",
      prerequisites: ["matrix.mode.choice"],
      completionEvent: "matrix.draft.created",
      producesRecord: "matrixId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage crew matrices, or no project exists yet.",
      next: "matrix.line.add",
    },
    {
      id: "matrix.line.add",
      label: "Define the manning requirement",
      route: "/crew/matrices/{matrixId}",
      targetIds: ["matrix.tab.lines", "matrix.lines.add-button", "matrix.line.save"],
      instruction:
        "Open the Lines tab, click “+ Add manning line”. Job role is the only required field — but review every option on this form before saving, since these are what positions get matched and staffed against: Required headcount (defaults to 1), Day/Night/Other shift quantity split, Rotation template, Employment type / Nationality / Language preferences, Minimum experience (years), Mobilization lead time (days), the “Client approval required” flag (critical — determines whether an assigned candidate needs client sign-off before mobilizing), and Remarks. Then Save manning line.",
      why: "This is the matrix's actual manning demand. Headcount and role drive staffing; the rest — rotation, preferences, experience, lead time, and especially Client approval required — drive eligibility checks, mobilization timing, and approval routing later, so getting them right here avoids rework on every line added from scratch afterward.",
      prerequisites: ["matrix.create.blank"],
      completionEvent: "matrix.line.added",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to edit this matrix, or it's no longer a draft.",
      next: "matrix.line.requirements",
    },
    {
      id: "matrix.line.requirements",
      label: "Set this line's requirements",
      route: "/crew/matrices/{matrixId}",
      targetIds: ["matrix.tab.lines", "matrix.line.requirements-toggle", "matrix.line.skills.add-button"],
      instruction:
        "Optional but recommended: open “Requirements” on the manning line you just added. Required documents are usually pre-filled from the role's document template — check they're right (mandatory vs optional, waiver allowed, minimum remaining validity) or “Apply template” if none loaded. Add Required skills, and if this role needs them, Required competency grades and Client-specific requirements. Every one of these becomes a real eligibility check candidates get screened against on the Staffing Plan tab.",
      why: "A line with only a role and headcount looks complete but has no actual screening behind it — documents, skills, competencies and client requirements are what the app checks before letting someone be assigned or mobilized against this line.",
      prerequisites: ["matrix.line.add"],
      completionEvent: "matrix.line.requirements.set",
      canSkip: true,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to edit this matrix, or it's no longer a draft.",
      next: "staffing.assign",
    },
    {
      id: "matrix.create.ai",
      label: "Generate the matrix with AI",
      route: "/crew/matrices/new",
      targetIds: ["matrix.mode.ai", "matrix.ai.continue-button", "matrix.ai.choose-file-button", "matrix.ai.generate-button", "matrix.ai.save-button"],
      instruction:
        "Upload the client's manning document (or paste the text), then Generate draft with AI. Review what comes back: map or create any role/document/skill flagged in red, tick every assumption and open question, then Create draft matrix — nothing is saved until you do.",
      why: "AI extraction never silently creates an approved record — this is a proposal you review and correct first, same as the spec requires.",
      prerequisites: ["matrix.mode.choice"],
      completionEvent: "matrix.ai.draft.created",
      producesRecord: "matrixId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "AI generation isn't enabled for this company (Settings → AI), or you don't have permission to manage crew matrices.",
      next: "staffing.assign",
    },
    {
      id: "staffing.assign",
      label: "Assign crew to a position",
      route: "/crew/matrices/{matrixId}",
      targetIds: ["matrix.tab.staffing", "matrix.staffing.assign-button"],
      instruction: "Optional next step: open the Staffing Plan tab, pick a candidate against a line, set a start date, then Assign.",
      why: "The draft matrix itself is already done — this just starts filling it. Compliance/eligibility checks on each candidate are the app's own, not something this guide adds.",
      prerequisites: ["matrix.line.requirements", "matrix.create.ai"],
      completionEvent: "matrix.staffing.assigned",
      canSkip: true,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to edit this matrix's roster, or it's no longer a draft.",
    },
  ],
};

// The standalone "Set up a site's manning requirements" workflow (Sites
// page) was removed at the user's request — sites are only ever created
// as part of crew matrix creation now, and standing manning requirements
// on an existing site are a small enough edit that a separate guided
// tour for it wasn't wanted. Setting a site's manning requirements is
// still fully supported on the Sites page itself (see
// app/sites/sites-panel.tsx) — it's just not one of the guide's offered
// walkthroughs.

export const GUIDE_REGISTRY: Record<string, GuidedWorkflow> = {
  [CREW_MATRIX_FULL_WORKFLOW.id]: CREW_MATRIX_FULL_WORKFLOW,
};

export function getWorkflow(id: string): GuidedWorkflow | null {
  return GUIDE_REGISTRY[id] ?? null;
}

export function getStep(workflowId: string, stepId: string) {
  const wf = getWorkflow(workflowId);
  return wf?.steps.find((s) => s.id === stepId) ?? null;
}
