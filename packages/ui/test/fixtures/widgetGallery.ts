import type { AskWidget, Cart, FlightList, GroundingNote, Plan, StayList, UiWidget, WeatherCard } from "@oab/shared/widgets";

const pick = (title: string, price: number, size?: string) => ({
  title,
  price,
  priceText: `$${price.toFixed(2)}`,
  url: `https://www.shipt.com/p/${encodeURIComponent(title)}`,
  image: `https://img.shipt.com/${encodeURIComponent(title)}.webp`,
  ...(size && { size }),
});

const weather: WeatherCard = {
  kind: "weather_card",
  location: "Pune, India",
  units: "metric",
  current: { temp: 28, condition: "Sunny" },
  days: [{ date: "2026-10-31", high: 31, low: 19, condition: "Clear", precipChance: 5 }],
  source: "https://open-meteo.com",
};

const flights: FlightList = {
  kind: "flight_list",
  from: "SFO",
  to: "BLR",
  date: "2026-12-15",
  currency: "USD",
  flights: [
    { airline: "Air India", departTime: "21:00", arriveTime: "04:30+2", duration: "20h 0m", stops: 0, price: 1100 },
    { airline: "United", departTime: "10:05", arriveTime: "23:55+1", duration: "24h 20m", stops: 1, price: 940 },
  ],
  searchUrl: "https://www.google.com/travel/flights?q=SFO+BLR",
  source: "Google Flights",
};

const card: UiWidget = {
  kind: "ui",
  title: "Diwali party for 25",
  subtitle: "Pune · Nov 8",
  blocks: [
    { type: "heading", text: "Budget" },
    {
      type: "stats",
      items: [
        { label: "Guests", value: "25" },
        { label: "Budget", value: "₹15,000", note: "your number" },
      ],
    },
  ],
};

const note: GroundingNote = { kind: "grounding_note", claims: ["$7.49", "In Stock"] };

const ask: AskWidget = {
  kind: "ask",
  question: "Which dates should I plan around?",
  fields: [
    { type: "date_range", label: "Travel dates", start: "2026-11-25", end: "2026-11-29" },
    { type: "number", label: "Travelers", value: 1, min: 1, max: 9 },
    { type: "choice", label: "Budget", options: ["Saver", "Comfort", "Splurge"], value: "Comfort" },
    { type: "text", label: "Flying from", value: "SJC" },
  ],
};

const stays: StayList = {
  kind: "stay_list",
  location: "Las Vegas",
  checkin: "2026-11-12",
  checkout: "2026-11-15",
  nights: 3,
  adults: 2,
  currency: "USD",
  sources: [
    {
      id: "google_hotels",
      label: "Google Hotels",
      site: "google.com",
      url: "https://www.google.com/travel/search?q=hotels",
      status: "ok",
      stays: [
        {
          title: "Bellagio",
          url: "https://www.google.com/travel/search?q=Bellagio",
          nightly: 131,
          total: 393,
          rating: 4.7,
          ratingScale: 5,
          reviews: 144300,
          kind: "5-star hotel",
          badge: "24% off usual",
        },
      ],
    },
    {
      id: "booking",
      label: "Booking.com",
      site: "booking.com",
      url: "https://www.booking.com/searchresults.html",
      status: "ok",
      stays: [
        { title: "Flamingo", url: "https://www.booking.com/hotel/us/flamingo.html", nightly: 98, total: 294, rating: 7.8, ratingScale: 10 },
      ],
    },
    { id: "airbnb", label: "Airbnb", site: "airbnb.com", url: "https://www.airbnb.com/s/Las%20Vegas/homes", status: "blocked", stays: [] },
    { id: "expedia", label: "Expedia", site: "expedia.com", url: "https://www.expedia.com/Hotel-Search", status: "link", stays: [] },
  ],
};

const event: Plan = {
  kind: "plan",
  entity: "event",
  id: "main",
  version: 1,
  value: {
    title: "8th birthday",
    date: "2026-11-14",
    guests: 12,
    budget: 300,
    currency: "USD",
    menu: ["pizza", "cake"],
    timeline: [{ when: "Day of", what: "Set up" }],
  },
};

const trip: Plan = {
  kind: "plan",
  entity: "trip",
  id: "trip",
  version: 2,
  value: {
    destination: "Tahoe",
    start: "2026-12-01",
    end: "2026-12-04",
    travelers: 2,
    stays: [{ name: "Lodge", url: "https://lodge.example/" }],
    days: [{ date: "2026-12-01", items: ["Ski"] }],
  },
};

const cart: Cart = {
  kind: "cart",
  stores: [
    {
      name: "Target (Shipt)",
      total: 4.37,
      url: "https://www.shipt.com/",
      missing: ["cilantro"],
      items: [
        { query: "rice", qty: 1, picks: [pick("Good & Gather Rice 32oz", 2.39, "32 oz"), pick("Instant Rice 14oz", 1.89)] },
        { query: "black beans", qty: 2, picks: [pick("Good & Gather Black Beans", 0.99)] },
        { query: "cilantro", qty: 1, picks: [] },
      ],
    },
    {
      name: "Safeway (Shipt)",
      total: 6.5,
      url: "https://www.shipt.com/",
      missing: [],
      items: [{ query: "rice", qty: 1, picks: [pick("Signature Rice 2 lb", 3.5)] }],
    },
  ],
};

export const WIDGET_GALLERY: ReadonlyArray<readonly [string, unknown]> = [
  ["weather", weather],
  ["flights", flights],
  ["ui", card],
  ["note", note],
  ["ask", ask],
  ["stays", stays],
  ["event", event],
  ["trip", trip],
  ["cart", cart],
];
