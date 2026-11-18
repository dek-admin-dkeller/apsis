/** Search box with autocomplete. The lookups themselves are hash-table reads in data/catalog.ts. */

import { searchCatalog, type Catalog } from '../data/catalog.ts';
import { CATEGORY_COLORS, type Satellite } from '../data/types.ts';
import { $ } from './dom.ts';

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
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.color = CATEGORY_COLORS[sat.category];
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
