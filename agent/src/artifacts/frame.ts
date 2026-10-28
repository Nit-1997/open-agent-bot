const BASE_CSS = `
:root { color-scheme: light; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0 auto; max-width: 760px; padding: 32px 24px 64px; font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1c1e; background: #fff; }
h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; }
h2 { font-size: 20px; margin: 32px 0 8px; }
h3 { font-size: 16px; margin: 24px 0 6px; }
p, ul, ol { margin: 0 0 12px; }
li { margin: 4px 0; }
a { color: #2f5d7c; }
img { max-width: 100%; height: auto; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e5e5ea; }
th { background: #f5f5f7; font-weight: 600; }
blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #c7d5df; background: #f6f9fb; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
pre { overflow-x: auto; padding: 12px; background: #f5f5f7; border-radius: 8px; }
@media print { body { padding: 0; max-width: none; } a { color: inherit; } }
`;

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base target="_blank"><style>${BASE_CSS}</style>`;

export function withReportFrame(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (tag) => `${tag}${HEAD}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${HEAD}</head>`);
  return `<!doctype html><html><head>${HEAD}</head><body>${html}</body></html>`;
}
