# Eval report: chat-sonnet-5.5

label: m1 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|
| grocery-offlist | pass pass | - | 2.0 (-1.5) | 24.2 (-7.4) | $0.0802 (-$0.0316) | 35729 (-14597) | same |
| india-shop | pass pass | - | 9.0 (+1.5) | 33.5 (+2.7) | $0.2270 (+$0.0025) | 101211 (+173) | same |
| party | pass pass | - | 5.0 | 90.6 (+20.1) | $0.2208 (+$0.0272) | 92288 (+9714) | same |
| recipe-cart | pass pass | - | 2.0 | 33.9 (+1.5) | $0.1240 (+$0.0021) | 57059 (+441) | same |

Passed 8 of 8 runs.

## Future assertions (not counted)

- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- grocery-offlist run 2
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- party run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
- party run 2
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
