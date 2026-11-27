export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | ',' | '⌫';

const MAX_INT = 9;
const MAX_DEC = 2;

/** Pure keypad reducer: returns the new display string after pressing `key`. */
export function pressKey(display: string, key: KeypadKey, decimalSep: ',' | '.'): string {
  if (key === '⌫') return display.length <= 1 ? '0' : display.slice(0, -1);
  if (key === '.' || key === ',') {
    if (display.includes(decimalSep)) return display;
    return display + decimalSep;
  }
  const at = display.indexOf(decimalSep);
  if (at >= 0) {
    return display.length - at - 1 >= MAX_DEC ? display : display + key;
  }
  if (display === '0') return key;
  return display.length >= MAX_INT ? display : display + key;
}
