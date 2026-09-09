import * as THREE from 'three';
import { Noise2D } from './noise';
import { loadCustomTextures } from '../lib/textureStore';

/** Gdzie wzór ma sens: nawierzchnia planszy i ścieżek, podłoga wnętrza, ściany wnętrza, elewacja budynku. */
export type TextureKind = 'ground' | 'floor' | 'wall' | 'facade';

export interface TextureDef {
  id: string;
  name: string;
  kinds: TextureKind[];
  draw: (ctx: CanvasRenderingContext2D, size: number) => void;
}

// 512 zamiast 256: cegła na fasadzie i deski na podłodze ogląda się z pół metra, a wzór jest rysowany
// proceduralnie raz — kosztuje tylko pamięć (12 wzorów po ~1,3 MB z mipmapami).
const SIZE = 512;

function fill(ctx: CanvasRenderingContext2D, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

/** Ziarno szumu na całej powierzchni — wspólna baza dla materiałów sypkich. */
function grain(ctx: CanvasRenderingContext2D, size: number, seed: number, amount: number, scale = 0.08) {
  const n = new Noise2D(seed);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = n.fbm(x * scale, y * scale, 3) * amount;
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + v));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + v));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + v));
    }
  }
  ctx.putImageData(img, 0, 0);
}

function bricks(ctx: CanvasRenderingContext2D, size: number, rows: number, cols: number, base: string, line: string, jitter: string[]) {
  fill(ctx, size, base);
  const h = size / rows;
  const w = size / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const off = r % 2 === 0 ? 0 : w / 2;
      ctx.fillStyle = jitter[(r * cols + c) % jitter.length];
      ctx.fillRect(c * w + off - w, r * h, w - 2, h - 2);
      ctx.fillRect(c * w + off, r * h, w - 2, h - 2);
    }
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * h);
    ctx.lineTo(size, r * h);
    ctx.stroke();
  }
}

export const BUILTIN_TEXTURES: TextureDef[] = [
  {
    id: 'grass',
    name: 'Trawa',
    kinds: ['ground'],
    draw: (ctx, s) => {
      fill(ctx, s, '#9db884');
      grain(ctx, s, 11, 26, 0.14);
      const n = new Noise2D(3);
      ctx.strokeStyle = 'rgba(120,150,100,0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 500; i++) {
        const x = ((n.noise(i * 0.7, 1) + 1) / 2) * s;
        const y = ((n.noise(1, i * 0.7) + 1) / 2) * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 1.5, y - 4);
        ctx.stroke();
      }
    },
  },
  { id: 'stone', name: 'Płyty kamienne', kinds: ['ground', 'floor', 'facade'], draw: (ctx, s) => { bricks(ctx, s, 4, 4, '#a9a79c', '#8d8b82', ['#bcbab0', '#b4b2a8', '#c2c0b6', '#b8b6ac']); grain(ctx, s, 5, 10); } },
  { id: 'cobble', name: 'Bruk', kinds: ['ground'], draw: (ctx, s) => { bricks(ctx, s, 8, 8, '#8f8b84', '#6f6c66', ['#a5a099', '#9b968f', '#aca79f', '#918c85']); grain(ctx, s, 7, 14); } },
  {
    id: 'sand',
    name: 'Piasek',
    kinds: ['ground'],
    draw: (ctx, s) => {
      fill(ctx, s, '#e0cda2');
      grain(ctx, s, 21, 18, 0.05);
      grain(ctx, s, 22, 8, 0.3);
    },
  },
  {
    id: 'planks',
    name: 'Deski',
    kinds: ['ground', 'floor'],
    draw: (ctx, s) => {
      fill(ctx, s, '#b98a5c');
      const rows = 6;
      const h = s / rows;
      const n = new Noise2D(9);
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = ['#c19264', '#b3835a', '#c79a6c', '#ab7d55'][r % 4];
        ctx.fillRect(0, r * h + 1, s, h - 2);
        ctx.strokeStyle = 'rgba(120,88,60,0.45)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
          const y = r * h + 3 + ((n.noise(r, i) + 1) / 2) * (h - 6);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(s * 0.3, y - 2, s * 0.6, y + 2, s, y);
          ctx.stroke();
        }
      }
    },
  },
  {
    id: 'marble',
    name: 'Marmur',
    kinds: ['floor', 'wall', 'facade'],
    draw: (ctx, s) => {
      fill(ctx, s, '#eeeae2');
      const n = new Noise2D(15);
      ctx.strokeStyle = 'rgba(150,150,145,0.5)';
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 0.5 + ((n.noise(i, 3) + 1) / 2) * 2;
        ctx.beginPath();
        let y = ((n.noise(i, 7) + 1) / 2) * s;
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 16) {
          y += n.noise(x * 0.05, i) * 7;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      grain(ctx, s, 17, 6);
    },
  },
  { id: 'soil', name: 'Ziemia', kinds: ['ground'], draw: (ctx, s) => { fill(ctx, s, '#8d7358'); grain(ctx, s, 31, 30, 0.1); grain(ctx, s, 32, 14, 0.35); } },
  { id: 'snow', name: 'Śnieg', kinds: ['ground'], draw: (ctx, s) => { fill(ctx, s, '#f2f4f6'); grain(ctx, s, 41, 12, 0.12); } },
];

