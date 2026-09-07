import * as THREE from 'three';

export interface TextPanelOpts {
  width?: number; // szerokość w jednostkach sceny
  fontSize?: number; // px na canvasie
  color?: string;
  bg?: string;
  padding?: number;
  align?: 'left' | 'center';
  maxLines?: number;
  title?: string;
  radius?: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

/** Tworzy płaszczyznę z tekstem (canvas → tekstura). Zwraca Mesh z geometrią o zadanej szerokości. */
export function makeTextPanel(text: string, opts: TextPanelOpts = {}): THREE.Mesh {
  const width = opts.width ?? 1.6;
  const fontSize = opts.fontSize ?? 34;
  const pad = opts.padding ?? 28;
  const canvasW = 768;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const lines: { t: string; bold: boolean }[] = [];
  if (opts.title) {
    ctx.font = `700 ${fontSize * 1.1}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    for (const l of wrap(ctx, opts.title, canvasW - pad * 2)) lines.push({ t: l, bold: true });
  }
  ctx.font = `500 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const body = wrap(ctx, text, canvasW - pad * 2).slice(0, opts.maxLines ?? 14);
  for (const l of body) lines.push({ t: l, bold: false });
  const lineH = fontSize * 1.35;
  const canvasH = Math.max(fontSize * 2, Math.ceil(pad * 2 + lines.length * lineH + (opts.title ? fontSize * 0.4 : 0)));
  canvas.width = canvasW;
  canvas.height = canvasH;
  const r = opts.radius ?? 28;
  ctx.fillStyle = opts.bg ?? 'rgba(255,255,255,0.94)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvasW, canvasH, r);
  ctx.fill();
  ctx.fillStyle = opts.color ?? '#20302a';
  ctx.textBaseline = 'top';
  ctx.textAlign = opts.align ?? 'left';
  let y = pad;
  const x = opts.align === 'center' ? canvasW / 2 : pad;
  for (const l of lines) {
    ctx.font = `${l.bold ? 700 : 500} ${l.bold ? fontSize * 1.1 : fontSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillText(l.t, x, y);
    y += lineH;
    if (l.bold && lines.indexOf(l) === (opts.title ? lines.filter((q) => q.bold).length - 1 : -1)) y += fontSize * 0.4;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(width, (width * canvasH) / canvasW);
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 10;
  return mesh;
}

export function disposeTextPanel(m: THREE.Mesh) {
  const mat = m.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.dispose();
  m.geometry.dispose();
}
