// How the Visa Tracker dashboard groups a visa's state. The groups are the
// ones people act on, not the full list of states.

export type VisaGroup = "valid" | "expiring" | "awaiting" | "newvisa" | "expired" | "other";

export const VISA_GROUPS: { key: VisaGroup; label: string; color: string; onColor: string; textColor: string; pillBg: string }[] = [
  { key: "valid", label: "Valid", color: "#0ca30c", onColor: "#08210a", textColor: "#17803d", pillBg: "#e8f6ee" },
  { key: "expiring", label: "Expiring within 90 days", color: "#fab219", onColor: "#2b2000", textColor: "#8a5a00", pillBg: "#fff4dc" },
  { key: "awaiting", label: "Awaiting entry", color: "#2a78d6", onColor: "#ffffff", textColor: "#1c5cab", pillBg: "#e6effb" },
  { key: "newvisa", label: "Needs a new visa", color: "#ec835a", onColor: "#2e1004", textColor: "#b4410c", pillBg: "#ffe8dc" },
  { key: "expired", label: "Expired", color: "#d03b3b", onColor: "#ffffff", textColor: "#b3261e", pillBg: "#fbe5e3" },
  { key: "other", label: "Applied, cancelled or none", color: "#9aa3ad", onColor: "#1b2430", textColor: "#5d6b7c", pillBg: "#eaeef3" },
];

export function visaGroupOf(state: string): VisaGroup {
  switch (state) {
    case "valid":
      return "valid";
    case "expiring":
      return "expiring";
    case "awaiting_entry":
    case "enter_soon":
      return "awaiting";
    case "entry_missed":
    case "stay_ended":
      return "newvisa";
    case "expired":
      return "expired";
    default:
      return "other";
  }
}

/** States where the visa is finished (nothing more to do with it, short of a new visa). */
export function isPastState(state: string): boolean {
  return state === "expired" || state === "entry_missed" || state === "stay_ended" || state === "cancelled";
}
