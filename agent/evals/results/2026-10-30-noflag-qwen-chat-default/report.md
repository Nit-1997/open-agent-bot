# Eval report: chat-default

label: noflag-qwen | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| store-domain | FAIL | text_matches(pattern=\$\d\|block\|couldn.t\|unable\|captcha) | 1.0 (-2.5) | 2.0 | 67.2 (+46.7) | $0.0000 | 12424 (+10387) | same |

Passed 0 of 1 runs.

## Failures

- store-domain run 1
  - text_matches(pattern=\$\d|block|couldn.t|unable|captcha): /\$\d|block|couldn.t|unable|captcha/ on reply text
