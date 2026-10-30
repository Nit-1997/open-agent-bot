import type { Stay } from "../stays/types.js";
import type { FlightPrefs } from "../../../shared/flights.js";

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

export type FlightOption = {
  airline: string;
  departTime: string;
  arriveTime: string;
  duration: string;
  stops: number;
  layoverMinutes?: number;
  layoverAt?: string;
  price?: number;
  origin?: string;
};

export type AirportResult = {
  code: string;
  name?: string;
  miles?: number;
  driveMinutes?: number;
  rideOneWay?: number;
  status: "ok" | "failed";
  searchUrl: string;
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
  prefs: FlightPrefs;
  priceNote?: string;
  searchUrl: string;
  source: string;
};

export type StaysData = {
  kind: "stays";
  location: string;
  checkin: string;
  checkout: string;
  nights: number;
  adults: number;
  currency: string;
  maxNightly?: number;
  sources: Array<{ id: string; label: string; site: string; url: string; status: "ok" | "blocked" | "failed" | "link"; stays: Stay[] }>;
};

