// Obrotówka pojedynczego modelu — zrzuty z kilku kątów do porównania z referencją.
//
//   npm run dev                     # w osobnym terminalu
//   node tools/model-shot.mjs studnia zrzuty/studnia --kąty 0,90,180,270
//
// Stawia obiekt danego typu na pustej planszy, kadruje kamerę na jego ramce
// i zapisuje po jednym zrzucie na każdy kąt (`<prefiks>-<kąt>.png`), przycięte do płótna sceny.
// Model ocenia się z kilku stron: jedno ujęcie od frontu przepuszcza dziurę z tyłu
// i część wiszącą w powietrzu.
//
// Opcje:
//   --kąty 0,90,180,270   azymut w stopniach (0 = od frontu, czyli od +Z)
//   --wzniesienie 22      kąt kamery nad poziomem
//   --dystans auto|<m>    odległość kamery (auto = z ramki modelu)
//   --cel auto|<m>        wysokość punktu, w który patrzy kamera (auto = środek ramki)
//   --skala 1             skala obiektu
//   --klimat <id>         nastrój pałacu (`ambience`, np. night)
//   --url http://127.0.0.1:5187/
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const type = positional[0];
const prefix = positional[1] ?? `zrzut-${type}`;
if (!type) {
  console.error('Użycie: node tools/model-shot.mjs <typ> <prefiks> [--kąty 0,90,180,270]');
  process.exit(1);
}
mkdirSync(dirname(prefix), { recursive: true });
const angles = opt('kąty', '0,90,180,270').split(',').map(Number);
const elevation = Number(opt('wzniesienie', 22));
const distance = opt('dystans', 'auto');
const aim = opt('cel', 'auto');
const scale = Number(opt('skala', 1));
const ambience = opt('klimat', '');
const url = opt('url', 'http://127.0.0.1:5187/');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(url, { waitUntil: 'networkidle0' });
await wait(1500);

await page.evaluate(() => window.__mneme.getState().createPalace('Podgląd modelu', 'empty'));
await wait(1800);
if (ambience) await page.evaluate((a) => window.__mneme.getState().setSettings({ ambience: a }), ambience);

// ramka modelu (`bounds`) jest w jego układzie — z niej bierze się środek kadru i odległość kamery
const frame = await page.evaluate((t, s) => {
  const store = window.__mneme.getState();
  const id = store.addObject(t, [0, 0, 0], 0, undefined, [s, s, s]);
  store.select(null);
  const entry = window.__scene.entries.get(id);
  if (!entry) return null;
  const b = entry.bounds;
  return { size: Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z), centerY: ((b.min.y + b.max.y) / 2) * s };
}, type, scale);
await wait(900);
if (!frame) {
  console.error(`Nie udało się wstawić obiektu „${type}” — sprawdź identyfikator w src/catalog.ts.`);
  await browser.close();
  process.exit(1);
}
const dist = distance === 'auto' ? Math.max(1.2, frame.size * scale * 1.9) : Number(distance);
// modele sięgające pod ziemię (czerw) mają środek ramki poniżej gruntu — wtedy wysokość celu podaje się ręcznie
const centerY = aim === 'auto' ? frame.centerY : Number(aim);

for (const angle of angles) {
  const box = await page.evaluate((a, d, elev, cy) => {
    const s = window.__scene;
    const rad = (a * Math.PI) / 180;
    const up = (elev * Math.PI) / 180;
    s.tween = null; // kadrowanie po utworzeniu pałacu przesuwa kamerę własnym przejściem
    s.orbit.minDistance = 0.4; // domyślne 3 m nie pozwala podejść do drobnego przedmiotu
    s.orbit.target.set(0, cy, 0);
    s.camera.position.set(Math.sin(rad) * d * Math.cos(up), cy + d * Math.sin(up), Math.cos(rad) * d * Math.cos(up));
    s.orbit.update();
    const r = s.renderer.domElement.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, angle, dist, elevation, centerY);
  await wait(450);
  const out = `${prefix}-${angle}.png`;
  await page.screenshot({ path: out, clip: box });
  console.log(out);
}

if (logs.length) console.log(logs.join('\n'));
// zamknięcie przeglądarki potrafi nie wrócić przy programowym renderowaniu — zrzuty są już na dysku,
// więc po chwili kończymy proces sami
await Promise.race([browser.close(), wait(4000)]);
process.exit(0);
