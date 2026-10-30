# Eval report: chat-default

label: final-router | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| car | FAIL | widget_matches(kind=ui, pattern=https?://); max_unverified_claims(n=2) | 2.0 (-3.5) | 2.0 | 21.6 (-56.5) | $0.0000 | 5089 (-7070) | same |
| dining | FAIL | max_tool_calls(n=14); max_llm_turns(n=12) | 42.0 (+19.5) | 43.0 | 244.4 (+205.1) | $0.0000 | 12074 (+6444) | same |
| events | FAIL | widget_matches(kind=ui, pattern="type":"cards"); widget_matches(kind=ui, pattern=kid\|famil\|child); widget_matches(kind=ui, pattern=free\|\$\d) | 8.0 | 5.0 | 51.5 | $0.0000 | 8847 | new |
| gifts | FAIL | widget_matches(kind=ui, pattern="type":"cards"); widget_matches(kind=ui, pattern=coffee\|cook\|kitchen\|chef\|brew); max_unverified_claims(n=2) | 1.0 | 2.0 | 18.3 | $0.0000 | 3993 | new |
| grocery-offlist | FAIL | must_call(tool=shop) | 0.0 (-1.5) | 1.0 | 4.0 (-17.7) | $0.0000 | 476 (-1972) | REGRESSION 2/2 -> 0/1 |
| hotel-brand | pass | - | 1.0 (-1.0) | 2.0 | 23.6 (-5.3) | $0.0000 | 4860 (-1463) | improved 0/2 -> 1/1 |
| india-shop | pass | - | 10.0 (+0.5) | 8.0 | 101.9 (+52.6) | $0.0000 | 34349 (+23180) | improved 1/2 -> 1/1 |
| party-followup | FAIL | error: turn 1 timed out after 420s; max_tool_calls(n=14) @turn 1; must_call(tool=shop) @turn 2; tool_arg_matches(tool=shop, pattern=qty) @turn 2; text_matches(pattern=16) @turn 2; max_unverified_claims(n=2) | 66.0 (+58.0) | n/a | 420.0 (+310.9) | n/a | n/a | same |
| party | pass | - | 7.0 (+4.5) | 8.0 | 98.4 (+71.7) | $0.0000 | 18657 (+17586) | improved 0/2 -> 1/1 |
| playlist | FAIL | widget_present(kind=ui); widget_matches(kind=ui, pattern=mzstatic\.com); widget_matches(kind=ui, pattern="image":"https?://) | 1.0 (-0.5) | 2.0 | 28.6 (+13.7) | $0.0000 | 4486 (+1691) | same |
| recipe-cart | FAIL | must_call(tool=shop); widget_present(kind=cart); tool_arg_matches(tool=shop, pattern=tortilla\|taco shell); tool_arg_matches(tool=shop, pattern=beef\|chicken\|pork\|turkey\|beans) | 1.0 (-70.0) | 2.0 | 37.5 (-173.7) | $0.0000 | 672 (+433) | same |
| research | FAIL | max_unverified_claims(n=5) | 11.0 | 7.0 | 117.7 (+33.8) | $0.0000 | 17388 (-1287) | REGRESSION 1/2 -> 0/1 |
| store-domain | FAIL | max_tool_calls(n=3) | 4.0 (+0.5) | 3.0 | 17.3 (-3.2) | $0.0000 | 1575 (-462) | same |
| trip | FAIL | widget_present(kind=ui) | 6.0 (+2.5) | 5.0 | 55.4 (+27.6) | $0.0000 | 14012 (+11610) | same |

Passed 3 of 14 runs.

## Failures

- car run 1
  - widget_matches(kind=ui, pattern=https?://): /https?:/// on 0 ui widget(s)
  - max_unverified_claims(n=2): 6 unverified, max 2
- dining run 1
  - max_tool_calls(n=14): 42 calls, max 14
  - max_llm_turns(n=12): 43 llm turns, max 12
- events run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=kid|famil|child): /kid|famil|child/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=free|\$\d): /free|\$\d/ on 0 ui widget(s)
- gifts run 1
  - widget_matches(kind=ui, pattern="type":"cards"): /"type":"cards"/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=coffee|cook|kitchen|chef|brew): /coffee|cook|kitchen|chef|brew/ on 0 ui widget(s)
  - max_unverified_claims(n=2): 10 unverified, max 2
- grocery-offlist run 1
  - must_call(tool=shop): shop called 0x
- party-followup run 1: turn 1 timed out after 420s
  - max_tool_calls(n=14) @turn 1: 66 calls, max 14
  - must_call(tool=shop) @turn 2: shop called 0x
  - tool_arg_matches(tool=shop, pattern=qty) @turn 2: /qty/ on 0 shop call(s)
  - text_matches(pattern=16) @turn 2: /16/ on reply text
  - max_unverified_claims(n=2): 4 unverified, max 2
- playlist run 1
  - widget_present(kind=ui): ui shown 0x; saw [grounding_note]
  - widget_matches(kind=ui, pattern=mzstatic\.com): /mzstatic\.com/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern="image":"https?://): /"image":"https?:/// on 0 ui widget(s)
- recipe-cart run 1
  - must_call(tool=shop): shop called 0x
  - widget_present(kind=cart): cart shown 0x; saw [ask]
  - tool_arg_matches(tool=shop, pattern=tortilla|taco shell): /tortilla|taco shell/ on 0 shop call(s)
  - tool_arg_matches(tool=shop, pattern=beef|chicken|pork|turkey|beans): /beef|chicken|pork|turkey|beans/ on 0 shop call(s)
- research run 1
  - max_unverified_claims(n=5): 8 unverified, max 5
- store-domain run 1
  - max_tool_calls(n=3): 4 calls, max 3
- trip run 1
  - widget_present(kind=ui): ui shown 0x; saw [ask, weather_card, stay_list]

## Future assertions (not counted)

- dining run 1
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [ui, followups])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- grocery-offlist run 1
  - would pass: text_matches(pattern=not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link) (/not (?:available|carried|offered)|can.t|cannot|doesn.t|no online|blocked|link/ on reply text)
- hotel-brand run 1
  - would pass: tool_arg_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays call(s))
  - would pass: tool_arg_matches(tool=stays, pattern=EUR) (/EUR/ on 1 stays call(s))
  - would pass: tool_result_matches(tool=stays, pattern=Marriott|Hyatt) (/Marriott|Hyatt/ on 1 stays result(s))
- party-followup run 1
  - would fail: must_call(tool=plan) @turn 2 (plan called 0x)
- party run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 0 load_skill call(s))
- research run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 0 load_skill call(s))
- trip run 1
  - would fail: tool_arg_matches(tool=load_skill, pattern=trip-planning) (/trip-planning/ on 0 load_skill call(s))
  - would pass: must_call(tool=plan) (plan called 1x)
