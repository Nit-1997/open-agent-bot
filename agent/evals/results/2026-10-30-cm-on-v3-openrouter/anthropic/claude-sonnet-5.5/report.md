# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-on-v3 | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL FAIL pass pass | text_matches(pattern=°) x2 | 14.8 | 3.5 | 10.7 | $0.0297 | 10 | new |

Passed 2 of 4 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text
- cities-fanout run 2
  - text_matches(pattern=°): /°/ on reply text
