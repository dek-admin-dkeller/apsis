/** Search box with autocomplete. The lookups themselves are hash-table reads in data/catalog.ts. */

import { searchCatalog, type Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { $ } from './dom.ts';
import { describe } from '../data/describe.ts';
import { articleFor, wikiSummary } from '../data/wiki.ts';
import { modelThumbnail } from '../render/satModels.ts';

/**
 * The little picture beside a suggestion: a real photo from Wikipedia when the object's
 * programme has one, otherwise a render of its 3D model, otherwise the plain coloured dot.
 */
function thumbnail(sat: Satellite): HTMLElement {
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

export function initSearch(getCatalog: () => Catalog | null, onSelect: (sat: Satellite) => void): void {
  const input = $<HTMLInputElement>('search');
  const list = $('suggestions');
  let results: Satellite[] = [];
  let active = 0;

  const close = () => list.classList.remove('is-open');

  const render = () => {
    list.replaceChildren();
    if (!input.value.trim()) return close();
    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No object with that name or ID';
      list.append(li);
    }
    results.forEach((sat, i) => {
      const li = document.createElement('li');
      li.className = i === active ? 'is-active' : '';
      const dot = thumbnail(sat);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = sat.name;
      const id = document.createElement('span');
      id.className = 'num muted';
      id.textContent = String(sat.noradId);
      li.append(dot, name, id);
      li.addEventListener('pointerdown', (event) => {
        event.preventDefault(); // keep focus until we have handled the choice
        choose(sat);
      });
      list.append(li);
    });
    list.classList.add('is-open');
  };

  const choose = (sat: Satellite) => {
    input.value = sat.name;
    close();
    input.blur();
    onSelect(sat);
  };

  input.addEventListener('input', () => {
    const catalog = getCatalog();
    results = catalog ? searchCatalog(catalog, input.value) : [];
    active = 0;
    render();
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) active = (active + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      render();
    } else if (event.key === 'Enter' && results[active]) {
      choose(results[active]);
    } else if (event.key === 'Escape') {
      close();
      input.blur();
    }
  });
}
