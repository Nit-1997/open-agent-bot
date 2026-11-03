import { KIDS_ANY, NO_AIRLINE, NO_DELIVERY, NO_FOOD_RULES, PETS_ANY } from "@oab/shared/onboarding";
import { homePlace } from "@oab/shared/profile";
import type { ProfileOverride } from "../prompt/userContext.js";

const list = (xs: string[] | undefined) => (xs ?? []).join(", ");
const part = (label: string, xs: string[] | undefined) => (xs?.length ? `${label} ${list(xs)}` : "");
const join = (parts: Array<string | false | undefined>) => parts.filter(Boolean).join("; ");

function household(p: ProfileOverride): string {
  const h = p.household;
  if (!h) return "";
  const bands = h.kids.filter((k) => k !== KIDS_ANY);
  const pets = h.pets.filter((x) => x !== PETS_ANY);
  return join([
    h.partner && "partner",
    h.kids.length > 0 && (bands.length ? `kids ${bands.join(", ")}` : "kids"),
    h.pets.length > 0 && (pets.length ? `pets: ${pets.join(", ").toLowerCase()}` : "pets"),
    ...h.other,
  ]);
}

export function profileLines(p: ProfileOverride): string[] {
  const t = p.travel;
  const s = p.shopping;
  const food = (p.food ?? []).filter((f) => f !== NO_FOOD_RULES);
  const lines: Array<[string, string]> = [
    ["Name", p.name ?? ""],
    ["Home", homePlace(p.home) ?? ""],
    ["Household", household(p)],
    ["Food", food.length ? list(food) : p.food?.includes(NO_FOOD_RULES) ? "no restrictions" : ""],
    [
      "Travel",
      t
        ? join([
            t.style,
            part(
              "airlines",
              t.airlines.filter((a) => a !== NO_AIRLINE),
            ),
            part(
              "stays",
              t.stays.map((x) => (x === "hotel" ? "hotels" : "vacation rentals")),
            ),
            part("hotel chains", t.hotelChains),
            part("books on", t.sites),
          ])
        : "",
    ],
    [
      "Shopping",
      s
        ? join([
            s.style && { save: "saves where they can", balanced: "balanced spender", treat: "likes to treat themselves" }[s.style],
            part("groceries from", s.groceries),
            part("also shops at", s.retail),
            part(
              "delivery apps",
              s.delivery.filter((d) => d !== NO_DELIVERY),
            ),
          ])
        : "",
    ],
    ["Notes", p.notes ?? ""],
  ];
  return lines.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`);
}
