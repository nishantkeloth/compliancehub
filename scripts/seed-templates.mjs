/* ============================================================
   ComplianceHub — Template seed script
   Loads AHM MS 90 (checklist) and AHM MS 33 (scored /390)
   into your live Supabase database.

   Run from the project root:
     node --env-file=.env.local scripts/seed-templates.mjs

   Requires in .env.local:
     NEXT_PUBLIC_SUPABASE_URL=...
     SUPABASE_SERVICE_ROLE_KEY=...   (Settings → API → service_role)
   The service key bypasses RLS — it must NEVER be exposed to the
   browser or committed to git (.env.local is already gitignored).
   ============================================================ */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key);

/* ---------------- AHM MS 90 — tri-state checklist ---------------- */
const MS90 = [
  ["Health & Safety Management", [
    "HSE Evacuation Plan is available",
    "Risk Assessments available at the workplace",
    "Work Instructions available at the workplace",
    "Pre-works checklist completed (if required)",
    "Fire Emergency Plan posted",
    "Welfare facilities available at site",
    "Emergency exits and pathways clear and easily accessible",
    "Emergency contact information displayed",
  ]],
  ["Storage / Housekeeping", [
    "General neatness of working areas maintained",
    "Work areas free from slip/trip hazards",
    "Materials stored safely and securely",
    "Safe means of access for high shelves / racks",
    "Material stored in racks/bins",
    "Work areas free from rubbish and obstructions",
    "Racks free of rubbish and waste material",
  ]],
  ["Electrical Equipment / Works", [
    "Temporary electric wiring protected from damage by traffic",
    "External temporary electric boxes weatherproof",
    "Portable electrical equipment PAT tested",
    "Electrical tools in good condition, not damaged",
    "Cables and leads clear of access ways",
    "RCD/ELCB installed and earthing system available at site",
    "Competent electrician available at site",
    "No overloading of sockets",
    "Cable management available at site",
    "Plugs, sockets, switches not damaged",
    "Temporary outlet boxes properly mounted",
    "Cables and leads not frayed, cut or defective",
    "Cooking equipment cords and outlets in good condition",
  ]],
  ["HSE Training & Consultation", [
    "Induction training conducted for new employees",
    "Weekly toolbox talks completed",
    "Safety meetings held with staff",
    "Staff inducted and trained on work activities",
    "Fire drill training conducted",
    "Monthly internal training completed",
    "Any external training required identified",
  ]],
  ["First Aid Arrangement", [
    "First aid kit available and checked monthly",
    "First aiders appointed and details posted",
    "First aid kit as per OSHAD requirement",
    "First aid kit available and clean",
  ]],
  ["Manual Handling", [
    "Manual handling training conducted for staff",
    "Risk assessment for manual handling",
    "Lifting equipment provided (trolleys, lifts, etc.)",
  ]],
  ["Hygiene & Sanitation", [
    "Handwashing facilities stocked with soap, sanitizer, towels",
    "Employees practicing proper hygiene (uniforms, hairnets, gloves)",
    "Food handling per food safety guidelines and regulations",
    "Waste disposal practices in place",
    "Food preparation surfaces sanitized regularly",
  ]],
  ["Fire Extinguisher Safety", [
    "Extinguishers available at the site",
    "Extinguishers checked monthly",
    "Firefighting equipment serviced as per plan",
    "Fire evacuation muster points identified",
    "Fire exit doors unobstructed, access clear",
    "Emergency signage in place at site",
    "No-smoking areas identified and enforced",
    "Fire wardens trained and appointed",
  ]],
  ["Personal Protective Equipment", [
    "Correct PPE available and used at place of work",
    "PPE in good condition and usable for all employees",
    "Staff trained in use of PPE",
    "Storage and cleaning facilities for PPE",
    "PPE issued to staff and recorded",
    "Jewellery (necklaces, rings, etc.) avoided",
    "All workers have correct PPE at site",
  ]],
  ["Chemical & Hazardous Material Store", [
    "Relevant signage available in the store",
    "Chemicals labelled appropriately, MSDS available",
    "Proper housekeeping observed in store area",
    "Hazardous material stored properly in ventilated area",
    "MSDS available at workplace incl. chemical storage area",
  ]],
  ["Mechanical Devices & Cooking Equipment", [
    "Operators trained / licensed to operate equipment",
    "Serviced to manufacturer's specification",
    "Machine guards fitted where required",
    "Warning lights fitted where needed",
    "Fire extinguishers available at cooking area",
    "Emergency switch available",
    "Equipment placed at designated areas",
    "Operators have 3rd-party certification where needed",
    "No visible emissions (black smoke) from equipment",
  ]],
  ["Ladder / Access & Egress", [
    "Adequate ladders provided",
    "Properly secured at top and bottom",
    "Ladders inspected and maintained",
    "Metal ladders not used around electrical hazards",
    "Step ladders fully open with locking device",
    "Proper handrails on all temporary stairs",
  ]],
  ["Cooking Area", [
    "Floors clean, dry, free from hazards, not slippery",
    "Employees wearing appropriate PPE in cooking area",
    "Cooking appliances in proper working condition",
    "Waste bin available and disposed appropriately",
    "Electrical cords and outlets without wear or damage",
    "Cooking equipment and surfaces cleaned and sanitized",
    "Ventilation / chimney removing smoke, steam, odors",
    "Flammable materials stored away from heat sources",
  ]],
  ["Dining Area", [
    "Tables, chairs, furniture clean and well maintained",
    "Fire exits and escape routes marked and unobstructed",
    "Waste bins properly placed and regularly emptied",
    "Food storage/display organized, labelled, temperature controlled",
  ]],
];

