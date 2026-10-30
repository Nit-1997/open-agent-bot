# Eval report: chat-default

label: followups-qwen | date: 2026-10-30 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| dining | FAIL | max_tool_calls(n=14); max_llm_turns(n=12); widget_matches(kind=ui, pattern=vegetarian\|veg); widget_matches(kind=ui, pattern=reserv\|OpenTable\|Resy\|Tock) | 24.0 (+1.5) | 25.0 | 116.0 (+76.7) | $0.0000 | 22060 (+16430) | same |
| store-domain | FAIL | max_tool_calls(n=3) | 4.0 (+0.5) | 3.0 | 15.9 (-4.6) | $0.0000 | 7735 (+5698) | same |

Passed 0 of 2 runs.

## Failures

- dining run 1
  - max_tool_calls(n=14): 24 calls, max 14
  - max_llm_turns(n=12): 25 llm turns, max 12
  - widget_matches(kind=ui, pattern=vegetarian|veg): /vegetarian|veg/ on 0 ui widget(s)
  - widget_matches(kind=ui, pattern=reserv|OpenTable|Resy|Tock): /reserv|OpenTable|Resy|Tock/ on 0 ui widget(s)
- store-domain run 1
  - max_tool_calls(n=3): 4 calls, max 3

## Future assertions (not counted)

- dining run 1
  - would fail: widget_present(kind=ui) (ui shown 0x; saw [grounding_note, followups])
  - would fail: widget_matches(kind=ui, pattern="type":"cards") (/"type":"cards"/ on 0 ui widget(s))
