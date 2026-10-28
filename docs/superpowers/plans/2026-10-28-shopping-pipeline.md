# Shopping Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `shop` tool that searches stores' real catalogs in the browser, re-ranks and compares stores, plus a live view of the agent's browser in the chat.

**Architecture:** Code does searching, extraction, ranking, and store comparison (`agent/src/shop/*`); the model plans items and composes the card. Browser frames stream as AG-UI CUSTOM events through a per-thread frame bus.

**Tech Stack:** Playwright (CDP screencast), Hono/AG-UI, Vitest (real Chromium for extractor tests), Next/React.

**Spec:** docs/superpowers/specs/2026-10-28-shopping-pipeline-design.md

## Global Constraints

- Guest browsing only; reuse `checkAction`/`isBlockedUrl`; never bypass bot checks.
- Products shown come from catalog tiles; generic image search never fills a product card from the shop tool.
- Unique `id` on every new HTML element; no unnecessary comments.
- Tool output is evidence (prices, images, links pass grounding).

## Review Focus

- A store that shows a bot check: reported as blocked with the search link, no retry.
- A search with zero matching tiles: "no products read" for that item, not an empty card.
- Sponsored tiles: never the top pick when an unsponsored match exists.
- Relative product URLs and lazy images (`data-src`, `srcset`) resolve to absolute http(s).
- Frames stop when the tool call ends or the run aborts (no leaked screencast).

---

### Task 1: Product tile extractor

**Files:** Create `agent/src/shop/extract.ts`; Test `agent/test/shop/extract.int.test.ts`

**Produces:** `type Tile = { title: string; price?: number; priceText?: string; image?: string; url: string; sponsored: boolean; size?: string; rating?: number; group?: string }`; `extractTiles(page: Page, opts?: { groupSelector?: string }): Promise<Tile[]>`.

- [ ] Test (real Chromium, `page.setContent` with a grid of 4 product cards: one sponsored, one with `data-src` lazy image and relative link, one with "4.5 out of 5 stars" and "15.5 oz", one banner image with no price): asserts 3 tiles, absolute URLs, `sponsored` true only on the ad, `price` 0.99 from "$0.99", `rating` 4.5, `size` "15.5 oz"; banner excluded.
- [ ] Implement: in-page walk from each image ≥ 70px (or width attr ≥ 70) up ≤ 8 ancestors to the smallest with a price and a link; title from alt (> 8 chars) else first long non-price line; `group` from the nearest preceding element matching `groupSelector` text.
- [ ] Commit.

### Task 2: Re-rank and best value

**Files:** Create `agent/src/shop/rank.ts`; Test `agent/test/shop/rank.test.ts`

**Consumes:** `Tile`, `matchingImage`'s key-word logic (export `keyWords` from webSearch.ts).
**Produces:** `rankTiles(query: string, tiles: Tile[]): Tile[]` (matches only; unsponsored first, then price); `bestValue(stores: StoreResult[]): StoreSummary[]` where `StoreResult = { store: string; items: Array<{ query: string; picks: Tile[] }> }` and `StoreSummary = { store; found; missing: string[]; total: number }` sorted by found desc, total asc.

- [ ] Tests: irrelevant titles dropped; sponsored match ranked after unsponsored; best value prefers more items found over a cheaper incomplete cart; total sums top picks × qty.
- [ ] Implement; commit.

### Task 3: Store adapters

**Files:** Create `agent/src/shop/stores.ts`; Test `agent/test/shop/stores.test.ts`

**Produces:** `type Store = { id: string; label: string; searchUrl?: (q: string) => string; groupSelector?: string; settleMs?: number }`; `storeFor(domainOrName: string): Store` (known: shipt, amazon, target, costco, bestbuy, walmart; else a generic store for the domain whose search uses the site's search box).

- [ ] Tests: "Target", "target.com", "www.target.com" map to the same adapter; search URL encodes the query; an unknown domain gets a generic adapter without `searchUrl`.
- [ ] Implement; commit.

### Task 4: `shop` tool

**Files:** Create `agent/src/tools/shop.ts`; Modify `agent/src/tools/browserPool.ts` (extra tabs per thread), `agent/src/tools/index.ts`; Test `agent/test/tools/shop.int.test.ts`

**Consumes:** Tasks 1–3. **Produces:** tool `shop({ stores: string[] (≤3), items: Array<{query, qty?}> (≤12) })` returning text per store (top 3 picks per item with price, size, image, link; missing items; blocked status) and a best-value summary; `details.data = { kind: "shop", stores, summary }`.

- [ ] Integration test with a local fixture store: URL-template store returns picks with absolute links and images; search-box store (generic) works; a CAPTCHA page reports blocked; an item with no matches is listed as missing.
- [ ] Implement: stores in parallel tabs (pool.extraPage), items sequential per store, per-page timeout 20s, policy checks on every navigation, budget group "shop": 2 per reply.
- [ ] Commit.

### Task 5: Frame bus and screencast

**Files:** Create `agent/src/browser/frames.ts`; Modify `browserPool.ts`, `browse.ts`, `shop.ts`, `server.ts`, `runHandler.ts`, `session/sessionStore.ts`; Tests `agent/test/browser/frames.test.ts`, `agent/test/agui/runHandler.test.ts`

**Produces:** `class FrameBus { publish(f: Frame); subscribe(cb): () => void }`, `Frame = { url: string; title: string; data: string }`; `watch(page, bus, opts) → stop()` (CDP `Page.startScreencast`, jpeg q60, maxWidth 800, throttle 500ms, acks frames); runHandler emits `{ type: CUSTOM, name: "browser_frame", value: Frame }`.

- [ ] Tests: bus throttles to one frame per interval and drops older ones; runHandler forwards bus frames as CUSTOM events during a run and unsubscribes after.
- [ ] Implement; commit.

### Task 6: Live browser panel (web)

**Files:** Create `web/components/chat/LiveBrowser.tsx`; Modify `ChatSession.tsx`, `TurnView.tsx`; Test `web/test/chat/liveBrowser.test.tsx`

- [ ] Tests: renders the frame image and host label while running; after the run shows a collapsed thumbnail that expands on click.
- [ ] Implement: `onCustomEvent` for `browser_frame` → latest frame per run, attached to the last turn; not persisted.
- [ ] Commit.

### Task 7: Prompt, labels, wiring, live verification

**Files:** `agent/src/prompt/systemPrompt.ts`, `web/lib/steps.ts`, tests.

- [ ] Prompt: shopping uses `shop` (plan items; recipes drop pantry basics; stores = named store, else 2–3 sensible ones); cards come only from shop picks; show best-value comparison; never generic images for products.
- [ ] Step label: "Shopped 6 items at Shipt, Amazon".
- [ ] Rebuild containers; live runs: Shipt burrito-bowl cart, Amazon headphones, Target single product; browser check of the live panel; commit.
