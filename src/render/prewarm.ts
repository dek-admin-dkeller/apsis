/**
 * Getting the heavy things ready before their first use, a little at a time.
 *
 * The first time a 3D model is shown it has to be built and its shaders compiled, which holds
 * the main thread for a moment: selecting the first satellite would stutter. Opened straight
 * into the tracker, all of that is done at once behind the loading screen (`prewarmModels` in
 * satModels.ts, `tiles.prewarm`). Opened from the home page there is no loading screen to
 * hide behind: the live globe is the page's picture and the visitor may be scrolling. So here
 * the same work is cut into slices, one model per idle moment, and a slice only starts while
 * `quiet()` says the page is not being touched or scrolled.
 *
 * Nothing depends on this having finished. Whatever is not ready when it is first needed is
 * simply built then, as it would be without any warming.
 */

import * as THREE from 'three';
import { KIND_LABEL, type ModelKind } from '../data/describe.ts';
import { buildModel } from './satModels.ts';
import type { EarthTiles } from './tiles.ts';

/** The models most likely to be asked for first; the rest follow in the order they are listed in describe.ts. */
const FIRST: ModelKind[] = ['iss', 'telescope', 'starlink', 'geocomsat', 'dragon', 'debris'];

export function prewarmInIdle(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tiles: EarthTiles, quiet: () => boolean,
): void {
  const holder = new THREE.Group();
  holder.position.set(0, 0, -5000); // far outside the view; compiling does not cull
  holder.scale.setScalar(0.001);

  const kinds = [...FIRST, ...(Object.keys(KIND_LABEL) as ModelKind[]).filter((kind) => !FIRST.includes(kind))];
  const jobs: (() => Promise<unknown> | void)[] = kinds.map((kind) => () => {
    const model = buildModel(kind);
    holder.add(model);
    // compileAsync lets the graphics driver compile in the background where it can, and takes
    // the lights and the environment from the real scene so the programs are the ones used later.
    return renderer.compileAsync(holder, camera, scene).finally(() => holder.remove(model));
  });
  jobs.push(() => tiles.prewarm(renderer, scene, camera)); // the close-up ground's shader, last

  const later = (work: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(work, { timeout: 2500 }) : setTimeout(work, 150));
  const next = (): void => {
    if (jobs.length === 0) return;
    if (!quiet()) return void setTimeout(next, 300);
    const job = jobs.shift()!;
    void Promise.resolve()
      .then(job)
      .catch((error) => console.error('Warming up failed', error)) // an optional extra: never stops the rest
      .then(() => later(next));
  };
  later(next);
}
