import { REPORT_CSS, REPORT_FONTS } from "./reportKit.js";

const HEAD = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="referrer" content="no-referrer">',
  '<base target="_blank">',
  `<link rel="stylesheet" href="${REPORT_FONTS}">`,
  `<style>${REPORT_CSS}</style>`,
].join("");

export function withReportFrame(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}${HEAD}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${HEAD}</head>`);
  return `<!doctype html><html><head>${HEAD}</head><body>${html}</body></html>`;
}
