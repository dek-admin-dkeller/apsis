/** Small pictures of objects, shared by the search suggestions and the hover card. */

import { describe } from '../data/describe.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { articleFor, wikiSummary } from '../data/wiki.ts';
import { modelThumbnail } from '../render/satModels.ts';

/**
 * A small picture of an object, for search suggestions and the hover card: a real photo from Wikipedia when the object's
 * programme has one, otherwise a render of its 3D model, otherwise the plain coloured dot.
 */
export function thumbnail(sat: Satellite): HTMLElement {
  const model = modelThumbnail(describe(sat).kind);
  if (!model) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.color = CATEGORY_COLORS[sat.category];
    return dot;
  }
  const image = document.createElement('img');
  image.className = 'thumb';
  image.alt = '';
  image.src = model;
  image.style.borderColor = CATEGORY_COLORS[sat.category];
  const article = articleFor(sat);
  if (article) {
    void wikiSummary(article).then((page) => {
      if (!page?.imageUrl || !image.isConnected) return;
      image.referrerPolicy = 'no-referrer';
      image.onerror = () => (image.src = model); // photo failed to load: back to the model
      image.src = page.imageUrl;
      image.classList.add('is-photo');
    });
  }
  return image;
}

