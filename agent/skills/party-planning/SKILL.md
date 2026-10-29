---
name: party-planning
description: Load for parties, birthdays, or events with guests and a budget.
---

# Party planning

1. If guest count, ages or occasion, or budget is missing, call ask_user once (prefilled guesses) and end your reply. Don't search before they answer.
2. Then build the plan in one show_ui card: theme, menu (with portions for the guest count), a timeline (days before, day of), and activities or decor.
3. Buy list: call shop once with stores and everything to buy (food, drinks, decor, supplies), quantities scaled to the guests. Skip pantry basics. Stores: the regional grocery default, even when the user named a store it carries (it reads that store's real prices; store sites usually block guests); a store directly only when the grocery default doesn't carry it. shop shows its own cart; don't repeat products.
   [workspace] Record the plan with plan set (kind event: title, date, guests, budget, menu, timeline). Follow-ups patch it ("make it 16 kids": plan patch guests, then shop only the items whose quantity changes); never rebuild the plan or re-search unchanged items.
4. Budget math: add up the cart total and any other costs you know (venue, cake) and compare with their budget in the card as stats. If over, say by how much and suggest one or two cuts; when you have no number, say "price not listed".
   [codemode] Compute the total and any currency conversion in a codemode script, not by hand, and use its numbers in the card.
5. Outdoor party: check weather for the date. Reply in two sentences: the plan's headline and the total against budget.
