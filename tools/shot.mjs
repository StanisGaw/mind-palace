// Zrzut ekranu aplikacji sterowany skryptem — narzędzie do sprawdzania zmian wizualnych.
//
//   npm run dev            # w osobnym terminalu
//   node tools/shot.mjs http://127.0.0.1:5187/ wynik.png "akcja@@akcja"
//
// Akcje rozdziela '@@' (nie średnik, bo kod JS zawiera średniki):
//   click:<selektor>  clickText:<tekst>  canvas:x,y  move:x,y  drag:x1,y1,x2,y2
//   rightclick:x,y    shiftclick:x,y     wheel:<delta>
//   mdown:x,y  mup  mdrag:x1,y1,x2,y2  (środkowy przycisk myszy)
//   key|down|up:<KodKlawisza>            wait:<ms>
//   upload:<selektor>,<plik>             eval:<javascript>
// SHOT_VIEWPORT=390x844 ustawia rozmiar okna (poniżej 900 px krótszego boku udaje telefon z dotykiem).
//
// W trybie deweloperskim dostępne: window.__mneme (magazyn), __scene (SceneManager),
// __mnemeStorage, __mnemeLandscapes. Wypisuje logi konsoli i błędy strony.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5187/';
const out = process.argv[3] ?? 'shot.png';
const actions = process.argv[4] ?? '';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
// SHOT_VIEWPORT=390x844 (albo 844x390) udaje telefon: dotyk i mobilny user agent
const vp = (process.env.SHOT_VIEWPORT ?? '').match(/^(\d+)x(\d+)$/);
const mobile = !!vp && Math.min(Number(vp[1]), Number(vp[2])) < 900;
await page.setViewport({ width: vp ? Number(vp[1]) : 1600, height: vp ? Number(vp[2]) : 1000, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
if (mobile) await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
for (const a of actions.split('@@').filter(Boolean)) {
  const [kind, ...rest] = a.split(':');
  const arg = rest.join(':');
  if (kind === 'click') await page.click(arg);
  if (kind === 'clickText') {
    const el = await page.$(`::-p-text(${arg})`);
    if (el) await el.click(); else logs.push(`[test] no element with text ${arg}`);
  }
  if (kind === 'canvas') { const [x, y] = arg.split(',').map(Number); await page.mouse.click(x, y); }
  if (kind === 'key') await page.keyboard.press(arg);
  if (kind === 'down') await page.keyboard.down(arg);
  if (kind === 'up') await page.keyboard.up(arg);
  if (kind === 'type') await page.keyboard.type(arg);
  if (kind === 'wait') await new Promise((r) => setTimeout(r, Number(arg)));
  if (kind === 'move') { const [x, y] = arg.split(',').map(Number); await page.mouse.move(x, y, { steps: 4 }); }
  if (kind === 'drag') {
    const [x1, y1, x2, y2] = arg.split(',').map(Number);
    await page.mouse.move(x1, y1); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8); await new Promise((r) => setTimeout(r, 30)); }
    await page.mouse.up();
  }
  if (kind === 'mdown') { const [x, y] = arg.split(',').map(Number); await page.mouse.move(x, y); await page.mouse.down({ button: 'middle' }); }
  if (kind === 'mup') await page.mouse.up({ button: 'middle' });
  if (kind === 'mdrag') {
    const [x1, y1, x2, y2] = arg.split(',').map(Number);
    await page.mouse.move(x1, y1); await page.mouse.down({ button: 'middle' });
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8); await new Promise((r) => setTimeout(r, 30)); }
    await page.mouse.up({ button: 'middle' });
  }
  if (kind === 'rightclick') { const [x, y] = arg.split(',').map(Number); await page.mouse.click(x, y, { button: 'right' }); }
  if (kind === 'shiftclick') { const [x, y] = arg.split(',').map(Number); await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift'); }
  if (kind === 'wheel') await page.mouse.wheel({ deltaY: Number(arg) });
  if (kind === 'upload') { const [sel, file] = arg.split(','); const h = await page.$(sel); if (h) await h.uploadFile(file); else logs.push('[test] no upload input ' + sel); }
  if (kind === 'eval') logs.push('[eval] ' + JSON.stringify(await page.evaluate(arg)));
}
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
