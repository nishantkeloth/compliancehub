"use client";

// Phase 11 — global conversational AI side panel ("Ask ComplianceHub").
// Mounted once in ShellChrome so it's reachable from every page. Chat
// history is plain component state — it resets on a full page navigation
// (ShellChrome itself isn't a persistent layout across every route, only
// within a few nested sections), which is an acceptable v1 trade-off: the
// alternative (persisting across navigation) would need lifting this into
// a route-independent provider, which isn't worth it until this is proven
// useful. No browser storage is used.

import { useRef, useState, useTransition, type FormEvent } from "react";
import { askAssistant, type AssistantMessage } from "./assistant/actions";
import { matchGuideIntent } from "@/lib/guide/intent";
import { getWorkflow } from "@/lib/guide/registry";
import { useGuideMaybe } from "@/components/guide/guide-context";
import type { GuideIntentMatch } from "@/lib/guide/types";

const SUGGESTIONS = [
  "How many Stewards do I have, and where are they assigned?",
  "Which crew have expired documents?",
  "List our offshore sites",
  "How many corrective actions are overdue?",
];

// Manual, deterministic "Guided workflows" entry point (doc section 5.2's
// fallback, used here as the primary path for v1 rather than a fallback
// — no model call is involved in reaching this proposal at all). Each of
// these is itself also a trigger phrase matchGuideIntent() recognizes, so
// typing the same wording works too.
const GUIDE_SUGGESTIONS: { label: string; match: GuideIntentMatch }[] = [
  { label: "🧭 Guide me through creating a crew matrix", match: { workflowId: "crew-matrix-full", startPointId: "contract" } },
];

export default function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const guide = useGuideMaybe();
  // Set only when the last user message matched a guide-trigger phrase —
  // renders as a proposal bubble with an explicit "Start guided
  // walkthrough" button. Merely discussing a process in chat (no match)
  // never sets this, so no overlay activates from ordinary conversation
  // (doc 1.2).
  const [guideProposal, setGuideProposal] = useState<GuideIntentMatch | null>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const proposeGuide = (question: string, match: GuideIntentMatch) => {
    setError(null);
    setGuideProposal(match);
    setMessages((cur) => [
      ...cur,
      { role: "user", content: question },
      { role: "assistant", content: `I can walk you through this step by step, highlighting each field on the real screens as we go. Ready to start from ${getWorkflow(match.workflowId)?.startPoints.find((p) => p.id === match.startPointId)?.label.replace(/^Start from /, "").toLowerCase() ?? "the beginning"}?` },
    ]);
    setInput("");
    scrollToBottom();
  };

  const send = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setGuideProposal(null);

    // Deterministic, model-free check first (doc 5.2: chat activation
    // never lets the model itself emit a route/selector — it either
    // matches this fixed allow-listed set or it doesn't match at all and
    // falls straight through to the normal Q&A assistant below).
    const match = matchGuideIntent(question);
    if (match) {
      proposeGuide(question, match);
      return;
    }

    setError(null);
    const next: AssistantMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    scrollToBottom();
    startTransition(async () => {
      const res = await askAssistant(next);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setMessages((cur) => [...cur, { role: "assistant", content: res.reply }]);
      scrollToBottom();
    });
  };

  const startGuide = () => {
    if (!guideProposal || !guide) return;
    guide.start(guideProposal.workflowId, guideProposal.startPointId);
    setGuideProposal(null);
    setOpen(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Ask ComplianceHub"}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white text-2xl font-bold"
        style={{ background: "linear-gradient(135deg, var(--ch-navy), var(--ch-ai))" }}
      >
        {open ? "✕" : "✦"}
      </button>

      {open && (
        <div
          className="fixed top-0 right-0 h-screen w-full sm:w-[380px] z-30 flex flex-col bg-white border-l shadow-2xl"
          style={{ borderColor: "var(--ch-line)" }}
        >
          <div className="px-4 py-4 border-b flex items-center gap-2" style={{ borderColor: "var(--ch-line)" }}>
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shrink-0"
              style={{ background: "linear-gradient(135deg, var(--ch-navy), var(--ch-ai))" }}
            >
              ✦
            </div>
            <div>
              <div className="text-sm font-extrabold" style={{ color: "var(--ch-navy)" }}>
                Ask ComplianceHub
              </div>
              <div className="text-[11px]" style={{ color: "var(--ch-sub)" }}>
                Contracts, crew, documents, sites & more
              </div>
            </div>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <div className="text-xs" style={{ color: "var(--ch-sub)" }}>
                  Ask things like:
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="block w-full text-left text-xs rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--ch-line)", color: "var(--ch-ink)" }}
                  >
                    {s}
                  </button>
                ))}
                <div className="text-xs pt-1" style={{ color: "var(--ch-sub)" }}>
                  Or get step-by-step help:
                </div>
                {GUIDE_SUGGESTIONS.map((g) => (
                  <button
                    key={g.label}
                    onClick={() => proposeGuide(g.label.replace(/^\S+\s/, ""), g.match)}
                    className="block w-full text-left text-xs font-semibold rounded-lg border px-3 py-2"
                    style={{ borderColor: "var(--ch-navy-soft)", background: "var(--ch-navy-soft)", color: "var(--ch-navy)" }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className="max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap"
                  style={
                    m.role === "user"
                      ? { background: "var(--ch-navy)", color: "#fff" }
                      : { background: "var(--ch-paper)", color: "var(--ch-ink)", border: "1px solid var(--ch-line)" }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {guideProposal && (
              <div className="flex justify-start">
                <button
                  onClick={startGuide}
                  className="text-sm font-semibold rounded-lg px-3.5 py-2 text-white flex items-center gap-1.5"
                  style={{ background: "linear-gradient(135deg, var(--ch-navy), var(--ch-ai))" }}
                >
                  <span className="font-mono">▶</span> Start guided walkthrough
                </button>
              </div>
            )}
            {pending && (
              <div className="flex justify-start">
                <div className="rounded-xl px-3 py-2 text-sm" style={{ background: "var(--ch-paper)", color: "var(--ch-sub)", border: "1px solid var(--ch-line)" }}>
                  Thinking…
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-xl px-3 py-2 text-xs" style={{ background: "var(--ch-fail-bg)", color: "var(--ch-fail)" }}>
                {error}
              </div>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t px-3 py-3 flex items-center gap-2" style={{ borderColor: "var(--ch-line)" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              disabled={pending}
              className="flex-1 text-sm rounded-lg border px-3 py-2 outline-none disabled:opacity-50"
              style={{ borderColor: "var(--ch-line)" }}
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="text-sm font-semibold rounded-lg px-3 py-2 text-white disabled:opacity-40"
              style={{ background: "var(--ch-navy)" }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
