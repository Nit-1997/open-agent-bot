# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m5-codemode | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| dining | pass | - | 6.0 (-1.0) | 5.0 | 14.3 (-8.8) | $0.0507 (-$0.1168) | 12 (-73585) | same |
| party | pass | - | 5.0 | 4.0 | 36.9 (-33.6) | $0.0742 (-$0.1194) | 10 (-82564) | same |

Passed 2 of 2 runs.

## Future assertions (not counted)

- dining run 1
  - would pass: widget_present(kind=ui) (ui shown 1x; saw [followups, ui])
  - would pass: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 1 ui widget(s))
- party run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=party-planning) (/party-planning/ on 1 load_skill call(s))
