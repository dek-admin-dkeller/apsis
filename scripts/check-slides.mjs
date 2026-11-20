// The "How it works" scenes show real code (src/ui/howSlides.ts, rules in src/ui/slideCode.ts).
// This check reads the same rules against the files on disk: every excerpt must be found, must
// end at its closing brace, and every lit line must be in the excerpts of its scene. A renamed
// function or a rewritten line fails here instead of leaving a scene without its code.

import { readFileSync } from 'node:fs';
import { CALLOUTS, EXCERPT_RULES, SCENE_EXCERPTS, excerpt } from '../src/ui/slideCode.ts';

let failed = false;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed = true;
};

const found = {};
for (const [name, rule] of Object.entries(EXCERPT_RULES)) {
  const source = readFileSync(new URL(`../${rule.file}`, import.meta.url), 'utf8');
  const part = excerpt(source, rule.file, rule.start);
  found[name] = part;
  check(part !== null && part.lines.length >= 3 && part.lines.length < 40 && /}\s*$/.test(part.lines.at(-1).text), `excerpt ${name} (${rule.file})`, part ? `lines ${part.lines[0].n}–${part.lines.at(-1).n}` : 'not found');
}
for (const [scene, callouts] of Object.entries(CALLOUTS)) {
  const lines = SCENE_EXCERPTS[scene].flatMap((name) => found[name]?.lines ?? []);
  callouts.forEach((callout, i) => {
    const hits = lines.filter((line) => callout.match.test(line.text));
    check(hits.length > 0, `scene ${scene}: callout ${i + 1} lights a line`, hits.map((line) => line.n).join(', ') || String(callout.match));
  });
}
console.log(failed ? '\nslide checks FAILED' : '\nall slide checks passed');
process.exit(failed ? 1 : 0);
