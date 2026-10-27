import type { UserContext } from "./systemPrompt.js";

export type Region = { country: string; currency: string };

const CURRENCY: Record<string, string> = {
  US: "USD", IN: "INR", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", SG: "SGD", AE: "AED", JP: "JPY", CH: "CHF", BR: "BRL", MX: "MXN",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR",
};

const US_ZONES = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Sitka|Nome|Yakutat|Metlakatla|Adak|Menominee|Indiana\/.*|Kentucky\/.*|North_Dakota\/.*)|Pacific\/Honolulu|US\/.*)$/;
const CA_ZONES = /^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Moncton|Whitehorse|Yellowknife|Iqaluit)$/;

const ZONE_COUNTRY: Record<string, string> = {
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN", "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Berlin": "DE",
  "Europe/Paris": "FR", "Europe/Madrid": "ES", "Europe/Rome": "IT", "Europe/Amsterdam": "NL", "Europe/Lisbon": "PT",
  "Europe/Brussels": "BE", "Europe/Vienna": "AT", "Europe/Helsinki": "FI", "Europe/Athens": "GR", "Europe/Zurich": "CH",
  "Asia/Singapore": "SG", "Asia/Dubai": "AE", "Asia/Tokyo": "JP", "Pacific/Auckland": "NZ", "America/Sao_Paulo": "BR",
  "America/Mexico_City": "MX",
};

function countryFromZone(tz: string): string | undefined {
  if (US_ZONES.test(tz)) return "US";
  if (CA_ZONES.test(tz)) return "CA";
  if (tz.startsWith("Australia/")) return "AU";
  return ZONE_COUNTRY[tz];
}

export function regionFor(ctx: UserContext | null): Region {
  const fromZone = ctx ? countryFromZone(ctx.timeZone) : undefined;
  const fromLocale = ctx?.locale.split(/[-_]/)[1]?.toUpperCase();
  const country = [fromZone, fromLocale].find((c): c is string => !!c && c in CURRENCY) ?? "US";
  return { country, currency: CURRENCY[country] };
}
