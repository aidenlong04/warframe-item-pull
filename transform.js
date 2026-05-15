/**
 * transform.js - Converts all pulled Warframe JSON data into
 * Markdown documentation tuned for Google Gemma 4 ingestion.
 *
 * Run after pull.js:  npm run transform
 *
 * Output: docs/  (one .md per topic, structured for AI consumption)
 *
 * Design (Gemma 4 targeted):
 *  - ASCII only. No unicode bullets, no exotic glyphs.
 *  - Each file opens with a single # heading + one-paragraph description so
 *    Gemma's retriever can score the file against a query in one read.
 *  - Each item is a ## heading; stats live on a single inline line of
 *    `Key: value | Key: value` pairs (token-efficient and easy for a small
 *    model to extract verbatim).
 *  - Tables for repeated structure (drops, recipes, comparisons).
 *  - Wiki narrative is cleaned aggressively (cleanWiki) to remove sections
 *    Gemma cannot use: Patch History, Gallery, Maximization, See Also.
 *  - Modular: each converter is a flat function; add new ones at the bottom.
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');
const DOCS = path.join(__dirname, 'docs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function load(rel) {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), 'utf8'));
}

function tryLoad(rel) {
  try { return load(rel); } catch { return null; }
}

let _fileCount = 0;
function writeMd(relPath, content) {
  const full = path.join(DOCS, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  var clean = content
    .replace(/\[Forum Link\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/Image Description:[^\n]*/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\/Lotus\/Language\/[^\s|)}\]]+/g, '')
    .replace(/\/Lotus\/[^\s|)}\]]+/g, function (m) { return m.split('/').pop(); })
    // <LINE_SEPARATOR> markers (already lost angle brackets via stripTags) → newline
    .replace(/<LINE_SEPARATOR>/g, '\n')
    // Literal backslash-n sequences in source data → real newlines / spaces
    .replace(/\\n\\n/g, '\n')
    .replace(/:\\n\+/g, ': +')
    .replace(/:\\n/g, ': ')
    .replace(/\\n/g, ' ')
    // Double spaces → single
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n(?!#|\|)/g, '\n')
    // Strip trailing whitespace on every line
    .replace(/[ \t]+$/gm, '');
  fs.writeFileSync(full, clean);
  _fileCount++;
  console.log(`  -> docs/${relPath}`);
}

function stripTags(s) {
  if (s == null) { return ''; }
  return String(s).replace(/<[^>]+>/g, '').replace(/Image Description:[^\n]*/g, '');
}

