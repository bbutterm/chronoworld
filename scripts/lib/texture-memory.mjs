/** Self-contained for serialization into the browser probe; identity is global across keys. */
export function textureMemory(textures) {
  const owners = new Map();
  return textures.map(({ key, source }) => {
    let bytes = 0;
    const dims = [];
    const sources = [];
    for (const s of source) {
      dims.push(`${s.width}x${s.height}`);
      if (!owners.has(s)) {
        owners.set(s, key);
        bytes += s.width * s.height * 4;
      }
      sources.push(owners.get(s));
    }
    return { key, dims: dims.join('+'), bytes, sources };
  });
}
