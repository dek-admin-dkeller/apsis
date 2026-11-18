/** "Who is aboard right now" — a compact block for the inspector, and a one-line summary. */

import './crew.css';
import { loadCrew, type CrewMember } from '../data/crew.ts';

function memberRow(person: CrewMember): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'crew-row';

  if (person.photoUrl) {
    const photo = document.createElement('img');
    photo.className = 'crew-photo';
    photo.src = person.photoUrl;
    photo.alt = '';
    photo.loading = 'lazy';
    photo.referrerPolicy = 'no-referrer';
    photo.addEventListener('error', () => photo.replaceWith(initials(person.name))); // broken link → initials
    li.append(photo);
  } else {
    li.append(initials(person.name));
  }

  const who = document.createElement('div');
  who.className = 'crew-who';
  const name = document.createElement('b');
  name.textContent = person.name;
  const detail = document.createElement('span');
  detail.textContent = [person.agency ?? person.country, person.role].filter(Boolean).join(', ');
  who.append(name, detail);
  li.append(who);

  if (person.daysInSpace !== undefined) {
    const days = document.createElement('span');
    days.className = 'crew-days';
    days.textContent = person.daysInSpace === 1 ? '1 day' : `${person.daysInSpace} days`;
    days.title = person.spacecraft ? `On this flight, launched aboard ${person.spacecraft}` : 'On this flight';
    li.append(days);
  }
  return li;
}

function initials(name: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'crew-photo crew-initials';
  badge.textContent = name.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

/**
 * Fill `container` with the people aboard one station. Nothing is shown while loading;
 * on failure (or if nobody is listed for that station) the container stays empty.
 */
export function renderCrew(container: HTMLElement, craft: 'ISS' | 'Tiangong'): void {
  container.replaceChildren();
  container.dataset.crewFor = craft; // guards against a late reply for a previous selection
  void loadCrew().then((crew) => {
    if (container.dataset.crewFor !== craft) return;
    const aboard = (crew ?? []).filter((person) => person.craft === craft);
    if (aboard.length === 0) return;
    const heading = document.createElement('p');
    heading.className = 'crew-head';
    heading.textContent = aboard.length === 1 ? '1 person aboard right now' : `${aboard.length} people aboard right now`;
    const list = document.createElement('ol');
    list.className = 'crew-list';
    list.append(...aboard.map(memberRow));
    container.replaceChildren(heading, list);
  });
}

/** One line such as "10 people are in space right now" (left empty if the list cannot be loaded). */
export function renderCrewSummary(el: HTMLElement): void {
  el.textContent = '';
  void loadCrew().then((crew) => {
    if (!crew || crew.length === 0) return;
    el.textContent = crew.length === 1 ? '1 person is in space right now' : `${crew.length} people are in space right now`;
  });
}
