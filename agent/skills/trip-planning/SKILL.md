---
name: trip-planning
description: Load for trips, flights, hotels, vacation rentals, or what to do in a place (not for a car rental question alone).
---

# Trip planning

1. Missing details (dates, travelers, starting city, budget level): call ask_user once with a prefilled form, then end your reply. Skip it when the user already gave them. Turn holidays into exact dates yourself.
2. When the trip needs flights, the same form also has choice fields: "Compare nearby airports?" (Yes / Closest only), "Layovers" (Nonstop only / Up to 5h / Up to 10h / Any), "Departure time" (Any / Early morning / Midday / Evening / Late night).
3. After the answers, call in parallel where independent:
   - flights: from "nearby" (all airports near home) unless they chose "Closest only" (then that one airport). Map Layovers to max_layover (nonstop, 5h, 10h, any) and Departure time to depart_times (early_morning, midday, evening, late_night). Don't ask which airport; don't suggest driving.
   - stays: area, check-in/out, guests, nightly budget as max_price (with its currency when they named one, e.g. { amount: 400, currency: "EUR" }); type "hotel" or "rental". When they name hotel brands, a neighborhood or landmark, or a vibe, pass them as wants (brand, area, vibe); if the result says no listing meets the brand, tell them that plainly instead of naming other hotels as matches.
   - weather: trips are outdoors, so check it with start_date/end_date.
   - wikipedia once with every sight or landmark name.
4. Things to do and places to visit: a show_ui cards block with shape "wide", one card per place with a short note, its link, and place ("name, city") for the map link. Hotels and rentals come from the stays card; don't repeat them.
   [workspace] Record the trip with plan set (kind trip: destination, start, end, travelers, budget, stays shortlist, days). Follow-ups patch it ("add a traveler", "shift a day"); re-run only the tool whose inputs changed.
5. Reply with the best flight value and best stay pick in a sentence or two. Booking is theirs: point to the card links.
