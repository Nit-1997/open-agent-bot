# First run: zero setup and a tap-first onboarding

Status: draft for review · 2026-10-30

## Why

A new user should run `docker compose up -d`, open the app, and be planning a trip or pricing a cart within about two minutes. Today they first copy four `.env` files, and the launcher asks four fixed questions (name, home, interest chips, model) whose answers live only in the browser. Open Agent is good at two things, travel and shopping, and the context that makes those sharp (who you plan for, what you eat, where you shop, how you like to travel) is never asked. Users end up repeating it in every chat.

This is also the first step toward auth, user profiles and a database: the profile moves to the agent now, so a later login only has to attach it to a user.

## Goals

- `docker compose up -d` works on a fresh clone with no `.env` file and no edits.
- Every secret is generated on first launch and kept on a volume; nothing secret is typed into a file.
- Every API key (chat providers, Jev, Brave) is added in the app.
- Onboarding is a short slideshow, mostly taps: You → Travel → Shopping → Jev → "Here's what I know". About a minute end to end; every section can be skipped.
- Suggestions are specific to where the user lives: nearby grocery stores, airlines from their airports, apps and shops for their country.
- The agent uses the answers in every chat without the user repeating them.
- The profile is stored by the agent and editable later, as a step toward per-user profiles.

## Non-goals

- Auth, accounts, multiple users. (Next project; this design must not block it.)
- A memory system that learns preferences from chats. (Later; the summary slide only promises "I'll offer to remember new things", so leave that line out until memory exists. Builder's call on wording.)
- Connecting Gmail, calendars or other accounts.
- Slides for events, cars or research. Those are learned in chat.

## Anti-goals (a failure even if it works)

- It feels like a long form or an interview. If a slide needs scrolling on a laptop, it has too much.
- A user picks a site expecting prices we can't fetch. Every travel site chip says whether we search it or only link to it.
- The full home address reaches an AI provider. Only city, region and country go into prompts.
- Setup breaks for someone who already has `.env` files. Existing files and variables keep working and override the generated defaults.

## Part 1: zero-setup launch

### What changes

- **Compose runs with no env files.** Every `env_file:` becomes optional (`required: false`), and every agent setting gets a default in `loadConfig`.
- **LiteLLM moves behind a compose profile** (`profiles: ["litellm"]`), like Ollama today. Without it the agent starts with no models and onboarding sends the user to add a provider. Anyone who wants the gateway turns it on with `COMPOSE_PROFILES=litellm`; with `LLM_API_KEY` set, the `litellm` provider appears as now.
- **There is no server default model** (decided with the user). `AGENT_MODEL` and the `chat-default` fallback are removed. The user picks a default model in onboarding, it is saved in their profile (`defaultModel`), and every chat without a per-chat choice uses it. `GET /models` reports the profile's choice as `default`. If no model is chosen yet, a run fails with "Pick a model in Settings → Models" rather than guessing. When auth arrives, this moves to the user's row with the rest of the profile.
- **Generated secrets**, created on first start and kept on volumes:
  - **Web↔agent shared secret.** The agent creates it (32 random bytes, owner-only) on a small `shared` volume mounted read-write in the agent and read-only in web. Both read it at startup. `AGENT_SHARED_SECRET` in the environment, if set, wins.
  - **SearXNG secret.** Generated once and kept on a volume. A small entrypoint wrapper exports it before SearXNG starts; `SEARXNG_SECRET` still overrides.
- **Keys in the app.** Chat providers already work this way. New:
  - **TypeSafe** joins the cloud provider list (API key only; pi already ships a `typesafe` provider) so Jev can run directly.
  - **Brave Search key** moves to a settings field (stored with the other keys). `BRAVE_SEARCH_API_KEY` still works.
- **Jev picks the provider the user has.** The judge resolver tries `typesafe/jev-latest`, then `openrouter/typesafe/jev-1.14`, and uses the first one with a key. `JEV_MODEL` still pins one.
- **Advanced settings stay environment-only, all optional:** `AGENT_MODEL_CAPS`, `JEV_CONCURRENCY`, `LOG_LEVEL`. They're documented in one reference table instead of the example files. Codemode needs a default without `AGENT_MODEL_CAPS`: Claude Sonnet models from any provider are tagged `codemode` by default (builder's call how).
- **README "Run"** becomes: install Docker, `docker compose up -d`, open http://localhost:3000. Ollama and LiteLLM become optional sections.

