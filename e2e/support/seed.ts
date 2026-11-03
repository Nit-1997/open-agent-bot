import { randomUUID } from "node:crypto";
import { admin } from "./admin";

export const BIG_SUR = "Weekend in Big Sur for two";
export const SEED = { chats: 24, reports: 13 } as const;
export const CART_CARD_ID = "call-e2eCart001-widget";
export const TRIP_CARD_ID = "call-e2eTrip001-widget";
export const BIG_SUR_REPORT = { id: "e2eReport001", title: "Big Sur weekend plan", toolCallId: "call-e2eReport001" } as const;
export const SECOND_REPORT = { id: "e2eReport002", title: "Big Sur campgrounds", toolCallId: "call-e2eReport002" } as const;
export const LIVE_REPORT = { id: "e2eReport003", title: "Packing list", toolCallId: "call-e2eReport003" } as const;

const DAY = 24 * 60 * 60 * 1000;

const TITLES = [
  BIG_SUR,
  "Diwali party for 20 people",
  "Taco night grocery run",
  "Noise-cancelling headphones under $300",
  "Flights SFO to Nashville",
  "Best indoor plants for low light",
  "Birthday party for a 6-year-old",
  "Camping gear checklist",
  "Farmers markets near me",
  "Weeknight vegetarian dinners",
  "Road trip to Yosemite",
  "Robot vacuum comparison",
  "Gift ideas for my sister",
  "Hotels in Lisbon in March",
  "Kids' science museum day",
  "Coffee grinder under $150",
  "Thanksgiving menu for 10",
  "Running shoes for flat feet",
  "Weekend in Napa",
  "Pet-friendly cabins",
  "Standing desk research",
  "Holiday lights near me",
  "Ski trip to Tahoe",
  "Picnic for six",
];

async function must<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`seed ${label}: ${error.message}`);
  return data;
}

export async function userId(email: string): Promise<string> {
  const rows = await must("profile", admin().from("profiles").select("user_id").eq("email", email));
  const id = (rows as Array<{ user_id: string }>)[0]?.user_id;
  if (!id) throw new Error(`seed: no profile for ${email}`);
  return id;
}

const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 60 * 60 * 1000).toISOString();

function ageOf(i: number): number {
  if (i < 3) return 0;
  if (i < 8) return 1 + (i - 3);
  return 8 + (i - 8);
}

const BIG_SUR_REPLY =
  "Here's a two-night plan from San Luis Obispo: Highway 1 north on Saturday morning, a cabin near Pfeiffer Big Sur, sunset at McWay Falls and vegetarian dinners.";

const FOCUS_THIEF = `<button id="grab" tabindex="0">Focus me</button><script>const grab=()=>{window.focus();document.getElementById("grab").focus();};window.addEventListener("load",()=>{grab();setTimeout(grab,4500);});</script>`;

