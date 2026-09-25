"use client";

// Guided Workflows — GuideOverlay.
//
// Highlights the real DOM node for the active step's target (matched by
// `data-guide-id`, never a brittle nth-child/label-text selector — doc
// section 4.1), scrolls it into view, and anchors a short instruction
// near it with a pointing arrow. Never blocks the target itself or the
// app's normal Save button: the backdrop layer is pointer-events: none,
// only the highlight ring and tooltip box intercept clicks (and the ring
// is a hollow outline, not a filled box, so it never actually sits on
// top of the target either).
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useGuide } from "./guide-context";
import type { FieldTarget } from "@/lib/guide/types";

type Rect = { top: number; left: number; width: number; height: number };

// Same templating as guide-context's fillRoute, applied to targetIds too —
// a step whose data-guide-id is per-record (e.g. "sites.manning-toggle:{siteId}",
// so the guide highlights the specific site's own row rather than
// whichever one happens to render first) gets the real id substituted in
// from the workflow's recorded refs before querying the DOM.
function fillIds(targetIds: string[], recordRefs: Record<string, string>): string[] {
  return targetIds.map((id) => id.replace(/\{(\w+)\}/g, (_, key: string) => recordRefs[key] ?? ""));
}

// targetIds is authored earliest-UI-element-first, most-specific-element-
// last (e.g. [open a tab, open a form, the actual Save button]). Earlier
// elements (tab buttons, "+ Add" triggers) commonly stay mounted even
// after the user has moved past them, so this prefers the LAST id that's
// currently present rather than the first — the highlight tracks how far
// the user has actually gotten, not just what still happens to exist.
function findTarget(targetIds: string[]): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const id of targetIds) {
    const el = document.querySelector<HTMLElement>(`[data-guide-id="${id}"]`);
    if (el) found = el;
  }
  return found;
}

// A field's data-guide-id may sit on the fillable control itself or (more
// commonly here) on the <label> that wraps it — same tolerance as
// findTarget above. A single standalone checkbox/radio has no natural
// "empty" state (both checked and unchecked are legitimate answers), so
// those are always treated as already filled: a step shouldn't force a
// stop on a boolean flag, just mention it in the step's own instruction
// text. A CHECKBOX GROUP is different — more than one checkbox inside the
// matched element (e.g. a "Service scope" field wrapping a whole list of
// service checkboxes) is treated as "filled" once at least one of them is
// checked, since a group like that stands in for a single required
// selection even though no individual box is itself required. An element
// with no fillable control inside it at all (e.g. a field id accidentally
// pointed at a button) is likewise treated as filled, so it never blocks
// the walk.
function isFieldFilled(el: HTMLElement): boolean {
  const checkboxes = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  if (checkboxes.length > 1) return checkboxes.some((c) => c.checked);

  const control = (el.matches("input,select,textarea") ? el : el.querySelector("input,select,textarea")) as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;
  if (!control) return true;
  if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) return true;
  return control.value.trim().length > 0;
}

// Walks `fields` in order and returns the first one that's both present in
// the DOM and still empty — the field GuideOverlay should be spotlighting
// right now. A field not yet mounted (e.g. the form behind a "+ Add"
// button hasn't been opened yet) is skipped rather than treated as
// "empty", so the walk correctly stays on the reveal button (via the
// normal targetIds fallback) until the form actually exists. Returns null
// once every mounted field is filled, or there are no fields to walk —
// callers then fall back to the step's targetIds, which by that point is
// normally the Save/submit button.
function findActiveField(fields: FieldTarget[]): { field: FieldTarget; el: HTMLElement } | null {
  for (const field of fields) {
    const el = document.querySelector<HTMLElement>(`[data-guide-id="${field.id}"]`);
    if (!el) continue;
    if (!isFieldFilled(el)) return { field, el };
  }
  return null;
}

