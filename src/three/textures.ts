import * as THREE from 'three';
import { Noise2D } from './noise';

export interface TextureDef {
  id: string;
  name: string;
  draw: (ctx: CanvasRenderingContext2D, size: number) => void;
}

const SIZE = 256;

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
  { id: 'stone', name: 'Płyty kamienne', draw: (ctx, s) => { bricks(ctx, s, 4, 4, '#a9a79c', '#8d8b82', ['#bcbab0', '#b4b2a8', '#c2c0b6', '#b8b6ac']); grain(ctx, s, 5, 10); } },
  { id: 'cobble', name: 'Bruk', draw: (ctx, s) => { bricks(ctx, s, 8, 8, '#8f8b84', '#6f6c66', ['#a5a099', '#9b968f', '#aca79f', '#918c85']); grain(ctx, s, 7, 14); } },
  {
    id: 'sand',
    name: 'Piasek',
    draw: (ctx, s) => {
      fill(ctx, s, '#e0cda2');
      grain(ctx, s, 21, 18, 0.05);
      grain(ctx, s, 22, 8, 0.3);
    },
  },
  {
    id: 'planks',
    name: 'Deski',
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
  { id: 'soil', name: 'Ziemia', draw: (ctx, s) => { fill(ctx, s, '#8d7358'); grain(ctx, s, 31, 30, 0.1); grain(ctx, s, 32, 14, 0.35); } },
  { id: 'snow', name: 'Śnieg', draw: (ctx, s) => { fill(ctx, s, '#f2f4f6'); grain(ctx, s, 41, 12, 0.12); } },
];

const cache = new Map<string, THREE.Texture>();
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
    const def = BUILTIN_TEXTURES.find((t) => t.id === id);
    if (!def) return null;
    tex = new THREE.CanvasTexture(drawToCanvas(def));
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

/** Miniatura do wyboru w interfejsie. */
export function textureThumb(id: string): string {
  const hit = thumbs.get(id);
  if (hit) return hit;
  const def = BUILTIN_TEXTURES.find((t) => t.id === id);
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