/* ---------------- AHM MS 33 — scored audit (390 marks) ---------------- */
const MS33 = [
  ["Personal Hygiene", [
    ["Staff well groomed, wears PPE, min. 2 uniforms & safety shoes", 5],
    ["No staff with disease/infection or open wounds working", 2],
    ["Dressings / band-aids changed daily", 4],
    ["Staff washing & sanitising hands properly on re-entry / after toilets", 5],
  ]],
  ["Kitchen", [
    ["Raw vegetables/fruits washed properly before use", 2],
    ["Pulses/grains/rice cleaned and checked for foreign objects", 2],
    ["Colour-coded chopping boards used", 2],
    ["All colour-coded knives present (red/blue/green/yellow/white/brown)", 3],
    ["Salad vegetables disinfected at 100 PPM, sanitizing checklist used", 4],
    ["Staff trained in chlorine water prep; labelled container & spray bottle", 3],
    ["Chain mail gloves washed, sanitised, stored properly", 2],
    ["No food stored directly on the floor", 2],
    ["Food cooked above 75°C with records for every meal", 3],
    ["All foods always kept covered properly", 3],
    ["No food at room temperature over 30 minutes", 2],
    ["No hot food prepared more than 1 hr before service", 2],
    ["Salads prepared just in time, stored and served chilled", 3],
    ["Meat not out of chiller more than 20 minutes for marination", 2],
    ["Work tables cleaned and sanitized with chlorine sprays", 2],
    ["Bloated cans disposed; canned food transferred on opening", 2],
    ["Knives disinfected and stored properly after use", 2],
    ["Separate sanitation bucket for sponge cloths", 2],
    ["Blue sponge cloths in galley, no dirty dusters", 2],
    ["No extra cleaning equipment/chemicals stored in galley", 3],
    ["No signs of pests and flies", 2],
    ["Raw eggs not at room temperature over 30 minutes", 1],
    ["Exhaust hoods/filters cleaned weekly with records", 3],
    ["Garbage bins cleared and cleaned in time", 2],
    ["Fire blankets available", 2],
    ["Fire extinguishers available, accessible, checked", 2],
    ["All equipment in good working condition", 3],
    ["Tin cutters used and maintained clean", 3],
    ["Disposable gloves dispensed neatly, signage displayed", 2],
    ["Restricted entry signage on entrance door", 2],
    ["Probe thermometer used and functional", 3],
    ["Masala in clear lidded plastic containers", 3],
    ["Storage cabinets/racks clean after each shift", 2],
    ["Mise-en-place fridge racks, walls & gaskets clean", 2],
    ["No broken tiles in the galley", 3],
    ["Floor drains clean with detachable covers", 2],
    ["Grillers and hotplates cleaned regularly", 2],
    ["Pots and pans stored inverted or hanging", 2],
    ["Grills and drip pans cleaned once per shift", 2],
    ["Deep fat fryers drained/strained daily, covered", 3],
    ["Dishes and utensils washed and air dried", 2],
    ["Dry towels used to polish cutlery and crockery", 2],
    ["Galley staff aware of fire response", 2],
    ["Cups and glasses stored dry, stain-free, inverted", 2],
    ["Floors/walls/ceiling cleaned end of each shift", 2],
    ["Oven gloves available and cleaned regularly", 2],
    ["Separate plastic aprons for meat cutting & dishwashing", 2],
    ["Cleaning checklist displayed and signed", 2],
    ["Dishwasher at proper temperature with records", 2],
    ["Dishwasher trays cleaned and descaled", 2],
    ["Hair net dispenser available and replenished", 2],
    ["Separate handwash facility in galley with signage", 2],
    ["Paper towels available for hand drying", 2],
    ["Waste segregation (food/paper/plastic/tins) in galley", 2],
    ["Colour coding poster displayed prominently", 2],
    ["Separate tub/spray for cutting-board sanitization", 3],
  ]],
  ["Chiller", [
    ["Enough pallets for foodstuffs", 2],
    ["Foods on racks, not on the floor", 3],
    ["Proper thawing crates with drip trays per meat type", 2],
    ["Vegetables & fruits in clean plastic crates, no cartons", 3],
    ["Raw meats and ready-to-eat kept separate, covered, dated", 3],
    ["Separate marination containers, date marked", 2],
    ["Frozen foods thawed in chiller, defrosting log kept", 3],
    ["FEFO followed, all foods date marked with expiry", 2],
    ["Raw below cooked; poultry below other meat", 3],
    ["Eggs stored separately, no broken eggs", 2],
    ["Expired/spoiled foods disposed", 3],
    ["No food stored in garbage bags", 2],
    ["Temperature < 5°C, recorded 3–4×/day, chart displayed", 2],
    ["Containers, racks, walls, ceiling cleaned daily", 2],
    ["Emergency alarm working", 2],
    ["Cleaning schedule displayed and signed by CB", 2],
  ]],
  ["Freezer", [
    ["Enough pallets for foodstuffs", 3],
    ["Thawed foods not refrozen", 2],
    ["Frozen vegetables stored separately from meats", 2],
    ["All foods date marked with expiry dates", 2],
    ["Expired/spoiled foods disposed", 2],
    ["Foods on racks, not on the floor", 2],
    ["Different meats stored separately", 2],
    ["No food stored in garbage bags", 2],
    ["Food samples retained 72 hrs with logs", 2],
    ["Storage clean, defrosted regularly, well lit", 2],
    ["Emergency alarm working", 2],
    ["Cleaning schedule displayed and signed by CB", 2],
    ["Temperature at −18°C, recorded 3–4×/day, chart displayed", 2],
  ]],
  ["Dry Stores", [
    ["Enough pallets for foodstuffs", 2],
    ["FEFO followed, items date tagged", 2],
    ["Expired/spoiled foods disposed", 2],
    ["No signs of pests, roaches, flies", 2],
    ["No food stored in garbage bags", 2],
    ["Floor/walls/racks clean", 2],
    ["No food in cardboard boxes or cardboard rack lining", 2],
    ["Atta/maida/sugar covered, proper scoops provided", 2],
    ["Pulses/cereals in plastic jars or original packets", 2],
    ["No open packets kept in stores", 2],
    ["Cleaning checklist displayed, updated, signed by CB", 2],
  ]],
  ["Mess Room", [
    ["Tables disinfected with 100 PPM chlorine spray", 2],
    ["Refrigerated foods covered and date marked", 2],
    ["No signs of pests, roaches, flies", 2],
    ["No chipped or cracked crockery in use", 2],
    ["Bain-marie at 63°C, temperature log updated", 2],
    ["Yellow sponge cloths sanitized, stored in clean water", 2],
    ["Cold foods served below 5°C", 2],
    ["Furniture wiped down daily", 3],
    ["Drink dispenser cleaned daily, sanitized every 3 days", 2],
    ["Ice machine wiped daily, filter changed as needed", 2],
    ["Sauce bottles, salt & pepper shakers clean", 3],
    ["Area around tea/coffee machines clean", 2],
    ["Bain-marie clean, water changed frequently", 2],
    ["Floors/walls/ceiling clean at all times", 2],
    ["Cleaning schedule displayed and signed by CB", 2],
    ["Menu board available and updated", 2],
    ["Customer feedback register checked by CB", 2],
  ]],
  ["Chemical Stores", [
    ["PPE gloves/masks/safety glasses available", 2],
    ["Cleaning agents in original containers", 2],
    ["Updated MSDS for all cleaning agents", 2],
    ["Standard dilution chart available", 2],
    ["Cleaning schedule displayed and updated", 2],
  ]],
  ["Accommodation", [
    ["Toilets, basins, showers cleaned and disinfected daily", 2],
    ["Trash cans emptied daily, washed when required", 2],
    ["All beds made daily", 2],
    ["Beds changed on departure or every 7 days", 2],
    ["Rooms free from bed bugs and cockroaches", 2],
    ["Bridge & offices cleaned daily", 2],
    ["Stairways, corridors, handrails cleaned daily", 2],
    ["Linen & towels per POB, washed regularly", 2],
    ["Gym & recreation rooms cleaned daily", 2],
    ["All rooms swept and mopped daily", 2],
    ["Furniture wiped down daily", 2],
    ["Cleaning schedule displayed and updated", 2],
  ]],
  ["Laundry", [
    ["No kitchen dusters/oil rags in washing machines", 2],
    ["No kitchen dusters/oil rags in dryers", 2],
    ["Cool-down cycle before folding coveralls", 2],
    ["Sufficient washers & dryers in working condition", 2],
    ["Area & machines clean, schedule displayed", 2],
    ["Dryer filters cleaned after every cycle", 2],
    ["Updated MSDS for laundry cleaning agents", 2],
    ["Laundry man aware of fire response", 2],
    ["PPE used for filters and chemicals", 2],
    ["Dirty/clean segregated, checked for sharp items", 2],
    ["Detergent container kept covered", 2],
  ]],
  ["Staff Facilities / Changing Room", [
    ["Trash cans emptied daily, washed when required", 2],
    ["Floors swept and mopped daily", 2],
    ["Lockers wiped down, tops clear of debris", 2],
    ["Area maintained after each break", 2],
    ["Grease and finger marks removed daily", 2],
  ]],
  ["Common Toilets & Bathrooms", [
    ["Trash cans emptied daily, washed when required", 3],
    ["Basins, showers, bowls cleaned and disinfected", 2],
    ["Soap & paper towels replenished", 3],
    ["Cleaning schedule updated and displayed", 3],
  ]],
  ["QHSE Compliance", [
    ["Crew aware of drug/alcohol/mobile policy", 2],
    ["Quality of meals prepared by cook is good", 5],
    ["Performance of staff in current position", 5],
    ["Staff aware of emergency response and alarms", 3],
    ["Staff working 12 hrs/day, not overworked", 2],
    ["Food safety team formed, meeting regularly", 2],
    ["Allergens notification displayed", 2],
    ["Weekly/monthly menu followed", 2],
    ["Operation log book in use", 2],
    ["Crew aware of MLC compliance", 2],
    ["Crew aware of grievance addressal system", 2],
  ]],
  ["Documents", [
    ["Menu profile available with CB/chief cook", 2],
    ["Scope of service available with CB", 2],
    ["Meal sheet & visitor meal records up to date", 2],
    ["Slopchest stock and cash in hand tallied", 2],
    ["Company laptop & printer in good condition", 2],
    ["Responsibility matrix available with CB", 2],
    ["Receiving checklist up to date", 2],
    ["Medical records & training certificates onboard", 2],
    ["Incident reports, TBT records, hygiene audits maintained", 2],
  ]],
];

