# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-on-1 | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL | text_matches(pattern=°) | 15.0 | 4.0 | 12.3 | $0.0270 | 10 | new |

Passed 0 of 1 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text
