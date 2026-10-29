import glob
import json
import random
import re
import sys
from collections import defaultdict

import pyarrow.compute as pc
import pyarrow.parquet as pq

SRC, OUT = sys.argv[1], sys.argv[2]

FOOD = set("""milk eggs egg butter cheese yogurt cream bread bagel tortilla rice pasta noodle spaghetti flour sugar salt pepper spice seasoning
olive oil vinegar sauce ketchup mustard mayo salsa honey syrup jam jelly peanut almond cashew walnut nuts oats oatmeal cereal granola
chicken beef pork turkey bacon sausage ham salmon tuna shrimp fish beans lentil chickpea tomato potato onion garlic carrot spinach
lettuce broccoli apple banana orange lemon lime berry strawberry blueberry grape avocado mango coconut chocolate cookie cracker chip
pretzel popcorn candy gum snack soda juice tea coffee water sparkling kombucha broth soup stock pickle olive hummus tofu protein
bar jerky frozen pizza ice cream pancake waffle muffin cake brownie mix baking vanilla cinnamon ginger turmeric paprika cumin oregano
basil parsley dressing marinade gluten organic vegan""".split())

NOT_FOOD = set("""table maker machine grinder mug cup cups pot pan pans capsule pod pods holder dispenser container bottle bottles tumbler filter
cutter cutters slicer peeler opener knife board kit set toy toys plush costume sticker stickers poster book candle candles soap shampoo
lotion diaper pet dog cat supplement vitamin pill tablet gummies cartridge grill smoker bag bags tray mold mould basket stand stools rack
bowl plate lunch box warmer warmers cooler coolers jar stove blender mixer fryer toaster oven kettle scale thermometer beard shea
essential hair skin body bath face lip cosmetic cosmetics wax soy scented perfume fragrance oils diffuser aromatherapy massage nail makeup
banner decoration decorations topper party balloon cleaning detergent watch ipad iphone phone phones pencil band bands case cream creams
cooker cookers roaster press sticks socks ribbon eye spray potting jojoba cbd cd songs lamp spout scraper barbell shower pump tank heater
heaters bulk bio mederma arnica bundles frontal dummy tub ones wine beer skimmer valve macbook bikes curtains carplay chlorine lights towel
wallet chemistry extractor bins weighted toothpaste chapstick scrub seeds rings edition formula cabrio generator blanket balance tv dolls
pepper bracelet mats blu gun maze sheet labels makers fertilizer ash ylang stones lame pitcher throw""".split())

tokens = lambda s: re.findall(r"[a-z]+", s.lower())
LABEL = {"Exact": "E", "Substitute": "S", "Complement": "C", "Irrelevant": "I"}

queries = defaultdict(dict)
for path in sorted(glob.glob(SRC + "/*.parquet")):
    for batch in pq.ParquetFile(path).iter_batches(batch_size=50000, columns=["query", "product_title", "esci_label", "product_locale"]):
        batch = batch.filter(pc.equal(batch["product_locale"], "us"))
        for q, title, label in zip(batch["query"].to_pylist(), batch["product_title"].to_pylist(), batch["esci_label"].to_pylist()):
            words = set(tokens(q))
            if not (words & FOOD) or (words & NOT_FOOD) or ("oil" in words and "olive" not in words) or len(q) > 50 or not title:
                continue
            queries[q][title] = LABEL[label]

pool = []
for q, titles in queries.items():
    items = [(t[:220], label) for t, label in titles.items()]
    labels = [label for _, label in items]
    foodlike = sum(1 for t, _ in items if set(tokens(t)) & FOOD)
    if len(items) < 8 or foodlike / len(items) < 0.7 or "E" not in labels or len(set(labels)) < 2 or labels.count("E") == len(labels):
        continue
    pool.append((q, items))

rng = random.Random(20261029)
pool.sort(key=lambda x: x[0])
rng.shuffle(pool)
rows = []
for q, items in pool[:120]:
    items.sort()
    rng.shuffle(items)
    chosen = items[: min(len(items), rng.randint(8, 20))]
    if not any(label == "E" for _, label in chosen):
        chosen[-1] = next(i for i in items if i[1] == "E")
        rng.shuffle(chosen)
    rows.append({"query": q, "tiles": [{"title": t, "label": label} for t, label in chosen]})

practice = round(len(rows) * 0.4)
with open(OUT, "w") as fh:
    for i, row in enumerate(rows):
        fh.write(json.dumps({"split": "practice" if i < practice else "test", **row}, ensure_ascii=False) + "\n")
