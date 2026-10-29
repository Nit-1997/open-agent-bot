# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m4 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| india-shop | pass | - | 6.0 (-1.5) | 7.0 | 23.7 (-7.1) | $0.0527 (-$0.1718) | 16 (-101022) | same |
| store-domain | FAIL | text_matches(pattern=B&H\|bhphotovideo); text_matches(pattern=Newegg) | 2.0 (-6.0) | 3.0 | 7.2 (-21.9) | $0.0275 (-$0.1428) | 8 (-77229) | same |

Passed 1 of 2 runs.

## Failures

- store-domain run 1
  - text_matches(pattern=B&H|bhphotovideo): /B&H|bhphotovideo/ on reply text
  - text_matches(pattern=Newegg): /Newegg/ on reply text
