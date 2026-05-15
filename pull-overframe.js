// Overframe.gg community builds scraper.
//
// Overframe has no public API. This script scrapes the Next.js __NEXT_DATA__
// JSON embedded in three public listing pages:
//   https://overframe.gg/builds/warframes/   (category "Suits")
//   https://overframe.gg/builds/weapons/     (category "Weapons")
//   https://overframe.gg/builds/companions/  (category "Companions")
//
// Each listing returns the top 100 builds for the category, already ranked by
// score (votes). We dedupe by item (frame / weapon / companion) and keep the
// top-N per item. With --enrich, we additionally fetch each build's detail
// page to extract the active mod loadout from props.pageProps.buildState.mods
// and the author's guide markdown.
//
// Run:    node pull-overframe.js
// Flags:  --force        ignore the 24h cache
//         --limit=N      top-N builds per item (default 2)
//         --enrich       also fetch each build detail page for mods + guide
//                        (adds ~1.5s per build; off by default)//         --no-catalog   skip the mod-id→name catalog step (only relevant with --enrich)//         --debug        dump raw HTML/JSON to data/overframe-debug/
//
// Output: data/overframe-builds.json

const https = require('https');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = 'https://overframe.gg';
const CATEGORIES = [
  { slug: 'warframes', label: 'Warframes' },
  { slug: 'archwing', label: 'Archwings' },
  { slug: 'sentinels', label: 'Sentinels' },
];
const OUTPUT = path.join(__dirname, 'data', 'overframe-builds.json');
const CATALOG_OUTPUT = path.join(__dirname, 'data', 'overframe-mod-catalog.json');
const DEBUG_DIR = path.join(__dirname, 'data', 'overframe-debug');
const THROTTLE_MS = 1500;
const CATALOG_THROTTLE_MS = 500; // small JSON endpoint, lighter load
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const USER_AGENT =
  'OdaFragment-DataPipeline/1.0 (+github.com/aidenlong04/warframe-item-pull; contact: repo issues)';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const ENRICH = argv.includes('--enrich');
const NO_CATALOG = argv.includes('--no-catalog');
const DEBUG = argv.includes('--debug');
const LIMIT = (() => {
  const m = argv.find((a) => a.startsWith('--limit='));
  return m ? Math.max(1, parseInt(m.split('=')[1], 10)) : 3;
})();

// Title-text heuristic for the "utility" slot. Looks for builds whose title
// signals a non-DPS role (helminth subsume, support, tank, CC, stealth, etc.).
const UTILITY_RE = /\b(utility|support|helminth|subsume|tank|tanky|defense|defensive|crowd[- ]control|\bcc\b|healer|healing|buff|priming|primer|spy|stealth|invis|hack|extract|farm|loot|speedrun|speed[- ]run|eidolon|profit[- ]taker|granum|disrupt|bounty|hijack|defense|interception|mobile[- ]defense|salvage|excavation)\b/i;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(new URL(res.headers.location, url).toString()).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function extractNextData(html) {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').html();
  if (!raw) { return null; }
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function slugToName(slug) {
  if (!slug) { return null; }
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function locTagToName(locTag) {
  if (!locTag) { return null; }
  const base = locTag.split('/').pop().replace(/Name$/, '');
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

function normalizeListing(b, categoryLabel) {
  const urlPath = b.url || '';
  const parts = urlPath.split('/').filter(Boolean); // [build, id, item-slug, title-slug]
  const itemSlug = parts[2] || null;
  const titleSlug = parts[3] || null;
  const itemName =
    slugToName(itemSlug) ||
    locTagToName(b.item_data && b.item_data.locTag) ||
    null;
  return {
    id: b.id,
    item: itemName,
    itemSlug,
    titleSlug,
    title: b.title || null,
    author: (b.author && b.author.username) || null,
    authorUrl: b.author && b.author.url ? ROOT + b.author.url : null,
    score: b.score ?? null,
    formas: b.formas ?? null,
    guideWords: b.guide_wordcount ?? null,
    category: categoryLabel,
    url: urlPath ? ROOT + urlPath : (b.id ? `${ROOT}/build/${b.id}` : null),
    iconLocTag: (b.item_data && b.item_data.locTag) || null,
  };
}

function dedupeTopPerItem(builds, limit) {
  const counts = new Map();
  const out = [];
  for (const b of builds) {
    const key = b.itemSlug || b.item || `id-${b.id}`;
    const n = counts.get(key) || 0;
    if (n >= limit) { continue; }
    counts.set(key, n + 1);
    out.push(b);
  }
  return out;
}

async function fetchListing(cat) {
  const url = `${ROOT}/builds/${cat.slug}/`;
  console.log(`\n[${cat.slug}] ${url}`);
  const html = await fetchText(url);

  if (DEBUG) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `listing-${cat.slug}.html`), html);
  }

  const nd = extractNextData(html);
  if (!nd) { throw new Error('no __NEXT_DATA__ in listing'); }
  if (DEBUG) {
    fs.writeFileSync(path.join(DEBUG_DIR, `listing-${cat.slug}-nextdata.json`), JSON.stringify(nd, null, 2));
  }

  const pp = nd.props && nd.props.pageProps;
  const builds = (pp && Array.isArray(pp.builds)) ? pp.builds : [];
  const overframeLabel = (pp && pp.category) || '(unknown)';
  const label = cat.label;
  console.log(`  overframe label="${overframeLabel}", display label="${label}", listing length=${builds.length}`);

  const normalized = builds.map((b) => normalizeListing(b, label));
  const picked = dedupeTopPerItem(normalized, LIMIT);
  console.log(`  picked ${picked.length} unique-item builds (limit ${LIMIT} per item)`);
  return picked;
}

