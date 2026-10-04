/** Load a registered portrait before generating a fallback from a sprite sheet. */
export interface PortraitTextureStore {
  exists(key: string): boolean;
  addImage(key: string, image: HTMLImageElement): { setFilter(mode: number): unknown } | null;
}

export async function ensurePortraitFile(
  textures: PortraitTextureStore,
  key: string,
  file: string | undefined,
  readImage: (url: string) => Promise<HTMLImageElement | null>,
  filterMode: number,
): Promise<boolean> {
  if (textures.exists(key)) return true;
  if (!file) return false;
  const image = await readImage(file);
  if (!image) return false;
  // A concurrent sheet/portrait request may have installed it while the image loaded.
  if (!textures.exists(key)) textures.addImage(key, image)?.setFilter(filterMode);
  return textures.exists(key);
}
