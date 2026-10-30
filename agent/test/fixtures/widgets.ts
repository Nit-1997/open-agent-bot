export const validWidgets = {
  weather_card: {
    kind: "weather_card",
    location: "Pune, India",
    units: "metric",
    current: { temp: 28, condition: "Sunny" },
    days: [{ date: "2026-10-31", high: 31, low: 19, condition: "Clear", precipChance: 5 }],
    source: "https://open-meteo.com",
  },
  flight_list: {
    kind: "flight_list",
    from: "SFO",
    to: "BLR",
    date: "2026-12-15",
    currency: "USD",
    flights: [{ airline: "Air India", departTime: "21:00", arriveTime: "04:30+2", duration: "20h 0m", stops: 0, price: 1100 }],
    searchUrl: "https://www.google.com/travel/flights?q=SFO+BLR",
    source: "Google Flights",
  },
  ui: {
    kind: "ui",
    title: "Diwali party for 25",
    subtitle: "Pune · Nov 8",
    blocks: [
      { type: "heading", text: "Budget" },
      {
        type: "stats",
        items: [
          { label: "Guests", value: "25" },
          { label: "Budget", value: "₹15,000" },
        ],
      },
      { type: "table", columns: ["Item", "Qty"], rows: [["Kaju katli", "1.5 kg"]] },
      { type: "list", items: [{ title: "Diya set", value: "₹499", badge: "In stock", url: "https://amazon.in/x" }] },
      { type: "checklist", title: "Day before", items: [{ text: "Clean the house", note: "start early" }] },
      { type: "links", items: [{ label: "Amazon", url: "https://amazon.in/x" }] },
      { type: "callout", tone: "info", text: "Prices change often." },
      { type: "text", text: "Have fun!" },
    ],
  },
  grounding_note: { kind: "grounding_note", claims: ["$7.49"] },
} as const;