export default function GuideOverlay() {
  const { state, currentStep, resolvedRoute, pickingStart, pause, end } = useGuide();
  const pathname = usePathname();
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [activeField, setActiveField] = useState<FieldTarget | null>(null);
  const missingSinceRef = useRef<number | null>(null);

  // "choice"-kind steps have no DOM target at all — GuideShell renders
  // their options as buttons instead; nothing to highlight here.
  const active = !!state && !state.paused && !pickingStart && !!currentStep && currentStep.kind !== "choice" && resolvedRoute === pathname;

  useEffect(() => {
    if (!active || !currentStep) {
      setRect(null);
      setMissing(false);
      setActiveField(null);
      missingSinceRef.current = null;
      return;
    }

    let raf = 0;
    // Re-triggers the scroll-into-view when the active field itself
    // changes (moving from one field to the next should re-scroll, unlike
    // ordinary re-measures of the same target while typing).
    let scrolledFor: string | null = null;
    // Which of this step's fields the user has manually clicked/tabbed
    // back into, if any — takes priority over the forward "first empty"
    // walk below. Without this, clicking back into an earlier field to
    // fix something (e.g. a typo'd date) wouldn't move the highlight
    // there at all: that field already has SOME value, so the walk would
    // just keep spotlighting whatever it had already advanced to.
    // Cleared on focusing anything outside this step's fields, so the
    // walk resumes normally once the user moves on.
    let focusedFieldId: string | null = null;

    const onFocusIn = (e: FocusEvent) => {
      const fields = currentStep.fields;
      if (!fields?.length) return;
      const wrapper = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-guide-id]");
      const id = wrapper?.getAttribute("data-guide-id");
      const field = id ? fields.find((f) => f.id === id) : undefined;
      if (field) {
        focusedFieldId = field.id;
        measure();
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const fields = currentStep.fields;
      if (!fields?.length || !focusedFieldId) return;
      // relatedTarget is the element gaining focus. If it's still one of
      // this step's fields, that field's own focusin (which fires right
      // after) will take over — leave focusedFieldId as-is until then so
      // there's no flash back to the forward walk in between. Otherwise
      // (clicked away, or relatedTarget unavailable) release it now.
      const nextWrapper = (e.relatedTarget as HTMLElement | null)?.closest<HTMLElement>("[data-guide-id]");
      const nextId = nextWrapper?.getAttribute("data-guide-id");
      if (!nextId || !fields.some((f) => f.id === nextId)) {
        focusedFieldId = null;
        measure();
      }
    };

    const measure = () => {
      // Field-by-field walk takes priority: while any of this step's
      // fields is still empty, spotlight that field with its own
      // label/hint instead of the step's whole-form target. Falls through
      // to the normal targetIds behavior (below) once every field is
      // filled or the step defines none. A field the user has manually
      // focused (see onFocusIn/onFocusOut above) overrides this forward
      // walk for as long as focus stays there, even if it's already filled.
      const focusedField = focusedFieldId ? currentStep.fields?.find((f) => f.id === focusedFieldId) : undefined;
      const focusedEl = focusedField ? document.querySelector<HTMLElement>(`[data-guide-id="${focusedField.id}"]`) : null;
      const activeFieldMatch =
        focusedField && focusedEl ? { field: focusedField, el: focusedEl } : findActiveField(currentStep.fields ?? []);
      const el = activeFieldMatch ? activeFieldMatch.el : findTarget(fillIds(currentStep.targetIds ?? [], state?.recordRefs ?? {}));
      setActiveField(activeFieldMatch?.field ?? null);

      if (!el) {
        if (missingSinceRef.current == null) missingSinceRef.current = Date.now();
        // Give the route/tab a moment to finish rendering before treating
        // the target as genuinely absent (doc 4.5: wait for a dialog/tab
        // to mount rather than immediately reporting "unsupported").
        setMissing(Date.now() - missingSinceRef.current > 2500);
        setRect(null);
        return;
      }
      missingSinceRef.current = null;
      setMissing(false);
      const scrollKey = activeFieldMatch?.field.id ?? "__target__";
      if (scrolledFor !== scrollKey) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        scrolledFor = scrollKey;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };

    measure();
    const poll = window.setInterval(measure, 350);
    const onScrollResize = () => {
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    // focusin/focusout (unlike focus/blur) bubble, so a single listener on
    // document sees focus land on or leave any field without attaching
    // anything to the fields themselves.
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    const observer = new MutationObserver(() => measure());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      window.clearInterval(poll);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [active, currentStep]);

  if (!active || !currentStep) return null;

  if (missing) {
    // Accessible fallback instead of an arrow pointing at empty space
    // (doc 4.5 / acceptance test 9): a plain instruction card, no
    // highlight box, with an explicit way out.
    return (
      <div
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] max-w-sm rounded-xl border shadow-lg bg-white px-4 py-3 text-sm"
        style={{ borderColor: "var(--ch-fail)" }}
        role="status"
        aria-live="polite"
      >
        <div className="font-semibold mb-1" style={{ color: "var(--ch-fail)" }}>
          Can&rsquo;t find this step&rsquo;s control
        </div>
        <div style={{ color: "var(--ch-ink)" }}>
          {currentStep.unsupportedMessage ?? "This control isn't available right now."}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={pause} className="text-xs font-semibold ch-link-navy">Pause guide</button>
          <button onClick={end} className="text-xs font-semibold" style={{ color: "var(--ch-sub)" }}>End guide</button>
        </div>
      </div>
    );
  }

  if (!rect) return null;

  const pad = 6;
  const boxTop = rect.top - pad;
  const boxLeft = rect.left - pad;
  const boxWidth = rect.width + pad * 2;
  const boxHeight = rect.height + pad * 2;

  // Anchor the tooltip below the target by default; flip above when
  // there's not enough room below the viewport (doc 4.2: reposition near
  // viewport edges).
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const tooltipWidth = 300;
  const spaceBelow = viewportH - (boxTop + boxHeight);
  const placeAbove = spaceBelow < 140 && boxTop > 140;
  const tooltipTop = placeAbove ? boxTop - 8 : boxTop + boxHeight + 8;
  const tooltipLeft = Math.min(Math.max(boxLeft, 12), Math.max(viewportW - tooltipWidth - 12, 12));

  return (
    <>
      {/* Highlight ring — hollow, pointer-events none, sits above the page but never over the target */}
      <div
        aria-hidden
        className="fixed z-[65] rounded-lg pointer-events-none transition-[top,left,width,height] duration-150"
        style={{
          top: boxTop,
          left: boxLeft,
          width: boxWidth,
          height: boxHeight,
          boxShadow: "0 0 0 3px var(--ch-ai), 0 0 0 9999px rgba(15,23,42,0.35)",
        }}
      />
      <div
        role="status"
        aria-live="polite"
        className="fixed z-[70] w-[300px] rounded-xl border shadow-xl bg-white p-3.5 text-sm"
        style={{
          top: placeAbove ? undefined : tooltipTop,
          bottom: placeAbove ? viewportH - tooltipTop : undefined,
          left: tooltipLeft,
          borderColor: "var(--ch-line)",
        }}
      >
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[10px] font-mono font-bold rounded px-1.5 py-0.5" style={{ background: "var(--ch-navy)", color: "#fff" }}>
            ✦ GUIDE
          </span>
          <span className="text-xs font-semibold" style={{ color: "var(--ch-navy)" }}>{activeField ? activeField.label : currentStep.label}</span>
          {activeField && (
            <span className="text-[10px] font-semibold ml-auto" style={{ color: "var(--ch-sub)" }}>{currentStep.label}</span>
          )}
        </div>
        <p style={{ color: "var(--ch-ink)" }}>{activeField ? (activeField.hint ?? currentStep.instruction) : currentStep.instruction}</p>
        {/* The "why" collapsible is step-level context — only show it once
            the field-by-field walk has landed on the step's main target
            (usually Save), not while still stepping through individual
            fields, to keep each field's own stop short. */}
        {!activeField && currentStep.why && (
          <details className="mt-1.5">
            <summary className="text-xs font-semibold cursor-pointer" style={{ color: "var(--ch-sub)" }}>Why is this needed?</summary>
            <p className="text-xs mt-1" style={{ color: "var(--ch-sub)" }}>{currentStep.why}</p>
          </details>
        )}
      </div>
    </>
  );
}
