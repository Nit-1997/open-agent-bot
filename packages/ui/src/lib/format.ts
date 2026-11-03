export function money(value: number | undefined, currency: string, locale: string): string | undefined {
  if (value == null) return undefined;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}
