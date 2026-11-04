import type { Page } from "playwright";
import type { Source } from "../sources/types.js";

export type StayKind = "hotel" | "rental";

export type StayQuery = {
  location: string;
  checkin: string;
  checkout: string;
  nights: number;
  adults: number;
  rooms: number;
  currency: string;
  brands?: string[];
};

export type Stay = {
  title: string;
  url: string;
  image?: string;
  nightly?: number;
  total?: number;
  rating?: number;
  ratingScale?: 5 | 10;
  reviews?: number;
  kind?: string;
  area?: string;
  badge?: string;
  currency?: string;
  met?: string[];
};

export type SourceResult = {
  source: StaySource;
  url: string;
  status: "ok" | "blocked" | "failed" | "link";
  stays: Stay[];
  error?: string;
};

export type OpenTab = (live: boolean) => Promise<{ page: Page; close: () => Promise<void> }>;

export type StayCtx = { openTab: OpenTab; live: boolean; allowPrivateHosts?: boolean };

export type StaySource = Source<StayQuery, SourceResult, StayCtx> & {
  label: string;
  site: string;
  lists: StayKind[];
  searchUrl: (q: StayQuery) => string;
  read?: (page: Page, q: StayQuery) => Promise<Stay[]>;
};
