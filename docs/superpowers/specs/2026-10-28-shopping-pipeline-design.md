# Shopping pipeline and live browser view

## Why

Shopping answers today are built from search snippets and generic image search, so pictures are often wrong and prices are missing. The user's model of shopping, for any store: **turn the request into a set of products, search each one in the store's real catalog, re-rank, and show the best matches with the catalog's own photos, prices, and links.** Some stores have APIs, connectors, or MCP servers that make this faster; most of the time it means driving a browser. The user also wants to watch that browser work, the way Meta's Muse and ChatGPT agent stream their browser.

## Goals

- One pipeline for any shopping request: a single product, a comparison, a recipe cart, a gift list.
- Products shown come from a store's catalog as the browser saw it: title, price, photo, link, and size or rating when shown.
- Best value across stores (Target vs Amazon, or stores inside an aggregator like Shipt), with missing items stated.
- A live view of the agent's browser in the chat.

## Non-goals

- Signing in, adding to a real cart, checking out, or paying. Unchanged: the agent hands back links.
- Solving CAPTCHAs or evading bot checks. A blocked store is reported as blocked.
- Controlling the live browser from the UI (view-only).

## Anti-goals

- Generic web images standing in for products. A product card shows a catalog photo or none.
- The model clicking around a store for minutes. Searching and extraction are code; the model decides what to search and which match fits.

## Pipeline

1. **Plan (model).** Turn the request into products to find, each with a search query and quantity. For recipes, the model lists ingredients and drops pantry basics (salt, pepper, sugar, oil, water, common dried spices). Choose stores: the one the user named, else the user's usual stores, else two or three sensible ones for the category.
2. **Search (`shop` tool, code).** Input: `stores` (domains), `items` ([{query, qty?}], up to 12), optional `zip` (defaults to the profile's home ZIP). For each store and item, open the store's search page as a guest in the chat's browser tab and extract product tiles. Runs items for one store in sequence on one tab, and stores in parallel tabs (max 3).
3. **Extract (code).** One generic extractor, run in the page:
   - Each visible image of at least 70px, walking up to the smallest ancestor that has a price and a link, gives a tile: title (image alt or first long line), price, image URL, product URL, plus sponsored flag, size, and rating when the text has them.
   - Store adapters only add what can't be generic: the search URL template, how to set the ZIP, extra wait or scroll, and how to read the store name for aggregators (Shipt shows sections per store).
   - Adapters can also be API, connector, or MCP-backed instead of browser-backed, behind the same interface (`search(query, zip) → Product[]`). None in v1; the interface allows them.
4. **Re-rank (code).** Per item: keep tiles whose title matches the query's key words (the same matcher used for images), push sponsored results down, then prefer the closest size to the needed quantity, then the lowest price. The tool returns the top three per item per store, so the model can override a bad top pick.
5. **Best value (code).** Per store: items found, cart total from each item's top pick, and missing items. Ranked by most items found, then lowest total.
6. **Show (model).** A cards block for the winning store with catalog photos, prices, and product links. A stats or text line compares the other stores ("Safeway: +$3.20", "Sprouts: 2 items missing"). It ends with a link to the store and follow-up pills.
7. **Grounding.** Everything the tool returns is evidence, so catalog prices and photos pass, and anything else is marked or removed as today.

## Store list in v1

| Store | Status in spike | Notes |
|---|---|---|
| Shipt | 132 tiles with catalog photos | Aggregator: compare stores within it; read store name per section |
| Amazon | 77 tiles | Mark and down-rank "Sponsored" |
| Target | 0 tiles | Products load late; needs wait, scroll, or adapter work |
| Costco | 0 tiles | Same as Target |
| Best Buy | Timed out | Retry with longer timeout |
| Walmart | "Robot or human?" check | Reported as blocked; return the search link |
| Any other domain | — | Use the site's own search box (input with "search" in name, placeholder, or aria-label); extractor as above |

## Live browser view

- The agent starts Chrome's screencast (`Page.startScreencast` via Playwright's CDP session) on the chat's tab while a browse or shop call runs: JPEG, quality 60, max width 800, about 2 frames per second.
- Frames go to the UI as AG-UI `CUSTOM` events named `browser_frame` ({ url, title, frame: base64 }), throttled so slow connections drop frames rather than queue them.
- The UI shows a live panel inside the activity area while the agent browses: the frame, the current URL, and a "Browsing target.com" label. After the run it collapses to the last frame as a thumbnail you can expand.
- View-only. Frames are not stored and not sent to the model.

## Safety

- Guest browsing only, using the existing browse policy (no login, cart, checkout, payment pages).
- Store pages are untrusted data; extracted text is data, never instructions.
- Stop at a bot check; never retry around it.

## Known limits

- Store pages change; an extractor or adapter can break without notice. The tool reports "no products read" per store so the answer stays honest.
- Name matching can pick the wrong product (deli chicken instead of raw breast). Showing the matched title on each card makes that visible.
- Prices are guest prices for the default or chosen ZIP; member and in-store prices can differ.

## Left to the builder

- Exact extractor heuristics and per-store waits.
- Frame rate and size tuning.
- Whether the shop tool shares the chat's existing browse tab or opens extra tabs per store.
