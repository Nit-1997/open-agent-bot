export const REPORT_FONTS =
  "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Instrument+Serif:ital@0;1&display=swap";

export const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #faf9f7; --paper: #ffffff; --surface: #f2f0ed; --border: #e5e3df; --border-strong: #d8d5cf;
  --ink: #111111; --ink-2: #555555; --ink-3: #888888;
  --mist-50: #eef3f4; --mist-100: #dce7e9; --mist-300: #a3bec3; --mist-500: #4d7f87; --mist-600: #36646c; --mist-900: #183a40;
  --good: #047857; --good-bg: #ecfdf5; --warn: #b45309; --warn-bg: #fffbeb; --bad: #dc2626; --bad-bg: #fef2f2;
  --serif: "Instrument Serif", Georgia, "Times New Roman", serif;
  --sans: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --radius: 16px;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; background: var(--bg); }
body { margin: 0 auto; max-width: 880px; padding: 40px 28px 72px; font: 16px/1.65 var(--sans); color: var(--ink); background: var(--bg); }
h1, h2 { font-family: var(--serif); font-weight: 400; letter-spacing: -0.01em; color: var(--ink); }
h1 { font-size: clamp(36px, 6vw, 56px); line-height: 1.04; margin: 8px 0 14px; }
h2 { font-size: clamp(26px, 4vw, 34px); line-height: 1.12; margin: 0 0 10px; }
h3 { font-size: 17px; line-height: 1.3; margin: 22px 0 6px; font-weight: 600; }
p, ul, ol { margin: 0 0 14px; }
li { margin: 5px 0; }
a { color: var(--mist-600); text-underline-offset: 3px; }
strong, b { font-weight: 600; }
img { max-width: 100%; height: auto; display: block; }
section { margin: 44px 0; }
section + section { padding-top: 36px; border-top: 1px solid var(--border); }

.eyebrow, .kicker { font: 600 12px/1.4 var(--sans); letter-spacing: 0.14em; text-transform: uppercase; color: var(--mist-600); margin: 0 0 8px; }
.dek { font-size: 20px; line-height: 1.5; color: var(--ink-2); margin: 0 0 22px; max-width: 46em; }
.muted, .note { color: var(--ink-3); font-size: 13px; }

.hero { margin: 0 0 32px; }
.hero > img, .hero figure img { width: 100%; max-height: 460px; object-fit: cover; border-radius: var(--radius); background: var(--surface); margin-top: 22px; }