/** Deski o różnych odcieniach z delikatnymi słojami; `rows` desek w poprzek, `along` = poziomo. */
function boards(ctx: CanvasRenderingContext2D, s: number, rows: number, shades: string[], line: string, seed: number, along = true) {
  const n = new Noise2D(seed);
  const t = s / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = shades[r % shades.length];
    if (along) ctx.fillRect(0, r * t + 1, s, t - 2);
    else ctx.fillRect(r * t + 1, 0, t - 2, s);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const o = r * t + 3 + ((n.noise(r, i) + 1) / 2) * (t - 6);
      ctx.beginPath();
      if (along) {
        ctx.moveTo(0, o);
        ctx.bezierCurveTo(s * 0.3, o - 2, s * 0.6, o + 2, s, o);
      } else {
        ctx.moveTo(o, 0);
        ctx.bezierCurveTo(o - 2, s * 0.3, o + 2, s * 0.6, o, s);
      }
      ctx.stroke();
    }
  }
}

/** Parkiet w jodełkę: dwa kierunki klepek na przemian. */
function herringbone(ctx: CanvasRenderingContext2D, s: number) {
  fill(ctx, s, '#8a6845');
  const shades = ['#b98a5c', '#c2956a', '#ad7f54', '#b58860'];
  const w = s / 8; // szerokość klepki
  const len = w * 3;
  let k = 0;
  for (let y = -len; y < s + len; y += w) {
    for (let x = -len; x < s + len; x += len) {
      const off = ((y / w) % 2 + 2) % 2 === 0 ? 0 : w;
      ctx.save();
      ctx.translate(x + off, y);
      ctx.fillStyle = shades[k++ % shades.length];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, -len);
      ctx.lineTo(len + w, -len + w);
      ctx.lineTo(w, w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.strokeStyle = 'rgba(80,55,35,0.35)';
  ctx.lineWidth = 1;
  k = 0;
  for (let y = -len; y < s + len; y += w) {
    for (let x = -len; x < s + len; x += len) {
      const off = ((y / w) % 2 + 2) % 2 === 0 ? 0 : w;
      ctx.beginPath();
      ctx.moveTo(x + off, y);
      ctx.lineTo(x + off + len, y - len);
      ctx.stroke();
    }
  }
}

/** Nieregularne kamienie: poligonalne plamy na spoinie. */
function fieldstones(ctx: CanvasRenderingContext2D, s: number, count: number, shades: string[], joint: string, seed: number) {
  fill(ctx, s, joint);
  const n = new Noise2D(seed);
  const cell = s / Math.sqrt(count);
  let k = 0;
  for (let cy = 0; cy < s; cy += cell) {
    for (let cx = 0; cx < s; cx += cell) {
      const x = cx + cell / 2 + n.noise(cx * 0.1, cy * 0.1) * cell * 0.2;
      const y = cy + cell / 2 + n.noise(cy * 0.1, cx * 0.1) * cell * 0.2;
      const r = cell * 0.42;
      ctx.fillStyle = shades[k++ % shades.length];
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = r * (0.8 + ((n.noise(k, i) + 1) / 2) * 0.3);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function tiles(ctx: CanvasRenderingContext2D, s: number, cols: number, a: string, b: string, line: string) {
  fill(ctx, s, line);
  const t = s / cols;
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? a : b;
      ctx.fillRect(c * t + 1, r * t + 1, t - 2, t - 2);
    }
  }
}

export const EXTRA_TEXTURES: TextureDef[] = [
  // nawierzchnie
  {
    id: 'gravel',
    name: 'Żwir',
    kinds: ['ground'],
    draw: (ctx, s) => {
      fill(ctx, s, '#b3aa9a');
      grain(ctx, s, 51, 22, 0.5);
      const n = new Noise2D(52);
      for (let i = 0; i < 900; i++) {
        const x = ((n.noise(i * 0.31, 2) + 1) / 2) * s;
        const y = ((n.noise(3, i * 0.31) + 1) / 2) * s;
        ctx.fillStyle = ['#9d9486', '#c4bcae', '#8e877b', '#b7ae9f'][i % 4];
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + ((n.noise(i, i) + 1) / 2) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  { id: 'fieldstone', name: 'Kamienie polne', kinds: ['ground'], draw: (ctx, s) => { fieldstones(ctx, s, 36, ['#a39d92', '#8f8a80', '#b0aa9e', '#98928a'], '#6f6a62', 61); grain(ctx, s, 62, 10); } },
  { id: 'pavers', name: 'Kostka', kinds: ['ground'], draw: (ctx, s) => { bricks(ctx, s, 12, 6, '#7b7670', '#5f5b56', ['#9a948c', '#8f8982', '#a29c94', '#938d86']); grain(ctx, s, 71, 12); } },
  {
    id: 'bark',
    name: 'Kora',
    kinds: ['ground'],
    draw: (ctx, s) => {
      fill(ctx, s, '#6e5440');
      grain(ctx, s, 81, 26, 0.2);
      const n = new Noise2D(82);
      for (let i = 0; i < 160; i++) {
        const x = ((n.noise(i * 0.4, 5) + 1) / 2) * s;
        const y = ((n.noise(7, i * 0.4) + 1) / 2) * s;
        ctx.fillStyle = ['#7d6249', '#5c4634', '#86694f'][i % 3];
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(n.noise(i, 1) * 1.5);
        ctx.fillRect(-6, -2, 12, 4);
        ctx.restore();
      }
    },
  },
  // podłogi
  { id: 'parquet', name: 'Parkiet', kinds: ['floor'], draw: (ctx, s) => { herringbone(ctx, s); grain(ctx, s, 91, 6); } },
  { id: 'panels', name: 'Panele', kinds: ['floor'], draw: (ctx, s) => { fill(ctx, s, '#7a5a40'); boards(ctx, s, 4, ['#c9a27a', '#bf9670', '#d0aa83', '#b88f69'], 'rgba(110,80,55,0.35)', 93); } },
  { id: 'darkwood', name: 'Ciemne deski', kinds: ['floor', 'wall', 'facade'], draw: (ctx, s) => { fill(ctx, s, '#3e2c20'); boards(ctx, s, 6, ['#6b4a34', '#5f412e', '#734f38', '#583c2a'], 'rgba(40,25,15,0.5)', 95); } },
  { id: 'concrete', name: 'Beton', kinds: ['floor', 'wall', 'ground', 'facade'], draw: (ctx, s) => { fill(ctx, s, '#a8a7a2'); grain(ctx, s, 101, 16, 0.06); grain(ctx, s, 102, 8, 0.4); } },
  { id: 'tiles', name: 'Płytki', kinds: ['floor', 'wall'], draw: (ctx, s) => { tiles(ctx, s, 8, '#e9e4d8', '#c9c2b2', '#a9a396'); grain(ctx, s, 111, 5); } },
  { id: 'terracotta', name: 'Terakota', kinds: ['floor', 'ground'], draw: (ctx, s) => { bricks(ctx, s, 4, 4, '#a9634a', '#7d4a37', ['#c27a5d', '#b87055', '#c98366', '#b06a50']); grain(ctx, s, 121, 12); } },
  {
    id: 'carpet',
    name: 'Dywan',
    kinds: ['floor'],
    draw: (ctx, s) => {
      fill(ctx, s, '#8a5a5e');
      grain(ctx, s, 131, 18, 0.6);
      ctx.strokeStyle = 'rgba(210,170,120,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(s * 0.08, s * 0.08, s * 0.84, s * 0.84);
      ctx.lineWidth = 1;
      ctx.strokeRect(s * 0.14, s * 0.14, s * 0.72, s * 0.72);
    },
  },
  // ściany
  { id: 'plaster', name: 'Tynk', kinds: ['wall', 'facade'], draw: (ctx, s) => { fill(ctx, s, '#f1ebdf'); grain(ctx, s, 141, 9, 0.05); grain(ctx, s, 142, 5, 0.35); } },
  { id: 'wainscot', name: 'Boazeria', kinds: ['wall'], draw: (ctx, s) => { fill(ctx, s, '#6e4d36'); boards(ctx, s, 5, ['#b98a5c', '#b3835a', '#c19264', '#ad7d55'], 'rgba(100,70,45,0.4)', 151, false); } },
  {
    id: 'wallpaper',
    name: 'Tapeta w pasy',
    kinds: ['wall'],
    draw: (ctx, s) => {
      fill(ctx, s, '#e8dcc8');
      const w = s / 8;
      for (let i = 0; i < 8; i += 2) {
        ctx.fillStyle = '#d9c7ab';
        ctx.fillRect(i * w, 0, w, s);
      }
      ctx.fillStyle = 'rgba(160,120,90,0.35)';
      for (let y = 0; y < s; y += s / 4) for (let i = 1; i < 8; i += 2) ctx.fillRect(i * w + w / 2 - 2, y + s / 8 - 2, 4, 4);
      grain(ctx, s, 161, 4);
    },
  },
  {
    id: 'damask',
    name: 'Tapeta zielona',
    kinds: ['wall'],
    draw: (ctx, s) => {
      fill(ctx, s, '#5f7a68');
      ctx.strokeStyle = 'rgba(200,190,150,0.35)';
      ctx.lineWidth = 2;
      const c = s / 4;
      for (let y = 0; y < s; y += c) {
        for (let x = 0; x < s; x += c) {
          ctx.beginPath();
          ctx.ellipse(x + c / 2, y + c / 2, c * 0.22, c * 0.34, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      grain(ctx, s, 171, 6);
    },
  },
  { id: 'brick', name: 'Cegła', kinds: ['wall', 'ground', 'facade'], draw: (ctx, s) => { bricks(ctx, s, 8, 4, '#a0533f', '#d8cbb8', ['#b0604a', '#a45744', '#b8674f', '#9d5240']); grain(ctx, s, 181, 12); } },
  { id: 'stonewall', name: 'Mur kamienny', kinds: ['wall', 'facade'], draw: (ctx, s) => { fieldstones(ctx, s, 25, ['#b5aea2', '#a39c90', '#c0b9ad', '#aca498'], '#7d776d', 191); grain(ctx, s, 192, 10); } },
  // wzory tylko na elewację — na ścianie wnętrza wyglądałyby jak niedokończony remont
  { id: 'clinker', name: 'Cegła klinkierowa', kinds: ['facade'], draw: (ctx, s) => { bricks(ctx, s, 10, 5, '#5d3a30', '#cfc4b4', ['#7a4436', '#6d3d31', '#834c3c', '#734132']); grain(ctx, s, 201, 10); } },
  { id: 'ashlar', name: 'Cios kamienny', kinds: ['facade'], draw: (ctx, s) => { bricks(ctx, s, 5, 3, '#8e8a80', '#d5cec2', ['#c3bcae', '#b8b1a3', '#cdc6b8', '#beb7a9']); grain(ctx, s, 203, 8); } },
  { id: 'siding', name: 'Deski pionowe', kinds: ['facade'], draw: (ctx, s) => { fill(ctx, s, '#7d5f45'); boards(ctx, s, 7, ['#c49a6c', '#b98f62', '#cda475', '#b48a5e'], 'rgba(90,65,45,0.45)', 205, false); grain(ctx, s, 206, 7); } },
];

export const ALL_TEXTURES: TextureDef[] = [...BUILTIN_TEXTURES, ...EXTRA_TEXTURES];

/** Wzory pasujące do miejsca (nawierzchnia, podłoga, ściana). */
export function texturesOfKind(kind: TextureKind): TextureDef[] {
  return ALL_TEXTURES.filter((t) => t.kinds.includes(kind));
}

let grain2d: THREE.Texture | null = null;
/**
 * Słoje drewna do mnożenia przez kolor warstwy: prawie biała podstawa z ciemniejszymi pasmami, więc
 * kolor roli zostaje dominujący, a słoje tylko go różnicują.
 */
export function grainTexture(): THREE.Texture {
  if (grain2d) return grain2d;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;
  fill(ctx, SIZE, '#f4f1ec');
  const n = new Noise2D(201);
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(120,90,60,${0.12 + ((n.noise(i, 9) + 1) / 2) * 0.18})`;
    ctx.beginPath();
    let x = ((n.noise(i, 3) + 1) / 2) * SIZE;
    ctx.moveTo(x, 0);
    for (let y = 0; y <= SIZE; y += 12) {
      x += n.noise(i, y * 0.04) * 3;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  grain(ctx, SIZE, 202, 5, 0.2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso; // słoje drewna są na każdej podłodze; bez tego migoczą pod ostrym kątem
  tex.repeat.set(2, 2);
  grain2d = tex;
  return tex;
}

const cache = new Map<string, THREE.Texture>();

/**
 * Filtrowanie anizotropowe wzorów. Podłoga i strop oglądane pod ostrym kątem bez niego mienią się pasami —
 * najbardziej na telefonie, gdzie na jeden piksel przypada kilka tekseli. Wartość ustawia scena z możliwości
 * karty; do tego czasu trzymamy bezpieczne 4.
 */
let maxAniso = 4;

/** Bieżące filtrowanie anizotropowe — dla tekstur rysowanych poza tym modułem (tabliczki z tekstem). */
export function maxAnisotropy(): number {
  return maxAniso;
}

/** Ustawia filtrowanie z możliwości renderera i nakłada je na wzory, które już powstały. */
export function setMaxAnisotropy(n: number) {
  const v = Math.max(1, Math.min(16, Math.round(n)));
  if (v === maxAniso) return;
  maxAniso = v;
  for (const tex of cache.values()) {
    tex.anisotropy = v;
    tex.needsUpdate = true;
  }
  if (grain2d) {
    grain2d.anisotropy = v;
    grain2d.needsUpdate = true;
  }
}
const thumbs = new Map<string, string>();

function drawToCanvas(def: TextureDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  def.draw(c.getContext('2d')!, SIZE);
  return c;
}

/** Tekstura wbudowana albo własna (dataURL). Zwraca null dla „bez tekstury". */
export function getTexture(id: string | undefined, customUrl?: string): THREE.Texture | null {
  if (!id) return null;
  const key = customUrl ? `custom:${id}` : id;
  const hit = cache.get(key);
  if (hit) return hit;
  let tex: THREE.Texture;
  if (customUrl) {
    tex = new THREE.TextureLoader().load(customUrl);
  } else {
    const def = ALL_TEXTURES.find((t) => t.id === id);
    if (!def) return null;
    tex = new THREE.CanvasTexture(drawToCanvas(def));
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  cache.set(key, tex);
  return tex;
}

/** Tekstura po id z dowolnego źródła: wbudowana albo własna (`c_…` z pamięci przeglądarki). */
export function textureById(id: string | undefined): THREE.Texture | null {
  if (typeof id !== 'string' || !id) return null; // dane z importu mogą mieć zły typ
  const custom = id.startsWith('c_') ? loadCustomTextures().find((t) => t.id === id) : undefined;
  return getTexture(id, custom?.dataUrl);
}

/** Miniatura do wyboru w interfejsie. */
export function textureThumb(id: string): string {
  const hit = thumbs.get(id);
  if (hit) return hit;
  const def = ALL_TEXTURES.find((t) => t.id === id);
  if (!def) return '';
  const c = drawToCanvas(def);
  const small = document.createElement('canvas');
  small.width = 64;
  small.height = 64;
  small.getContext('2d')!.drawImage(c, 0, 0, 64, 64);
  const url = small.toDataURL('image/png');
  thumbs.set(id, url);
  return url;
}
