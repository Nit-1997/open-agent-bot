# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m5-m6-m8 | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| dining | pass | - | 8.0 (+1.0) | 7.0 | 18.6 (-4.5) | $0.0518 (-$0.1157) | 16 (-73581) | same |
| party-followup | pass | - | 8.0 (+1.0) | 7.0 | 42.3 (-51.1) | $0.2241 (-$0.0612) | 18 (-120253) | improved 0/2 -> 1/1 |
| party | FAIL | max_unverified_claims(n=2) | 5.0 | 5.0 | 44.5 (-26.0) | $0.0667 (-$0.1269) | 12 (-82562) | REGRESSION 2/2 -> 0/1 |
| research | FAIL | must_call(tool=create_artifact) | 3.0 (-10.0) | 4.0 | 67.5 (+14.6) | $0.0215 (-$0.3531) | 10 (-157574) | REGRESSION 2/2 -> 0/1 |

Passed 2 of 4 runs.

## Failures

- party run 1
  - max_unverified_claims(n=2): 3 unverified, max 2
- research run 1
  - must_call(tool=create_artifact): create_artifact called 0x

## Future assertions (not counted)

- dining run 1
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [followups, ui])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- party-followup run 1
  - would pass: must_call(tool=plan) @turn 2 (plan called 1x)
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