// Fetch builds for one item via Overframe's REST API. Returns the raw
// score-sorted results (capped to `limit`).
function fetchApiBuilds(itemName, limit = 100) {
  const qs = `item_name=${encodeURIComponent(itemName)}&ordering=-score&limit=${limit}`;
  const url = `${ROOT}/api/v1/builds/?${qs}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Array.isArray(j.results) ? j.results : []);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Three-slot selection per frame:
//   slot 1 = highest score (priority/meta)
//   slot 2 = "utility" pick: highest-score build whose title matches UTILITY_RE,
//            excluding slot 1; if no match, falls back to the next-highest
//   slot 3 = second most-used: next-highest score not already selected
// Returns 0, 1, 2, or 3 builds depending on availability.
function selectThreeBuilds(builds) {
  if (!builds.length) { return []; }
  const taken = new Set();
  const out = [];
  const pick = (b, role) => {
    if (!b || taken.has(b.id)) { return; }
    taken.add(b.id);
    out.push(Object.assign({}, b, { selectionRole: role }));
  };
  // Slot 1: top score
  pick(builds[0], 'top');
  // Slot 2: utility match (skip the one already taken)
  const utility = builds.find((b) => !taken.has(b.id) && b.title && UTILITY_RE.test(b.title));
  if (utility) { pick(utility, 'utility'); }
  // Slot 3 (or 2 if no utility): next highest unused
  for (const b of builds) {
    if (out.length >= 3) { break; }
    if (!taken.has(b.id)) { pick(b, out.length === 1 ? 'runner-up' : 'runner-up'); }
  }
  return out;
}

// Fetch Warframes per-item via the REST API. Iterates every playable frame
// from data/items-Warframes.json (productCategory==='Suits') and picks 3 builds
// (top + utility + runner-up) for each.
async function fetchWarframesViaApi() {
  const wfPath = path.join(__dirname, 'data', 'items-Warframes.json');
  if (!fs.existsSync(wfPath)) {
    throw new Error(`missing ${wfPath} — run \`npm run pull\` first`);
  }
  const all = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  const frames = all
    .filter((e) => e.productCategory === 'Suits' && e.name)
    .map((e) => e.name)
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .sort();
  console.log(`\n[warframes] per-item API mode — ${frames.length} frames`);
  const out = [];
  const stats = { hit: 0, empty: 0, error: 0 };
  for (let i = 0; i < frames.length; i++) {
    const name = frames[i];
    await sleep(800);
    try {
      const results = await fetchApiBuilds(name);
      // The API does loose name matching (e.g. "Loki" returns Loki builds,
      // not Loki Prime). Filter strictly by item_data.locTag/name to be safe.
      const strict = results.filter((b) => {
        const item = (b.item_data && (b.item_data.name || b.item_data.locTag)) || '';
        const slug = (b.url || '').match(/\/build\/\d+\/([^/]+)\//);
        const urlSlug = slug ? slug[1].toLowerCase() : '';
        const target = name.toLowerCase().replace(/\s+/g, '-');
        return urlSlug === target || (item && item.toLowerCase().endsWith(name.toLowerCase()));
      });
      const picks = selectThreeBuilds(strict.length ? strict : results);
      if (!picks.length) { stats.empty++; }
      else { stats.hit++; }
      for (const b of picks) {
        const n = normalizeListing(b, 'Warframes');
        n.selectionRole = b.selectionRole;
        // Override item to be the canonical frame name to avoid Overframe
        // returning a near-miss (e.g., "Loki" search matching variants).
        if (!n.item) { n.item = name; }
        out.push(n);
      }
      process.stdout.write(`  [${i + 1}/${frames.length}] ${name.padEnd(22)} -> ${picks.length} build(s)            \r`);
    } catch (e) {
      stats.error++;
      console.log(`\n  !! ${name}: ${e.message}`);
    }
  }
  console.log(`\n  done — frames: ${stats.hit} with builds, ${stats.empty} empty, ${stats.error} errored; total builds = ${out.length}`);
  return out;
}

