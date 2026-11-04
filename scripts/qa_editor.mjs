import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { polynomialSource, polynomialValue } from '../frontend/src/polynomial.ts';
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : createRequire(path.resolve('frontend/package.json'))('playwright');
const url = process.env.EDITOR_URL || process.env.APP_URL || 'http://127.0.0.1:8000/';
const output = path.resolve(process.env.EDITOR_EVIDENCE || 'report/evidence/editor');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
page.setDefaultTimeout(180000);
const checks = [], errors = []; let requests = 0;
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { if (r.url().endsWith('/api/simulate')) requests++; });
const check = (name, passed) => { checks.push({ name, passed: !!passed }); if (!passed) throw Error(name); };
const ready = () => page.locator('.calculation-status[data-ready=true]').waitFor();
const tab = name => page.getByRole('button', { name, exact: true }).click();
const coefficient = name => page.getByLabel('Коэффициент ' + name, { exact: true });
const exportResult = async () => {
  await ready(); const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).click();
  const file = await wait, target = path.join(output, 'last-result.json'); await file.saveAs(target);
  return JSON.parse(await fs.readFile(target, 'utf8'));
};
const importConfig = async config => {
  await page.locator('input[type=file]').setInputFiles({ name: 'scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)) });
  await page.waitForTimeout(100); await ready();
};
const restored = c => JSON.stringify(c.plus) === JSON.stringify(baseline.config.plus) && JSON.stringify(c.minus) === JSON.stringify(baseline.config.minus) && JSON.stringify(c.factors) === JSON.stringify(baseline.config.factors);
let baseline;
try {
  await page.goto(url); await ready(); baseline = await exportResult();
  check('Zero coefficients are omitted without inventing false singularities', polynomialSource([0,0,0,0], 'X1') === '0' && polynomialValue([0,0,0,0], 1e6) === 0);
  check('Large cancelling terms obey the solver intermediate-value limit', polynomialValue([1e12,-1e12,-5e11,0], 1.5) === null);
  if (new URL(url).pathname === '/') {
    for (const [name, coefficients, start, end] of [
      ['ordinary cubic', [.2,-.5,1.1,.05], -2, 2],
      ['large cancelling terms', [1e12,-1e12,-5e11,0], 0, 2],
      ['zero function on a wide interval', [0,0,0,0], -1e6, 1e6],
    ]) {
      const config = structuredClone(baseline.config); config.plus[3] = polynomialSource(coefficients, 'X1');
      const response = await page.request.post(new URL('api/preview', url).href, { data: { config, kind: 'plus', index: 3, argument: 'X1', start, end } });
      const actual = await response.json();
      check(`Immediate curve equals Python evaluation: ${name}`, response.ok() && actual.points.length === 201 && actual.points.every(([x,y]) => {
        const local = polynomialValue(coefficients, x);
        return y === null ? local === null : local !== null && Math.abs(local-y) < 1e-12*(1+Math.abs(y));
      }));
    }
  }
  check('Automatic initial solve; no Calculate button', await page.getByRole('button', { name: 'Рассчитать', exact: true }).count() === 0);
  await tab('Зависимости');
  await coefficient('c').waitFor();
  check('Exact linear source opens four coefficients without changing the model', await coefficient('c').inputValue() === '0.9' && restored((await exportResult()).config));
  await page.getByRole('button', { name: 'Пример кубической', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.function-type')?.textContent === 'Кубическая');
  const cubic = await exportResult();
  check('Cubic demo changes the real integrated function', cubic.config.plus[3].includes('**3') && Math.abs(cubic.y.at(-1)[3] - baseline.y.at(-1)[3]) > 1e-5);
  check('Cubic demo leaves the other 21 model functions intact', cubic.config.plus.every((s, i) => i === 3 || s === baseline.config.plus[i]) && JSON.stringify(cubic.config.minus) === JSON.stringify(baseline.config.minus));
  for (const [name, value] of Object.entries({ a: '.25', b: '-.1', c: '.2', d: '.3' })) await coefficient(name).fill(value);
  const edited = await exportResult();
  check('Four entered coefficients reach the actual solver', edited.config.plus[3] === '(0.25)*X1**3+(-0.1)*X1**2+(0.2)*X1+(0.3)');
  await coefficient('d').fill('0,35');
  check('Decimal comma is accepted by coefficient inputs', (await exportResult()).config.plus[3].endsWith('(0.35)'));
  const beforeDraft = requests;
  await coefficient('a').fill('-'); await page.waitForTimeout(650);
  check('Incomplete coefficient pauses the solve and disables stale exports', await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).isDisabled() && (await page.locator('.calculation-status').innerText()).includes('Допишите') && requests === beforeDraft);
  await coefficient('a').fill('.4'); await ready();
  check('Completing the coefficient resumes automatic calculation', (await exportResult()).config.plus[3].startsWith('(0.4)*'));
  await coefficient('a').fill('-');
  await page.getByLabel('Модельный пример', { exact: true }).selectOption('0'); await ready(); await coefficient('c').waitFor();
  check('Selecting a preset clears an incomplete coefficient draft', await coefficient('a').inputValue() === '0' && restored((await exportResult()).config));
  await page.getByLabel('Ползунок c', { exact: true }).focus(); await page.getByLabel('Ползунок c', { exact: true }).press('End');
  const sliderValue = Number(await coefficient('c').inputValue());
  check('Slider updates both numeric field and integrated expression', (await exportResult()).config.plus[3].includes(`(${sliderValue})*X1`));
  for (const name of ['a', 'b', 'c', 'd']) await coefficient(name).fill('0');
  await ready();
  check('Zero polynomial is correctly labelled constant', (await page.locator('.function-type').innerText()) === 'Постоянная');
  await coefficient('c').fill('.9'); await ready();
  check('a=b=0 is labelled linear', (await page.locator('.function-type').innerText()) === 'Линейная');
  await coefficient('a').fill('.4'); await ready();
  await page.waitForTimeout(220);
  const curveBefore = await page.locator('.editor-plot canvas').evaluate(c => c.toDataURL());
  await coefficient('a').fill('.8'); await page.waitForTimeout(220);
  const curveAfter = await page.locator('.editor-plot canvas').evaluate(c => c.toDataURL());
  check('The visible function curve changes with the coefficient', curveBefore !== curveAfter);
  await ready();
  await page.screenshot({ path: path.join(output, 'editor-cubic-desktop.png'), fullPage: true });
  await page.getByLabel('Аргумент зависимости', { exact: true }).selectOption('X2');
  const changedArgument = await exportResult();
  check('Changing the argument changes the actual solver expression', changedArgument.config.plus[3].includes('X2**3') && !changedArgument.config.plus[3].includes('X1'));
  await page.getByLabel('Начало диапазона зависимости', { exact: true }).fill('2');
  check('Reversed plot interval has an explicit error', await page.getByText('Задайте конечные границы диапазона:', { exact: false }).isVisible());
  await page.getByLabel('Начало диапазона зависимости', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Из задания', exact: true }).click();
  check('Restore returns exactly to the source functions', restored((await exportResult()).config));
  for (const side of ['plus', 'minus']) {
    await page.getByLabel('Часть уравнения', { exact: true }).selectOption(side);
    for (let i = 0; i < 11; i++) {
      await page.getByLabel('Характеристика в редакторе', { exact: true }).selectOption(String(i));
      await page.getByRole('button', { name: 'Формула', exact: true }).click();
      check(`${side} X${i+1} is selectable with its exact original expression`, await page.getByLabel('Формула в редакторе', { exact: true }).inputValue() === baseline.config[side][i]);
    }
  }
  await page.getByLabel('Формула в редакторе', { exact: true }).fill('1+');
  await page.getByRole('alert').waitFor();
  check('Incomplete formula gives a useful message instead of an endless busy state', (await page.getByRole('alert').innerText()).includes('Допишите формулу') && await page.getByRole('button', { name: 'Результат JSON ↓', exact: true }).isDisabled());
  await page.getByLabel('Формула в редакторе', { exact: true }).fill('1.');
  check('A complete decimal literal with a trailing point is accepted', (await exportResult()).config.minus[10] === '1.');
  await page.getByRole('button', { name: 'Из задания', exact: true }).click(); await ready();
  await page.getByLabel('Характеристика в редакторе', { exact: true }).selectOption('2');
  await page.getByLabel('Часть уравнения', { exact: true }).selectOption('plus');
  await page.getByRole('button', { name: 'Формула', exact: true }).click();
  await page.getByLabel('Аргумент зависимости', { exact: true }).selectOption('X1');
  await page.getByText('Пропуски: в 1 точке', { exact: false }).waitFor();
  check('Undefined graph value is displayed as a gap', await page.getByText('Значения не подменяются.', { exact: false }).isVisible());
  await tab('Внешние факторы'); await coefficient('d').waitFor();
  for (let i = 0; i < 7; i++) {
    await page.getByLabel('Фактор в редакторе', { exact: true }).selectOption(String(i));
    await page.getByRole('button', { name: 'Формула', exact: true }).click();
    check(`F${i+1} is selectable; its only independent argument is time`, await page.getByLabel('Формула в редакторе', { exact: true }).inputValue() === baseline.config.factors[i] && await page.getByLabel('Аргумент зависимости', { exact: true }).locator('option').count() === 1);
  }
  await page.getByLabel('Фактор в редакторе', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Пример кубической', exact: true }).click();
  const wind = await exportResult();
  check('External cubic is integrated and changes the system trajectory', wind.config.factors[2].includes('t**3') && Math.abs(wind.y.at(-1)[2] - baseline.y.at(-1)[2]) > 1e-6);
  check('External selector uses both equal-width desktop columns', await page.locator('.external-selection').evaluate(el => {
    const [a,b] = [...el.children].map(c => c.getBoundingClientRect());
    return Math.abs(a.width-b.width) < 1 && Math.abs(b.right-el.getBoundingClientRect().right) < 1;
  }));
  await page.screenshot({ path: path.join(output, 'editor-external-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Из задания', exact: true }).click(); await ready();
  // Native-only deterministic delayed responses expose stale-result/error races.
  if (new URL(url).pathname === '/') {
    let delayed = 0;
    await page.route('**/api/simulate', async route => {
      const response = await route.fetch();
      if (++delayed === 1) await new Promise(resolve => setTimeout(resolve, 1000));
      await route.fulfill({ response });
    });
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.71');
    await page.waitForRequest(r => r.url().endsWith('/api/simulate'));
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.72');
    await page.waitForTimeout(650);
    check('A delayed old calculation is never marked current', await page.locator('.calculation-status').getAttribute('data-ready') === 'false');
    const latest = await exportResult();
    check('Queued solves coalesce to the latest configuration', latest.config.initial[0] === .72 && latest.y[0][0] === .72 && delayed === 2);
    await page.unroute('**/api/simulate'); await importConfig(baseline.config);
    let failFirst = true;
    await page.route('**/api/simulate', async route => {
      if (failFirst) { failFirst = false; await new Promise(resolve => setTimeout(resolve, 900)); await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'obsolete error' }) }); }
      else await route.continue();
    });
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.73');
    await page.waitForRequest(r => r.url().endsWith('/api/simulate'));
    await page.getByLabel('X1 начальное условие', { exact: true }).fill('.74');
    const recovered = await exportResult();
    check('An obsolete error cannot replace a newer successful solve', recovered.config.initial[0] === .74 && await page.getByRole('alert').count() === 0);
    await page.unroute('**/api/simulate'); await importConfig(baseline.config);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  check('External selectors occupy the full mobile width', await page.locator('.external-selection').evaluate(el => [...el.children].every(c => Math.abs(c.getBoundingClientRect().width-el.getBoundingClientRect().width) < 1)));
  await tab('Зависимости'); await coefficient('c').waitFor();
  await page.getByRole('button', { name: 'Пример кубической', exact: true }).click(); await ready();
  check('Editor has no horizontal overflow on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.locator('.function-editor').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'editor-mobile.png'), fullPage: true });
  check('All formulas render without KaTeX errors', await page.locator('.katex-error').count() === 0);
  check('No uncaught JavaScript errors', errors.length === 0);
} catch (e) {
  await page.screenshot({ path: path.join(output, 'editor-failure.png'), fullPage: true }); throw e;
} finally {
  await fs.writeFile(path.join(output, 'checks.json'), JSON.stringify({ url, checks, errors }, null, 2)); await browser.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }, null, 2));
