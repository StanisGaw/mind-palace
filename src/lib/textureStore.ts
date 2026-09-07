/** Własne tekstury podłoża wgrane przez użytkownika (osobny klucz, poza danymi pałacu). */
const KEY = 'mneme.textures.v1';
const MAX = 10;
const SIZE = 512;

export interface CustomTexture {
  id: string;
  name: string;
  dataUrl: string;
}

export function loadCustomTextures(): CustomTexture[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((t) => t?.id && t?.dataUrl) : [];
  } catch {
    return [];
  }
}

function save(list: CustomTexture[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Skaluje obrazek do kwadratu 512×512 i zapisuje jako JPEG, żeby zmieścić się w pamięci przeglądarki. */
export async function addCustomTexture(file: File): Promise<CustomTexture> {
  const list = loadCustomTextures();
  if (list.length >= MAX) throw new Error(`Można zapisać najwyżej ${MAX} własnych tekstur`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Nie udało się wczytać obrazu'));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const entry: CustomTexture = {
      id: 'c_' + Date.now().toString(36),
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Własna',
      dataUrl: c.toDataURL('image/jpeg', 0.85),
    };
    try {
      save([...list, entry]);
    } catch {
      throw new Error('Brak miejsca w pamięci przeglądarki — usuń część własnych tekstur');
    }
    return entry;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function removeCustomTexture(id: string) {
  save(loadCustomTextures().filter((t) => t.id !== id));
}
