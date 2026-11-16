const hundredths = new Intl.NumberFormat('en-US', {
  useGrouping: false, maximumFractionDigits: 2,
});

export function roundCoefficient(value: number) {
  return Number(hundredths.format(value));
}

export function coefficientText(value: number, round: boolean) {
  return round && !Number.isInteger(value) && roundCoefficient(value) === value
    ? value.toFixed(2) : String(value);
}

// Same term order and per-operation bounds as backend.expressions.Expression.
// This evaluates the function curve; Python still integrates the entire ODE.
export function polynomialSource(coefficients: number[], argument: string, multiplier?: string, preserveArgument = false) {
  const terms = coefficients.flatMap((value, i) => value === 0 ? [] : [
    `(${value})` + (i < 3 ? '*' + argument + (i < 2 ? '**' + (3-i) : '') : ''),
  ]);
  const expression = terms.join('+') || '0';
  // Keep the chosen argument in the editable form even when its coefficient is zero.
  const marker = (preserveArgument || multiplier) && coefficients.slice(0, 3).every(value => value === 0) ? '+0*' + argument : '';
  return multiplier ? `(${expression}${marker})*(${multiplier})` : expression + marker;
}

export function polynomialValue(coefficients: number[], x: number): number | null {
  const bounded = (value: number) => Number.isFinite(value) && Math.abs(value) <= 1e12;
  if (!bounded(x) || !coefficients.every(bounded)) return null;
  let result = 0;
  for (let i = 0; i < 4; i++) {
    if (coefficients[i] === 0) continue;
    const power = 3-i;
    const argument = power ? x**power : 1;
    if (!bounded(argument)) return null;
    const term = power ? coefficients[i]*argument : coefficients[i];
    if (!bounded(term)) return null;
    result += term;
    if (!bounded(result)) return null;
  }
  return result;
}
