/**
 * Keeping an open tab up to date with what the site has published since it was loaded.
 *
 * The site refreshes its data files every few hours (see .github/workflows/deploy.yml), but a
 * page only read them when it loaded: a tab opened yesterday showed yesterday's orbits until
 * someone reloaded it. This module asks OUR OWN site, and nobody else, whether a data file has
 * changed, and has the module that owns the file load it again.
 *
 * How little it asks:
 *   - at most once every 30 minutes, and only while the tab is visible (a hidden tab asks
 *     nothing; when it is looked at again after a long sleep it asks straight away);
 *   - one HEAD request per file: the reply is headers only, a few hundred bytes. Its `ETag`
 *     (or `Last-Modified`) is compared with that of the copy in use, which `fetchData`
 *     remembered when the file was loaded. Same → nothing more happens;
 *   - different → the owner's `reload()` fetches the file once. A file is watched only after
 *     it has been loaded successfully once, so a file this copy of the site does not have
 *     (changes.json on a local copy) is never asked for again.
 *
 * Seeing a change despite the caches. GitHub Pages sends `Cache-Control: max-age=600`, so for
 * ten minutes a plain fetch is answered by the browser's own cache without asking anyone.
 * Both requests here are made with `cache: 'no-cache'`, which means "ask the server whether
 * my copy is still good before using it": unchanged costs a 304 and no download, changed
 * brings the new file (and replaces the cached one). The site's own CDN may lag a deployment
 * by up to those ten minutes; the next look catches it. And because a validator says only
 * that the file was published again, not that its contents are newer, every owner compares
 * the `fetchedAt` inside the file with the one in use before changing anything.
 *
 * Some files must not be swapped at any moment (the catalogue: not in the middle of a
 * close-approach replay). An owner says so with `when()`; the file then stays marked and is
 * tried again each minute, with no further request, until the moment is right.
 */

const CHECK_EVERY_MS = 30 * 60000; // how often the site is asked, at most
const TICK_MS = 60000; // how often a waiting change is offered again (no request is made for that)

/** What `reload()` reports: something the visitor can see changed, nothing did, or "not now, offer it again". */
export type Reloaded = 'changed' | 'same' | 'later';

export interface Owner {
  /** Fetch the file again (through `fetchData(url, true)`) and put what is new to use. */
  reload(): Promise<Reloaded>;
  /** May `reload()` run now? Left out: always. */
  when?(): boolean;
}

interface Watched {
  url: string;
  inUse: string | null; // the validator of the copy this page is using (null: never loaded, or the server sends none)
  changed: boolean; // the site has a different copy that has not been taken yet
  owner: Owner | null;
}

/** One entry per data file, keyed by its path on the site: a hash table, so loaders and the checker find it in one lookup. */
const files = new Map<string, Watched>();

/** "./data/radio.json" and "data/radio.json" are the same file. */
const pathOf = (url: string): string => new URL(url, document.baseURI).pathname;

function entry(url: string): Watched {
  const key = pathOf(url);
  let file = files.get(key);
  if (!file) {
    file = { url, inUse: null, changed: false, owner: null };
    files.set(key, file);
  }
  return file;
}

/** What identifies one published copy of a file: its ETag, or failing that its date. */
const validator = (res: Response): string | null => res.headers.get('etag') ?? res.headers.get('last-modified');

/**
 * Fetch one of the site's own data files and remember which copy came back. Every loader of a
 * watched file goes through here. `fresh` asks the server before trusting the browser's cache
 * (see the header); the first load of a page does not need it.
 */
export async function fetchData(url: string, fresh = false): Promise<Response> {
  const res = await fetch(url, fresh ? { cache: 'no-cache' } : undefined);
  if (res.ok) entry(url).inUse = validator(res);
  return res;
}

/** Say who loads `url`, so that it can be told to load it again when the site has a newer copy. */
export function watchData(url: string, owner: Owner): void {
  entry(url).owner = owner;
}

let lastLook = Date.now(); // the page has only just loaded everything: the first look is half an hour away
let busy = false;

/** Ask the site, once, which watched files it now has a different copy of. */
async function look(): Promise<void> {
  for (const file of files.values()) {
    if (!file.owner || !file.inUse || file.changed) continue;
    try {
      const res = await fetch(file.url, { method: 'HEAD', cache: 'no-cache' });
      const now = res.ok ? validator(res) : null;
      if (now && now !== file.inUse) file.changed = true;
    } catch { /* offline, or the site is unreachable: look again next time */ }
  }
}

/**
 * Start looking. `onChange` is called after a round in which at least one owner reported a
 * change the visitor can see: the place for one quiet message.
 */
export function startFreshness(onChange: () => void): void {
  const tick = async (): Promise<void> => {
    if (document.hidden || busy) return;
    busy = true;
    try {
      // The wall clock, not the page's own timer: a laptop that slept all night is due at once.
      if (Date.now() - lastLook >= CHECK_EVERY_MS) {
        lastLook = Date.now();
        await look();
      }
      let seen = false;
      for (const file of files.values()) {
        if (!file.changed || !file.owner || !(file.owner.when?.() ?? true)) continue;
        try {
          const outcome = await file.owner.reload();
          if (outcome !== 'later') file.changed = false;
          if (outcome === 'changed') seen = true;
        } catch (error) {
          console.error('A data file could not be refreshed', error); // an optional extra: the page carries on with what it has
          file.changed = false; // do not retry every minute: the next look will mark it again
        }
      }
      if (seen) onChange();
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), TICK_MS);
  document.addEventListener('visibilitychange', () => void tick());
}
