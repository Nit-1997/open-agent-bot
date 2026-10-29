---
name: judging
description: Load when the codemode tool is available and the task needs math, currency conversion, budget totals, joining lists, or judging 10 or more items against requirements.
---

# Judging and math with codemode

Use codemode only when it replaces many reads or turns: exact arithmetic (totals, shares, currency conversion), joining or filtering lists from several tool calls, or judging 10+ items against requirements. For fewer than 10 items, judge from the tool results yourself.

Script rules:
- Scripts reach web_search, fetch_page, wikipedia, music, weather, shop, stays and flights. Nothing else (no show_ui, ask_user, create_artifact); do those yourself after the script.
- Run independent calls together with Promise.allSettled and skip the ones that failed.
- Return a short summary (the top picks with the numbers or reasons that matter, and counts like "ranked 14 of 16"), never raw lists. Then show the result with show_ui yourself.
- Set `// @options: {"max_output_tokens": 1500}` as the first line when you expect a lot of output.

Judging with models.classify:
1. Find the classifier once: `const jev = (await models.getAvailableOfType("classifier")).find((m) => m.id.includes("jev"))`. If there is none, skip judging and say so.
2. Make one classify call per item: `state` holds the item's facts (name, snippet, price, rating), `questions` holds the requirements. Several questions in one call are answered together.
3. Write each criterion with a means and a not, so near misses are told apart:
   - bool: `{ type: "bool", instructions: "Does it serve vegetarian mains?", criteria: { true: "means: a vegetarian menu or several vegetarian mains. not: a single side salad", false: "otherwise" } }`
   - score: `criteria` lists levels from lowest to highest, each as "means ... not ..."; `score` is the expected level index.
   - choice: `criteria` maps each label to what it means.
4. Thresholds: a bool counts as yes at probability 0.6 or more; a score passes at level 2 or more of 0-3; a choice needs confidence 0.6 or more. Keep items that clear every must-have, then order by score, then by rating.
5. Fallbacks: a result whose stopReason is not "stop" is a failed judgment. Leave that item out of the ranking and count it. If more than a third failed, or there is no classifier, keep the original order and tell the user the ranking was not checked against their requirements.

Example, "8 vegetarians, reservable":
```js
// @options: {"max_output_tokens": 1500}
const jev = (await models.getAvailableOfType("classifier")).find((m) => m.id.includes("jev"));
if (!jev) return "No classifier available: ranking not checked against the requirements.";
const found = await tools.web_search({ query: "best vegetarian friendly restaurants Austin group reservations", count: 15 });
const hits = found.split("\n\n").slice(0, 15);
const judged = await Promise.all(hits.map(async (hit) => {
  const r = await models.classify(jev, {
    state: { hit },
    questions: {
      veg: { type: "bool", instructions: "Is this a good place for vegetarians?", criteria: { true: "means: several vegetarian mains or a vegetarian menu. not: only a side salad", false: "no vegetarian focus" } },
      group: { type: "bool", instructions: "Can a group of 8 reserve a table?", criteria: { true: "means: reservations or large-party bookings are mentioned. not: walk-in only", false: "no mention of reservations, or walk-in only" } },
    },
  });
  return { hit, ok: r.stopReason === "stop", veg: r.answers?.veg?.probability ?? 0, group: r.answers?.group?.probability ?? 0 };
}));
const failed = judged.filter((j) => !j.ok).length;
if (failed > hits.length / 3) return `Ranking not checked: ${failed} of ${hits.length} judgments failed. Original order kept.\n` + hits.slice(0, 6).join("\n");
const top = judged.filter((j) => j.ok && j.veg >= 0.6 && j.group >= 0.6).sort((a, b) => b.veg + b.group - (a.veg + a.group)).slice(0, 6);
return `Ranked ${hits.length - failed} of ${hits.length}, ${top.length} meet both.\n` + top.map((j) => j.hit.split("\n").slice(0, 3).join(" | ")).join("\n");
```
If fewer than 3 clear both, say plainly that few places meet both, and show the closest with what each lacks.
