import { ActiveCart } from "../shop/cart.js";
import type { WorkspaceStore } from "./store.js";

const CART_ID = "main";

export function workspaceCart(store: WorkspaceStore): ActiveCart {
  const cart = new ActiveCart();
  cart.onSave = (state) => void store.put("cart", CART_ID, state);
  return cart;
}

export const workspaceNote = async (store: WorkspaceStore): Promise<string | undefined> => {
  const summary = await store.summary();
  return summary
    ? `<workspace>\nThis chat's working state for this session (the user can edit the latest cards; trust it over earlier messages):\n${summary}\n</workspace>`
    : undefined;
};