### Safety

- Ports stay bound to `127.0.0.1`, as now. There is no login yet, so the app is safe only on the user's own machine; the README says so plainly, and the onboarding doesn't change that.
- Keys and the profile live on the `agent-data` volume, owner-only, written atomically (`lib/files.ts`). No endpoint returns a key.
- The shared secret file is readable only by the agent and web container users.
- When auth arrives, the first-run screens become "create the admin account" before anything else. Out of scope here.

## Part 2: onboarding slideshow

The interactive mockup is the reference for layout and copy: `.superpowers/brainstorm/76606-1793383997/content/slideshow-v3.html` (open it in a browser). It follows the existing onboarding's look: glass frame, orb, eyebrow step counter, progress bar.

### Slides

Each slide has a title, a one-line reason for asking, its own **Skip this section**, Back/Next, and progress dots. Chips toggle on tap. Every chip row except single-choice rows has **+ add** for the user's own tag (free text, trimmed, short).

0. **Model** comes first if no provider is configured yet; otherwise it sits just before the summary (see below).
1. **You.** Name (optional). Home address with typeahead (below). Household: just me / married or partner / kids / pets / + add; choosing Kids reveals age bands (0–3, 4–8, 9–12, 13–17, multi-select). Food: no restrictions, vegetarian, vegan, halal, kosher, gluten-free, nut allergy, + add.
2. **Travel.** Style (budget / comfort / luxury, single). Airlines you prefer, suggested for the user's country and nearby airports, plus "no preference". Where you stay: hotels / vacation rentals / either. Hotel chains (optional, for loyalty). Sites you book on, each marked **searched** (we read prices there today: Google Flights, Airbnb, Booking.com, Google Hotels) or **linked** (we hand back a search link: Expedia, and any site without a reader).
3. **Shopping.** Spending style (save / balanced / treat myself, single). Groceries from: stores near the address. Other shopping: big retailers and online shops for the country. Delivery apps: Instacart, DoorDash, Uber Eats, Shipt, Amazon Fresh and so on for the country, plus none.
4. **Jev (optional).** Explains the measured gain: the right grocery item came first 86% of the time with Jev versus 62% without (ESCI grocery slice, `docs/findings.md`). Two key fields: OpenRouter (also unlocks chat models) or TypeSafe. **Skip, use without Jev** is a first-class choice. Keys are saved through the existing provider endpoints. Hidden if a Jev provider is already configured.
5. **Here's what I know.** The full summary, one editable line per section (tapping a line jumps back to that slide). Three starter requests built from the answers (for example "Weekend trip from SFO for the 3 of us", "Veggie taco night at Trader Joe's"). **Start chatting** saves the profile and drops the first starter into the composer if one was tapped.

**Model step (required, before the summary):** "Choose your model". If no provider is configured, it embeds the existing providers panel ("Add a model to start"); once one is, it shows the enabled models with their price notes and the user picks one. This is the only step that can't be skipped, because there is no server default. The header menu still switches per chat.

### Address typeahead

- From 3 characters, debounced (~250 ms), the web calls a new agent endpoint `GET /places?q=` which queries **Photon** (OpenStreetMap, no key) and returns up to 5 suggestions: label, city, region, country code, lat/lon.
- Picking one shows the detected line: city · currency · units · nearest airports (the agent already has an airport table and `nearbyAirports`).
- Free text that matches nothing is allowed; it's geocoded the way `home` is today.
- The request goes through the agent, so the browser talks only to our origin. The fair-use limit of the public Photon instance is fine for typeahead; the endpoint is behind the shared secret.

