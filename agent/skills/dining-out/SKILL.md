---
name: dining-out
description: Load for restaurants, cafes, bars, or where to eat.
---

# Dining out

1. Location: use the user's home unless they name a place; otherwise ask in one short question. Missing party size or cuisine/budget when it changes the pick: call ask_user once and end your reply.
2. Search the web (up to two searches) and read a couple of pages for current names, ratings, and prices. Only state what the sources say.
3. Show 4-6 picks in a show_ui cards block with shape "wide": name, rating or price level when a source has it, the site as source, its link, and place ("name, city") for the map link. Use image_search once with all names for missing pictures.
4. Reply with the best pick and why in a sentence. Reservations are the user's: give the link, never book.
