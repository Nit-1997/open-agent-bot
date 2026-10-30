# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: cm-on-v2 | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| cities-fanout | FAIL pass FAIL FAIL | text_matches(pattern=°) x3 | 15.0 | 3.8 | 11.1 | $0.0322 | 10 | new |

Passed 1 of 4 runs.

## Failures

- cities-fanout run 1
  - text_matches(pattern=°): /°/ on reply text
- cities-fanout run 3
  - text_matches(pattern=°): /°/ on reply text
- cities-fanout run 4
  - text_matches(pattern=°): /°/ on reply text
