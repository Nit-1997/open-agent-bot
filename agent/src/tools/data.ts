export type WeatherData = {
  kind: "weather";
  location: string;
  units: "metric" | "imperial";
  current: { temp: number; condition: string };
  days: Array<{ date: string; high: number; low: number; condition: string; precipChance?: number }>;
  source: string;
};

export type FlightOption = { airline: string; departTime: string; arriveTime: string; duration: string; stops: number; price?: number };

export type FlightsData = {
  kind: "flights";
  from: string;
  to: string;
  date: string;
  currency: string;
  options: FlightOption[];
  searchUrl: string;
  source: string;
};

export type ToolData = WeatherData | FlightsData;
