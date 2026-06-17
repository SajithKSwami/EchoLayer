// Embedding <-> BLOB codec (D3). Float32 keeps blobs compact; cosine tolerates the precision.

export function encodeVec(arr) {
  const f = Float32Array.from(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function decodeVec(blob) {
  if (!blob || blob.length === 0) return [];
  const u = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  // Copy to a fresh, 4-byte-aligned buffer before viewing as Float32.
  const copy = u.slice();
  return Array.from(new Float32Array(copy.buffer));
}
