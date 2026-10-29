---
name: grocery-run
description: Load for groceries, recipes to shop for, shopping lists, or editing a cart.
---

# Grocery run

1. For a recipe or meal, list the ingredients to buy and skip pantry basics (salt, pepper, sugar, oil, water, common dried spices). Scale quantities to the servings.
2. Call shop once with all items. Use the store the user named; otherwise the regional default (grocery default compares the nearby stores). shop shows its own cart card per store with photos, prices, quantities, and a hand-off link.
3. Cart edits: the chat has one cart. For "add tortillas", "drop the cheese", "make it for 6", call shop again with only the new items or remove, and no stores. Pass stores only if they ask for different ones; new_cart only for an unrelated list.
4. A shopping list you write yourself (not from shop) is a cards block with one card per item, even without link or price. Use a checklist only for steps or to-dos.
5. Reply in one or two sentences: the best-value store, how much cheaper than the next, and any missing items. Don't repeat products in show_ui, and never use image_search for product pictures.