function extractDetail(nd) {
  const pp = nd && nd.props && nd.props.pageProps;
  if (!pp) { return { error: 'no pageProps' }; }
  const d = pp.data || {};
  const item = pp.item || {};
  const bs = pp.buildState || {};
  const mods = Array.isArray(bs.mods) ? bs.mods : (Array.isArray(d.slots) ? d.slots : null);
  return {
    item: item.name || null,
    title: d.title || null,
    description: d.description || null,
    masteryRank: d.mastery_rank ?? null,
    formas: d.formas ?? null,
    platinumCost: d.platinum_cost ?? null,
    endoCost: d.endo_cost ?? null,
    orokin: bs.orokin ?? null,
    itemRank: bs.itemRank ?? null,
    modCount: mods ? mods.length : null,
    mods,
    guideMarkdown: pp.guideMarkdown || null,
    stats: d.stats || null,
  };
}

async function enrichBuild(b, i, total) {
  await sleep(THROTTLE_MS);
  process.stdout.write(`  [${i}/${total}] ${b.url}\r`);
  let html;
  try { html = await fetchText(b.url); }
  catch (e) {
    console.log(`\n    !! ${e.message}`);
    b.detail = { error: e.message };
    return b;
  }
  if (DEBUG && i <= 2) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(path.join(DEBUG_DIR, `detail-${b.category.toLowerCase()}-${i}-${b.id}.html`), html);
  }
  const nd = extractNextData(html);
  if (!nd) {
    b.detail = { error: 'no __NEXT_DATA__' };
    return b;
  }
  if (DEBUG && i <= 2) {
    fs.writeFileSync(path.join(DEBUG_DIR, `detail-${b.category.toLowerCase()}-${i}-${b.id}.json`), JSON.stringify(nd, null, 2));
  }
  b.detail = extractDetail(nd);
  return b;
}

function shouldUseCache() {
  if (FORCE) { return false; }
  if (!fs.existsSync(OUTPUT)) { return false; }
  const age = Date.now() - fs.statSync(OUTPUT).mtimeMs;
  return age < CACHE_MAX_AGE_MS;
}

// Fetch a single mod page's JSON via Next.js data endpoint. Falls back to
// the HTML page if the JSON endpoint 404s (Overframe redeploys rotate the
// buildId, which we then refresh).
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }, (res) => {
      if (res.statusCode === 404) { return resolve({ __notFound: true }); }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(new URL(res.headers.location, url).toString()).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Discover the current Next.js buildId by scraping any mod-arsenal HTML page.
async function discoverBuildId(probeId) {
  const html = await fetchText(`${ROOT}/items/arsenal/${probeId}/`);
  const m = html.match(/"buildId":"([^"]+)"/);
  return m ? m[1] : null;
}

