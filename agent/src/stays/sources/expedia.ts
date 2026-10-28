import type { StaySource } from "../types.js";

export const expedia: StaySource = {
  id: "expedia",
  label: "Expedia",
  site: "expedia.com",
  lists: ["hotel", "rental"],
  searchUrl: (q) => {
    const u = new URL("https://www.expedia.com/Hotel-Search");
    u.searchParams.set("destination", q.location);
    u.searchParams.set("startDate", q.checkin);
    u.searchParams.set("endDate", q.checkout);
    u.searchParams.set("adults", String(q.adults));
    u.searchParams.set("rooms", String(q.rooms));
    return u.href;
  },
};
