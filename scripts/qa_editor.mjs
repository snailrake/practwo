import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { polynomialSource, polynomialValue } from '../frontend/src/polynomial.ts';
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : createRequire(path.resolve('frontend/package.json'))('playwright');
const url = process.env.EDITOR_URL || process.env.APP_URL || 'http://127.0.0.1:8000/';
const native = new URL(url).pathname === '/';
const output = path.resolve(process.env.EDITOR_EVIDENCE || 'report/evidence/editor');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
page.setDefaultTimeout(45000);
const checks = [], errors = []; let requests = 0;
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.url().endsWith('/api/simulate')) requests++; });
const check = (name, passed) => { checks.push({ name, passed: !!passed }); if (!passed) throw Error(name); };
const ready = () => page.locator('.calculation-status[data-ready=true]').waitFor({ timeout: 180000 });
const settled = () => page.getByLabel('Вид формулы', { exact: true }).waitFor().then(() => page.waitForFunction(() => !document.querySelector('[aria-label="Вид формулы"]').disabled));
const tab = name => page.getByRole('button', { name, exact: true }).click();
const activePart = page.locator('.formula-part');
const selectPart = side => page.getByRole('button', { name: side === 'plus' ? 'Первая часть' : 'Вычитаемая часть', exact: true }).click();
const coefficient = name => activePart.getByLabel('Коэффициент ' + name, { exact: true });
const reset = () => page.getByRole('button', { name: /^Сбросить (уравнение|фактор)$/ }).click();
const form = async degree => { await settled(); await page.getByLabel('Вид формулы', { exact: true }).selectOption(String(degree)); await ready(); await settled(); };
const raw = async () => { if (!await page.getByLabel('Формула в редакторе', { exact: true }).isVisible()) await page.getByText('Запись формулы', { exact: true }).click(); return page.getByLabel('Формула в редакторе', { exact: true }); };
const exportResult = async () => {
  await ready(); const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).click();
  const file = await wait, target = path.join(output, 'last-result.json'); await file.saveAs(target);
  return JSON.parse(await fs.readFile(target, 'utf8'));
};
const importConfig = async config => {
  await page.locator('input[type=file]').setInputFiles({ name: 'scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) });
  await page.waitForTimeout(80); await ready();
};
try {
  await page.goto(url); await ready(); await tab('Зависимости'); await settled();
  const startup = await exportResult();
  check('First screen is the inline cubic editor without an extra click', await page.getByRole('heading', { name: 'Редактор зависимостей', exact: true }).isVisible() && await page.getByLabel('Вид формулы', { exact: true }).inputValue() === '3');
  const startupA = await coefficient('a').inputValue();
  check('All four editable fields are physically inside the formula', await activePart.locator('.inline-formula input').count() === 4 && Number(startupA) !== 0 && await coefficient('d').inputValue() === '0');
  const subtracted = page.locator('.formula-part[data-part=minus]');
  check('The first part is the only formula visible by default', await activePart.count() === 1 && await activePart.getAttribute('data-part') === 'plus' && (await page.locator('.equation-divisor').innerText()).includes('2'));
  check('One reset and two equation-part buttons', await page.locator('.editor-heading button').count() === 1 && await page.getByRole('group', {name: 'Часть уравнения', exact: true}).getByRole('button').count() === 2);
  check('Default coefficients are clearly identified as an investigative scenario', await page.locator('.scenario-note').isVisible() && startup.config.name === 'Кубические зависимости');
  await page.screenshot({ path: path.join(output, 'editor-default-desktop.png'), fullPage: true });
  await page.locator('.formula-workspace').screenshot({ path: path.join(output, 'inline-formula.png') });
  for (const [width, height] of [[1366,768], [1280,650]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForFunction(() => {
      const charts = [...document.querySelectorAll('.editor-charts canvas')];
      return charts.length === 2 && charts.every(c => c.getBoundingClientRect().bottom <= innerHeight);
    }, null, { timeout: 6000 });
    check('Formula and both plots visible at ' + width + '×' + height, await coefficient('a').isVisible());
  }
  await page.screenshot({ path: path.join(output, 'editor-laptop.png') });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.waitForTimeout(250);
  const timeCanvas = page.locator('.editor-result-plot canvas');
  const initialTimeCurve = await timeCanvas.evaluate(c => c.toDataURL());
  await coefficient('a').fill('0.9');
  const changed = await exportResult();
  await page.waitForFunction(before => document.querySelector('.editor-result-plot canvas')?.toDataURL() !== before, initialTimeCurve);
  check('Time graph redraws with the solver result from the same inline edit', changed.config.plus[3].startsWith('(0.9)*X1**3') && Math.abs(changed.y.at(-1)[3] - startup.y.at(-1)[3]) > .01 && await page.locator('.editor-result-plot').getAttribute('data-current') === 'true');
  const subtractedField = subtracted.getByLabel('Коэффициент a', { exact: true });
  await selectPart('minus');
  await subtractedField.fill('0.7');
  const bothEdited = await exportResult();
  check('Editing the second cubic preserves its other arguments', await subtracted.isVisible() && bothEdited.config.plus[3] === changed.config.plus[3] && bothEdited.config.minus[3].startsWith('((0.7)*F4**3') && bothEdited.config.minus[3].includes('F1 ** 0.8 * F3'));
  await subtractedField.fill('-');
  await selectPart('plus');
  await coefficient('a').fill('1.2');
  await page.waitForTimeout(550);
  check('An incomplete draft in either part keeps the time result marked old', await page.locator('.editor-result-plot').getAttribute('data-current') === 'false' && await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).isDisabled());
  await reset(); await ready(); await settled();
  const restored = await exportResult();
  check('One reset restores the exact selected scenario in both displayed parts', restored.fingerprint === startup.fingerprint);
  check('Zero coefficients do not invent false singularities', polynomialSource([0,0,0,0], 'X1') === '0' && polynomialValue([0,0,0,0], 1e6) === 0);
  check('Large cancelling terms obey the solver intermediate-value limit', polynomialValue([1e12,-1e12,-5e11,0], 1.5) === null);
  if (native) {
    for (const [name, coefficients, start, end] of [
      ['ordinary cubic', [.2,-.5,1.1,.05], -2, 2], ['large cancelling terms', [1e12,-1e12,-5e11,0], 0, 2], ['zero function', [0,0,0,0], -1e6, 1e6],
    ]) {
      const config = structuredClone(startup.config); config.plus[3] = polynomialSource(coefficients, 'X1');
      const response = await page.request.post(new URL('api/preview', url).href, { data: { config, kind: 'plus', index: 3, argument: 'X1', start, end } });
      const actual = await response.json();
      check(`Immediate curve equals Python: ${name}`, response.ok() && actual.points.length === 201 && actual.points.every(([x,y]) => {
        const local = polynomialValue(coefficients, x); return y === null ? local === null : local !== null && Math.abs(local-y) < 1e-12*(1+Math.abs(y));
      }));
    }
  }
  for (const [name, value] of Object.entries({ a: '.25', b: '-.1', c: '.2', d: '.3' })) await coefficient(name).fill(value);
  const edited = await exportResult();
  check('Inline coefficients reach the integrated expression', edited.config.plus[3] === '(0.25)*X1**3+(-0.1)*X1**2+(0.2)*X1+(0.3)');
  check('Editing the cubic changes actual system results', Math.abs(edited.y.at(-1)[3] - startup.y.at(-1)[3]) > 1e-6);
  await coefficient('d').fill('0,35');
  check('Inline inputs accept a decimal comma', (await exportResult()).config.plus[3].endsWith('(0.35)'));
  const beforeDraft = requests;
  await coefficient('a').fill('-'); await page.waitForTimeout(650);
  check('Incomplete inline input pauses computation and stale export', await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).isDisabled() && requests === beforeDraft);
  await reset(); await ready(); await settled();
  check('Reset clears a draft and returns to the default cubic', (await exportResult()).config.plus[3] === startup.config.plus[3] && await coefficient('a').inputValue() === startupA);
  await form(2);
  check('Quadratic form has exactly three inline coefficients', await activePart.locator('.inline-formula input').count() === 3 && await coefficient('a').count() === 0);
  await form(1);
  check('Linear form has exactly two inline coefficients', await activePart.locator('.inline-formula input').count() === 2 && await coefficient('c').count() === 1);
  await form(0);
  check('Constant form has one inline coefficient', await activePart.locator('.inline-formula input').count() === 1);
  await reset(); await ready(); await settled();
  for (const name of ['a','b','c','d']) await coefficient(name).fill('0');
  await ready();
  check('Zero polynomial is labelled constant without hiding the current four slots', await page.locator('.function-type').innerText() === 'Постоянная' && await activePart.locator('.inline-formula input').count() === 4);
  await coefficient('c').fill('.9'); await ready();
  check('a=b=0 is honestly labelled linear', await page.locator('.function-type').innerText() === 'Линейная');
  await coefficient('a').focus(); await page.getByLabel('Ползунок выбранного коэффициента', { exact: true }).press('End');
  check('One compact slider edits the coefficient selected in the formula', (await exportResult()).config.plus[3].startsWith('(' + await coefficient('a').inputValue() + ')*'));
  await page.waitForTimeout(220);
  const curveBefore = await page.locator('.editor-plot canvas').evaluate(c => c.toDataURL());
  await coefficient('a').fill('.8'); await page.waitForTimeout(220);
  check('The curve visibly redraws when an inline value changes', curveBefore !== await page.locator('.editor-plot canvas').evaluate(c => c.toDataURL()));
  await ready(); await page.screenshot({ path: path.join(output, 'editor-cubic-desktop.png'), fullPage: true });
  await page.getByLabel('Подставляем в формулу', { exact: true }).selectOption('X2');
  check('Changing the argument changes the real solver formula', (await exportResult()).config.plus[3].includes('X2**3'));
  await reset(); await ready(); await settled();
  check('Reset restores both the expression and its original argument', (await exportResult()).config.plus[3] === startup.config.plus[3] && await page.getByLabel('Подставляем в формулу', { exact: true }).inputValue() === 'X1');
  for (let i = 0; i < 11; i++) {
    await page.getByLabel('Что рассчитываем', { exact: true }).selectOption(String(i));
    for (const side of ['plus', 'minus']) {
      await selectPart(side); await settled();
      const zero = startup.config[side][i] === '0';
      check(`Startup ${side} X${i+1} shows its ${zero ? 'original zero' : 'editable cubic'}`, await activePart.locator('.inline-formula input').count() === (zero ? 1 : 4) && await page.getByLabel('Вид формулы', { exact: true }).inputValue() === (zero ? '0' : '3'));
    }
  }
  await page.getByLabel('Что рассчитываем', { exact: true }).selectOption('3'); await selectPart('plus'); await settled();
  await page.getByLabel('Модельный пример', { exact: true }).selectOption('0'); await ready(); await settled();
  const baseline = await exportResult();
  check('Original assignment stays available with its exact linear function', baseline.config.plus[3] === '0.9*X1' && await activePart.locator('.inline-formula input').count() === 2);
  await coefficient('c').fill('1.1'); await ready(); await reset(); await ready(); await settled();
  check('Reset uses the current scenario rather than silently restoring another model', (await exportResult()).config.plus[3] === '0.9*X1');
  for (const side of ['plus','minus']) {
    for (let i = 0; i < 11; i++) {
      await page.getByLabel('Что рассчитываем', { exact: true }).selectOption(String(i)); await selectPart(side); await settled();
      check(`${side} X${i+1} opens its exact original expression`, await (await raw()).inputValue() === baseline.config[side][i] && await activePart.locator('.inline-formula input').count() > 0);
    }
  }
  await page.getByLabel('Что рассчитываем', { exact: true }).selectOption('0'); await settled();
  await activePart.getByLabel('Число 1 в формуле', { exact: true }).fill('0.025');
  const editedProduct = await exportResult();
  check('Inline editing of a multivariable product preserves its other arguments', editedProduct.config.plus[0] === '(0.025)*X2*F1**(0.8)' && await activePart.locator('.inline-formula input').count() === 2);
  await activePart.getByLabel('Число 2 в формуле', { exact: true }).fill('1.1');
  check('Editing a superscript changes the actual exponent', (await exportResult()).config.plus[0] === '(0.025)*X2*F1**(1.1)');
  await activePart.getByLabel('Число 1 в формуле', { exact: true }).fill('0.026');
  check('Repeated literal edits keep stable positions and the other edited value', (await exportResult()).config.plus[0] === '(0.026)*X2*F1**(1.1)');
  await activePart.getByLabel('Число 1 в формуле', { exact: true }).fill('-'); await page.waitForTimeout(450);
  check('Partial literal edit blocks export without corrupting the last formula', await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).isDisabled());
  await reset(); await ready(); await settled();
  check('Reset recovers an incomplete literal in an analytic formula', (await exportResult()).config.plus[0] === baseline.config.plus[0]);
  await page.getByLabel('Что рассчитываем', { exact: true }).selectOption('9'); await settled();
  check('A square root retains its mathematical layout with inline numeric input', await activePart.locator('.inline-formula .root-sign').count() === 1 && await activePart.locator('.inline-formula input').count() === 1);
  await page.getByLabel('Что рассчитываем', { exact: true }).selectOption('2'); await settled();
  await page.getByLabel('По горизонтали', { exact: true }).selectOption('X1'); await settled();
  check('Singular analytic functions start on a readable positive interval', Number(await page.getByLabel('Начало диапазона зависимости', { exact: true }).inputValue()) > 0);
  await page.screenshot({ path: path.join(output, 'editor-analytic-desktop.png'), fullPage: true });
  await page.getByText('Диапазон графика', { exact: true }).click();
  await page.getByLabel('Начало диапазона зависимости', { exact: true }).fill('0');
  await page.getByLabel('Конец диапазона зависимости', { exact: true }).fill('1'); await settled();
  await page.getByText('Пропуски на графике: 1.', { exact: false }).waitFor();
  check('Division and exponents render as mathematics with editable literals', await activePart.locator('.inline-formula .math-fraction').count() > 0 && await activePart.locator('.inline-formula .math-power input').count() > 0);
  await tab('Внешние факторы');
  const factor = i => page.locator('.all-factors').getByRole('group', {name: 'F' + (i + 1), exact: true});
  for (let i = 0; i < 7; i++) {
    check(`F${i+1} uses four fields and the time argument`, await factor(i).locator('input').count() === 4 &&
      (await factor(i).locator('annotation').allTextContents()).includes('F_{' + (i + 1) + '}(t)='));
  }
  await factor(2).getByRole('textbox', {name: 'Коэффициент a', exact: true}).fill('.1');
  const wind = await exportResult();
  check('External cubic really changes the computed trajectory', wind.config.factors[2].includes('t**3') && Math.abs(wind.y.at(-1)[2] - baseline.y.at(-1)[2]) > 1e-6);
  await page.getByRole('button', {name: 'Сбросить F3', exact: true}).click(); await ready();
  if (native) {
    let delayed = 0;
    await page.route('**/api/simulate', async route => { const response = await route.fetch(); if (++delayed === 1) await new Promise(resolve => setTimeout(resolve, 1000)); await route.fulfill({ response }); });
    const firstRequest = page.waitForRequest(r => r.url().endsWith('/api/simulate'));
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.71'); await firstRequest;
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.72'); await page.waitForTimeout(650);
    check('A delayed old computation cannot be marked current', await page.locator('.calculation-status').getAttribute('data-ready') === 'false');
    check('Queued recalculations coalesce to the newest input', (await exportResult()).config.initial[0] === .72 && delayed === 2);
    await page.unroute('**/api/simulate'); await importConfig(baseline.config);
    let failFirst = true;
    await page.route('**/api/simulate', async route => { if (failFirst) { failFirst = false; await new Promise(resolve => setTimeout(resolve, 900)); await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'obsolete error' }) }); } else await route.continue(); });
    const request = page.waitForRequest(r => r.url().endsWith('/api/simulate'));
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.73'); await request;
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.74');
    check('An obsolete error cannot overwrite the newer solve', (await exportResult()).config.initial[0] === .74 && await page.getByRole('alert').count() === 0);
    await page.unroute('**/api/simulate');
  }
  await page.getByLabel('Модельный пример', { exact: true }).selectOption('4'); await ready(); await tab('Зависимости'); await settled();
  for (const width of [1280,800,390]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(180);
    check('Inline formula and page fit width ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.locator('details.initial-details > summary').click();
  await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
  await coefficient('b').fill('.2'); await ready();
  check('Inline editing works on a phone', (await exportResult()).config.plus[3].includes('(0.2)*X1**2'));
  await reset(); await ready();
  check('No KaTeX errors or uncaught JavaScript errors', await page.locator('.katex-error').count() === 0 && errors.length === 0);
} catch (e) {
  await page.screenshot({ path: path.join(output, 'editor-failure.png'), fullPage: true }); throw e;
} finally {
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ url, checks, errors }, null, 2)); await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }, null, 2));
