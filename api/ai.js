// ============================================================
// ComplianceHub — AI proxy (Vercel serverless function)
// Path: /api/ai.js  →  callable at https://your-domain/api/ai
//
// Keeps the AI provider key server-side only. The frontend
// (index.html) never sees it — it just POSTs { action, payload }
// to this endpoint and gets back { text } or { error }.
//
// Requires an environment variable set in Vercel:
//   ANTHROPIC_API_KEY = sk-ant-...
// (Settings → Environment Variables → Production+Preview)
//
// All prompts below are written to be industry-neutral —
// nothing here assumes marine/food-safety/HSE specifically.
// ============================================================

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AI not configured. Set ANTHROPIC_API_KEY in Vercel project settings." });
    return;
  }

  const { action, payload } = req.body || {};

  const prompts = {
    // ---- 1. AI Form Generator ----
    generate_template: (p) => `You are digitizing a paper compliance/inspection/audit checklist for use in a general-purpose inspection platform. The checklist could be from ANY industry — manufacturing, healthcare, hospitality, retail, construction, marine, logistics, education, etc. Do not assume any specific industry.

Given the raw checklist text below, extract a structured JSON template.

Return ONLY valid JSON (no markdown fences, no explanation), in exactly this shape:
{"name": "string", "code": "string", "scoring_type": "checklist" or "scored", "sections": [{"title": "string", "items": [{"prompt": "string", "max_marks": number or null}]}]}

Rules:
- Use "scoring_type": "scored" only if the source text shows numeric marks/points/weights per item. Otherwise use "checklist".
- If scored: every item's max_marks must be a positive integer.
- If checklist: every item's max_marks must be null.
- Group items into logical sections based on the source document's own structure/headers.
- Keep item wording close to the original, just cleaned up for clarity and consistent phrasing.
- If no clear title/code is present in the source, infer a short reasonable one.

RAW CHECKLIST TEXT:
"""
${p.text}
"""`,

    // ---- 3. AI executive summary ----
    summarize_inspection: (p) => `Write a concise, professional 2-3 paragraph executive summary of this inspection/audit result, suitable for a manager or client report in any industry. Be factual and direct — do not invent details not present in the data. Do not use industry-specific jargon unless it appears in the data itself.

Template: ${p.templateName}
Location/site: ${p.siteName}
Score: ${p.score}%
${p.previousScore != null ? `Previous score at this site for this template: ${p.previousScore}%` : ""}
Findings (failed or under-scored items): ${JSON.stringify(p.findings)}`,

    // ---- 2. Photo-based defect detection ----
    analyze_photo: (p) => `You are assisting an inspector reviewing a photo attached to a failed/deficient checklist item titled: "${p.itemPrompt}".
In one or two sentences, describe what the photo appears to show that is relevant to this finding, in objective and factual language suitable to paste directly into an inspection finding note. If the photo doesn't clearly show a problem, say so plainly rather than guessing. Do not mention that you are an AI.`,

    // ---- 6. Smart corrective-action suggestions ----
    suggest_action: (p) => `An inspection found this issue:
Section: ${p.section}
Item: "${p.itemPrompt}"
Inspector's note: "${p.note || "none provided"}"

Suggest a brief, practical corrective action (1-2 sentences, plain language, applicable to any industry) and a realistic number of days to resolve it.

Return ONLY valid JSON, no markdown: {"action": "string", "days": number}`,

    // ---- 5. Natural-language assistant ----
    nl_query: (p) => `You are a compliance data assistant for an inspection platform used across many industries. Answer the user's question using ONLY the data provided below — do not invent facts. If the data doesn't contain enough information to answer, say so honestly and briefly suggest what data would help.

DATA:
${JSON.stringify(p.context)}

QUESTION: ${p.question}`,
  };

  const promptFn = prompts[action];
  if (!promptFn) {
    res.status(400).json({ error: "Unknown action: " + action });
    return;
  }

  const isVision = action === "analyze_photo";
  const messages = isVision
    ? [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: payload.mediaType || "image/jpeg", data: payload.imageBase64 } },
          { type: "text", text: promptFn(payload) },
        ],
      }]
    : [{ role: "user", content: promptFn(payload) }];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1024, messages }),
    });
    const data = await r.json();
    if (!r.ok) {
      res.status(500).json({ error: data.error?.message || "AI request failed" });
      return;
    }
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