### Where suggestions come from

- **Grocery stores near you:** an Overpass (OpenStreetMap) query for supermarkets around the chosen lat/lon (radius ~10 km), grouped by brand and ranked by count; the top 6 become chips. If Overpass fails or is slow (>3 s), fall back to the country's curated list.
- **Everything else** (other shops, delivery apps, airlines, booking sites, hotel chains): a curated list per country in one data file in `shared/`, with a `*` fallback. Start with US, IN, GB and a generic list; adding a country is adding entries.
- **Searched or linked** is computed from the source registry (`agent/src/sources`), not hard-coded, so it stays true as readers are added.
- The web gets all of this from one agent endpoint, `GET /onboarding/options?lat=&lon=&country=`, which returns every chip row with its searched/linked flag. *(Builder check: my call.)*

### The profile

Stored by the agent, not the browser:

```
Profile {
  name?: string
  home?: { label: string; city: string; region?: string; country: string; lat: number; lon: number }
  household: { partner: boolean; kids: string[] /* age bands */; pets: string[]; other: string[] }
  food: string[]
  travel: { style?: "budget" | "comfort" | "luxury"; airlines: string[]; stays: ("hotel" | "rental")[]; hotelChains: string[]; sites: string[] }
  shopping: { style?: "save" | "balanced" | "treat"; groceries: string[]; retail: string[]; delivery: string[] }
  defaultModel?: string /* provider/model ref, chosen in onboarding; no server default */
  notes?: string /* free text; the drawer keeps it, the old profile's interests and notes migrate here */
  skipped: ("you" | "travel" | "shopping" | "jev")[]
  onboardedAt?: string
}
```

- A typebox schema in `shared/` validates it on both sides, with length and count caps.
- Saved in a `profile` table in the agent's SQLite file. There's one row now (key `default`); auth later adds a user id column. Endpoints `GET /profile` and `PUT /profile` sit behind the shared secret, and the web proxies them like `/providers`.
- **Migration:** on first load, if the agent has no profile and the browser has the old `open-agent.profile`, the web sends it up once (name and home text map across; interests and notes go into `notes`) and clears local storage. *(Builder check: my call.)*
- The profile drawer edits the same data, grouped like the slides.
- The agent reads the profile itself for each run. The browser no longer sends it in `user_context`. A profile that is sent in `user_context` still overrides the stored one for that run, because the eval harness (`agent/evals/run.ts`) sets `profile.home` per scenario. *(Builder check: my call.)*

### How the agent uses it

- **Prompt:** the existing "About the user" section becomes one short line per area, built from the profile. City, region and country only, never the street address. It stays labeled as background, not instructions.
- **Tool defaults, where simple:**
  - `shop` defaults to the user's grocery stores that have a reader, then the regional defaults.
  - `stays` uses the user's stay type and only the chosen searched sites unless asked otherwise.
  - Flights start from the user's nearby airports, and drive times use the stored lat/lon instead of geocoding text each session.
  - Airline and hotel-chain preferences go through the prompt (the flights tool has no airline filter today); hotel chains also become the stays brand wish when Jev is on.
- Food needs and household size go through the prompt. The existing grounding and tool rules are unchanged.

## Constraints

- Every HTML element gets a unique `id` (project rule), following the existing `onboarding-*` naming.
- Tests: profile schema and migration, the places endpoint (fake Photon), Overpass fallback, the prompt line builder (no street address), the generated-secret bootstrap, compose running with no env files (CI job: `docker compose config` with no env files present).
- Existing installs keep working: env files and variables override generated values, and the old local-storage profile is migrated.

## Left to the builder

- Exact copy beyond the mockup, animations, and how "+ add" tags are entered.
- The entrypoint mechanics for the SearXNG secret and how the codemode default is expressed.
- Curated list contents per country.
- Overpass query details and the radius.
- Whether the summary slide's line taps re-open a slide or edit inline.
