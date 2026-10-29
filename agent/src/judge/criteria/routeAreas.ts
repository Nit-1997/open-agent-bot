export const AREAS = ["lodging", "flights", "shopping", "dining", "research", "music", "weather"] as const;
export type Area = (typeof AREAS)[number];
export type Intent = "plan" | "buy" | "book" | "login";

export const routeAreas = {
  id: "routeAreas",
  version: "3",
  areas: {
    lodging: {
      question: "Does the user want help with lodging: finding, comparing or planning hotels, rentals or places to stay?",
      yes: "The message, or the conversation it continues, asks about hotels, rentals, Airbnbs or where to stay, including follow-ups that adjust an earlier lodging search. A general request to plan a trip to a place also counts.",
      no: "Lodging is not part of what the user wants now.",
    },
    flights: {
      question: "Does the user want help with flights: searching, comparing or planning air travel?",
      yes: "The message, or the conversation it continues, asks about flights, airfare, airlines, airports or getting somewhere by plane, including follow-ups that adjust an earlier flight search. A general request to plan a trip to a place also counts.",
      no: "Flights are not part of what the user wants now.",
    },
    shopping: {
      question: "Does the user want help with shopping: finding or comparing products, groceries, supplies, gifts, or building a cart or shopping list?",
      yes: "The message, or the conversation it continues, asks to find, compare, price or pick products or groceries, to plan something that needs items bought, or follows up on an earlier cart or product list. Building or editing a cart in this chat counts.",
      no: "Products or groceries are not part of what the user wants now. Asking whether a big purchase is worth it, as a topic to analyze, is research rather than shopping.",
    },
    dining: {
      question: "Does the user want help with dining: finding restaurants, cafes, bars or places to eat or drink?",
      yes: "The message, or the conversation it continues, asks where to eat or drink, restaurant picks, or a follow-up on earlier restaurant suggestions. A general request to plan a trip to a place also counts.",
      no: "Dining out is not part of what the user wants now.",
    },
    research: {
      question: "Does the user want research: an explanation, comparison, decision analysis, fact lookup or a written report on a topic?",
      yes: "The user wants an explanation, analysis, fact lookup, decision advice or a written report about a topic that needs sources. Questions like which one to get, whether something is good or worth it, or what to buy need reviews and comparisons and count. A plain search for a hotel, flight, restaurant, product, album or forecast is not research by itself.",
      no: "Finding hotels, flights, restaurants, products, music or weather, a follow-up that tweaks such a search, or plain conversation.",
    },
    music: {
      question: "Does the user want help with music: albums, songs, artists or playlists?",
      yes: "The message, or the conversation it continues, asks for music recommendations, album or song details, or playlists.",
      no: "Music is not part of what the user wants now.",
    },
    weather: {
      question: "Does the user want weather information: forecasts, conditions, climate or what to pack for the weather?",
      yes: "The message, or the conversation it continues, asks about the weather or climate at a place or time, or what to wear or pack because of it.",
      no: "Weather is not part of what the user wants now.",
    },
  } satisfies Record<Area, { question: string; yes: string; no: string }>,
  missing: {
    question: "Is a detail still missing that a plan or purchase needs: dates, number of guests or travelers, city or location, or budget?",
    yes: "The request needs details such as dates, headcount, place or budget that neither the message, the recent conversation nor the saved workspace provides.",
    no: "Every detail needed is already given, or the request needs none.",
  },
  intent: {
    question: "What does the user want the agent itself to do?",
    options: {
      plan: "Look things up, compare, recommend or plan, including finding a hotel, flight or product that the user could later book or buy on their own, and plain questions or chit-chat.",
      buy: "Asks the agent itself to spend money: pay, complete a checkout, or place an order on a store or site. Asking to get, grab or add items, or to build, edit or compare a cart or list in this chat, is plan, not buy.",
      book: "Asks the agent itself to reserve, book or confirm a hotel, flight, table, ticket or appointment on their behalf. Looking for options to book later, or ideas for where to reserve, is plan.",
      login: "Asks the agent itself to sign in, use their account or password, or act inside a logged-in account.",
    } satisfies Record<Intent, string>,
  },
} as const;
