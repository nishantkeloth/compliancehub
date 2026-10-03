// Visa types a person can travel on. Fixed for every organization; the
// Mobilization Tracks screen decides which steps apply to which visa.
export const VISA_TYPES = ["mission", "resident", "seaman", "visit"] as const;
export type VisaType = (typeof VISA_TYPES)[number];
export const VISA_LABEL: Record<string, string> = { mission: "Mission", resident: "Resident", seaman: "Seaman", visit: "Visit" };
