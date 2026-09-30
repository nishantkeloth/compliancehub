// A fixed, alphabetical list of nationality demonyms (Indian, Egyptian, Sri
// Lankan, Filipino, etc.) for crew_profiles.nationality — a constrained
// dropdown instead of free text, same pattern as lib/countries.ts (used for
// the separate home_country field: a country NAME, not a demonym). A legacy
// or AI-extracted value that isn't in this list is never silently dropped —
// each call site keeps it selectable as an "(unmatched)" option.
//
// One entry per country in lib/countries.ts (196), using the demonym most
// commonly used in everyday HR/immigration usage rather than always the
// most formally "correct" one (e.g. "Argentinian" over "Argentine"). A
// handful of countries share an adjective in English (the two Congos, the
// Dominica/Dominican Republic pair) — disambiguated with a parenthetical
// so each stays a distinct, selectable option.
export const NATIONALITIES = [
  "Afghan", "Albanian", "Algerian", "American", "Andorran", "Angolan", "Antiguan",
  "Argentinian", "Armenian", "Australian", "Austrian", "Azerbaijani", "Bahamian", "Bahraini",
  "Bangladeshi", "Barbadian", "Basotho", "Belarusian", "Belgian", "Belizean", "Beninese",
  "Bhutanese", "Bissau-Guinean", "Bolivian", "Bosnian", "Botswanan", "Brazilian", "British",
  "Bruneian", "Bulgarian", "Burkinabe", "Burmese", "Burundian", "Cambodian", "Cameroonian",
  "Canadian", "Cape Verdean", "Central African", "Chadian", "Chilean", "Chinese", "Colombian",
  "Comoran", "Congolese (Congo-Brazzaville)", "Congolese (DR Congo)", "Costa Rican",
  "Croatian", "Cuban", "Cypriot", "Czech", "Danish", "Djiboutian", "Dominican (Dominica)",
  "Dominican (Dominican Republic)", "Dutch", "Ecuadorian", "Egyptian", "Emirati",
  "Equatorial Guinean", "Eritrean", "Estonian", "Ethiopian", "Fijian", "Filipino", "Finnish",
  "French", "Gabonese", "Gambian", "Georgian", "German", "Ghanaian", "Greek", "Grenadian",
  "Guatemalan", "Guinean", "Guyanese", "Haitian", "Honduran", "Hungarian", "I-Kiribati",
  "Icelandic", "Indian", "Indonesian", "Iranian", "Iraqi", "Irish", "Israeli", "Italian",
  "Ivorian", "Jamaican", "Japanese", "Jordanian", "Kazakhstani", "Kenyan", "Kittitian",
  "Kuwaiti", "Kyrgyzstani", "Lao", "Latvian", "Lebanese", "Liberian", "Libyan",
  "Liechtensteiner", "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malawian",
  "Malaysian", "Maldivian", "Malian", "Maltese", "Marshallese", "Mauritanian", "Mauritian",
  "Mexican", "Micronesian", "Moldovan", "Monegasque", "Mongolian", "Montenegrin", "Moroccan",
  "Mozambican", "Namibian", "Nauruan", "Nepali", "New Zealander", "Ni-Vanuatu", "Nicaraguan",
  "Nigerian", "Nigerien", "North Korean", "Norwegian", "Omani", "Pakistani", "Palauan",
  "Palestinian", "Panamanian", "Papua New Guinean", "Paraguayan", "Peruvian", "Polish",
  "Portuguese", "Qatari", "Romanian", "Russian", "Rwandan", "Saint Lucian", "Salvadoran",
  "Sammarinese", "Samoan", "Sao Tomean", "Saudi", "Senegalese", "Serbian", "Seychellois",
  "Sierra Leonean", "Singaporean", "Slovak", "Slovenian", "Solomon Islander", "Somali",
  "South African", "South Korean", "South Sudanese", "Spanish", "Sri Lankan", "Sudanese",
  "Surinamese", "Swazi", "Swedish", "Swiss", "Syrian", "Taiwanese", "Tajikistani",
  "Tanzanian", "Thai", "Timorese", "Togolese", "Tongan", "Trinidadian", "Tunisian", "Turkish",
  "Turkmen", "Tuvaluan", "Ugandan", "Ukrainian", "Uruguayan", "Uzbekistani", "Vatican",
  "Venezuelan", "Vietnamese", "Vincentian", "Yemeni", "Zambian", "Zimbabwean",
] as const;
