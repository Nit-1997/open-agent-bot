import type { Judge } from "../../src/judge/index.js";

export const SOURCE_A = { url: "https://energy.example.org/heat-pumps", text: "Air-source heat pumps reach a COP of 3.2 in mild weather. A typical install costs $14,500 before incentives. The federal credit covers 30% of the cost." };
export const SOURCE_B = { url: "https://hvac.example.com/furnaces", text: "A gas furnace is 96% efficient (AFUE). A new furnace install costs $6,200 on average." };

export const REPORT = `<!doctype html><html><body>
<header class="hero"><h1>Heat pump or furnace</h1><p class="dek">A heat pump is the better choice for most mild-climate homes.</p></header>
<p>Heat pumps reach a COP of 5.0 in mild weather <a href="https://energy.example.org/heat-pumps">[1]</a>. A typical install costs $14,500 before incentives <a href="https://energy.example.org/heat-pumps">[1]</a>.</p>
<ul><li>A gas furnace is 96% efficient <a href="https://hvac.example.com/furnaces/">[2]</a>.</li></ul>
<table><tr><td>Furnace install</td><td>$6,200 <a href="https://hvac.example.com/furnaces">[2]</a></td></tr></table>
<ol class="sources"><li><a href="https://energy.example.org/heat-pumps">Energy</a></li><li><a href="https://hvac.example.com/furnaces">HVAC</a></li></ol>
</body></html>`;

const figures = (s: string) => s.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];

export function numberJudge(): Judge {
  return {
    available: true,
    score: async () => null,
    choose: async () => null,
    classify: async () => null,
    usage: () => ({ calls: 0, failures: 0, costUsd: 0 }),
    yesno: async (items, _c, o) =>
      items.map((it) => {
        const source = String(o?.batch?.shared.source ?? it.state.source);
        const yes = figures(String(it.state.claim)).every((n) => source.includes(n));
        return { id: it.id, yes, p: yes ? 0.9 : 0.1 };
      }),
  };
}

export const nullJudge: Judge = { ...numberJudge(), yesno: async () => null };
