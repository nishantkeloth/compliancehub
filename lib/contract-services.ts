// The fixed set of services a contract's scope can cover — shared between
// app/contracts/contracts-manager.tsx (the create form's Service Scope
// checklist) and app/contracts/[id]/contract-detail.tsx (the Service Scope
// tab) so the two checklists can never drift apart. Also used server-side
// in app/contracts/actions.ts to validate incoming service keys before
// insert. Keep this in sync with the `service` check constraint on the
// contract_services table (supabase/migrations).
export const CONTRACT_SERVICE_OPTIONS = [
  { key: "catering", label: "Catering" },
  { key: "housekeeping", label: "Housekeeping" },
  { key: "laundry", label: "Laundry" },
  { key: "provision_supply", label: "Provision supply" },
  { key: "equipment_supply", label: "Equipment supply" },
  { key: "camp_management", label: "Camp management" },
  { key: "waste_management", label: "Waste management" },
  { key: "container_logistics_support", label: "Container/logistics support" },
  { key: "other", label: "Other" },
] as const;

export const CONTRACT_SERVICE_KEYS = new Set<string>(CONTRACT_SERVICE_OPTIONS.map((o) => o.key));
