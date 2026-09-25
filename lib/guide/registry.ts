import type { GuidedWorkflow } from "./types";

// Guided Workflows registry — Phase 1 vertical slice.
//
// This is the allow-listed source of truth the doc's section 5.1/5.2
// requires: workflow graphs, not a single hard-coded tour, and the ONLY
// place a workflow/step id is defined. The chat entry point (see
// lib/guide/intent.ts) can only ever resolve to a (workflowId,
// startPointId) pair that exists here — it never emits a route, selector
// or step definition itself.
//
// Coverage note (see the Phase 0 discovery report for the full picture):
// the New Crew Matrix screen's "Blank draft" mode always creates a brand
// new offshore site as part of creating the matrix — there is no way to
// pick an existing site there. So this workflow's "vessel/site" and
// "create the matrix" steps are genuinely the same screen in this app,
// not two — the guide reflects that honestly rather than pretending a
// separate site-picker step exists. Manning is defined afterward as a
// manning LINE on the matrix's own Lines tab (crew_matrix_lines), which is
// the real, always-reachable equivalent of "define the manning
// requirement" for a specific draft matrix. The site's own STANDING
// manning requirements (site_manning_requirements, used only by
// "Generate from manning requirements" mode) are a separate concept,
// covered by the second workflow below — see the discovery report for why
// that generate-mode is currently unreachable in practice.
export const CREW_MATRIX_FULL_WORKFLOW: GuidedWorkflow = {
  id: "crew-matrix-full",
  version: 1,
  title: "Create a crew matrix",
  goal: "Draft matrix created",
  startPoints: [
    { id: "contract", label: "Start from Client/Contract", description: "Create or choose a contract first.", firstStepId: "contract.create" },
    { id: "project", label: "Start from Project", description: "I already have a contract — create the project.", firstStepId: "project.create" },
    { id: "matrix", label: "Start from Crew Matrix", description: "I already have a project — create the draft matrix.", firstStepId: "matrix.create" },
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
    },
    {
      id: "matrix.create",
      label: "Create the draft crew matrix",
      route: "/crew/matrices/new",
      targetIds: ["matrix.mode.blank", "matrix.form.save"],
      instruction: "Blank draft mode is already selected. Choose the Project, give the new site a name, give the matrix a Title, then Create draft matrix.",
      why: "This creates a new offshore site together with the draft matrix in one step — there's no separate site-picker on this screen.",
      prerequisites: ["project.create"],
      completionEvent: "matrix.draft.created",
      producesRecord: "matrixId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage crew matrices, or no project exists yet.",
    },
    {
      id: "matrix.line.add",
      label: "Define the manning requirement",
      route: "/crew/matrices/{matrixId}",
      targetIds: ["matrix.tab.lines", "matrix.lines.add-button", "matrix.line.save"],
      instruction: "Open the Lines tab, click “+ Add manning line”, choose the role, set the headcount, then Save manning line.",
      why: "This is the matrix's actual manning demand — role and headcount — that positions get filled against.",
      prerequisites: ["matrix.create"],
      completionEvent: "matrix.line.added",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to edit this matrix, or it's no longer a draft.",
    },
  ],
};

// A second, independent workflow — deliberately kept small — to prove the
// framework is a real graph of reusable workflows rather than one
// hard-coded tour bolted to Crew Matrix. Covers the STANDING manning
// requirement on a site (Sites page), separate from a specific matrix's
// own lines above.
export const SITE_MANNING_SETUP_WORKFLOW: GuidedWorkflow = {
  id: "site-manning-setup",
  version: 1,
  title: "Set up a site's manning requirements",
  goal: "Manning requirements set",
  startPoints: [
    { id: "site", label: "Start from Vessel/Site", description: "Create the offshore site, then set its manning requirements.", firstStepId: "site.create" },
  ],
  steps: [
    {
      id: "site.create",
      label: "Create the offshore site",
      route: "/sites",
      targetIds: ["sites.new-button", "sites.form.save"],
      instruction: "Click “+ Add offshore site”, give it a name, then Save.",
      prerequisites: [],
      completionEvent: "site.saved",
      producesRecord: "siteId",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage crew setup data.",
    },
    {
      id: "site.manning.set",
      label: "Set its manning requirements",
      route: "/sites",
      targetIds: ["sites.manning-toggle:{siteId}", "sites.manning.set-button"],
      instruction: "Click “Manning requirements” on the site you just created, pick a role and minimum headcount, then Set requirement.",
      why: "A site's standing manning requirements are what “Generate from manning requirements” reads from when creating a matrix for that same, already-set-up site.",
      prerequisites: ["site.create"],
      completionEvent: "site.manning.set",
      canSkip: false,
      onMissingTarget: "unsupported",
      unsupportedMessage: "You don't have permission to manage crew setup data.",
    },
  ],
};

export const GUIDE_REGISTRY: Record<string, GuidedWorkflow> = {
  [CREW_MATRIX_FULL_WORKFLOW.id]: CREW_MATRIX_FULL_WORKFLOW,
  [SITE_MANNING_SETUP_WORKFLOW.id]: SITE_MANNING_SETUP_WORKFLOW,
};

export function getWorkflow(id: string): GuidedWorkflow | null {
  return GUIDE_REGISTRY[id] ?? null;
}

export function getStep(workflowId: string, stepId: string) {
  const wf = getWorkflow(workflowId);
  return wf?.steps.find((s) => s.id === stepId) ?? null;
}
