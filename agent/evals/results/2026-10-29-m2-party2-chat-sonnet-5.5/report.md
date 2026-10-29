# Eval report: chat-sonnet-5.5

label: m2-party2 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| grocery-offlist | pass pass | - | 3.0 (-0.5) | 4.0 | 26.3 (-5.3) | $0.0855 (-$0.0263) | 38762 (-11564) | same |
| party-followup | FAIL pass | max_unverified_claims(n=2) x1 | 6.5 (-0.5) | 7.0 | 78.8 (-14.6) | $0.3234 (+$0.0381) | 142154 (+21883) | improved 0/2 -> 1/2 |
| party | pass pass | - | 4.0 (-1.0) | 4.0 | 42.6 (-27.9) | $0.1347 (-$0.0589) | 58185 (-24389) | same |
| recipe-cart | pass pass | - | 3.0 (+1.0) | 4.0 | 35.8 (+3.4) | $0.1208 (-$0.0011) | 55437 (-1181) | same |

Passed 7 of 8 runs.

## Failures

- party-followup run 1
  - max_unverified_claims(n=2): 5 unverified, max 2

## Future assertions (not counted)

- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- grocery-offlist run 2
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party-followup run 2
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- party run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