function esc(s) {
  if (s == null) { return ''; }
  return stripTags(String(s)).replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function pct(n) {
  if (n == null) { return '—'; }
  return `${Number(n).toFixed(2)}%`;
}

const POLARITY_NAMES = {
  AP_ATTACK: 'Madurai', AP_DEFENSE: 'Vazarin', AP_TACTIC: 'Naramon',
  AP_POWER: 'Zenurik', AP_WARD: 'Unairu', AP_PRECEPT: 'Penjaga',
  AP_UMBRA: 'Umbra', AP_ANY: 'Universal', AP_UNIVERSAL: 'Universal'
};

function friendlyPolarity(p) {
  return POLARITY_NAMES[p] || p;
}

function heading(title, description) {
  return `# ${title}\n${description}\n\n`;
}

function normStat(s) {
  return stripTags(s).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Wiki enrichment: clean + lookup
// ---------------------------------------------------------------------------
var _LOC_RE = /^(?:de|es|fr|ru|uk|ja|ko|pt|pl|it|tc|th|tr|zh):.*$/;
var _REMOVE_SECTIONS = new Set([
  'Stats', 'Patch History', 'Gallery', 'Media',
  'Maximization', 'Set Bonus',
  'Appearance History', 'Appearance', 'History',
  'See Also', 'See also', 'Bugs', 'References',
  'Normal', 'Flawed' // orphan stat subsection headers from removed wiki tables
]);
var _DROP_HEADERS = new Set(['See Also', 'See also', 'Bugs']);
// Wiki section labels to convert to bold inline labels.
// Acquisition / Drop Locations are kept as narrative because the structured
// drop tables (from items JSON / drops API) are incomplete for many mods
// (e.g. Hall of Ascension rewards, vendor-only mods).
var _LABEL_MAP = {
  'Notes': '**Notes:**',
  'Tips': '**Tips:**',
  'Trivia': '**Trivia:**',
  'Acquisition': '**Acquisition:**',
  'Drop Locations': '**Wiki Drop Sources:**'
};

function cleanWiki(text, itemName) {
  if (!text) { return ''; }

  // Normalize: any line that is exactly a known section header should be
  // its own block. Insert blank lines around such lines so block splitting
  // can handle empty sections correctly (common after wiki tables stripped).
  var _SECTION_NAMES = new Set([
    'Stats', 'Acquisition', 'Drop Locations', 'Notes', 'Tips', 'Trivia',
    'Patch History', 'Gallery', 'Media', 'Maximization', 'Set Bonus',
    'Appearance History', 'Appearance', 'History', 'See Also', 'See also',
    'Bugs', 'References', 'Normal', 'Flawed'
  ]);
  var _normLines = text.split('\n');
  var _norm = [];
  for (var n = 0; n < _normLines.length; n++) {
    var ln = _normLines[n].trim();
    if (_SECTION_NAMES.has(ln)) {
      // Force a block break before the header so it starts a new block.
      if (_norm.length && _norm[_norm.length - 1] !== '') { _norm.push(''); }
      _norm.push(ln);
      // Do NOT insert a blank line after — the next line is the section body
      // and must stay attached for label/body grouping to work.
    } else {
      _norm.push(_normLines[n]);
    }
  }
  text = _norm.join('\n');

  // Split into paragraph blocks (sections separated by blank lines)
  var blocks = text.split(/\n\n/);
  var kept = [];

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim();
    if (!block) { continue; }

    // Check first line — skip entire block if it's a removable section
    var first = block.split('\n')[0].trim();
    if (_REMOVE_SECTIONS.has(first)) { continue; }
    if (_DROP_HEADERS.has(first)) { continue; }

    // Convert section labels to bold inline markers for AI readability.
    // Skip the label entirely if the section has no body content.
    if (_LABEL_MAP[first]) {
      var body = block.slice(first.length).trim();
      if (!body) { continue; }
      block = _LABEL_MAP[first] + '\n' + body;
    }

    // Filter out localization lines within the block
    var lines = block.split('\n');
    var filtered = [];
    for (var j = 0; j < lines.length; j++) {
      if (!_LOC_RE.test(lines[j].trim())) { filtered.push(lines[j]); }
    }
    block = filtered.join('\n').trim();
    if (!block) { continue; }
    kept.push(block);
  }

  var clean = kept.join('\n');

  // FIRST: Clean orphan possessives (must run before comma cleanup)
  // Wikilink target stripped: "[[Trinity]]'s" → " 's"
  clean = clean.replace(/ 's /g, ' ');
  clean = clean.replace(/ 's\./g, '.');
  clean = clean.replace(/ 's,/g, ',');
  clean = clean.replace(/ 's$/gm, '');

  // THEN: Clean orphan comma sequences from stripped wikilinks
  // e.g. "the , , , , and ." → "the and ."
  clean = clean.replace(/ (?:, ){2,}/g, ' ');
  clean = clean.replace(/, ,/g, ',');
  clean = clean.replace(/^, /gm, '');
  clean = clean.replace(/ ,$/gm, '');
  clean = clean.replace(/ , \./g, '.');
  // Clean ", and" after orphan cleanup → "and"
  clean = clean.replace(/ , and /g, ' and ');
  clean = clean.replace(/ , or /g, ' or ');

  // Lines that are essentially empty after cleanup (just commas, spaces, dots)
  clean = clean.replace(/^[\s,.*]+$/gm, '');

  // Leading whitespace on lines
  clean = clean.replace(/^ +/gm, '');

  // Prepend item name if text starts with "is a"/"is an" (stripped wikilink self-reference)
  if (itemName && /^is an?\s/.test(clean)) {
    clean = itemName + ' ' + clean;
  }

  // Collapse excess whitespace
  clean = clean.replace(/\n{3,}/g, '\n\n');

  return clean.trim();
}

var _wikiEnrich = null;
function getWiki(name) {
  if (!_wikiEnrich) {
    _wikiEnrich = tryLoad('wiki-enrichment.json') || {};
    console.log(`  Loaded wiki enrichment: ${Object.keys(_wikiEnrich).length} items`);
  }
  return cleanWiki(_wikiEnrich[name] || '', name);
}

// Split a cleaned wiki blob into { acquisition, drops, rest }.
// Promotes `**Acquisition:**` and `**Wiki Drop Sources:**` blocks out of the
// Wiki section so the AI sees them as structured top-level data, alongside
// the items-JSON drop tables.
function splitWikiSections(wiki) {
  if (!wiki) { return { acquisition: '', drops: '', rest: '' }; }
  var out = { acquisition: '', drops: '', rest: '' };
  var lines = wiki.split('\n');
  var current = 'rest';
  var buckets = { rest: [], acquisition: [], drops: [] };
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/^\*\*Acquisition:\*\*\s*$/.test(ln)) { current = 'acquisition'; continue; }
    if (/^\*\*Wiki Drop Sources:\*\*\s*$/.test(ln)) { current = 'drops'; continue; }
    // Any other bold-label header ends a special section
    if (/^\*\*[A-Za-z][A-Za-z ]+:\*\*\s*$/.test(ln) && current !== 'rest') {
      current = 'rest';
      buckets.rest.push(ln);
      continue;
    }
    buckets[current].push(ln);
  }
  out.acquisition = buckets.acquisition.join('\n').trim();
  out.drops = buckets.drops.join('\n').trim();
  out.rest = buckets.rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function formatDrop(d) {
  return `${d.location} (${pct(d.chance)})`;
}

function compressDrops(drops) {
  if (!drops || !drops.length) { return []; }
  // Group relic refinement tiers into one entry
  const relicMap = new Map();
  var result = [];
  for (const d of drops) {
    if (d.chance === 0) { continue; } // skip 0% drops
    var relicMatch = d.location.match(/^(.+ Relic)(?:\s+\((Exceptional|Flawless|Radiant)\))?$/);
    if (relicMatch) {
      var baseName = relicMatch[1];
      if (!relicMap.has(baseName)) {
        relicMap.set(baseName, { location: baseName, rarity: d.rarity, intact: null });
      }
      var tier = relicMatch[2] || 'Intact';
      if (tier === 'Intact') { relicMap.get(baseName).intact = d.chance; }
    } else {
      result.push(d);
    }
  }
  for (const [, info] of relicMap) {
    result.push({ location: info.location, chance: info.intact || 0, rarity: info.rarity });
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. Warframes
// ---------------------------------------------------------------------------
function transformWarframes() {
  const items = tryLoad('items-Warframes.json');
  if (!items) { return; }

  let md = heading(
    'Warframes',
    'Complete list of all Warframes in Warframe, including stats, abilities, crafting requirements, and component drop locations. ' +
    'Each entry includes the Warframe\'s base stats at rank 0, a full ability breakdown, and where to obtain each crafting component.'
  );

  var seenWf = new Set();
  for (const wf of items) {
    if (seenWf.has(wf.name)) { continue; }
    seenWf.add(wf.name);
    md += `## ${wf.name}\n`;
    if (wf.description) { md += `${stripTags(wf.description)}\n`; }
    var wikiWf = getWiki(wf.name);
    var wfWikiParts = splitWikiSections(wikiWf);
    if (wfWikiParts.acquisition) { md += `\n### Acquisition\n${wfWikiParts.acquisition}\n`; }
    if (wfWikiParts.rest) { md += `\n### Wiki\n${wfWikiParts.rest}\n`; }

    // Stats (inline)
    var wfStats = [];
    if (wf.health != null) { wfStats.push(`Health: ${wf.health}`); }
    if (wf.shield != null) { wfStats.push(`Shield: ${wf.shield}`); }
    if (wf.armor != null) { wfStats.push(`Armor: ${wf.armor}`); }
    if (wf.power != null) { wfStats.push(`Energy: ${wf.power}`); }
    if (wf.sprint != null) { wfStats.push(`Sprint: ${wf.sprint}`); }
    if (wfStats.length) { md += wfStats.join(' | ') + '\n'; }
    var wfMeta = [];
    if (wf.aura) { wfMeta.push(`Aura: ${wf.aura}`); }
    if (wf.masteryReq) { wfMeta.push(`Mastery Req: ${wf.masteryReq}`); }
    if (wfMeta.length) { md += wfMeta.join(' | ') + '\n'; }
    md += '\n';

    // Abilities
    if (wf.abilities && wf.abilities.length) {
      md += '### Abilities\n';
      for (const ab of wf.abilities) {
        md += `**${ab.name}:** ${stripTags(ab.description || 'No description available.')}\n`;
      }
      md += '\n';
    }

    // Components / Crafting
    if (wf.components && wf.components.length) {
      md += '### Crafting Components\n';
      md += '| Component | Count | Drops |\n|---|---|---|\n';
      for (const comp of wf.components) {
        const drops = compressDrops(comp.drops)
          .map(formatDrop)
          .join('; ') || '—';
        md += `| ${esc(comp.name)} | ${comp.itemCount || 1} | ${esc(drops)} |\n`;
      }
      md += '\n';
    }

    // Patch history (concise)
    if (wf.patchlogs && wf.patchlogs.length) {
      const usefulPatches = wf.patchlogs.filter(function (p) {
        var body = (p.changes || p.additions || p.fixes || '').trim();
        return body.length > 0 && body !== p.name && !body.endsWith(':');
      });
      if (usefulPatches.length) {
        md += `### Patch History (${usefulPatches.length} entries)\n`;
        for (const p of usefulPatches.slice(0, 3)) {
          md += `- **${p.name}** (${p.date || ''}): ${esc((p.changes || p.additions || p.fixes || '').slice(0, 200))}\n`;
        }
        if (usefulPatches.length > 3) { md += `- ...and ${usefulPatches.length - 3} more patches\n`; }
        md += '\n';
      }
    }
  }

  writeMd('equipment/warframes.md', md);
}

// ---------------------------------------------------------------------------
// 2. Weapons (Primary, Secondary, Melee, Arch-Gun, Arch-Melee)
// ---------------------------------------------------------------------------
function transformWeapons() {
  const categories = [
    ['items-Primary.json', 'Primary Weapons', 'All primary weapons including rifles, shotguns, bows, and launchers.'],
    ['items-Secondary.json', 'Secondary Weapons', 'All secondary weapons including pistols, thrown weapons, and dual wielded sidearms.'],
    ['items-Melee.json', 'Melee Weapons', 'All melee weapons including swords, polearms, whips, and heavy blades.'],
    ['items-Arch-Gun.json', 'Arch-Guns', 'All Archwing-mounted primary weapons usable in space and with Gravimag on land.'],
    ['items-Arch-Melee.json', 'Arch-Melee Weapons', 'All Archwing-mounted melee weapons.'],
  ];

  for (const [file, title, desc] of categories) {
    const items = tryLoad(file);
    if (!items) { continue; }

    let md = heading(title, desc + ' Includes damage types, critical stats, status chance, and crafting info.');

    var seenW = new Set();
    for (const w of items) {
      if (seenW.has(w.name)) { continue; }
      seenW.add(w.name);
      md += `## ${w.name}\n`;
      if (w.description) { md += `${stripTags(w.description)}\n`; }
      var wikiW = getWiki(w.name);
      var wWikiParts = splitWikiSections(wikiW);
      if (wWikiParts.acquisition) { md += `\n### Acquisition\n${wWikiParts.acquisition}\n`; }
      if (wWikiParts.rest) { md += `\n### Wiki\n${wWikiParts.rest}\n`; }

      // General info
      const meta = [];
      if (w.type) { meta.push(`**Type:** ${w.type}`); }
      if (w.masteryReq) { meta.push(`**Mastery Req:** ${w.masteryReq}`); }
      if (w.disposition) { meta.push(`**Riven Disposition:** ${w.disposition}`); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }
      md += '\n';

      // Attacks
      if (w.attacks && w.attacks.length) {
        for (const atk of w.attacks) {
          md += `### ${atk.name || 'Attack'}\n`;
          if (atk.damage && typeof atk.damage === 'object') {
            const dmgParts = Object.entries(atk.damage)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k}: ${v}`);
            if (dmgParts.length) { md += `**Damage:** ${dmgParts.join(', ')}\n`; }
          }
          const stats = [];
          if (atk.crit_chance != null) { stats.push(`Crit Chance: ${pct(atk.crit_chance)}`); }
          if (atk.crit_mult != null) { stats.push(`Crit Multiplier: ${atk.crit_mult}x`); }
          if (atk.status_chance != null) { stats.push(`Status Chance: ${pct(atk.status_chance)}`); }
          if (atk.speed != null) { stats.push(`Fire Rate: ${atk.speed}`); }
          if (stats.length) { md += stats.join(' | ') + '\n'; }
          md += '\n';
        }
      }

      // Components
      if (w.components && w.components.length) {
        md += '### Crafting\n';
        md += '| Component | Count | Drops |\n|---|---|---|\n';
        for (const c of w.components) {
          const drops = compressDrops(c.drops).map(formatDrop).join('; ') || '—';
          md += `| ${esc(c.name)} | ${c.itemCount || 1} | ${esc(drops)} |\n`;
        }
        md += '\n';
      }
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`weapons/${safe}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// 3. Mods
// ---------------------------------------------------------------------------
function transformMods() {
  const items = tryLoad('items-Mods.json');
  if (!items) { return; }

  let md = heading(
    'Mods',
    'Complete mod database for Warframe. Each mod entry includes its name, polarity, drain, compatibility, ' +
    'all rank-up stat progression, drop locations, and whether it is an augment or prime variant.'
  );

  var seenM = new Set();
  for (const m of items) {
    if (seenM.has(m.name)) { continue; }
    seenM.add(m.name);
    md += `## ${m.name}\n`;
    if (m.description) { md += `${stripTags(m.description)}\n`; }

    const meta = [];
    if (m.rarity) { meta.push(`**Rarity:** ${m.rarity}`); }
    if (m.polarity) { meta.push(`**Polarity:** ${m.polarity}`); }
    if (m.baseDrain != null) { meta.push(`**Drain:** ${m.baseDrain}`); }
    if (m.compatName) { meta.push(`**Compatible:** ${m.compatName}`); }
    if (m.isAugment) { meta.push('**Augment**'); }
    if (m.isPrime) { meta.push('**Prime**'); }
    if (m.fusionLimit != null) { meta.push(`**Max Rank:** ${m.fusionLimit}`); }
    if (meta.length) { md += meta.join(' | ') + '\n'; }
    md += '\n';

    var wikiM = getWiki(m.name);
    var wmParts = splitWikiSections(wikiM);
    if (wmParts.acquisition) {
      md += `### Acquisition\n${wmParts.acquisition}\n\n`;
    }

    // Level stats
    if (m.levelStats && m.levelStats.length) {
      md += '### Stats by Rank\n';
      for (let i = 0; i < m.levelStats.length; i++) {
        const stats = (m.levelStats[i].stats || []).map(normStat).filter(Boolean).join(', ');
        if (stats) { md += `- **Rank ${i}:** ${stats}\n`; }
      }
      md += '\n';
    }

    // Drops
    if (m.drops && m.drops.length) {
      md += '### Drop Locations\n';
      for (const d of m.drops) {
        md += `- ${d.location} — ${d.rarity || ''} (${pct(d.chance)})\n`;
      }
      md += '\n';
    }

    // Wiki drop sources (extracted earlier) — when items-JSON drops are empty
    if (wmParts.drops && (!m.drops || !m.drops.length)) {
      md += `### Drop Locations (Wiki)\n${wmParts.drops}\n\n`;
    }

    // Remaining wiki content (notes, tips, trivia, mechanics)
    if (wmParts.rest) {
      md += `### Wiki\n${wmParts.rest}\n\n`;
    }
  }

  writeMd('mods/mods.md', md);
}

// ---------------------------------------------------------------------------
// 4. Arcanes
// ---------------------------------------------------------------------------
function transformArcanes() {
  const items = tryLoad('items-Arcanes.json');
  if (!items) { return; }

  let md = heading(
    'Arcanes',
    'All Arcane enhancements in Warframe. Includes trigger conditions, stat progression per rank, and drop sources.'
  );

  var seenA = new Set();
  for (const a of items) {
    if (seenA.has(a.name)) { continue; }
    seenA.add(a.name);
    md += `## ${a.name}\n`;
    if (a.description) { md += `${stripTags(a.description)}\n`; }
    md += '\n';

    var wikiA = getWiki(a.name);
    var waParts = splitWikiSections(wikiA);
    if (waParts.acquisition) {
      md += `### Acquisition\n${waParts.acquisition}\n\n`;
    }

    if (a.levelStats && a.levelStats.length) {
      md += '### Stats by Rank\n';
      for (let i = 0; i < a.levelStats.length; i++) {
        const stats = (a.levelStats[i].stats || []).map(normStat).filter(Boolean).join(', ');
        if (stats) { md += `- **Rank ${i}:** ${stats}\n`; }
      }
      md += '\n';
    }

    if (a.drops && a.drops.length) {
      md += '### Drop Sources\n';
      for (const d of a.drops) {
        md += `- ${d.location} — ${d.type || ''} (${pct(d.chance)})\n`;
      }
      md += '\n';
    }

    if (waParts.drops && (!a.drops || !a.drops.length)) {
      md += `### Drop Sources (Wiki)\n${waParts.drops}\n\n`;
    }

    if (waParts.rest) {
      md += `### Wiki\n${waParts.rest}\n\n`;
    }
  }

  writeMd('mods/arcanes.md', md);
}

// ---------------------------------------------------------------------------
// 5. Companions (Pets + Sentinels)
// ---------------------------------------------------------------------------
function transformCompanions() {
  const pets = tryLoad('items-Pets.json') || [];
  const sents = tryLoad('items-Sentinels.json') || [];

  let md = heading(
    'Companions — Pets & Sentinels',
    'All companion types in Warframe including Kubrows, Kavats, MOAs, Hounds, and Sentinels. ' +
    'Includes base stats, crafting requirements, and descriptions.'
  );

  var seenC = new Set();
  for (const c of [...pets, ...sents]) {
    if (seenC.has(c.name)) { continue; }
    seenC.add(c.name);
    md += `## ${c.name}\n`;
    if (c.description) { md += `${stripTags(c.description)}\n`; }
    var wikiC = getWiki(c.name);
    var cWikiParts = splitWikiSections(wikiC);
    if (cWikiParts.acquisition) { md += `\n### Acquisition\n${cWikiParts.acquisition}\n`; }
    if (cWikiParts.rest) { md += `\n### Wiki\n${cWikiParts.rest}\n`; }

    var cStats = [];
    if (c.health != null) { cStats.push(`Health: ${c.health}`); }
    if (c.shield != null) { cStats.push(`Shield: ${c.shield}`); }
    if (c.armor != null) { cStats.push(`Armor: ${c.armor}`); }
    if (c.power != null) { cStats.push(`Energy: ${c.power}`); }
    if (cStats.length) { md += cStats.join(' | ') + '\n'; }
    md += '\n';

    if (c.components && c.components.length) {
      md += '### Crafting\n';
      md += '| Component | Count |\n|---|---|\n';
      for (const comp of c.components) {
        md += `| ${esc(comp.name)} | ${comp.itemCount || 1} |\n`;
      }
      md += '\n';
    }
  }

  writeMd('equipment/companions.md', md);
}

// ---------------------------------------------------------------------------
// 6. Archwings
// ---------------------------------------------------------------------------
function transformArchwings() {
  const items = tryLoad('items-Archwing.json');
  if (!items) { return; }

  let md = heading('Archwings', 'All Archwing flight suits with stats, abilities, and crafting data.');

  var seenAw = new Set();
  for (const a of items) {
    if (seenAw.has(a.name)) { continue; }
    seenAw.add(a.name);
    md += `## ${a.name}\n`;
    if (a.description) { md += `${stripTags(a.description)}\n`; }
    var wikiAw = getWiki(a.name);
    var awWikiParts = splitWikiSections(wikiAw);
    if (awWikiParts.acquisition) { md += `\n### Acquisition\n${awWikiParts.acquisition}\n`; }
    if (awWikiParts.rest) { md += `\n### Wiki\n${awWikiParts.rest}\n`; }

    var aStats = [];
    if (a.health != null) { aStats.push(`Health: ${a.health}`); }
    if (a.shield != null) { aStats.push(`Shield: ${a.shield}`); }
    if (a.armor != null) { aStats.push(`Armor: ${a.armor}`); }
    if (a.power != null) { aStats.push(`Energy: ${a.power}`); }
    if (aStats.length) { md += aStats.join(' | ') + '\n'; }
    md += '\n';

    if (a.abilities && a.abilities.length) {
      md += '### Abilities\n';
      for (const ab of a.abilities) {
        md += `**${ab.name}:** ${stripTags(ab.description || '')}\n`;
      }
      md += '\n';
    }
  }

  writeMd('equipment/archwings.md', md);
}

// ---------------------------------------------------------------------------
// 7. Railjack
// ---------------------------------------------------------------------------
function transformRailjack() {
  const items = tryLoad('items-Railjack.json');
  if (!items) { return; }

  let md = heading('Railjack Components', 'All Railjack ship components, armaments, and avionics.');

  var seenRj = new Set();
  for (const r of items) {
    if (seenRj.has(r.name)) { continue; }
    seenRj.add(r.name);
    md += `## ${r.name}\n`;
    if (r.description) { md += `${stripTags(r.description)}\n`; }
    if (r.type) { md += `**Type:** ${r.type}\n`; }
    md += '\n';
  }

  writeMd('equipment/railjack.md', md);
}

// ---------------------------------------------------------------------------
// 8. Relics & Void Fissures
// ---------------------------------------------------------------------------
function transformRelics() {
  const relics = tryLoad('relics.json');
  const itemRelics = tryLoad('items-Relics.json');

  let md = heading(
    'Void Relics',
    'Complete relic drop table. Each relic lists its tier (Lith/Meso/Neo/Axi), refinement state, ' +
    'and all possible rewards with drop chances by rarity (Common, Uncommon, Rare).'
  );

  // Group relics by tier+name using the drop-table data
  if (relics && relics.length) {
    const grouped = {};
    for (const r of relics) {
      const key = `${r.tier} ${r.relicName}`;
      if (!grouped[key]) { grouped[key] = {}; }
      grouped[key][r.state] = r.rewards;
    }

    for (const [name, states] of Object.entries(grouped)) {
      md += `## ${name}\n`;
      for (const [state, rewards] of Object.entries(states)) {
        md += `### ${state}\n`;
        md += '| Reward | Rarity | Chance |\n|---|---|---|\n';
        for (const rw of rewards) {
          md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
        }
        md += '\n';
      }
    }
  }

  // Append item-level relic descriptions
  if (itemRelics && itemRelics.length) {
    md += '## Relic Descriptions\n';
    for (const r of itemRelics) {
      if (r.description) { md += `**${r.name}:** ${stripTags(r.description)}\n`; }
    }
  }

  writeMd('drops/relics.md', md);
}

// ---------------------------------------------------------------------------
// 9. Mission Rewards
// ---------------------------------------------------------------------------
function transformMissionRewards() {
  const data = tryLoad('missionRewards.json');
  if (!data) { return; }

  let md = heading(
    'Mission Rewards',
    'All mission reward tables organized by planet and node. Shows game mode, rotation rewards (A/B/C), ' +
    'item names, rarity, and exact drop percentages.'
  );

  for (const [planet, nodes] of Object.entries(data)) {
    md += `## ${planet}\n`;
    for (const [node, info] of Object.entries(nodes)) {
      md += `### ${node} — ${info.gameMode || 'Unknown'}${info.isEvent ? ' (Event)' : ''}\n`;
      if (info.rewards) {
        // Check if rewards uses rotation letters (A/B/C) or numeric keys (flat list)
        const entries = Object.entries(info.rewards);
        const hasRotations = entries.some(([k]) => /^[A-Z]$/.test(k));

        if (hasRotations) {
          for (const [rot, rewards] of entries) {
            if (!Array.isArray(rewards) || !rewards.length) { continue; }
            md += `**Rotation ${rot}:**\n`;
            md += '| Item | Rarity | Chance |\n|---|---|---|\n';
            for (const rw of rewards) {
              md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
            }
          }
        } else {
          // Flat reward list (numeric keys or single-item objects)
          md += '| Item | Rarity | Chance |\n|---|---|---|\n';
          for (const [, rw] of entries) {
            if (rw && typeof rw === 'object' && rw.itemName) {
              md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
            }
          }
        }
      }
      md += '\n';
    }
  }

  writeMd('drops/mission-rewards.md', md);
}

// ---------------------------------------------------------------------------
// 10. Bounty Rewards (Cetus, Solaris, Deimos, Zariman, Entrati Lab, Hex)
// ---------------------------------------------------------------------------
function transformBountyRewards() {
  const bounties = [
    ['cetusBountyRewards.json', 'Cetus Bounty Rewards', 'Plains of Eidolon bounty reward tables from Konzu.'],
    ['solarisBountyRewards.json', 'Solaris Bounty Rewards', 'Orb Vallis bounty reward tables from Eudico.'],
    ['deimosRewards.json', 'Deimos Bounty Rewards', 'Cambion Drift bounty reward tables.'],
    ['zarimanRewards.json', 'Zariman Bounty Rewards', 'Zariman Ten Zero bounty and mission reward tables.'],
    ['entratiLabRewards.json', 'Entrati Lab Rewards', 'Entrati Lab mission reward tables.'],
    ['hexRewards.json', 'Hex Bounty Rewards', 'Hex bounty reward tables.'],
  ];

  for (const [file, title, desc] of bounties) {
    const data = tryLoad(file);
    if (!data || (Array.isArray(data) && !data.length)) { continue; }

    let md = heading(title, desc + ' Includes rotation rewards and drop percentages.');

    const arr = Array.isArray(data) ? data : Object.values(data);
    for (const entry of arr) {
      const label = entry.bountyLevel || entry.objectiveName || entry.name || 'Bounty';
      md += `## ${esc(label)}\n`;

      const rewards = entry.rewards;
      if (Array.isArray(rewards)) {
        md += '| Item | Rarity | Chance | Stage |\n|---|---|---|---|\n';
        for (const rw of rewards) {
          md += `| ${esc(rw.itemName)} | ${rw.rarity || '—'} | ${pct(rw.chance)} | ${rw.stage || '—'} |\n`;
        }
        md += '\n';
      } else if (rewards && typeof rewards === 'object') {
        for (const [rot, rws] of Object.entries(rewards)) {
          if (!Array.isArray(rws)) { continue; }
          md += `**Rotation ${rot}:**\n| Item | Rarity | Chance |\n|---|---|---|\n`;
          for (const rw of rws) {
            md += `| ${esc(rw.itemName)} | ${rw.rarity || '—'} | ${pct(rw.chance)} |\n`;
          }
        }
      }
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`bounties/${safe}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// 11. Sortie Rewards & Transient Rewards
// ---------------------------------------------------------------------------
function transformSpecialRewards() {
  // Sortie
  const sortie = tryLoad('sortieRewards.json');
  if (sortie && sortie.length) {
    let md = heading('Sortie Rewards', 'Daily sortie reward tables including Legendary Core, Riven Mods, Ayatan, and more.');
    const grouped = {};
    for (const entry of sortie) {
      const key = entry.objectiveName || 'Sortie';
      if (!grouped[key]) { grouped[key] = []; }
      grouped[key].push(...(entry.rewards || []));
    }
    for (const [obj, rewards] of Object.entries(grouped)) {
      md += `## ${obj}\n`;
      md += '| Item | Rarity | Chance | Rotation |\n|---|---|---|---|\n';
      for (const rw of rewards) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} | ${rw.rotation || '—'} |\n`;
      }
      md += '\n';
    }
    writeMd('drops/sortie-rewards.md', md);
  }

  // Transient
  const trans = tryLoad('transientRewards.json');
  if (trans && trans.length) {
    let md = heading(
      'Transient Rewards',
      'Special mission reward tables including Derelict Vault mods, Arbitrations, and other transient objectives.'
    );
    for (const entry of trans) {
      md += `## ${entry.objectiveName || 'Unknown'}\n`;
      md += '| Item | Rarity | Chance | Rotation |\n|---|---|---|---|\n';
      for (const rw of (entry.rewards || [])) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} | ${rw.rotation || '—'} |\n`;
      }
      md += '\n';
    }
    writeMd('drops/transient-rewards.md', md);
  }
}

// ---------------------------------------------------------------------------
// 12. Mod Drop Locations (by mod and by enemy)
// ---------------------------------------------------------------------------
function transformModLocations() {
  const modLoc = tryLoad('modLocations.json');
  if (modLoc && modLoc.length) {
    let md = heading(
      'Mod Drop Locations',
      'Every mod in the game and which enemies drop it, with exact drop chance percentages.'
    );
    for (const entry of modLoc) {
      md += `## ${entry.modName || 'Unknown'}\n`;
      if (entry.enemies && entry.enemies.length) {
        md += '| Enemy | Enemy Drop Chance | Rarity | Chance |\n|---|---|---|---|\n';
        for (const e of entry.enemies) {
          md += `| ${esc(e.enemyName)} | ${pct(e.enemyModDropChance)} | ${e.rarity} | ${pct(e.chance)} |\n`;
        }
      }
      md += '\n';
    }
    writeMd('drops/mod-locations.md', md);
  }

  const enemyMod = tryLoad('enemyModTables.json');
  if (enemyMod && enemyMod.length) {
    let md = heading(
      'Enemy Mod Drop Tables',
      'Every enemy and which mods they drop, organized by enemy name with base mod drop chances.'
    );
    var seenEnemyMod = new Set();
    for (const entry of enemyMod) {
      var emName = entry.enemyName || 'Unknown';
      if (seenEnemyMod.has(emName)) { continue; }
      seenEnemyMod.add(emName);
      md += `## ${emName}\n`;
      md += `**Base Mod Drop Chance:** ${pct(entry.enemyModDropChance)}\n`;
      if (entry.mods && entry.mods.length) {
        md += '| Mod | Rarity | Chance |\n|---|---|---|\n';
        for (const m of entry.mods) {
          md += `| ${esc(m.modName)} | ${m.rarity} | ${pct(m.chance)} |\n`;
        }
      }
      md += '\n';
    }
    writeMd('drops/enemy-mod-tables.md', md);
  }
}

// ---------------------------------------------------------------------------
// 13. Blueprint Drop Locations
// ---------------------------------------------------------------------------
function transformBlueprintLocations() {
  const bp = tryLoad('blueprintLocations.json');
  if (!bp || !bp.length) { return; }

  let md = heading(
    'Blueprint Drop Locations',
    'Every blueprint in the game and which enemies drop it, with exact drop percentages.'
  );

  for (const entry of bp) {
    md += `## ${entry.itemName || entry.blueprintName || 'Unknown'}\n`;
    if (entry.enemies && entry.enemies.length) {
      md += '| Enemy | Blueprint Drop % | Item Drop % | Rarity | Chance |\n|---|---|---|---|---|\n';
      for (const e of entry.enemies) {
        md += `| ${esc(e.enemyName)} | ${pct(e.enemyBlueprintDropChance)} | ${pct(e.enemyItemDropChance)} | ${e.rarity} | ${pct(e.chance)} |\n`;
      }
    }
    md += '\n';
  }

  writeMd('drops/blueprint-locations.md', md);

  // Enemy blueprint tables
  const enemyBp = tryLoad('enemyBlueprintTables.json');
  if (enemyBp && enemyBp.length) {
    let md2 = heading(
      'Enemy Blueprint Drop Tables',
      'Every enemy and which blueprints they can drop, organized by enemy.'
    );
    var seenEnemyBp = new Set();
    for (const entry of enemyBp) {
      var ebName = entry.enemyName || 'Unknown';
      if (seenEnemyBp.has(ebName)) { continue; }
      seenEnemyBp.add(ebName);
      md2 += `## ${ebName}\n`;
      const allItems = [...(entry.items || []), ...(entry.mods || [])];
      if (allItems.length) {
        md2 += '| Item | Rarity | Chance |\n|---|---|---|\n';
        for (const it of allItems) {
          md2 += `| ${esc(it.itemName || it.modName)} | ${it.rarity} | ${pct(it.chance)} |\n`;
        }
      }
      md2 += '\n';
    }
    writeMd('drops/enemy-blueprint-tables.md', md2);
  }
}

// ---------------------------------------------------------------------------
// 14. Key Rewards
// ---------------------------------------------------------------------------
function transformKeyRewards() {
  const data = tryLoad('keyRewards.json');
  if (!data || (Array.isArray(data) && !data.length)) { return; }

  let md = heading('Key Rewards', 'Reward tables for Derelict and other key-locked missions.');

  const arr = Array.isArray(data) ? data : [data];
  var seenKey = new Set();
  for (const entry of arr) {
    var keyName = entry.keyName || entry.objectiveName || 'Key Mission';
    if (seenKey.has(keyName)) { continue; }
    seenKey.add(keyName);
    md += `## ${keyName}\n`;
    const rewards = entry.rewards;
    if (Array.isArray(rewards)) {
      md += '| Item | Rarity | Chance |\n|---|---|---|\n';
      for (const rw of rewards) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
      }
    } else if (rewards && typeof rewards === 'object') {
      for (const [rot, rws] of Object.entries(rewards)) {
        if (!Array.isArray(rws)) { continue; }
        md += `**Rotation ${rot}:**\n| Item | Rarity | Chance |\n|---|---|---|\n`;
        for (const rw of rws) {
          md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
        }
      }
    }
    md += '\n';
  }

  writeMd('drops/key-rewards.md', md);
}

// ---------------------------------------------------------------------------
// 15. Resources, Fish, Gear, Quests
// ---------------------------------------------------------------------------
function transformMiscItems() {
  const cats = [
    ['items-Resources.json', 'Resources', 'All crafting resources, their descriptions, and drop sources.'],
    ['items-Fish.json', 'Fish', 'All fish species across Plains, Vallis, and Cambion Drift with descriptions.'],
    ['items-Gear.json', 'Gear Items', 'All gear wheel items including ciphers, specters, and consumables.'],
    ['items-Quests.json', 'Quests', 'All quests available in Warframe with descriptions.'],
  ];

  // Merge resource-like items from items-Misc.json into Resources category
  // Common resources (Argon Crystal, Neurodes, Ferrite, etc.) are type=Resource or type=Misc in Misc
  var miscExclude = new Set(['Nightwave Challenge', 'Captura', 'Equipment Adapter', 'Ship Segment',
    'Conservation Tag', 'Fish Part', 'Exalted Weapon', 'Kitgun Component', 'Amp', 'Focus Lens',
    'K-Drive Component', 'Simulacrum', 'Pistol', 'Extractor', 'Orbiter', 'Key', 'Conservation Prey',
    'Boosters', 'Skin', 'Fish Bait', 'Pet Collar', 'Rifle', 'Medallion',
    'Melee Riven Mod', 'Zaw Riven Mod', 'Kitgun Riven Mod', 'Pistol Riven Mod',
    'Rifle Riven Mod', 'Shotgun Riven Mod']);
  var miscResources = (tryLoad('items-Misc.json') || []).filter(function (i) {
    return !miscExclude.has(i.type);
  });

  for (const [file, title, desc] of cats) {
    var items = tryLoad(file);
    if (!items) { items = []; }
    if (file === 'items-Resources.json') { items = items.concat(miscResources); }
    if (!items.length) { continue; }

    let md = heading(title, desc);

    var seenMisc = new Set();
    for (const item of items) {
      if (seenMisc.has(item.name)) { continue; }
      seenMisc.add(item.name);
      md += `## ${item.name}\n`;
      if (item.description) { md += `${stripTags(item.description)}\n`; }
      var wikiItem = getWiki(item.name);
      var itemWikiParts = splitWikiSections(wikiItem);
      if (itemWikiParts.acquisition) { md += `\n### Acquisition\n${itemWikiParts.acquisition}\n`; }
      if (itemWikiParts.rest) { md += `\n### Wiki\n${itemWikiParts.rest}\n`; }

      const meta = [];
      if (item.type) { meta.push(`**Type:** ${item.type}`); }
      if (item.tradable) { meta.push('**Tradable**'); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }
      md += '\n';

      if (item.drops && item.drops.length) {
        const compressed = compressDrops(item.drops);
        md += '### Drop Sources\n';
        for (const d of compressed.slice(0, 20)) {
          md += `- ${d.location} — ${d.rarity || ''} (${pct(d.chance)})\n`;
        }
        if (compressed.length > 20) { md += `- ...and ${compressed.length - 20} more sources\n`; }
        md += '\n';
      }
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`items/${safe}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// 16. Patch Notes
// ---------------------------------------------------------------------------
function transformPatchlogs() {
  const logs = tryLoad('patchlogs.json');
  if (!logs || !logs.length) { return; }

  let md = heading(
    'Warframe Patch Notes',
    'Complete history of Warframe updates, hotfixes, and prime access releases. ' +
    'Each entry includes additions, changes, and bug fixes.'
  );

  function collapseNewlines(s) {
    return s.trim().replace(/\n{3,}/g, '\n\n');
  }

  for (const p of logs) {
    md += `## ${p.name || 'Untitled'}\n`;
    md += `**Date:** ${p.date || 'Unknown'} | **Type:** ${p.type || 'Update'}\n`;

    if (p.description) { md += `${collapseNewlines(stripTags(p.description))}\n`; }
    if (p.additions) { md += `### Additions\n${collapseNewlines(p.additions)}\n\n`; }
    if (p.changes) { md += `### Changes\n${collapseNewlines(p.changes)}\n\n`; }
    if (p.fixes) { md += `### Fixes\n${collapseNewlines(p.fixes)}\n\n`; }
  }

  writeMd('patch-notes.md', md);
}

// ---------------------------------------------------------------------------
// 17. Riven Disposition Tags
// ---------------------------------------------------------------------------
function transformRivenTags() {
  const tags = tryLoad('riven-tags.json');
  if (!tags) { return; }

  let md = heading(
    'Riven Mod Tags & Dispositions',
    'Riven mod stat tags with prefix/suffix naming conventions and weight values. ' +
    'Used for determining possible Riven stats when unveiling or rolling.'
  );

  for (const [category, entries] of Object.entries(tags)) {
    md += `## ${category}\n`;
    md += '| Tag | Prefix | Suffix | Weight |\n|---|---|---|---|\n';
    for (const e of entries) {
      md += `| ${esc(e.tag)} | ${esc(e.prefix)} | ${esc(e.suffix)} | ${e.value} |\n`;
    }
    md += '\n';
  }

  writeMd('mods/riven-tags.md', md);
}

// ---------------------------------------------------------------------------
// 18. Syndicates
// ---------------------------------------------------------------------------
function transformSyndicates() {
  const data = tryLoad('syndicates.json');
  if (!data) { return; }

  // Check worldstate-data for richer syndicate data
  const wsdSyndicates = tryLoad('worldstate-data/syndicates.json');

  let md = heading(
    'Syndicates',
    'All syndicates in Warframe including their offerings and relationships.'
  );

  if (wsdSyndicates && typeof wsdSyndicates === 'object') {
    for (const [key, val] of Object.entries(wsdSyndicates)) {
      const name = (typeof val === 'object' && val.name) ? val.name : key;
      md += `## ${name}\n`;
      if (typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (k === 'name') { continue; }
          md += `**${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}\n`;
        }
      }
      md += '\n';
    }
  } else if (typeof data === 'object') {
    for (const [key, val] of Object.entries(data)) {
      md += `## ${key}\n`;
      if (Array.isArray(val) && val.length) {
        for (const item of val) {
          md += `- ${typeof item === 'string' ? item : JSON.stringify(item)}\n`;
        }
        md += '\n';
      } else {
        md += '*No reward data available.*\n\n';
      }
    }
  }

  writeMd('items/syndicates.md', md);
}

// ---------------------------------------------------------------------------
// 19. Public Export — Warframes (resolved names via dict_en)
// ---------------------------------------------------------------------------
function transformPublicExport() {
  const dict = tryLoad('public-export/dict_en.json');
  if (!dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  // Warframes
  const wfs = tryLoad('public-export/ExportWarframes.json');
  if (wfs) {
    let md = heading(
      'Public Export — Warframes (Detailed)',
      'Official Digital Extremes Warframe data export with resolved English names. ' +
      'Includes precise stat numbers, ability energy costs, mastery requirements, and variant info.'
    );

    var seenPE = new Set();
    for (const [, wf] of Object.entries(wfs)) {
      const name = resolve(wf.name);
      if (!name || seenPE.has(name)) { continue; }
      seenPE.add(name);
      md += `## ${name}\n`;
      const desc = resolve(wf.description);
      if (desc && desc !== name) { md += `${desc}\n`; }

      var peStats = [];
      if (wf.health != null) { peStats.push(`Health: ${wf.health}`); }
      if (wf.shield != null) { peStats.push(`Shield: ${wf.shield}`); }
      if (wf.armor != null) { peStats.push(`Armor: ${wf.armor}`); }
      if (wf.power != null) { peStats.push(`Energy: ${wf.power}`); }
      if (wf.masteryReq != null) { peStats.push(`Mastery Req: ${wf.masteryReq}`); }
      if (peStats.length) { md += peStats.join(' | ') + '\n'; }
      md += '\n';

      if (wf.abilities && wf.abilities.length) {
        md += '### Abilities\n';
        for (const ab of wf.abilities) {
          md += `**${resolve(ab.name)}:** ${resolve(ab.description)}\n`;
          if (ab.energyRequiredToActivate) { md += `Energy Cost: ${ab.energyRequiredToActivate}\n`; }
        }
        md += '\n';
      }
    }
    writeMd('public-export/warframes-detailed.md', md);
  }

  // Weapons
  const wpns = tryLoad('public-export/ExportWeapons.json');
  if (wpns) {
    let md = heading(
      'Public Export — Weapons (Detailed)',
      'Official weapon data from Digital Extremes with resolved names. Includes all 20 damage types, ' +
      'critical stats, status chance, fire rate, magazine, and reload time.'
    );

    const dmgTypes = [
      'Impact','Slash','Puncture','Heat','Cold','Electricity','Toxin',
      'Blast','Radiation','Viral','Magnetic','Gas','Corrosive','Void',
      'Tau','CinematicDmg','ShieldDrain','HealthDrain','EnergyDrain','True'
    ];

    var seenPEW = new Set();
    for (const [, w] of Object.entries(wpns)) {
      const name = resolve(w.name);
      if (!name || seenPEW.has(name)) { continue; }
      seenPEW.add(name);
      md += `## ${name}\n`;
      const desc = resolve(w.description);
      if (desc && desc !== name) { md += `${desc}\n`; }

      var wpnStats = [];
      if (w.totalDamage != null) { wpnStats.push(`Total Damage: ${w.totalDamage}`); }
      if (w.criticalChance != null) { wpnStats.push(`Crit Chance: ${pct(w.criticalChance * 100)}`); }
      if (w.criticalMultiplier != null) { wpnStats.push(`Crit Mult: ${w.criticalMultiplier}x`); }
      if (w.procChance != null) { wpnStats.push(`Status: ${pct(w.procChance * 100)}`); }
      if (w.fireRate != null) { wpnStats.push(`Fire Rate: ${w.fireRate}`); }
      if (wpnStats.length) { md += wpnStats.join(' | ') + '\n'; }
      var wpnMeta = [];
      if (w.accuracy != null) { wpnMeta.push(`Accuracy: ${w.accuracy}`); }
      if (w.magazineSize != null) { wpnMeta.push(`Magazine: ${w.magazineSize}`); }
      if (w.reloadTime != null) { wpnMeta.push(`Reload: ${w.reloadTime}s`); }
      if (w.multishot != null) { wpnMeta.push(`Multishot: ${w.multishot}`); }
      if (w.masteryReq != null) { wpnMeta.push(`MR: ${w.masteryReq}`); }
      if (wpnMeta.length) { md += wpnMeta.join(' | ') + '\n'; }

      // Damage breakdown
      if (w.damagePerShot && Array.isArray(w.damagePerShot)) {
        const dmg = w.damagePerShot
          .map((v, i) => [dmgTypes[i] || `Type${i}`, v])
          .filter(([, v]) => v > 0);
        if (dmg.length) {
          md += '**Damage Breakdown:** ' + dmg.map(([t, v]) => `${t}: ${v.toFixed(1)}`).join(', ') + '\n';
        }
      }
      md += '\n';
    }
    writeMd('public-export/weapons-detailed.md', md);
  }

  // Mods (Upgrades)
  const mods = tryLoad('public-export/ExportUpgrades.json');
  if (mods) {
    let md = heading(
      'Public Export — Mods & Upgrades',
      'Official mod data including polarity, rarity, drain, fusion limits, and compatibility tags.'
    );

    var seenPEM = new Set();
    for (const [, m] of Object.entries(mods)) {
      var modName = resolve(m.name);
      if (!modName || seenPEM.has(modName)) { continue; }
      seenPEM.add(modName);
      md += `## ${modName}\n`;
      const desc = resolve(m.description);
      if (desc) { md += `${desc}\n`; }

      const meta = [];
      if (m.rarity) { meta.push(`**Rarity:** ${m.rarity}`); }
      if (m.polarity) { meta.push(`**Polarity:** ${friendlyPolarity(m.polarity)}`); }
      if (m.baseDrain != null) { meta.push(`**Drain:** ${m.baseDrain}`); }
      if (m.fusionLimit != null) { meta.push(`**Max Rank:** ${m.fusionLimit}`); }
      if (m.type) { meta.push(`**Type:** ${m.type}`); }
      if (m.compatName) { meta.push(`**Compat:** ${resolve(m.compatName)}`); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }
      md += '\n';
    }
    writeMd('public-export/mods-detailed.md', md);
  }

  // Recipes
  const recipes = tryLoad('public-export/ExportRecipes.json');
  if (recipes) {
    let md = heading(
      'Public Export — Crafting Recipes',
      'All foundry crafting recipes with credit costs, build times, and ingredient requirements.'
    );

    var seenPER = new Set();
    for (const [recipeKey, r] of Object.entries(recipes)) {
      const result = resolve(r.resultType) || recipeKey;
      if (seenPER.has(result)) { continue; }
      seenPER.add(result);
      md += `## ${result}\n`;
      md += `**Credits:** ${r.buildPrice || 0} | **Build Time:** ${r.buildTime ? (r.buildTime / 3600).toFixed(1) + 'h' : '—'} | **Rush:** ${r.skipBuildTimePrice || 0} Platinum\n`;

      if (r.ingredients && r.ingredients.length) {
        md += '| Ingredient | Count |\n|---|---|\n';
        for (const ing of r.ingredients) {
          md += `| ${resolve(ing.ItemType || ing.itemType)} | ${ing.ItemCount || ing.itemCount || 1} |\n`;
        }
        md += '\n';
      }
    }
    writeMd('public-export/recipes.md', md);
  }

  // Enemies
  const enemies = tryLoad('public-export/ExportEnemies.json');
  if (enemies) {
    let md = heading('Public Export — Enemies', 'All enemy types with resolved names and descriptions.');
    var seenPEE = new Set();
    for (const [, e] of Object.entries(enemies)) {
      var eName = resolve(e.name);
      if (!eName || seenPEE.has(eName)) { continue; }
      seenPEE.add(eName);
      md += `## ${eName}\n`;
      const desc = resolve(e.description);
      if (desc) { md += `${desc}\n`; }
      md += '\n';
    }
    writeMd('public-export/enemies.md', md);
  }

  // Factions
  const factions = tryLoad('public-export/ExportFactions.json');
  if (factions) {
    let md = heading('Public Export — Factions', 'All factions in Warframe.');
    for (const [, f] of Object.entries(factions)) {
      const fName = resolve(f.name);
      if (!fName) { continue; }
      md += `## ${fName}\n`;
      const desc = resolve(f.description);
      if (desc) { md += `${desc}\n`; }
      md += '\n';
    }
    writeMd('public-export/factions.md', md);
  }

  // Regions / Star Chart
  const regions = tryLoad('public-export/ExportRegions.json');
  if (regions) {
    const SYSTEM_NAMES = ['Mercury','Venus','Earth','Mars','Phobos','Deimos','Ceres','Jupiter','Europa','Saturn','Uranus','Neptune','Pluto','Sedna','Eris','Void','Lua','Kuva Fortress','Zariman','Tau','Höllvania','Duviri'];
    const NODE_TYPES = ['Hub','Assassinate','Capture','Defense','Exterminate','Mobile Defense','Rescue','Sabotage','Spy','Survival','Interception','Hijack','Excavation','Defection','Disruption','Arena','Solar Rail Conflict','Free Roam','Junction','Railjack','Ground Assault','Conjunction Survival','Arbitration','Sortie'];
    const FACTION_NAMES = ['Grineer','Corpus','Infested','Orokin','Sentient','Stalker','Tenno','Crossfire','Narmer','Wally','Murmur','Scaldra','Techrot'];
    const resolveEnum = function (arr, idx) { return (idx != null && arr[idx]) ? arr[idx] : (idx != null ? String(idx) : null); };
    let md = heading('Public Export — Star Chart Regions', 'All Star Chart regions/nodes with mission types and requirements.');
    for (const [regionKey, r] of Object.entries(regions)) {
      const rName = resolve(r.name) || regionKey;
      if (!rName) { continue; }
      md += `## ${rName}\n`;
      const meta = [];
      const sys = resolveEnum(SYSTEM_NAMES, r.systemIndex);
      if (sys) { meta.push(`System: ${sys}`); }
      const nt = resolveEnum(NODE_TYPES, r.nodeType);
      if (nt) { meta.push(`Type: ${nt}`); }
      if (r.masteryReq) { meta.push(`MR: ${r.masteryReq}`); }
      if (r.minEnemyLevel) { meta.push(`Level: ${r.minEnemyLevel}-${r.maxEnemyLevel || '?'}`); }
      const fac = resolveEnum(FACTION_NAMES, r.factionIndex);
      if (fac) { meta.push(`Faction: ${fac}`); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }
      md += '\n';
    }
    writeMd('public-export/regions.md', md);
  }
}

// ---------------------------------------------------------------------------
// 20. Worldstate Reference (English only, for Spark)
// ---------------------------------------------------------------------------
function transformWorldstateData() {
  const dir = path.join(DATA, 'worldstate-data');
  if (!fs.existsSync(dir)) { return; }

  // EN locale files (or top-level if no en/ folder)
  const enDir = path.join(dir, 'en');
  const sourceDir = fs.existsSync(enDir) ? enDir : dir;

  const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json'));

  let md = heading(
    'Worldstate Reference Data',
    'Reference data used by Warframe\'s world state system. Includes Sol node mappings, ' +
    'mission types, faction data, fissure modifiers, sortie conditions, syndicate info, and more. English locale.'
  );

  for (const file of files.sort()) {
    const name = path.basename(file, '.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(sourceDir, file), 'utf8')); } catch { continue; }

    md += `## ${name}\n`;

    if (Array.isArray(data)) {
      // Simple array — show as list
      for (const item of data.slice(0, 100)) {
        if (typeof item === 'string') {
          md += `- ${item}\n`;
        } else if (typeof item === 'object' && item !== null) {
          const name = item.name || item.value || item.key || '';
          const desc = item.description || '';
          md += `- **${esc(name)}**${desc ? ': ' + esc(desc) : ''}\n`;
        }
      }
      if (data.length > 100) { md += `- ...and ${data.length - 100} more entries\n`; }
      md += '\n';
    } else if (typeof data === 'object' && data !== null) {
      // Object — show as key-value table or nested sections
      const entries = Object.entries(data);
      if (entries.length <= 200) {
        md += '| Key | Value |\n|---|---|\n';
        for (const [k, v] of entries) {
          const val = typeof v === 'object' ? (v.value || v.name || JSON.stringify(v).slice(0, 120)) : String(v);
          md += `| ${esc(k)} | ${esc(val)} |\n`;
        }
      } else {
        md += `*${entries.length} entries — showing first 200*\n\n`;
        md += '| Key | Value |\n|---|---|\n';
        for (const [k, v] of entries.slice(0, 200)) {
          const val = typeof v === 'object' ? (v.value || v.name || JSON.stringify(v).slice(0, 120)) : String(v);
          md += `| ${esc(k)} | ${esc(val)} |\n`;
        }
      }
      md += '\n';
    }
  }

  writeMd('worldstate-reference.md', md);
}

// ---------------------------------------------------------------------------
// 21. Additional drop tables (resource/sigil/additional by avatar)
// ---------------------------------------------------------------------------
function transformAvatarDrops() {
  const files = [
    ['resourceByAvatar.json', 'Resource Drops by Enemy', 'Which resources each enemy type drops.'],
    ['sigilByAvatar.json', 'Sigil Drops by Enemy', 'Which sigils each enemy type drops.'],
    ['additionalItemByAvatar.json', 'Additional Item Drops by Enemy', 'Additional items dropped by enemy types beyond standard loot tables.'],
  ];

  for (const [file, title, desc] of files) {
    const data = tryLoad(file);
    if (!data) { continue; }

    let md = heading(title, desc);

    const arr = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({ name: k, ...v }));
    var seenAvatar = new Set();
    for (const entry of arr) {
      const name = entry.enemyName || entry.source || entry.name || 'Unknown';
      if (seenAvatar.has(name)) { continue; }
      seenAvatar.add(name);
      md += `## ${esc(name)}\n`;

      const items = entry.items || entry.resources || entry.rewards || [];
      if (Array.isArray(items) && items.length) {
        md += '| Item | Rarity | Chance |\n|---|---|---|\n';
        for (const it of items) {
          md += `| ${esc(it.itemName || it.item || it.name)} | ${it.rarity || '—'} | ${pct(it.chance)} |\n`;
        }
      }
      md += '\n';
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`drops/${safe}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// 22. Enemies (from @wfcd/items)
// ---------------------------------------------------------------------------
function transformEnemies() {
  const items = tryLoad('items-Enemy.json');
  if (!items || !items.length) { return; }

  let md = heading(
    'Enemies',
    'All enemies in Warframe with health, shield, armor, faction, and drop tables. ' +
    'Includes boss enemies, minibosses, and standard units across all factions.'
  );

  var seenE = new Set();
  for (const e of items) {
    if (seenE.has(e.name)) { continue; }
    seenE.add(e.name);
    md += `## ${e.name}\n`;
    if (e.description) { md += `${stripTags(e.description)}\n`; }
    var wikiE = getWiki(e.name);
    var eWikiParts = splitWikiSections(wikiE);
    if (eWikiParts.acquisition) { md += `\n### Acquisition\n${eWikiParts.acquisition}\n`; }
    if (eWikiParts.rest) { md += `\n### Wiki\n${eWikiParts.rest}\n`; }

    var eStats = [];
    if (e.health != null) { eStats.push(`Health: ${e.health}`); }
    if (e.shield != null) { eStats.push(`Shield: ${e.shield}`); }
    if (e.armor != null) { eStats.push(`Armor: ${e.armor}`); }
    if (e.type) { eStats.push(`Faction: ${e.type}`); }
    if (eStats.length) { md += eStats.join(' | ') + '\n'; }
    md += '\n';

    if (e.drops && e.drops.length) {
      md += '### Drops\n';
      md += '| Item | Rarity | Chance |\n|---|---|---|\n';
      for (const d of e.drops.slice(0, 30)) {
        md += `| ${esc(d.location)} | ${d.rarity || '—'} | ${pct(d.chance)} |\n`;
      }
      if (e.drops.length > 30) { md += `| ...and ${e.drops.length - 30} more | | |\n`; }
      md += '\n';
    }
  }

  writeMd('items/enemies.md', md);
}

// ---------------------------------------------------------------------------
// 23. Star Chart Nodes (from @wfcd/items)
// ---------------------------------------------------------------------------
function transformNodes() {
  const items = tryLoad('items-Node.json');
  if (!items || !items.length) { return; }

  let md = heading(
    'Star Chart Nodes',
    'All playable nodes on the Star Chart with planet, mission type, enemy level range, and faction.'
  );

  const factions = ['Grineer', 'Corpus', 'Infested', 'Orokin', 'Sentient', 'Crossfire', 'Unknown'];

  // Group by system
  const bySystem = {};
  for (const node of items) {
    const sys = node.systemName || 'Unknown';
    if (!bySystem[sys]) { bySystem[sys] = []; }
    bySystem[sys].push(node);
  }

  for (const [system, nodes] of Object.entries(bySystem).sort()) {
    md += `## ${system}\n`;
    md += '| Node | Levels | Faction |\n|---|---|---|\n';
    for (const n of nodes) {
      const levels = (n.minEnemyLevel && n.maxEnemyLevel) ? `${n.minEnemyLevel}-${n.maxEnemyLevel}` : '—';
      const faction = factions[n.factionIndex] || '—';
      md += `| ${esc(n.name)} | ${levels} | ${faction} |\n`;
    }
    md += '\n';
  }

  writeMd('items/star-chart-nodes.md', md);
}

// ---------------------------------------------------------------------------
// 24. Focus Schools (from ExportFocusUpgrades)
// ---------------------------------------------------------------------------
function transformFocusSchools() {
  const data = tryLoad('public-export/ExportFocusUpgrades.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Focus Schools & Operator Upgrades',
    'All Operator Focus school upgrades including Madurai, Vazarin, Naramon, Zenurik, and Unairu. ' +
    'Shows name, description, polarity, rarity, drain, max rank, and stat progression.'
  );

  // Group by polarity (school)
  const schools = {};
  for (const [, u] of Object.entries(data)) {
    const school = u.polarity || 'Unknown';
    if (!schools[school]) { schools[school] = []; }
    schools[school].push(u);
  }

  for (const [school, upgrades] of Object.entries(schools).sort()) {
    md += `## ${friendlyPolarity(school)}\n`;
    for (const u of upgrades) {
      const name = resolve(u.name);
      const desc = resolve(u.description);
      md += `### ${name}\n`;
      if (desc && desc !== name) { md += `${desc}\n`; }

      const meta = [];
      if (u.rarity) { meta.push(`**Rarity:** ${u.rarity}`); }
      if (u.baseDrain != null) { meta.push(`**Drain:** ${u.baseDrain}`); }
      if (u.fusionLimit != null) { meta.push(`**Max Rank:** ${u.fusionLimit}`); }
      if (u.baseFocusPointCost != null) { meta.push(`**Focus Cost:** ${u.baseFocusPointCost.toLocaleString()}`); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }

      if (u.levelStats && u.levelStats.length) {
        md += '| Rank | Stats |\n|---|---|\n';
        for (let r = 0; r < u.levelStats.length; r++) {
          const stats = Object.entries(u.levelStats[r]).map(([k, v]) => `${k}: ${v}`).join(', ');
          md += `| ${r} | ${esc(stats)} |\n`;
        }
        md += '\n';
      }
    }
  }

  writeMd('public-export/focus-schools.md', md);
}

// ---------------------------------------------------------------------------
// 25. Dojo Recipes (from ExportDojoRecipes)
// ---------------------------------------------------------------------------
function transformDojoRecipes() {
  const data = tryLoad('public-export/ExportDojoRecipes.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Dojo Recipes & Clan Research',
    'All Dojo room, decoration, and research recipes. Includes ' +
    'credit costs, resource requirements, and clan tier scaling.'
  );

  for (const section of ['rooms', 'research', 'fabrications']) {
    const sectionData = data[section];
    if (!sectionData || typeof sectionData !== 'object') { continue; }

    md += `## ${section.charAt(0).toUpperCase() + section.slice(1)}\n`;

    const entries = Object.entries(sectionData);
    for (const [key, val] of entries.slice(0, 500)) {
      const name = (val && val.resultType) ? resolve(val.resultType) : key.split('/').pop();
      md += `### ${esc(name)}\n`;

      if (val.buildPrice != null) { md += `**Credits:** ${val.buildPrice}`; }
      if (val.buildTime != null) { md += ` | **Build Time:** ${(val.buildTime / 3600).toFixed(1)}h`; }
      md += '\n';

      if (val.ingredients && val.ingredients.length) {
        md += '| Ingredient | Count |\n|---|---|\n';
        for (const ing of val.ingredients) {
          md += `| ${resolve(ing.ItemType || ing.itemType)} | ${ing.ItemCount || ing.itemCount || 1} |\n`;
        }
        md += '\n';
      }
    }

    if (entries.length > 500) { md += `*...and ${entries.length - 500} more entries*\n\n`; }
  }

  writeMd('public-export/dojo-recipes.md', md);
}

// ---------------------------------------------------------------------------
// 26. Nightwave (from ExportNightwave)
// ---------------------------------------------------------------------------
function transformNightwave() {
  const data = tryLoad('public-export/ExportNightwave.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Nightwave',
    'Nightwave challenge tiers, challenge types, and reward pool. ' +
    'Includes weekly, daily, and elite challenges with their standing values.'
  );

  if (data.affiliationTag) {
    md += `**Affiliation:** ${resolve(data.affiliationTag)}\n\n`;
  }

  // Challenges
  if (data.challenges && typeof data.challenges === 'object') {
    md += '## Challenges\n';
    const challengeEntries = Object.entries(data.challenges);
    for (const [key, ch] of challengeEntries) {
      const name = resolve(ch.name || key);
      md += `### ${esc(name)}\n`;
      const desc = resolve(ch.description);
      if (desc && desc !== name) { md += `${desc}\n`; }
      const meta = [];
      if (ch.standing != null) { meta.push(`**Standing:** ${ch.standing}`); }
      if (ch.required != null) { meta.push(`**Required:** ${ch.required}`); }
      if (ch.isDaily) { meta.push('**Daily**'); }
      if (ch.isElite) { meta.push('**Elite**'); }
      if (meta.length) { md += meta.join(' | ') + '\n'; }
      md += '\n';
    }
  }

  // Rewards
  if (data.rewards && Array.isArray(data.rewards)) {
    md += '## Rewards\n';
    md += '| Reward | Type |\n|---|---|\n';
    for (const r of data.rewards) {
      const name = resolve(r.name || r.storeItem || r.uniqueName || '');
      md += `| ${esc(name)} | ${r.credits || ''} |\n`;
    }
    md += '\n';
  }

  writeMd('public-export/nightwave.md', md);
}

// ---------------------------------------------------------------------------
// 27. Vendors (from ExportVendors)
// ---------------------------------------------------------------------------
function transformVendors() {
  const data = tryLoad('public-export/ExportVendors.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Vendors & Shops',
    'All in-game vendors and their item offerings. Includes NPC shops from ' +
    'relays, open worlds, and other hubs with prices in credits, standing, or special currency.'
  );

  var seenVen = new Set();
  for (const [vendorKey, vendor] of Object.entries(data)) {
    const vendorName = vendorKey.split('/').pop().replace(/Manifest$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    if (seenVen.has(vendorName)) { continue; }
    seenVen.add(vendorName);
    md += `## ${esc(vendorName)}\n`;

    if (vendor.isDynamic != null) { md += `**Dynamic Inventory:** ${vendor.isDynamic ? 'Yes' : 'No'}\n`; }

    if (vendor.items && Array.isArray(vendor.items)) {
      md += '| Item | Quantity | Price |\n|---|---|---|\n';
      for (const item of vendor.items.slice(0, 100)) {
        const name = resolve(item.storeItem || '');
        const qty = item.quantity || 1;
        let price = '';
        if (item.regularPrice) { price = `${item.regularPrice} Credits`; }
        else if (item.premiumPrice) { price = `${item.premiumPrice} Platinum`; }
        else if (item.itemPrices && item.itemPrices.length) {
          const parts = [];
          for (const p of item.itemPrices) { parts.push(`${p.ItemCount} ${resolve(p.ItemType)}`); }
          price = parts.join(', ');
        }
        md += `| ${esc(name)} | ${qty} | ${esc(price)} |\n`;
      }
      if (vendor.items.length > 100) { md += `| ...and ${vendor.items.length - 100} more items | | |\n`; }
      md += '\n';
    }
  }

  writeMd('public-export/vendors.md', md);
}

// ---------------------------------------------------------------------------
// 28. Achievements (from ExportAchievements)
// ---------------------------------------------------------------------------
function transformAchievements() {
  const data = tryLoad('public-export/ExportAchievements.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Achievements',
    'All in-game achievements (Steam/PSN/Xbox trophies). ' +
    'Each achievement has a name and description of the unlock condition.'
  );

  md += '| Achievement | Description |\n|---|---|\n';
  for (const [, ach] of Object.entries(data)) {
    const name = resolve(ach.name);
    const desc = resolve(ach.description);
    md += `| ${esc(name)} | ${esc(desc)} |\n`;
  }
  md += '\n';

  writeMd('public-export/achievements.md', md);
}

// ---------------------------------------------------------------------------
// 29. Syndicates (Detailed from ExportSyndicates)
// ---------------------------------------------------------------------------
function transformSyndicatesDetailed() {
  const data = tryLoad('public-export/ExportSyndicates.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Public Export — Syndicates (Detailed)',
    'Full syndicate data from the official export including rank titles, ' +
    'standing requirements, initiation sacrifices, and offerings at each rank.'
  );

  var seenSyn = new Set();
  for (const [, syn] of Object.entries(data)) {
    const name = resolve(syn.name);
    if (!name || seenSyn.has(name)) { continue; }
    seenSyn.add(name);
    md += `## ${name}\n`;
    const desc = resolve(syn.description);
    if (desc && desc !== name) { md += `${desc}\n`; }
    md += '\n';

    if (syn.titles && syn.titles.length) {
      md += '### Ranks\n';
      md += '| Rank | Title | Standing |\n|---|---|---|\n';
      for (const t of syn.titles) {
        md += `| ${t.level != null ? t.level : '—'} | ${esc(resolve(t.name))} | ${t.minStanding || 0} |\n`;
      }
      md += '\n';
    }

    if (syn.initiationSacrifice && syn.initiationSacrifice.items) {
      md += '**Initiation Cost:** ';
      const costParts = [];
      for (const it of syn.initiationSacrifice.items) { costParts.push(`${it.ItemCount} ${resolve(it.ItemType)}`); }
      md += costParts.join(', ');
      md += '\n\n';
    }
  }

  writeMd('public-export/syndicates-detailed.md', md);
}

// ---------------------------------------------------------------------------
// 30. Bounties (Detailed from ExportBounties)
// ---------------------------------------------------------------------------
function transformBountiesDetailed() {
  const data = tryLoad('public-export/ExportBounties.json');
  const dict = tryLoad('public-export/dict_en.json');
  if (!data || !dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return stripTags(dict[key] || key.split('/').pop() || key);
  }

  let md = heading(
    'Public Export — Bounties (Detailed)',
    'Bounty data from the official export including bounty tiers, objectives, and reward tables.'
  );

  for (const [bountyKey, bounty] of Object.entries(data)) {
    const name = resolve(bounty.name || bountyKey);
    md += `## ${esc(name)}\n`;

    if (bounty.minEnemyLevel != null) {
      md += `**Levels:** ${bounty.minEnemyLevel}-${bounty.maxEnemyLevel || '?'}\n`;
    }

    if (bounty.rewards && bounty.rewards.length) {
      md += '### Rewards\n';
      md += '| Item | Chance |\n|---|---|\n';
      for (const r of bounty.rewards) {
        md += `| ${esc(resolve(r.name || r.storeItem || r.type || ''))} | ${pct(r.chance)} |\n`;
      }
      md += '\n';
    }
  }

  writeMd('public-export/bounties-detailed.md', md);
}

// ---------------------------------------------------------------------------
// 32. Wiki — Lore Characters
// ---------------------------------------------------------------------------
function transformWikiLore() {
  var pages = tryLoad('wiki-lore.json');
  if (!pages) { return; }
  var md = heading('Wiki — Lore Characters & Factions',
    'Detailed lore profiles for key characters and groups from the Warframe wiki.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/lore-characters.md', md);
}

// ---------------------------------------------------------------------------
// 33. Wiki — Quests
// ---------------------------------------------------------------------------
function transformWikiQuests() {
  var pages = tryLoad('wiki-quests.json');
  if (!pages) { return; }
  var md = heading('Wiki — Quest Guide',
    'Detailed quest walkthroughs and synopses from the Warframe wiki.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/quests.md', md);
}

// ---------------------------------------------------------------------------
// 34. Wiki — Factions
// ---------------------------------------------------------------------------
function transformWikiFactions() {
  var pages = tryLoad('wiki-factions.json');
  if (!pages) { return; }
  var md = heading('Wiki — Factions',
    'Detailed faction overviews from the Warframe wiki.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/factions.md', md);
}

// ---------------------------------------------------------------------------
// 35. Wiki — Open Worlds
// ---------------------------------------------------------------------------
function transformWikiOpenWorlds() {
  var pages = tryLoad('wiki-open-worlds.json');
  if (!pages) { return; }
  var md = heading('Wiki — Open Worlds & Landscapes',
    'Detailed guides for open world areas from the Warframe wiki.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/open-worlds.md', md);
}

// ---------------------------------------------------------------------------
// 36. Wiki — Game Mechanics
// ---------------------------------------------------------------------------
function transformWikiMechanics() {
  var pages = tryLoad('wiki-mechanics.json');
  if (!pages) { return; }
  var md = heading('Wiki — Game Mechanics',
    'In-depth game mechanic explanations from the Warframe wiki.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/mechanics.md', md);
}

// ---------------------------------------------------------------------------
// 37. Wiki — Damage Types
// ---------------------------------------------------------------------------
function transformWikiDamageTypes() {
  var pages = tryLoad('wiki-damage-types.json');
  if (!pages) { return; }
  var md = heading('Wiki — Damage Types',
    'Detailed damage type breakdowns and status effects from the Warframe wiki.');
  for (const p of pages) {
    // Clean "Damage/" prefix from titles for readability
    var title = p.title.replace(/^Damage\//, '');
    md += `## ${title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/damage-types.md', md);
}

// ---------------------------------------------------------------------------
// 38. Wiki — Game Systems (Trading, Incarnon, Prime, etc.)
// ---------------------------------------------------------------------------
function transformWikiGameSystems() {
  var pages = tryLoad('wiki-game-systems.json');
  if (!pages) { return; }
  var md = heading('Wiki — Game Systems',
    'Core game systems and economy from the Warframe wiki: trading, Incarnon, Prime, Void Fissures, Operator, Orbiter, and more.');
  for (const p of pages) {
    var title = p.title.replace(/\s*\(Lore\)/, '');
    md += `## ${title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/game-systems.md', md);
}

// ---------------------------------------------------------------------------
// 39. Wiki — Endgame Activities
// ---------------------------------------------------------------------------
function transformWikiEndgame() {
  var pages = tryLoad('wiki-endgame.json');
  if (!pages) { return; }
  var md = heading('Wiki — Endgame Activities',
    'Endgame mission modes and boss fights from the Warframe wiki: Steel Path, Arbitrations, Eidolons, Profit-Taker, Kuva Liches, and more.');
  for (const p of pages) {
    var title = p.title.replace(/^Kuva Lich\/Main$/, 'Kuva Lich');
    md += `## ${title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/endgame.md', md);
}

// ---------------------------------------------------------------------------
// 40. Wiki — Companion Types
// ---------------------------------------------------------------------------
function transformWikiCompanions() {
  var pages = tryLoad('wiki-companions.json');
  if (!pages) { return; }
  var md = heading('Wiki — Companion Types',
    'Detailed guides for companion types from the Warframe wiki: Kubrow, Kavat, and Sentinel.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/companions.md', md);
}

// ---------------------------------------------------------------------------
// 41. Wiki — Modular Equipment
// ---------------------------------------------------------------------------
function transformWikiModular() {
  var pages = tryLoad('wiki-modular.json');
  if (!pages) { return; }
  var md = heading('Wiki — Modular Equipment',
    'Modular weapon and vehicle systems from the Warframe wiki: Amps, Zaws, Kitguns, K-Drives, and Necramechs.');
  for (const p of pages) {
    md += `## ${p.title}\n${cleanWiki(p.content)}\n\n`;
  }
  writeMd('wiki/modular-equipment.md', md);
}

// ---------------------------------------------------------------------------
// Overframe.gg community builds (optional, runs only if data file exists)
// ---------------------------------------------------------------------------
function transformOverframeBuilds() {
  const data = tryLoad('overframe-builds.json');
  if (!data || !data.categories) {
    console.log('  (no data/overframe-builds.json — skipping Overframe builds; run `node pull-overframe.js` to fetch)');
    return;
  }

  // Optional mod-id -> name catalog produced by pull-overframe.js --enrich.
  // When present, we can render a proper slot table; otherwise we fall back
  // to the author guide excerpt only.
  const modCatalog = tryLoad('overframe-mod-catalog.json') || {};
  const resolveMod = (id) => {
    if (id == null) { return null; }
    const e = modCatalog[id];
    return e && e.name ? e.name : null;
  };

  const intro =
    'Community-curated build snapshots scraped from Overframe.gg. ' +
    'These are popular Tenno-submitted loadouts, NOT official game data. ' +
    'Every entry is flagged `(community-curated, source: Overframe)` and must never override ' +
    'authoritative stats from equipment/weapons/mods/export bundles. ' +
    'Each item carries up to three roles: `top` (highest score — meta/endgame pick), ' +
    '`utility` (title-matched support / CC / farming / stealth / subsume build), and ' +
    '`runner-up` (second highest score). Prefer `top` or `runner-up` for endgame queries; ' +
    'use `utility` only when the request is for support / CC / farming / Helminth context. ' +
    `Snapshot fetched ${data.fetched_at || 'unknown'}; up to 3 per item; ` +
    `enriched=${data.enriched ? 'yes' : 'no'}.`;

  // Overframe encodes mod links in guides as `[\[ModName\]](/items/...)`.
  // Pull out the bracketed names so the bot sees real names instead of
  // backslashed markdown, and strip the link target.
  function cleanGuide(raw) {
    if (!raw || typeof raw !== 'string') { return ''; }
    let s = raw;
    // [\[Mod Name\]](/items/...) -> Mod Name
    s = s.replace(/\[\\\[([^\]]+?)\\\]\]\([^)]*\)/g, '$1');
    // [Plain Text](/url) -> Plain Text
    s = s.replace(/\[([^\]]+?)\]\(([^)]+)\)/g, '$1');
    // Lingering escaped brackets
    s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
    // Drop image syntax
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    // Compress whitespace
    s = s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return s.trim();
  }

  function renderBuild(b) {
    var d = b.detail || null;
    var lines = [];
    var title = b.title || (d && d.title) || `Build ${b.id || ''}`;
    var itemName = b.item || (d && d.item) || 'Unknown item';
    lines.push(`## ${esc(title)} — ${esc(itemName)} (community-curated, source: Overframe)`);

    var meta = [];
    if (b.selectionRole) { meta.push(`Role: ${esc(b.selectionRole)}`); }
    if (b.author) { meta.push(`Author: ${esc(b.author)}`); }
    if (b.score != null) { meta.push(`Votes: ${b.score}`); }
    if (b.formas != null) { meta.push(`Forma: ${b.formas}`); }
    if (d && d.masteryRank != null) { meta.push(`MR: ${d.masteryRank}`); }
    if (b.id) { meta.push(`Overframe build #${b.id}`); }
    if (meta.length) { lines.push(meta.join(' | ')); }

    // Mod loadout — only when catalog resolves every name (no polarity, no drain).
    if (d && Array.isArray(d.mods) && d.mods.length) {
      const rows = d.mods.map((m, i) => {
        const id = m && m.modId;
        if (id == null) { return `- S${i + 1} (empty)`; }
        const name = resolveMod(id);
        const text = name ? esc(name) : `(unresolved mod #${id})`;
        return `- S${i + 1} ${text}`;
      });
      // Suppress section if every row is unresolved.
      const anyNamed = rows.some((r) => !/\((unresolved|empty)/.test(r));
      if (anyNamed) {
        lines.push('');
        lines.push('### Mod Loadout');
        rows.forEach((r) => lines.push(r));
      }
    }

    // Author's build guide — first ~800 chars of cleaned markdown.
    // (Overframe's slot data is opaque modIds without names, so the guide
    // text is the only readable source of mod choices.)
    var guide = d && cleanGuide(d.guideMarkdown);
    if (guide) {
      lines.push('');
      lines.push('### Author Guide');
      lines.push(esc(guide.slice(0, 800)));
      if (guide.length > 800) { lines.push('...'); }
    } else if (d && d.description) {
      lines.push('');
      lines.push(esc(d.description).slice(0, 800));
    }

    lines.push('');
    return lines.join('\n');
  }

  // Map scraper category slug -> markdown filename + display label.
  const CATS = {
    warframes: 'Warframes',
    archwing: 'Archwings',
    sentinels: 'Sentinels',
  };

  for (const [category, builds] of Object.entries(data.categories)) {
    if (!Array.isArray(builds) || !builds.length) { continue; }
    var label = CATS[category] || (category.charAt(0).toUpperCase() + category.slice(1));
    var md = heading(`Overframe Community Builds — ${label}`, intro);
    for (const b of builds) { md += renderBuild(b) + '\n'; }
    writeMd(`builds/overframe-${category}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// Index / Table of Contents
// ---------------------------------------------------------------------------
function writeIndex() {
  const md = `# Warframe Data Documentation

This is a complete, AI-readable documentation set for all Warframe game data.
Updated automatically from official sources and community APIs.

## How to Use

These files are structured as Markdown documentation optimized for AI assistants.
Each file covers one topic with names, descriptions, stats, and drop tables in human-readable format.

## Source Data Version

${(() => {
  const info = tryLoad('info.json');
  if (!info) { return 'Unknown'; }
  return `- **Hash:** ${info.hash}\n- **Timestamp:** ${new Date(info.timestamp).toISOString()}\n- **Modified:** ${new Date(info.modified).toISOString()}`;
})()}

## Table of Contents

### Equipment
- [Warframes](equipment/warframes.md) — All Warframes with stats, abilities, and crafting
- [Primary Weapons](weapons/primary-weapons.md) — Rifles, shotguns, bows, launchers
- [Secondary Weapons](weapons/secondary-weapons.md) — Pistols, thrown, dual wield
- [Melee Weapons](weapons/melee-weapons.md) — Swords, polearms, heavy blades
- [Arch-Guns](weapons/arch-guns.md) — Archwing primary weapons
- [Arch-Melee](weapons/arch-melee-weapons.md) — Archwing melee weapons
- [Archwings](equipment/archwings.md) — Flight suit stats and abilities
- [Railjack](equipment/railjack.md) — Ship components and armaments
- [Companions](equipment/companions.md) — Pets and Sentinels

### Modding
- [Mods](mods/mods.md) — Full mod database with stats per rank
- [Arcanes](mods/arcanes.md) — Arcane enhancements
- [Riven Tags](mods/riven-tags.md) — Riven stat tags and dispositions

### Drop Tables
- [Mission Rewards](drops/mission-rewards.md) — Every mission's rotation rewards
- [Relics](drops/relics.md) — Void relic reward tables
- [Sortie Rewards](drops/sortie-rewards.md) — Daily sortie drop tables
- [Transient Rewards](drops/transient-rewards.md) — Vault mods, Arbitrations, etc.
- [Mod Locations](drops/mod-locations.md) — Which enemies drop which mods
- [Enemy Mod Tables](drops/enemy-mod-tables.md) — Mods organized by enemy
- [Blueprint Locations](drops/blueprint-locations.md) — Blueprint drop sources
- [Enemy Blueprint Tables](drops/enemy-blueprint-tables.md) — Blueprints by enemy
- [Key Rewards](drops/key-rewards.md) — Key-locked mission rewards
- [Resource Drops by Enemy](drops/resource-drops-by-enemy.md) — Resources by enemy
- [Sigil Drops by Enemy](drops/sigil-drops-by-enemy.md) — Sigils by enemy
- [Additional Drops by Enemy](drops/additional-item-drops-by-enemy.md) — Extra enemy loot

### Bounties
- [Cetus Bounties](bounties/cetus-bounty-rewards.md) — Plains of Eidolon
- [Solaris Bounties](bounties/solaris-bounty-rewards.md) — Orb Vallis
- [Deimos Bounties](bounties/deimos-bounty-rewards.md) — Cambion Drift
- [Zariman Bounties](bounties/zariman-bounty-rewards.md) — Zariman Ten Zero
- [Entrati Lab](bounties/entrati-lab-rewards.md) — Entrati Lab missions
- [Hex Bounties](bounties/hex-bounty-rewards.md) — Hex missions

### Items
- [Resources](items/resources.md) — Crafting materials and drop sources
- [Fish](items/fish.md) — Fish species across open worlds
- [Gear](items/gear-items.md) — Gear wheel items
- [Quests](items/quests.md) — All quest descriptions
- [Enemies](items/enemies.md) — All enemies with stats and drop tables
- [Star Chart Nodes](items/star-chart-nodes.md) — All mission nodes by planet

### Reference
- [Syndicates](items/syndicates.md) — Syndicate info
- [Worldstate Reference](worldstate-reference.md) — Sol nodes, factions, mission types
- [Patch Notes](patch-notes.md) — Full update history

### Official Export Data
- [Warframes (Detailed)](public-export/warframes-detailed.md) — DE export with full stats
- [Weapons (Detailed)](public-export/weapons-detailed.md) — DE export with damage types
- [Mods (Detailed)](public-export/mods-detailed.md) — DE export mod data
- [Crafting Recipes](public-export/recipes.md) — All foundry recipes
- [Enemies](public-export/enemies.md) — Enemy types
- [Factions](public-export/factions.md) — All factions
- [Star Chart](public-export/regions.md) — Map regions and nodes
- [Focus Schools](public-export/focus-schools.md) — Operator focus upgrades
- [Dojo Recipes](public-export/dojo-recipes.md) — Clan research and decoration recipes
- [Nightwave](public-export/nightwave.md) — Challenges and rewards
- [Vendors](public-export/vendors.md) — All in-game shop inventories
- [Achievements](public-export/achievements.md) — In-game trophies and achievements
- [Syndicates (Detailed)](public-export/syndicates-detailed.md) — Full syndicate data
- [Bounties (Detailed)](public-export/bounties-detailed.md) — Bounty tiers and rewards

### Wiki Lore & Guides
- [Lore Characters](wiki/lore-characters.md) — Character profiles and background lore
- [Quest Guide](wiki/quests.md) — Quest walkthroughs and synopses
- [Factions](wiki/factions.md) — Faction overviews and history
- [Open Worlds](wiki/open-worlds.md) — Landscape area guides
- [Game Mechanics](wiki/mechanics.md) — In-depth mechanic explanations
- [Damage Types](wiki/damage-types.md) — Damage type details and status effects
- [Game Systems](wiki/game-systems.md) — Trading, Incarnon, Prime, Operator, Orbiter
- [Endgame](wiki/endgame.md) — Steel Path, Arbitrations, Eidolons, Liches
- [Companion Types](wiki/companions.md) — Kubrow, Kavat, Sentinel guides
- [Modular Equipment](wiki/modular-equipment.md) — Amps, Zaws, Kitguns, K-Drives, Necramechs

## Quick Download — Combined TXT Files

Pre-built text files combining all topics above, each ≤ 3 MB for easy upload to AI tools.

| File | Contents |
|---|---|
| [warframe-data-equipment.txt](warframe-data-equipment.txt) | Warframes, Archwings, Railjack, Companions |
| [warframe-data-weapons.txt](warframe-data-weapons.txt) | Primary, Secondary, Melee, Arch-Guns, Arch-Melee |
| [warframe-data-mods.txt](warframe-data-mods.txt) | Mods, Arcanes, Riven Tags |
| [warframe-data-drops-missions.txt](warframe-data-drops-missions.txt) | Mission Rewards, Sorties, Bounties, Key Rewards |
| [warframe-data-drops-relics.txt](warframe-data-drops-relics.txt) | Void Relics, Mod Locations, Blueprint Locations |
| [warframe-data-drops-enemies.txt](warframe-data-drops-enemies.txt) | Enemy Mod/Blueprint/Resource/Sigil Drop Tables |
| [warframe-data-items.txt](warframe-data-items.txt) | Resources, Fish, Gear, Quests, Syndicates, Enemies, Star Chart |
| [warframe-data-export.txt](warframe-data-export.txt) | Official DE Export: Warframes, Weapons, Mods, Recipes, Enemies, Factions, Regions |
| [warframe-data-export-extended.txt](warframe-data-export-extended.txt) | Focus Schools, Dojo, Nightwave, Vendors, Achievements, Syndicates, Bounties |
| [warframe-data-patchnotes.txt](warframe-data-patchnotes.txt) | Full Warframe patch note history |
| [warframe-data-mastery-rank.txt](warframe-data-mastery-rank.txt) | Mastery Rank requirements and tests |
| [warframe-data-lore.txt](warframe-data-lore.txt) | Wiki: Lore Characters, Factions |
| [warframe-data-quests.txt](warframe-data-quests.txt) | Wiki: Quest Walkthroughs |
| [warframe-data-mechanics.txt](warframe-data-mechanics.txt) | Wiki: Damage, Status Effects, Mechanics, Enemy Scaling |
| [warframe-data-systems.txt](warframe-data-systems.txt) | Wiki: Open Worlds, Game Systems, Endgame, Companions, Modular Equipment |
`;

  writeMd('README.md', md);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log('Transforming data -> docs/...\n');
  fs.mkdirSync(DOCS, { recursive: true });

  transformWarframes();
  transformWeapons();
  transformMods();
  transformArcanes();
  transformCompanions();
  transformArchwings();
  transformRailjack();
  transformRelics();
  transformMissionRewards();
  transformBountyRewards();
  transformSpecialRewards();
  transformModLocations();
  transformBlueprintLocations();
  transformKeyRewards();
  transformMiscItems();
  transformPatchlogs();
  transformRivenTags();
  transformSyndicates();
  transformPublicExport();
  transformWorldstateData();
  transformAvatarDrops();
  transformEnemies();
  transformNodes();
  transformFocusSchools();
  transformDojoRecipes();
  transformNightwave();
  transformVendors();
  transformAchievements();
  transformSyndicatesDetailed();
  transformBountiesDetailed();
  transformWikiLore();
  transformWikiQuests();
  transformWikiFactions();
  transformWikiOpenWorlds();
  transformWikiMechanics();
  transformWikiDamageTypes();
  transformWikiGameSystems();
  transformWikiEndgame();
  transformWikiCompanions();
  transformWikiModular();
  transformOverframeBuilds();
  writeIndex();

  console.log(`\nDone. ${_fileCount} documentation files written to docs/`);
}

main();
