# Eval report: chat-sonnet-5.5

label: m1-c64 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|
| party | pass FAIL | max_unverified_claims(n=2) x1 | 5.0 | 76.7 (+6.2) | $0.2132 (+$0.0196) | 90451 (+7877) | REGRESSION 2/2 -> 1/2 |
| recipe-cart | pass pass | - | 2.0 | 33.6 (+1.2) | $0.1209 (-$0.0010) | 56493 (-125) | same |

Passed 3 of 4 runs.

## Failures

- party run 2
  - max_unverified_claims(n=2): 4 unverified, max 2

## Future assertions (not counted)

- party run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
- party run 2
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