const reportHtml = (title: string, extra = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:24px"><h1>${title}</h1><p>A one-page guide made for the end-to-end demo.</p>${extra}</body></html>`;

const seedPart = (r: { id: string; title: string; toolCallId: string }) => ({
  type: "tool",
  id: r.toolCallId,
  name: "create_artifact",
  args: JSON.stringify({ title: r.title }),
  result: `artifact ${r.id} created: ${r.title}`,
});

export type Seeded = { chats: Array<{ id: string; title: string }>; bigSur: string; cartChat: string; reports: string[]; otherChat: string };

const pick = (title: string, price: number) => ({
  title,
  price,
  priceText: `$${price.toFixed(2)}`,
  url: `https://www.traderjoes.com/p/${encodeURIComponent(title)}`,
});

const CART_CARD = {
  kind: "cart",
  stores: [
    {
      name: "Trader Joe's",
      total: 19.36,
      currency: "USD",
      url: "https://www.traderjoes.com/",
      missing: [],
      items: [
        { query: "corn tortillas", qty: 2, picks: [pick("Corn tortillas", 2.99)] },
        { query: "black beans", qty: 4, picks: [pick("Black beans", 1.19)] },
        { query: "avocados", qty: 6, picks: [pick("Hass avocados", 1.49)] },
      ],
    },
  ],
};

const TRIP_CARD = {
  kind: "plan",
  entity: "trip",
  id: "big-sur/weekend",
  version: 1,
  value: {
    destination: "Big Sur",
    start: "2026-11-14",
    end: "2026-11-16",
    travelers: 2,
    budget: 900,
    stays: [{ name: "Cabin near Pfeiffer Big Sur", url: "https://www.parks.ca.gov/?page_id=570", price: 420 }],
    days: [
      { date: "2026-11-14", items: ["Drive Highway 1 north", "Sunset at McWay Falls"] },
      { date: "2026-11-15", items: ["Pfeiffer Beach", "Dinner at a vegetarian spot"] },
    ],
  },
};

const CART_REPLY = "Here's your taco night cart at Trader Joe's.";

const cardPart = (id: string, widget: object) => ({ type: "tool", id, name: "show_widget", args: JSON.stringify({ widget }), result: "rendered" });

export async function seed(demoEmail: string, otherEmail: string): Promise<Seeded> {
  const db = admin();
  const user = await userId(demoEmail);
  const other = await userId(otherEmail);
  await must("profile reset", db.from("profiles").update({ data: {} }).eq("user_id", user));

  const chats = TITLES.map((title, i) => ({ id: randomUUID(), user_id: user, title, last_message_at: ago(ageOf(i), i < 3 ? i : 0) }));
  await must("chats", db.from("chats").insert(chats));
  const bigSur = chats[0].id;
  const messages = chats.flatMap((c, i) => [
    { chat_id: c.id, user_id: user, run_id: `seed-${i}`, role: "user", content: c.title, status: "complete" },
    {
      chat_id: c.id,
      user_id: user,
      run_id: `seed-${i}`,
      role: "assistant",
      content: i === 0 ? BIG_SUR_REPLY : i === 2 ? CART_REPLY : `Here is what I found for ${c.title.toLowerCase()}.`,
      status: "complete",
      ...(i === 0 && {
        parts: [seedPart(BIG_SUR_REPORT), seedPart(SECOND_REPORT), cardPart(TRIP_CARD_ID, TRIP_CARD), { type: "text", text: BIG_SUR_REPLY }],
      }),
      ...(i === 2 && { parts: [cardPart(CART_CARD_ID, CART_CARD), { type: "text", text: CART_REPLY }], created_at: ago(0, 3) }),
    },
  ]);
  await must("messages", db.from("chat_messages").insert(messages, { defaultToNull: false }));

  const bigSurReports = [BIG_SUR_REPORT, SECOND_REPORT, LIVE_REPORT];
  const reports = Array.from({ length: SEED.reports }, (_, i) => ({
    id: bigSurReports[i]?.id ?? `e2eReport${String(i + 1).padStart(3, "0")}`,
    title: bigSurReports[i]?.title ?? `Guide ${i + 1}: ${TITLES[(i + 3) % TITLES.length]}`,
    chat: i < bigSurReports.length ? bigSur : i % 3 === 0 ? null : chats[i % chats.length].id,
    at: ago(i),
    html: reportHtml(bigSurReports[i]?.title ?? `Guide ${i + 1}: ${TITLES[(i + 3) % TITLES.length]}`, i === 1 ? FOCUS_THIEF : ""),
  }));
  for (const r of reports) {
    const html = r.html;
    const { error } = await db.storage.from("artifacts").upload(`${user}/${r.id}.html`, html, { contentType: "text/html", upsert: true });
    if (error) throw new Error(`seed upload: ${error.message}`);
  }
  await must(
    "artifacts",
    db.from("artifacts").insert(
      reports.map((r) => ({
        id: r.id,
        user_id: user,
        chat_id: r.chat,
        title: r.title,
        html_path: `${user}/${r.id}.html`,
        size_bytes: Buffer.byteLength(r.html),
        created_at: r.at,
      })),
    ),
  );

  const otherChat = randomUUID();
  await must("other chat", db.from("chats").insert({ id: otherChat, user_id: other, title: "Someone else's chat" }));

  return { chats: chats.map((c) => ({ id: c.id, title: c.title })), bigSur, cartChat: chats[2].id, reports: reports.map((r) => r.id), otherChat };
}
