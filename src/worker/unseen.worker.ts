/**
 * Fills in the parts of a world no camera has photographed, off the main thread.
 *
 * The bundled maps give those parts one flat tone (scripts/build-space-maps.py, fill_unseen):
 * Pluto's and Charon's south, the north of Triton and of Uranus's five moons (in darkness when
 * the one spacecraft flew past), Phoebe's gaps, Callisto's poles. Seen on a globe, half a world
 * of flat grey reads as "not rendered" (the owner's words), so by default the app draws an
 * EDUCATED GUESS there instead, and says so (Settings → "Fill in unseen ground", the world's card):
 *
 *   1. find the flat area: on a small copy, pixels within a few levels of the flat tone that are
 *      joined to the top or bottom edge of the map (the unseen parts all touch a pole there),
 *      so a smooth patch inside the photographed part is never touched;
 *   2. take the world's own photographed terrain, mirrored north–south and turned half a turn
 *      (so no landmark appears twice in the same place), and lay it into that area through a
 *      soft-edged mask scaled up from the small copy.
 * Nothing is invented from outside: the guess has that world's own colours, brightness and
 * kinds of terrain. Messages: { id, bitmap } in, { id, bitmap } out (the input is consumed).
 */

/// <reference lib="webworker" />

const SMALL_W = 256;
const SMALL_H = 128;
const TOLERANCE = 7; // levels (of 255) from the flat tone; JPEG leaves the fill within ±3

function fill(bitmap: ImageBitmap): ImageBitmap {
  const w = bitmap.width, h = bitmap.height;
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);

  // 1. The flat area, on a small copy.
  const small = new OffscreenCanvas(SMALL_W, SMALL_H);
  const sg = small.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(bitmap, 0, 0, SMALL_W, SMALL_H);
  const px = sg.getImageData(0, 0, SMALL_W, SMALL_H).data;
  const at = (x: number, y: number) => 4 * (y * SMALL_W + x);
  // The tone: the colour of whichever pole row is the flatter (the unseen part reaches it).
  const rowTone = (y: number): { tone: [number, number, number]; spread: number } => {
    const sum = [0, 0, 0];
    for (let x = 0; x < SMALL_W; x++) for (let c = 0; c < 3; c++) sum[c] += px[at(x, y) + c];
    const tone = sum.map((v) => v / SMALL_W) as [number, number, number];
    let spread = 0;
    for (let x = 0; x < SMALL_W; x++) for (let c = 0; c < 3; c++) spread += Math.abs(px[at(x, y) + c] - tone[c]);
    return { tone, spread: spread / (3 * SMALL_W) };
  };
  const top = rowTone(1), bottom = rowTone(SMALL_H - 2);
  const { tone, spread } = top.spread < bottom.spread ? top : bottom;
  if (spread > 4) return finish(canvas, bitmap); // no flat pole: nothing was filled in this map
  const flat = (x: number, y: number) => {
    const i = at(x, y);
    return Math.abs(px[i] - tone[0]) < TOLERANCE && Math.abs(px[i + 1] - tone[1]) < TOLERANCE && Math.abs(px[i + 2] - tone[2]) < TOLERANCE;
  };
  // Flood from the top and bottom rows through flat pixels (the map wraps east–west).
  const unseen = new Uint8Array(SMALL_W * SMALL_H);
  const stack: number[] = [];
  for (const y of [0, SMALL_H - 1]) for (let x = 0; x < SMALL_W; x++) if (flat(x, y)) stack.push(y * SMALL_W + x);
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (unseen[k]) continue;
    unseen[k] = 1;
    const x = k % SMALL_W, y = (k - x) / SMALL_W;
    const next = [[(x + 1) % SMALL_W, y], [(x + SMALL_W - 1) % SMALL_W, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of next) if (ny >= 0 && ny < SMALL_H && !unseen[ny * SMALL_W + nx] && flat(nx, ny)) stack.push(ny * SMALL_W + nx);
  }
  let count = 0;
  for (const v of unseen) count += v;
  if (count < SMALL_W * SMALL_H * 0.002) return finish(canvas, bitmap);

  // The mask: grown by a pixel (the source fades into the fill), scaled up smoothly, which softens its edge.
  const maskSmall = new OffscreenCanvas(SMALL_W, SMALL_H);
  const mg = maskSmall.getContext('2d')!;
  const mask = mg.createImageData(SMALL_W, SMALL_H);
  for (let y = 0; y < SMALL_H; y++) {
    for (let x = 0; x < SMALL_W; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) for (let dx = -1; dx <= 1 && !on; dx++) {
        const yy = y + dy;
        if (yy >= 0 && yy < SMALL_H && unseen[yy * SMALL_W + ((x + dx + SMALL_W) % SMALL_W)]) on = 1;
      }
      mask.data[at(x, y) + 3] = on ? 255 : 0;
    }
  }
  mg.putImageData(mask, 0, 0);

  // 2. The world's own terrain, mirrored north–south and turned half a turn, through the mask.
  const copy = new OffscreenCanvas(w, h);
  const cg = copy.getContext('2d')!;
  cg.save();
  cg.translate(0, h);
  cg.scale(1, -1);
  cg.drawImage(bitmap, w / 2, 0);
  cg.drawImage(bitmap, -w / 2, 0);
  cg.restore();
  cg.globalCompositeOperation = 'destination-in';
  cg.imageSmoothingEnabled = true;
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(maskSmall, 0, 0, w, h);
  g.drawImage(copy, 0, 0);
  return finish(canvas, bitmap);
}

function finish(canvas: OffscreenCanvas, bitmap: ImageBitmap): ImageBitmap {
  bitmap.close();
  return canvas.transferToImageBitmap();
}

self.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data;
  let out: ImageBitmap;
  try {
    out = fill(bitmap);
  } catch {
    out = bitmap; // something this browser cannot do: the map as it is
  }
  (self as unknown as Worker).postMessage({ id, bitmap: out }, [out]);
};
