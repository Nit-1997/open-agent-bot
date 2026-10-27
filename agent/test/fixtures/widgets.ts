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
    flights: [{ airline: "Air India", departTime: "21:00", arriveTime: "04:30+2", durationMin: 1200, stops: 0, price: 1100 }],
    searchUrl: "https://www.google.com/travel/flights?q=SFO+BLR",
    source: "Google Flights",
  },
  product_comparison: {
    kind: "product_comparison",
    query: "Sony WH-1000XM5",
    currency: "INR",
    rows: [
      { store: "Amazon.in", title: "Sony WH-1000XM5", price: 26990, availability: "in_stock", url: "https://amazon.in/x" },
      { store: "Flipkart", title: "Sony WH-1000XM5", availability: "blocked", url: "https://flipkart.com/x" },
    ],
  },
  plan_checklist: {
    kind: "plan_checklist",
    title: "Diwali party for 25",
    sections: [{ name: "Sweets", items: [{ label: "Kaju katli", quantity: "1.5 kg", url: "https://example.com" }] }],
  },
} as const;
