// Pomiar płynności: npm run perf -- [adres] [szablon] [gęstość ekranu]
//   npm run perf -- http://127.0.0.1:5187/ city 2
//
// Otwiera prawdziwe okno Chrome (z GPU — inaczej mierzylibyśmy swiftshadera, nie kartę), buduje pałac
// z szablonu i mierzy w czterech ujęciach: edytor w bezruchu, obrót widoku, spacer w bezruchu, marsz.
// Dla każdego wypisuje średni i najdłuższy czas klatki, liczbę zacięć > 50 ms oraz ile programów shaderów
// przybyło w trakcie — to ostatnie jest głównym podejrzanym przy szarpaniu, bo kompilacja programu blokuje
// wątek na kilkadziesiąt milisekund, a nowy program powstaje przy każdej zmianie liczby widocznych świateł.
//
// Klawisze wciskamy przez `__scene.keys`, bo bez blokady wskaźnika scena ignoruje zdarzenia klawiatury.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://127.0.0.1:5187/';
const template = process.argv[3] ?? 'city';
const dpr = Number(process.argv[4] ?? 2);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--no-sandbox', '--window-size=1600,1000', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: dpr });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'networkidle0' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1500);

// budowa pałacu: ile trwa i ile z tego to klatki dłuższe niż 40 ms (kompilacja shaderów i bryły kolizji)
const build = await page.evaluate(async (tpl) => {
  const t0 = performance.now();
  window.__mneme.getState().createPalace('Pomiar', tpl);
  const marks = [];
  await new Promise((res) => {
    let n = 0;
    const f = () => { marks.push(performance.now()); if (++n < 60) requestAnimationFrame(f); else res(); };
    requestAnimationFrame(f);
  });
  const gaps = marks.map((m, i) => m - (i ? marks[i - 1] : t0));
  const dlugie = gaps.filter((g) => g > 40);
  return { klatki_ponad_40ms: dlugie.length, laczna_zwloka: +dlugie.reduce((a, b) => a + b, 0).toFixed(0) + ' ms', najdluzsza: +Math.max(...gaps).toFixed(0) + ' ms' };
}, template);
console.log('budowa pałacu'.padEnd(24), JSON.stringify(build));
await sleep(6000);

const SAMPLE = `(async (ms) => {
  const r = window.__scene.renderer;
  const programy0 = r.info.programs.length;
  const gaps = []; let last = performance.now(); const t0 = last;
  await new Promise((res) => { const f = () => { const n = performance.now(); gaps.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  gaps.shift();
  const sorted = [...gaps].sort((a, b) => a - b);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return {
    kl_s: +(1000 / avg).toFixed(1),
    srednia: +avg.toFixed(1),
    p95: +sorted[Math.floor(gaps.length * 0.95)].toFixed(0),
    najdluzsza: +sorted[sorted.length - 1].toFixed(0),
    zaciec_ponad_50ms: gaps.filter((x) => x > 50).length,
    nowych_programow: r.info.programs.length - programy0,
    skala: +window.__scene.renderScale.toFixed(2),
  };
})`;
const sample = async (label, ms = 3500) => console.log(label.padEnd(24), JSON.stringify(await page.evaluate(`${SAMPLE}(${ms})`)));
const keys = (on, code) => page.evaluate((on, code) => { const k = window.__scene.keys; on ? k.add(code) : k.delete(code); }, on, code);

await sample('edytor: bezruch');

await page.mouse.move(790, 555);
await page.mouse.down({ button: 'middle' });
const obrot = sample('edytor: obrót widoku');
for (let i = 0; i < 34; i++) { await page.mouse.move(790 + i * 12, 555, { steps: 2 }); await sleep(95); }
await obrot;
await page.mouse.up({ button: 'middle' });

await page.evaluate(() => window.__mneme.getState().setViewMode('fp'));
await sleep(2500);
await page.evaluate(() => window.__scene.placeRig({ x: 0, z: 37, yaw: 0 }));
await sleep(1200);
await sample('spacer: bezruch');
await keys(true, 'KeyW');
await sample('spacer: marsz');
await keys(false, 'KeyW');

await browser.close();
