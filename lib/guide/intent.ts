import type { GuideIntentMatch } from "./types";

// Deterministic chat-activation matching (doc section 5.2's "manual
// Guided workflows entry" — used here as the only path for v1, not a
// fallback). No model call, no free-text route/selector emission: a chat
// message either matches one of these fixed phrase+keyword pairs and
// resolves to an allow-listed (workflowId, startPointId), or it doesn't
// match at all and falls through to the normal assistant Q&A.
const TRIGGER_PHRASES = [
  /\bguide me\b/i,
  /\bwalk me through\b/i,
  /\bwalkthrough\b/i,
  /\bshow me how to\b/i,
  /\bstart the guided walkthrough\b/i,
];

type Rule = { keywords: RegExp[]; match: GuideIntentMatch };

const RULES: Rule[] = [
  {
    keywords: [/\bcontract\b/i],
    match: { workflowId: "crew-matrix-full", startPointId: "contract" },
  },
  {
    keywords: [/\bproject\b/i],
    match: { workflowId: "crew-matrix-full", startPointId: "project" },
  },
  {
    keywords: [/\bmanning requirement/i, /\bvessel\b/i, /\boffshore site\b/i, /\bsite\b/i],
    match: { workflowId: "site-manning-setup", startPointId: "site" },
  },
  {
    keywords: [/\bcrew matrix\b/i, /\bmatrix\b/i],
    match: { workflowId: "crew-matrix-full", startPointId: "matrix" },
  },
];

// Falls back to the fullest workflow (start from Contract) when the
// message clearly asks for guidance but names no specific entity — e.g.
// "guide me through the full crew matrix process".
const DEFAULT_MATCH: GuideIntentMatch = { workflowId: "crew-matrix-full", startPointId: "contract" };

export function matchGuideIntent(message: string): GuideIntentMatch | null {
  const text = message.trim();
  if (!text) return null;
  if (!TRIGGER_PHRASES.some((re) => re.test(text))) return null;

  for (const rule of RULES) {
    if (rule.keywords.some((re) => re.test(text))) return rule.match;
  }
  return DEFAULT_MATCH;
}
