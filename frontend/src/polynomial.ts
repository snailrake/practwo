// Same term order and per-operation bounds as backend.expressions.Expression.
// This evaluates the function curve; Python still integrates the entire ODE.
export function polynomialSource(coefficients: number[], argument: string) {
  const terms = coefficients.flatMap((value, i) => value === 0 ? [] : [
    `(${value})` + (i < 3 ? '*' + argument + (i < 2 ? '**' + (3-i) : '') : ''),
  ]);
  return terms.join('+') || '0';
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
