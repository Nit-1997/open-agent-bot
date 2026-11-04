export function inertOutside(el: HTMLElement, root: HTMLElement, keep: ReadonlyArray<Element | null> = []): () => void {
  const added: Element[] = [];
  let node: HTMLElement = el;
  while (node !== root && node.parentElement) {
    const parent = node.parentElement;
    for (const sib of [...parent.children]) {
      if (sib === node || keep.includes(sib) || sib.hasAttribute("inert")) continue;
      sib.setAttribute("inert", "");
      added.push(sib);
    }
    if (parent === root) break;
    node = parent;
  }
  return () => {
    for (const sib of added) sib.removeAttribute("inert");
  };
}