async function main() {
  // 1. Find (or create) the organization
  let { data: org } = await db
    .from("organizations").select("id").eq("name", "AHM Marine").maybeSingle();
  if (!org) {
    const { data, error } = await db
      .from("organizations").insert({ name: "AHM Marine" }).select("id").single();
    if (error) throw error;
    org = data;
    console.log("Created organization AHM Marine:", org.id);
  } else {
    console.log("Using organization AHM Marine:", org.id);
  }

  await seedTemplate({
    orgId: org.id, code: "AHM MS 90",
    name: "Monthly HSE Inspection Checklist",
    revision: "00", scoringType: "checklist", sections: MS90,
  });

  await seedTemplate({
    orgId: org.id, code: "AHM MS 33",
    name: "FSMS Audit Checklist",
    revision: "00", scoringType: "scored", sections: MS33,
  });

  console.log("\nSeed complete.");
}

async function seedTemplate({ orgId, code, name, revision, scoringType, sections }) {
  // Idempotent: skip if this template code+revision already exists
  const { data: existing } = await db
    .from("templates").select("id")
    .eq("org_id", orgId).eq("code", code).eq("revision", revision)
    .maybeSingle();
  if (existing) {
    console.log(`${code} already seeded — skipping.`);
    return;
  }

  const { data: tpl, error: tErr } = await db
    .from("templates")
    .insert({ org_id: orgId, code, name, revision, scoring_type: scoringType, status: "active" })
    .select("id").single();
  if (tErr) throw tErr;

  let itemCount = 0, markTotal = 0;
  for (let si = 0; si < sections.length; si++) {
    const [title, items] = sections[si];
    const { data: sec, error: sErr } = await db
      .from("template_sections")
      .insert({ template_id: tpl.id, title, sort_order: si })
      .select("id").single();
    if (sErr) throw sErr;

    const rows = items.map((it, ii) =>
      scoringType === "scored"
        ? { section_id: sec.id, prompt: it[0], sort_order: ii, max_marks: it[1], response_type: "score" }
        : { section_id: sec.id, prompt: it, sort_order: ii, response_type: "tri_state" }
    );
    const { error: iErr } = await db.from("template_items").insert(rows);
    if (iErr) throw iErr;

    itemCount += items.length;
    if (scoringType === "scored") markTotal += items.reduce((n, it) => n + it[1], 0);
  }

  console.log(
    `Seeded ${code}: ${sections.length} sections, ${itemCount} items` +
    (scoringType === "scored" ? `, ${markTotal} total marks` : "")
  );
}

main().catch((e) => { console.error("Seed failed:", e.message ?? e); process.exit(1); });
