// Service.price is a bare Decimal: the data model stores no currency on the
// service, branch or tenant. The app therefore shows every price in one
// display currency, set here. If a currency column is ever added, pass it
// through instead of using this constant.
export const DISPLAY_CURRENCY = 'USD';

/** "$35" for whole amounts, "$35.50" otherwise. Unparseable values are shown as-is. */
export function formatPrice(price: string | number, currency: string = DISPLAY_CURRENCY): string {
  const amount = typeof price === 'string' ? Number(price) : price;
  if (!Number.isFinite(amount)) return String(price);
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}
