---
name: research
description: Load for research, "is X a good buy", decisions, comparisons, and before any report or PDF.
---

# Research and reports

1. Search and read the key sources: up to four web searches (parallel when independent) and six pages. Don't keep searching for marginal gains. Use wikipedia once for people, places, or events.
2. If the subject or options are recognizable by sight (products, cars, places, food, gear, buildings), call image_search once with one query per item, e.g. ["2026 Mazda MX-5 Miata", "Toyota GR86"], unless the pages you read already listed good images. For a quick "tell me about" overview, start the card with an image block from image_search, then the key facts.
3. Call create_artifact once with a rich report built from the report kit (classes below): a hero with the headline answer and a picture, a verdict, stat tiles for key numbers, option cards with a picture each, a comparison table, a bar chart when one number varies across options, pros and cons, next steps, and linked sources.
4. Answer the question for anyone asking it. Use details the user gave in this chat where they change the answer; keep their profile (name, home, interests) out of the title and verdict unless the question is about them.
5. The report shows inline and the user can open it in a new tab or as a PDF. Reply in two or three sentences with the main takeaway; don't repeat the report in text or show_ui.

## Report kit

Design: the page is styled by the Open Agent report kit, so compose it from these classes instead of writing CSS:
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
Every picture must be an image URL a tool returned (image_search, wikipedia, music, or a page's images: list); others are removed.
