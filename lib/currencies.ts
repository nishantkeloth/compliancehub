// Currencies offered in drop-downs. The Gulf currencies and the ones AHM Marine
// bills in come first. A value already saved on a record that is not in this list
// is still shown (see currencyOptions), so nothing saved earlier is lost.

export const CURRENCIES: { code: string; name: string }[] = [
  { code: "AED", name: "UAE Dirham" },
  { code: "USD", name: "US Dollar" },
  { code: "SAR", name: "Saudi Riyal" },
  { code: "QAR", name: "Qatari Riyal" },
  { code: "KWD", name: "Kuwaiti Dinar" },
  { code: "BHD", name: "Bahraini Dinar" },
  { code: "OMR", name: "Omani Rial" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
  { code: "EGP", name: "Egyptian Pound" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "NOK", name: "Norwegian Krone" },
];

/** The drop-down options, plus the record's current value when it is not in the list. */
export function currencyOptions(current: string | null | undefined): { code: string; name: string }[] {
  const c = (current ?? "").trim();
  if (c && !CURRENCIES.some((x) => x.code === c.toUpperCase())) return [{ code: c, name: "Other" }, ...CURRENCIES];
  return CURRENCIES;
}
