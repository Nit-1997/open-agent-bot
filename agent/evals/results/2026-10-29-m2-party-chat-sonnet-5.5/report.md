# Eval report: chat-sonnet-5.5

label: m2-party | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| gifts | pass FAIL | widget_matches(kind=ui, pattern="type":"cards") x1; widget_matches(kind=ui, pattern=coffee\|cook\|kitchen\|chef\|brew) x1; max_unverified_claims(n=2) x1 | 4.5 | 5.0 | 42.9 | $0.1184 | 51711 | new |
| party-followup | FAIL FAIL | max_unverified_claims(n=2) x2 | 7.5 (+0.5) | 8.0 | 77.4 (-16.0) | $0.4380 (+$0.1527) | 196652 (+76381) | same |
| party | pass FAIL | widget_present(kind=cart) x1 | 5.0 | 5.0 | 69.1 (-1.4) | $0.1263 (-$0.0673) | 52578 (-29996) | REGRESSION 2/2 -> 1/2 |

Passed 2 of 6 runs.

## Failures

- gifts run 2
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=coffee|cook|kitchen|chef|brew): /coffee|cook|kitchen|chef|brew/ on 0 ui widget(s)
  - max_unverified_claims(n=2): 3 unverified, max 2
- party-followup run 1
  - max_unverified_claims(n=2): 3 unverified, max 2
- party-followup run 2
  - max_unverified_claims(n=2): 3 unverified, max 2
- party run 2
  - widget_present(kind=cart): cart shown 0x; saw [followups, ui, grounding_note]

## Future assertions (not counted)

- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party-followup run 2
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- party run 2
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
