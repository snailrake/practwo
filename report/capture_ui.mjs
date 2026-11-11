// Capture report figures from the running application, never fabricated UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(path.resolve('frontend/package.json'))('playwright');
const output = path.resolve(process.env.REPORT_CAPTURE || 'report/evidence');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
page.setDefaultTimeout(45000);
const ready = () => page.locator('.calculation-status[data-ready=true]').waitFor();
const settled = () => page.waitForFunction(() => document.querySelector('[aria-label="Вид формулы"]')?.disabled === false);
const tab = name => page.getByRole('button', { name, exact: true }).click();
const capture = async (locator, name) => { await page.evaluate(() => document.fonts.ready); await locator.screenshot({ path: path.join(output, name) }); };
const captureEditor = async (name, viewport = { width: 1366, height: 820 }) => {
  await page.setViewportSize(viewport);
  await page.evaluate(() => { window.scrollTo(0, 0); return document.fonts.ready; });
  await page.locator('.editor-charts canvas').first().waitFor();
  const top = await page.locator('.editor-heading').boundingBox();
  const bottom = await page.locator('.editor-charts').boundingBox();
  await page.screenshot({ path: path.join(output, name), clip: { x: top.x, y: top.y, width: top.width, height: bottom.y + bottom.height - top.y } });
};
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:8000/'); await ready(); await settled();
  await page.locator('.formula-part[data-part=minus] input').first().waitFor();
  await page.locator('.editor-result-plot canvas').waitFor();
  await captureEditor('ui-equations.png', { width: 1344, height: 763 });
  await page.getByLabel('Модельный пример', { exact: true }).selectOption('1'); await ready();
  await tab('Внешние факторы'); await settled();
  await captureEditor('ui-factors.png');
  await page.getByLabel('Модельный пример', { exact: true }).selectOption('0'); await ready();
  await tab('Все результаты');
  await page.getByRole('button', { name: 'Один график', exact: true }).click();
  await page.getByText('Проверка расчёта', { exact: true }).click();
  await page.getByRole('button', { name: 'Проверить расчёт', exact: true }).click();
  await page.getByRole('heading', { name: 'Все численные критерии выполнены', exact: true }).waitFor();
  if (await page.getByRole('cell', { name: 'Пройдена', exact: true }).count() !== 5) throw Error('Numerical verification did not pass');
  await capture(page.locator('.verification-details'), 'ui-verification.png');
  await fs.writeFile(path.join(output, 'report-ui-capture.json'), JSON.stringify({
    source: process.env.APP_URL || 'http://127.0.0.1:8000/',
    figures: { 'ui-equations.png': 'cubic scenario, both parts of X4', 'ui-factors.png': 'original increasing-wind scenario F3', 'ui-verification.png': 'baseline, five executed numerical checks' },
    viewport: { width: 1366, height: 820 },
    equation_viewport: { width: 1344, height: 763 },
    regions: { 'ui-equations.png': 'both equation parts, dependency curve and time result', 'ui-factors.png': 'factor formula and time profile', 'ui-verification.png': 'verification details' },
    passed: true,
  }, null, 2));
  console.log('Three current report screenshots captured; five numerical checks passed.');
} finally { await browser.close(); }
