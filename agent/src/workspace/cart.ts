import { type CartEntity, validateEntity } from "../../../shared/workspace.js";
import { log } from "../lib/log.js";
import { ActiveCart } from "../shop/cart.js";
import type { WorkspaceStore } from "./store.js";

const CART_ID = "main";

export async function workspaceCart(store: WorkspaceStore): Promise<ActiveCart> {
  const cart = new ActiveCart();
  const saved = await store.get("cart", CART_ID);
  if (saved && validateEntity("cart", saved.value).ok) cart.load(saved.value as CartEntity);
  let saving: Promise<unknown> = Promise.resolve();
  cart.onSave = (state) => {
    saving = saving
      .then(() => store.put("cart", CART_ID, state))
      .catch((err: unknown) => log.warn("[workspace] couldn't save the cart", err));
  };
  return cart;
}

export const workspaceNote = async (store: WorkspaceStore): Promise<string | undefined> => {
  const summary = await store.summary();
  return summary
    ? `<workspace>\nThis chat's working state for this session (the user can edit the latest cards; trust it over earlier messages):\n${summary}\n</workspace>`
    : undefined;
};