function collectUniqueModIds(result) {
  const ids = new Set();
  for (const arr of Object.values(result.categories)) {
    if (!Array.isArray(arr)) { continue; }
    for (const b of arr) {
      const mods = b.detail && b.detail.mods;
      if (!Array.isArray(mods)) { continue; }
      for (const m of mods) {
        if (m && m.modId != null) { ids.add(m.modId); }
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}

function loadCatalog() {
  if (!fs.existsSync(CATALOG_OUTPUT)) { return {}; }
  try { return JSON.parse(fs.readFileSync(CATALOG_OUTPUT, 'utf8')); }
  catch (_) { return {}; }
}

async function buildModCatalog(result) {
  const ids = collectUniqueModIds(result);
  if (!ids.length) {
    console.log('No mod ids to resolve.');
    return;
  }
  const catalog = loadCatalog();
  const todo = ids.filter((id) => !catalog[id]);
  console.log(`\nMod catalog: ${ids.length} unique ids, ${todo.length} missing names.`);
  if (!todo.length) { return; }

  let buildId = await discoverBuildId(todo[0]);
  if (!buildId) {
    console.warn('  !! could not discover Next.js buildId; skipping catalog.');
    return;
  }
  console.log(`  buildId=${buildId}`);

  for (let i = 0; i < todo.length; i++) {
    const id = todo[i];
    await sleep(CATALOG_THROTTLE_MS);
    process.stdout.write(`  [${i + 1}/${todo.length}] mod ${id}\r`);
    const url = `${ROOT}/_next/data/${buildId}/items/arsenal/${id}.json`;
    let json;
    try { json = await fetchJson(url); }
    catch (e) {
      console.log(`\n    !! mod ${id}: ${e.message}`);
      continue;
    }
    if (json && json.__notFound) {
      // buildId may have rotated mid-run — re-discover and retry once.
      const refreshed = await discoverBuildId(id);
      if (refreshed && refreshed !== buildId) {
        buildId = refreshed;
        console.log(`\n  buildId rotated -> ${buildId}; retrying...`);
        i--; // retry this id
        continue;
      }
      catalog[id] = { name: null, missing: true };
      continue;
    }
    const item = json && json.pageProps && json.pageProps.item;
    if (item && item.name) {
      catalog[id] = { name: item.name };
    } else {
      catalog[id] = { name: null, missing: true };
    }
    // Periodic flush so a mid-run failure doesn't lose progress.
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(CATALOG_OUTPUT, JSON.stringify(catalog, null, 2));
    }
  }
  fs.writeFileSync(CATALOG_OUTPUT, JSON.stringify(catalog, null, 2));
  const resolved = Object.values(catalog).filter((v) => v && v.name).length;
  console.log(`\n  catalog: ${resolved}/${Object.keys(catalog).length} mods named -> ${CATALOG_OUTPUT}`);
}

async function main() {
  if (shouldUseCache()) {
    console.log(`Cache fresh (<24h). Use --force to refetch. (${OUTPUT})`);
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

  const result = {
    source: 'overframe.gg',
    fetched_at: new Date().toISOString(),
    notice: 'Community-curated builds. Treat as suggestions; never override official game data.',
    limit_per_item: LIMIT,
    enriched: ENRICH,
    categories: {},
  };

  for (const cat of CATEGORIES) {
    try {
      let builds;
      if (cat.slug === 'warframes') {
        // Per-item API fetch so every playable frame gets >=3 builds
        // (top score, utility, runner-up) instead of being squeezed out by
        // the global top-100 listing.
        const apiBuilds = await fetchWarframesViaApi();
        // Merge with the global listing too so any frame missing from the
        // catalog (or named differently) still gets surfaced.
        let listingBuilds = [];
        try { listingBuilds = await fetchListing(cat); }
        catch (e) { console.warn(`[warframes] listing fallback failed: ${e.message}`); }
        const seen = new Set(apiBuilds.map((b) => b.id));
        for (const b of listingBuilds) {
          if (!seen.has(b.id)) { apiBuilds.push(b); seen.add(b.id); }
        }
        builds = apiBuilds;
      } else {
        builds = await fetchListing(cat);
      }
      if (ENRICH) {
        const enriched = [];
        for (let i = 0; i < builds.length; i++) {
          enriched.push(await enrichBuild(builds[i], i + 1, builds.length));
        }
        builds = enriched;
        console.log('');
      }
      result.categories[cat.slug] = builds;
    } catch (e) {
      console.warn(`[${cat.slug}] failed: ${e.message}`);
      result.categories[cat.slug] = { error: e.message };
    }
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  const total = Object.values(result.categories).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  console.log(`\nWrote ${total} builds to ${OUTPUT}`);

  if (ENRICH && !NO_CATALOG) {
    await buildModCatalog(result);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