figure { margin: 22px 0; }
figure img { width: 100%; border-radius: var(--radius); background: var(--surface); object-fit: cover; max-height: 440px; }
figure.contain img { object-fit: contain; background: #fff; border: 1px solid var(--border); }
figcaption { margin-top: 8px; font-size: 13px; color: var(--ink-3); }

.verdict { margin: 22px 0; padding: 20px 22px; border-radius: var(--radius); background: var(--mist-900); color: #fff; font-size: 17px; line-height: 1.55; }
.verdict strong:first-child { display: block; font: 400 26px/1.15 var(--serif); margin-bottom: 6px; }
.verdict.good { background: var(--good); } .verdict.warn { background: #92400e; } .verdict.bad { background: #991b1b; }

.callout { margin: 18px 0; padding: 14px 18px; border-radius: 12px; background: var(--mist-50); border: 1px solid var(--mist-100); }
.callout.warn { background: var(--warn-bg); border-color: #fde68a; } .callout.good { background: var(--good-bg); border-color: #a7f3d0; } .callout.bad { background: var(--bad-bg); border-color: #fecaca; }

.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 22px 0; }
.stat { padding: 16px 18px; border-radius: 14px; background: var(--paper); border: 1px solid var(--border); border-top: 3px solid var(--mist-500); }
.stat b { display: block; font: 400 30px/1.1 var(--serif); color: var(--ink); }
.stat span { display: block; margin-top: 4px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 28px; margin: 18px 0; }
.cols > * > h3:first-child { margin-top: 0; }
.pros, .cons { list-style: none; padding: 0; }
.pros li, .cons li { position: relative; padding-left: 26px; }
.pros li::before, .cons li::before { position: absolute; left: 0; top: 1px; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.pros li::before { content: "✓"; color: var(--good); background: var(--good-bg); }
.cons li::before { content: "✕"; color: var(--bad); background: var(--bad-bg); }

.options { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; margin: 22px 0; }
.option { position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: var(--radius); background: var(--paper); border: 1px solid var(--border); }
.option > img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; background: var(--surface); }
.option .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
.option h3 { margin: 0; font-size: 16px; }
.option .meta { margin: 0; font-weight: 600; color: var(--mist-600); font-size: 14px; }
.option p { margin: 0; font-size: 14px; color: var(--ink-2); }
.option.pick { border: 2px solid var(--mist-500); box-shadow: 0 10px 30px rgba(24, 58, 64, 0.12); }
.badge { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--mist-900); color: #fff; font: 600 11px/1.5 var(--sans); letter-spacing: 0.04em; }
.option > .badge { align-self: flex-start; margin: 14px 16px 0; }
.option:has(> img) > .badge { position: absolute; top: 12px; left: 12px; margin: 0; }
.tags { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.tags li { margin: 0; padding: 2px 9px; border-radius: 999px; background: var(--surface); font-size: 12px; color: var(--ink-2); }

table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 18px 0 24px; font-size: 14px; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--paper); }
th, td { text-align: left; vertical-align: top; padding: 11px 14px; border-bottom: 1px solid var(--border); }
tr:last-child td { border-bottom: 0; }
thead th, tr:first-child th { background: var(--ink); color: #fff; font-weight: 600; }
tbody tr:nth-child(even) td { background: #fbfaf8; }
td:first-child, th:first-child { font-weight: 600; }
td.yes { color: var(--good); font-weight: 600; } td.no { color: var(--bad); font-weight: 600; } td.best { background: var(--mist-50) !important; font-weight: 600; }

.chart { margin: 22px 0; padding: 18px 20px; border-radius: var(--radius); background: var(--paper); border: 1px solid var(--border); }
.chart > h3:first-child { margin-top: 0; }
.bars { display: flex; flex-direction: column; gap: 10px; margin: 12px 0 0; }
.bar { display: grid; grid-template-columns: minmax(90px, 30%) 1fr auto; align-items: center; gap: 12px; font-size: 14px; }
.bar::after { content: ""; grid-column: 2; grid-row: 1; height: 14px; width: var(--v, 50%); border-radius: 999px; background: var(--mist-500); }
.bar.hi::after { background: var(--mist-900); } .bar.lo::after { background: var(--mist-300); }
.bar > span { grid-column: 1; color: var(--ink-2); }
.bar > b { grid-column: 3; font-weight: 600; }

.meter { display: inline-block; vertical-align: middle; width: 90px; height: 8px; border-radius: 999px; background: var(--surface); overflow: hidden; }
.meter::before { content: ""; display: block; height: 100%; width: var(--v, 50%); background: var(--mist-500); }

.steps { list-style: none; counter-reset: step; padding: 0; }
.steps li { counter-increment: step; position: relative; padding: 2px 0 10px 44px; }
.steps li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; background: var(--mist-100); color: var(--mist-900); font-weight: 700; display: flex; align-items: center; justify-content: center; }

.quote { margin: 22px 0; padding: 4px 0 4px 20px; border-left: 3px solid var(--mist-300); font: italic 400 22px/1.4 var(--serif); color: var(--ink-2); }
.sources { font-size: 13px; color: var(--ink-3); }
.sources li { margin: 3px 0; }

@media (max-width: 640px) {
  body { padding: 28px 18px 56px; }
  table { display: block; overflow-x: auto; }
  .bar { grid-template-columns: minmax(80px, 34%) 1fr auto; }
}
@media print {
  html, body { background: #fff; }
  body { max-width: none; padding: 0; }
  section, .option, .stat, table, figure, .chart { break-inside: avoid; }
}
`;

export const REPORT_GUIDE = `Design: the page is styled by the Open Agent report kit, so compose it from these classes instead of writing CSS:
- <header class="hero"><p class="eyebrow">TOPIC · CONTEXT</p><h1>Headline answer</h1><p class="dek">One-sentence framing</p><img src="…" alt="…"></header>
- <div class="verdict"><strong>Verdict in a few words.</strong> One or two sentences.</div> (add class good, warn or bad for tone)
- <div class="stats"><div class="stat"><b>181 hp</b><span>2.0L engine</span></div>…</div> for 3–4 headline numbers
- <figure><img src="…" alt="…"><figcaption>What it shows</figcaption></figure> (class contain for product shots on white)
- <div class="options"><article class="option pick"><span class="badge">Best value</span><img src="…" alt="…"><div class="body"><h3>Name</h3><p class="meta">$30,430 · 181 hp</p><p>One line on who it suits</p><ul class="tags"><li>Convertible</li></ul></div></article>…</div> for the things being compared
- <table> with a header row for side-by-side specs; td class yes, no or best to color a cell
- <div class="chart"><h3>Title</h3><div class="bars"><div class="bar hi" style="--v:100%"><span>Label</span><b>$33,930</b></div>…</div></div> for one number across 3+ items (--v is the bar length relative to the largest)
- <div class="cols"><div><h3>Pros</h3><ul class="pros">…</ul></div><div><h3>Cons</h3><ul class="cons">…</ul></div></div>
- <ol class="steps"> for what to do next, <div class="callout warn"> for a caveat, <p class="quote"> for a striking line from a source
- <section><p class="kicker">Part 2</p><h2>…</h2>…</section> for each major part, and <ol class="sources"> with links at the end
Every picture must be an image URL a tool returned (image_search, wikipedia, music, or a page's images: list); others are removed.`;
