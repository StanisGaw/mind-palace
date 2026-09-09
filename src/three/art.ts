import * as THREE from 'three';

/** Liczba stylów płótna; obraz wybiera styl z hasza swojego id, więc obok siebie wiszą różne. */
export const ART_VARIANTS = 5;

const cache = new Map<number, THREE.CanvasTexture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Pejzaż: niebo, słońce, trzy plany wzgórz. */
function landscape(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#f3d9a6');
  sky.addColorStop(0.6, '#f7ebd6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f2b35a';
  ctx.beginPath();
  ctx.arc(w * 0.7, h * 0.32, h * 0.11, 0, Math.PI * 2);
  ctx.fill();
  const hills: [string, number, number][] = [
    ['#a9bd93', 0.62, 0.12],
    ['#7f9a6f', 0.72, 0.09],
    ['#4f6f52', 0.84, 0.07],
  ];
  for (const [color, base, amp] of hills) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = h * base - Math.sin((x / w) * Math.PI * 2.3 + base * 7) * h * amp - Math.sin((x / w) * Math.PI * 7) * h * amp * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
}

/** Abstrakcja: kremowe tło, pasy i koła w kolorach akcentów. */
function abstract(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#efe7d8';
  ctx.fillRect(0, 0, w, h);
  const colors = ['#c9705f', '#2f5a3c', '#d9b45a', '#6b8fb3', '#3b3f3a'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(w * (0.1 + i * 0.22), 0, w * 0.06, h);
  }
  const circles: [number, number, number, string][] = [
    [0.3, 0.4, 0.2, '#d9b45a'],
    [0.62, 0.58, 0.26, '#c9705f'],
    [0.78, 0.3, 0.12, '#2f5a3c'],
  ];
  for (const [x, y, r, c] of circles) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(w * x, h * y, h * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Martwa natura: stół, wazon, owoce. */
function stillLife(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#3f3a36';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#8b6a4f';
  ctx.fillRect(0, h * 0.68, w, h * 0.32);
  ctx.fillStyle = '#6b8fb3';
  ctx.beginPath();
  ctx.moveTo(w * 0.36, h * 0.68);
  ctx.bezierCurveTo(w * 0.28, h * 0.5, w * 0.34, h * 0.42, w * 0.4, h * 0.32);
  ctx.lineTo(w * 0.48, h * 0.32);
  ctx.bezierCurveTo(w * 0.54, h * 0.42, w * 0.6, h * 0.5, w * 0.52, h * 0.68);
  ctx.closePath();
  ctx.fill();
  const fruit: [number, number, number, string][] = [
    [0.68, 0.62, 0.07, '#c9705f'],
    [0.78, 0.64, 0.06, '#d9b45a'],
    [0.62, 0.65, 0.05, '#7ea06d'],
  ];
  for (const [x, y, r, c] of fruit) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(w * x, h * y, h * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Portret: sylwetka na ciemnym tle z jaśniejszą poświatą. */
function portrait(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.1, w * 0.5, h * 0.5, h * 0.8);
  bg.addColorStop(0, '#6b5a4a');
  bg.addColorStop(1, '#2a2622');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3b3f3a';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 1.02, w * 0.3, h * 0.36, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8cdb0';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.42, w * 0.13, h * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a3a2c';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.3, w * 0.14, h * 0.12, 0, Math.PI, Math.PI * 2);
  ctx.fill();
}

/** Geometria: siatka rombów w dwóch tonach. */
function geometric(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#f7f2e5';
  ctx.fillRect(0, 0, w, h);
  const s = h / 4;
  for (let y = -1; y < 5; y++) {
    for (let x = -1; x < 7; x++) {
      const cx = x * s + (y % 2 ? s / 2 : 0);
      const cy = y * s;
      ctx.fillStyle = (x + y) % 3 === 0 ? '#2f5a3c' : (x + y) % 3 === 1 ? '#c9a45c' : '#b8b2a3';
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.45);
      ctx.lineTo(cx + s * 0.45, cy);
      ctx.lineTo(cx, cy + s * 0.45);
      ctx.lineTo(cx - s * 0.45, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
}

const PAINTERS = [landscape, abstract, stillLife, portrait, geometric];

/** Tekstura płótna danego stylu — pięć sztuk na cały czas życia aplikacji, bez zwalniania. */
export function paintingTexture(variant: number): THREE.CanvasTexture {
  const v = ((variant % ART_VARIANTS) + ART_VARIANTS) % ART_VARIANTS;
  let tex = cache.get(v);
  if (tex) return tex;
  // 512 na bok: płótno ogląda się z pół metra, a malarze rysują względem w/h, więc rośnie tylko pamięć
  const [c, ctx] = canvas(512, 384);
  PAINTERS[v](ctx, c.width, c.height);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(v, tex);
  return tex;
}

let sky: THREE.CanvasTexture | null = null;
/** Jasny „dzień” za oknem pokoju ładowanego: gradient nieba z chmurami, bez cienia. Jedna tekstura na całą sesję. */
export function skyTexture(): THREE.CanvasTexture {
  if (sky) return sky;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#9fc4e8');
  grad.addColorStop(0.7, '#dbe9f4');
  grad.addColorStop(1, '#b9d29a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  for (const [x, y, r] of [[30, 34, 12], [44, 30, 15], [58, 36, 11], [92, 52, 10], [104, 48, 13]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  sky = new THREE.CanvasTexture(c);
  sky.colorSpace = THREE.SRGBColorSpace;
  return sky;
}
