// Builds the site for publishing into _site/. Netlify runs this after every change (see netlify.toml).
//
//   node tools/build.mjs
//
// 1. Bakes the CMS content (content/**.json) into the pages: journeys, gallery and prices.
// 2. Writes the language bundles in assets/i18n/ from the catalogs in i18n/ and the CMS translations.
// 3. Copies what the site needs into _site/: the six pages, assets/, admin/, favicon.ico and robots.txt.
//    From "assets/Treavel Images" (the original photos and videos) only the files the site links to are
//    copied. content/, i18n/ and tools/ stay out: the pages already contain everything they need.
// 4. Writes _site/sitemap.xml: every page, with its language versions (?lang=de and so on) so search
//    engines find those too. robots.txt points to it.
//
// If the content has a problem (a missing photo, an unknown category…) the build stops with a message
// and Netlify keeps the last working version of the site online.

import fs from 'node:fs';
import path from 'node:path';
import { PAGES, ROOT } from './bake.mjs';
import { prepare, compile } from './i18n.mjs';

const OUT = path.join(ROOT, '_site');
const ORIGINALS = 'assets/Treavel Images';
const ROOT_FILES = ['favicon.ico', 'robots.txt'];
const TEXT_TYPES = /\.(html|css|js|json|svg)$/i;
const SITE = 'https://damnethtravels.com/';
const LANGUAGES = ['en', 'de', 'fr', 'ru', 'he'];

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(file));
    else out.push(file);
  }
  return out;
}

function size(bytes) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** The files in assets/Treavel Images that a page, stylesheet, script or content file links to. */
function usedOriginals() {
  const dir = path.join(ROOT, ORIGINALS);
  if (!fs.existsSync(dir)) return [];
  const sources = [
    ...PAGES.map((page) => path.join(ROOT, `${page}.html`)),
    ...walk(path.join(ROOT, 'assets')).filter((file) => TEXT_TYPES.test(file) && !rel(file).startsWith(`${ORIGINALS}/`)),
    ...walk(path.join(ROOT, 'content')).filter((file) => file.endsWith('.json')),
  ];
  const text = sources.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  return fs.readdirSync(dir).filter((name) => {
    const forms = [name, encodeURI(name), encodeURIComponent(name), name.replace(/ /g, '%20')];
    return forms.some((form) => text.includes(`Treavel Images/${form}`) || text.includes(`Treavel%20Images/${form}`));
  });
}

/** sitemap.xml listing each page in every language. The hreflang links match the ones in the page heads. */
function sitemap() {
  const urls = [];
  for (const page of PAGES) {
    const base = SITE + (page === 'index' ? '' : `${page}.html`);
    const versions = LANGUAGES.map((lang) => [lang, lang === 'en' ? base : `${base}?lang=${lang}`]);
    const links = [...versions, ['x-default', base]]
      .map(([lang, href]) => `    <xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`);
    for (const [, loc] of versions) urls.push(['  <url>', `    <loc>${loc}</loc>`, ...links, '  </url>'].join('\n'));
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

function build() {
  const started = Date.now();
  const log = (line) => console.log(`  ${line}`);

  console.log('Content');
  const prepared = prepare({ root: ROOT, write: true, log });
  log(prepared.changed.length ? `pages updated: ${prepared.changed.join(', ')}` : 'pages already up to date');

  console.log('Languages');
  const compiled = compile({ root: ROOT, prepared, log });
  log(compiled.written.length ? `bundles written: ${compiled.written.length}` : 'bundles already up to date');
  for (const [code, { total, done }] of Object.entries(compiled.stats)) log(`${code}: ${done} of ${total} page texts translated`);

  console.log('Copying to _site');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const copy = (from, filter) => fs.cpSync(path.join(ROOT, from), path.join(OUT, from), { recursive: true, filter });
  for (const page of PAGES) copy(`${page}.html`);
  for (const file of ROOT_FILES) if (fs.existsSync(path.join(ROOT, file))) copy(file);
  copy('admin');
  copy('assets', (src) => rel(src) !== ORIGINALS);
  const originals = usedOriginals();
  for (const name of originals) copy(`${ORIGINALS}/${name}`);
  log(`${ORIGINALS}: ${originals.length} linked files copied`);
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap());
  log(`sitemap.xml: ${PAGES.length * LANGUAGES.length} addresses`);

  const files = walk(OUT);
  const bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  console.log(`Done: ${files.length} files, ${size(bytes)}, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

try {
  build();
} catch (error) {
  console.error(`\nBuild stopped: ${error.message}`);
  process.exitCode = 1;
}
