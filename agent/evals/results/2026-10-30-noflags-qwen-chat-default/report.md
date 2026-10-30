# Eval report: chat-default

label: noflags-qwen | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| grocery-offlist | pass | - | 1.0 (-0.5) | 2.0 | 65.5 (+43.8) | $0.0000 | 15124 (+12676) | same |

Passed 1 of 1 runs.

## Future assertions (not counted)

- grocery-offlist run 1
  - would fail: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
