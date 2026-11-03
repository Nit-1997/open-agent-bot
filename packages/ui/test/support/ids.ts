import { expect } from "vitest";

export const htmlIds = (root: ParentNode) =>
  [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);

export function expectUniqueIds(root: ParentNode) {
  const ids = htmlIds(root);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
}
