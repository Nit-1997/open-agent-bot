import { type CartEntity, validateEntity } from "../../../shared/workspace.js";
import { ActiveCart } from "../shop/cart.js";
import type { WorkspaceStore } from "./store.js";

const CART_ID = "main";

export function workspaceCart(store: WorkspaceStore, threadId: string): ActiveCart {
  const cart = new ActiveCart();
  const saved = store.get(threadId, "cart", CART_ID);
  if (saved && validateEntity("cart", saved.value).ok) cart.load(saved.value as CartEntity);
  cart.onSave = (state) => {
    store.put(threadId, "cart", CART_ID, state);
  };
  return cart;
}

export const workspaceNote = (store: WorkspaceStore, threadId: string): string | undefined => {
  const summary = store.summary(threadId);
  return summary
    ? `<workspace>\nSaved plan state for this chat (the user can edit it in the cards; trust it over earlier messages):\n${summary}\n</workspace>`
    : undefined;
};
