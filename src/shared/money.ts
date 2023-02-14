// Money is held in pence everywhere below the UI. Anything that hands a number
// to a customer goes through format().
//
// Historic note: the desktop product stored pounds as floats and we still get
// the odd 0.1 + 0.2 ticket from the import path. Do not add float arithmetic here.

export type Pence = number;

export function pounds(p: Pence): number {
  return p / 100;
}

export function format(p: Pence): string {
  const negative = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  return `${negative ? '-' : ''}£${whole.toLocaleString('en-GB')}.${String(part).padStart(2, '0')}`;
}

export function sum(items: Pence[]): Pence {
  return items.reduce((a, b) => a + b, 0);
}

// Percentage of a pence amount, rounded half up to the nearest penny.
// Used by the late payment charge. Nothing else uses it yet.
export function percentOf(p: Pence, percent: number): Pence {
  return Math.round((p * percent) / 100);
}
