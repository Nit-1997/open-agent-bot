import type { Page } from "playwright";
import type { Tile } from "../../shop/extract.js";
import type { Lookup } from "../../tools/net.js";
import type { Source } from "../types.js";

export type RetailQuery = { query: string };
export type RetailResult = { tiles: Tile[]; blocked?: string; error?: string };
export type WebHit = { title: string; url: string; snippet?: string };

export type RetailCtx = {
  page?: Page;
  allowPrivateHosts?: boolean;
  fetch?: typeof fetch;
  lookup?: Lookup;
  webSearch?: (query: string) => Promise<WebHit[]>;
  signal?: AbortSignal;
};

export type Store = {
  id: string;
  label: string;
  home: string;
  searchUrl?: (q: string) => string;
  marketplace?: boolean;
  groupSelector?: string;
  groupFromHref?: string;
  scrolls?: number;
  search?: (q: RetailQuery, ctx: RetailCtx) => Promise<RetailResult>;
};

export type RetailSource = Store &
  Source<RetailQuery, RetailResult, RetailCtx> & {
    domains: string[];
    aliases?: string[];
    note?: string;
  };
