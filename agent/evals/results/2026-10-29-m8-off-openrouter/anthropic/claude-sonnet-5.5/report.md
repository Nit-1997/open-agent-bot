# Eval report: openrouter/anthropic/claude-sonnet-5.5

label: m8-off | date: 2026-10-29 | baseline: baseline (2026-10-29)

| Scenario | Runs | Failed assertions | Tool calls | LLM turns | Seconds | Cost $ | Input tokens | vs baseline |
|---|---|---|---|---|---|---|---|---|
| research | pass | - | 7.0 (-6.0) | 4.0 | 27.6 (-25.3) | $0.0880 (-$0.2866) | 10 (-157574) | same |

Passed 1 of 1 runs.

## Future assertions (not counted)

- research run 1
  - would pass: tool_arg_matches(tool=load_skill, pattern=research) (/research/ on 1 load_skill call(s))
