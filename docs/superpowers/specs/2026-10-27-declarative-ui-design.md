# Declarative UI with grounding

## Why

Adding a hand-built card per use case (products, plans, …) doesn't scale, and the user wants the agent to compose UI freely. Separately, qwen3.5:35b invents prices and stock claims when it has only search snippets (see findings, Round 3). The fix for both: the model composes cards from a small set of primitives, and every value-bearing string is checked against what tools actually returned before it reaches the user.

## Shape

- **`show_ui` tool** (model-called): `{ title, subtitle?, blocks[] }`. Blocks: `heading`, `text`, `stats`, `table`, `list`, `checklist`, `links`, `callout`. It replaces `show_products` and `show_plan`. Numbers sent where text is expected are stringified. Validation errors are returned with block paths (`/blocks/2/items/0/url`) so the model can retry once.
- **Data-rendered cards stay**: `weather_card` and `flight_list` are still produced deterministically from data tools by `render/registry.ts`.
- **Artifacts stay** for open-ended pages and PDFs.

## Grounding (option A)

- **Evidence** (`agent/src/grounding/evidence.ts`), one per chat session:
  - Fed with every non-`show_*` tool result (text plus `details.data` JSON) and every user message.
  - `show_*` output never counts as evidence.
- **Claims** checked:
  - Prices: currency symbol or code with a number, matched by value.
  - Ratings: `4.5 stars`, `4.5/5`, `out of 5`.
  - Stock phrases: in-stock vs out-of-stock family.
  - Links: host plus path, ignoring query and trailing slash. A bare homepage is OK if the host was seen.
  - Plain numbers (quantities, guests, temperatures) are not claims.
- **Cards** (`groundUi`):
  - Unbacked claims are listed in `widget.unverified`, and the renderer marks each occurrence with a dotted, amber "?" mark and a footer.
  - Links not found in evidence are removed, and `removedLinks` says how many.
- **Free text**: after each assistant message, unbacked claims are emitted as a `grounding_note` widget under the message. Each claim is noted at most once per run.
- **Prompt**: the model is told this check exists. It should say "price not listed" or link instead of estimating, and label any estimate it gives.

## Known limits

- Support is pool-level, not per item. "In stock" anywhere in the evidence backs any in-stock claim, and a price backs the same number anywhere. This catches invention, not misattribution.
- Derived numbers (totals, per-person costs) get flagged as unverified. That is accepted, since they are estimates.
- Streamed text can't be retracted, so free-text grounding is a note after the fact rather than an inline mark.
