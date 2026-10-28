export type WeatherData = {
  kind: "weather";
  mode: "forecast" | "typical";
  basis?: string;
  location: string;
  units: "metric" | "imperial";
  current?: { temp: number; condition: string };
  days: Array<{ date: string; high: number; low: number; condition: string; precipChance?: number }>;
  source: string;
};

export type FlightOption = { airline: string; departTime: string; arriveTime: string; duration: string; stops: number; price?: number; origin?: string };

export type AirportResult = {
  code: string;
  name?: string;
  miles?: number;
  ground?: number;
  bestFare?: number;
  total?: number;
  options: number;
  searchUrl: string;
  status: "ok" | "failed";
  closest?: boolean;
  cheapest?: boolean;
  recommended?: boolean;
};

export type FlightsData = {
  kind: "flights";
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  currency: string;
  options: FlightOption[];
  airports: AirportResult[];
  priceNote?: string;
  searchUrl: string;
  source: string;
};

export type ToolData = WeatherData | FlightsData;
