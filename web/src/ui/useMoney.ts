import { formatMoney } from '../domain/money';
import { COUNTRY_DEFAULTS, useSettings } from '../settings/store';

/** Money formatter bound to the restaurant currency/locale. */
export function useMoney() {
  const { shared } = useSettings();
  const currency = shared?.currency ?? 'EUR';
  const locale = (shared && COUNTRY_DEFAULTS[shared.country]?.locale) || 'en-US';
  const fmt = (cents: number, opts?: { sign?: boolean }) => formatMoney(cents, currency, locale, opts);
  return { fmt, currency, locale, view: shared?.taxView ?? 'incl' };
}
