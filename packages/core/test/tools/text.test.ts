import { describe, expect, it } from "vitest";
import { htmlToText, imagesText, MAX_PAGE_CHARS, pageImages, truncate } from "../../src/tools/text.js";

describe("truncate", () => {
  it("truncate adds marker only when cut", () => {
    expect(truncate("abc", 5)).toBe("abc");
    expect(truncate("abcdefgh", 5)).toBe("abcde\n[truncated]");
    expect(MAX_PAGE_CHARS).toBe(12000);
  });
});

describe("htmlToText", () => {
  it("drops scripts and styles and collapses whitespace", () => {
    const t = htmlToText("<html><body><script>var x=1</script><style>p{}</style><nav>Menu</nav><p>Hello   \n\n  world</p></body></html>");
    expect(t).toContain("Hello world");
    expect(t).not.toContain("var x");
    expect(t).not.toContain("p{}");
  });
});

describe("pageImages", () => {
  const page = `<html><head>
    <meta property="og:image" content="https://cdn.shop.com/og/boot.jpg">
    <meta property="og:title" content="Mercurial Vapor 17">
    <script type="application/ld+json">{"@type":"Product","name":"Phantom 6 Low","image":["https://cdn.shop.com/p/phantom.png"]}</script>
  </head><body>
    <img src="/logo.svg" alt="Shop logo">
    <img src="/img/tiempo.jpg" alt="Nike Tiempo Maestro Academy TF">
    <img data-src="https://cdn.shop.com/lazy/superfly.webp" src="data:image/gif;base64,R0lGOD" alt="Superfly 11 Academy MG">
    <img src="https://cdn.shop.com/px.gif" alt="" width="1" height="1">
    <img src="/img/tiempo.jpg" alt="Nike Tiempo Maestro Academy TF">
    <img src="https://cdn.shop.com/icons/cart.png" alt="Cart icon">
  </body></html>`;

  it("lists product images with their names, resolved and deduplicated", () => {
    expect(pageImages(page, "https://www.shop.com/w/turf")).toEqual([
      { alt: "Mercurial Vapor 17", src: "https://cdn.shop.com/og/boot.jpg" },
      { alt: "Phantom 6 Low", src: "https://cdn.shop.com/p/phantom.png" },
      { alt: "Nike Tiempo Maestro Academy TF", src: "https://www.shop.com/img/tiempo.jpg" },
      { alt: "Superfly 11 Academy MG", src: "https://cdn.shop.com/lazy/superfly.webp" },
    ]);
  });

  it("skips site icons even when they have a usable name", () => {
    const html = `<head><title>Products. Nike.com</title><meta property="og:image" content="https://www.nike.com/android-icon-192x192.png"></head><body><img src="/favicon-96.png" alt="Nike store home"></body>`;
    expect(pageImages(html, "https://www.nike.com/w/")).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<img src="/p/${i}.jpg" alt="Product number ${i}">`).join("");
    expect(pageImages(`<body>${many}</body>`, "https://s.com/")).toHaveLength(24);
  });

  it("finds a visible product's image even when the page has many others first", () => {
    const many = Array.from({ length: 30 }, (_, i) => `<img src="/p/${i}.jpg" alt="Hidden product ${i}">`).join("");
    const t = imagesText(`<body>${many}<img src="/b.jpg" alt="Tiempo Academy Turf"></body>`, "https://s.com/", "Tiempo Academy Turf $95");
    expect(t).toContain("https://s.com/b.jpg");
  });

  it("lists only images for products the model can see in the page text", () => {
    const html = `<body><img src="/a.jpg" alt="Women's Track Jacket"><img src="/b.jpg" alt="Tiempo Maestro Academy Turf Shoes"></body>`;
    const t = imagesText(html, "https://s.com/", "Tiempo Maestro Academy\nTurf Shoes\n$95");
    expect(t).toBe("\n\nimages:\n- Tiempo Maestro Academy Turf Shoes — https://s.com/b.jpg");
  });
});
