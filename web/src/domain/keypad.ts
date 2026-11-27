const MAX_INT = 9;
const MAX_DEC = 2;

/**
 * Cleans what the user typed in an amount field (the phone's own number keyboard):
 * keeps digits and one decimal separator (either ',' or '.' typed, shown as `decimalSep`),
 * at most 9 integer digits and 2 decimals, no leading zeros. '' means nothing typed yet.
 */
export function sanitizeAmount(raw: string, decimalSep: ',' | '.'): string {
  let int = '';
  let dec: string | null = null;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (dec === null) int += ch;
      else dec += ch;
    } else if ((ch === ',' || ch === '.') && dec === null) {
      dec = '';
    }
  }
  int = int.replace(/^0+(?=\d)/, '').slice(0, MAX_INT);
  if (dec === null) return int;
  return (int === '' ? '0' : int) + decimalSep + dec.slice(0, MAX_DEC);
}
