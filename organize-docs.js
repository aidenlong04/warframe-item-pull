#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const docsDir = path.join(__dirname, 'docs');
const MAX_SIZE = 3 * 1024 * 1024; // 3 MB

// --- Step 1: Read individual md files and build section map ---

function readSection(relPath) {
  const full = path.join(docsDir, relPath);
  if (!fs.existsSync(full)) { return null; }
  return fs.readFileSync(full, 'utf8');
}

function getSectionHeading(content) {
  if (!content) { return null; }
  const match = content.match(/^# .+/m);
  return match ? match[0] : null;
}

const headingMap = new Map();
const mdFiles = [
  'equipment/warframes.md',
  'weapons/primary-weapons.md',
  'weapons/secondary-weapons.md',
  'weapons/melee-weapons.md',
  'weapons/arch-guns.md',
  'weapons/arch-melee-weapons.md',
  'equipment/archwings.md',
  'equipment/railjack.md',
  'equipment/companions.md',
  'mods/mods.md',
  'mods/arcanes.md',
  'mods/riven-tags.md',
  'drops/mission-rewards.md',
  'drops/relics.md',
  'drops/sortie-rewards.md',
  'drops/transient-rewards.md',
  'drops/mod-locations.md',
  'drops/enemy-mod-tables.md',
  'drops/blueprint-locations.md',
  'drops/enemy-blueprint-tables.md',
  'drops/key-rewards.md',
  'bounties/cetus-bounty-rewards.md',
  'bounties/solaris-bounty-rewards.md',
  'bounties/deimos-bounty-rewards.md',
  'bounties/zariman-bounty-rewards.md',
  'bounties/entrati-lab-rewards.md',
  'bounties/hex-bounty-rewards.md',
  'items/resources.md',
  'items/fish.md',
  'items/gear-items.md',
  'items/quests.md',
  'items/syndicates.md',
  'worldstate-reference.md',
  'patch-notes.md',
  'public-export/warframes-detailed.md',
  'public-export/weapons-detailed.md',
  'public-export/mods-detailed.md',
  'public-export/recipes.md',
  'public-export/enemies.md',
  'public-export/factions.md',
  'public-export/regions.md',
  'drops/resource-drops-by-enemy.md',
  'drops/sigil-drops-by-enemy.md',
  'drops/additional-item-drops-by-enemy.md',
  'items/enemies.md',
  'items/star-chart-nodes.md',
  'public-export/focus-schools.md',
  'public-export/dojo-recipes.md',
  'public-export/nightwave.md',
  'public-export/vendors.md',
  'public-export/achievements.md',
  'public-export/syndicates-detailed.md',
  'public-export/bounties-detailed.md',
  'wiki/lore-characters.md',
  'wiki/quests.md',
  'wiki/factions.md',
  'wiki/open-worlds.md',
  'wiki/mechanics.md',
  'wiki/damage-types.md',
  'wiki/game-systems.md',
  'wiki/endgame.md',
  'wiki/companions.md',
  'wiki/modular-equipment.md',
  'builds/overframe-warframes.md',
  'builds/overframe-archwing.md',
  'builds/overframe-sentinels.md',
];

for (const rel of mdFiles) {
  const content = readSection(rel);
  if (!content) {
    console.warn('  Missing: docs/' + rel);
    continue;
  }
  const h = getSectionHeading(content);
  if (h) {
    headingMap.set(h, content);
  } else {
    console.warn('  No heading found in docs/' + rel);
  }
}

console.log('Loaded ' + headingMap.size + ' sections from individual md files');

// --- Step 2: Sanitize content for Gemma 4 consumption ---
// Gemma 4 has a smaller context window than Gemini 2.5 and is more sensitive to noise,
// so we strip everything that does not carry retrievable facts: wiki links, forum links,
// bare URLs, Lotus paths, HTML tags, image descriptions, and stray whitespace.
// We also normalise Unicode that the system prompt forbids (smart quotes, en dash,
// unicode bullets, zero-width chars, NBSP, ellipsis, multiplication sign) so the model
// only ever sees the canonical token vocabulary it is told to emit.
//
// Wiki UI noise headers ("In-Game Description", "Click to view ...", "Patch History",
// "Trivia", etc.) are stripped because they contain no retrievable fact -- the prose
// that follows is the actual content. Long flattened paragraphs (>500 chars) are
// soft-wrapped on sentence boundaries so retrieval chunkers can split cleanly and so
// Gemma 4 sees one fact per line, which improves pattern matching.

// Regex matching wiki UI lines that are pure boilerplate. Match either a bare
// label (whole line) or a "Click to view ..." style instruction.
const NOISE_LINE = new RegExp([
  '^In-Game Description\\s*$',
  '^External Links?\\s*$',
  '^Main [Aa]rticle:.*$',
  '^See also:.*$',
  '^Click (?:to view|here).*$',
  '^Edit on wiki.*$',
  '^Patch History\\s*$',
  '^Maximization\\s*$',
  '^Gallery\\s*$',
  '^Tabber\\s*$',
  '^Media\\s*$',
  '^For the .* of the same name.*$',
  '^This .* is a stub.*$',
  '^#REDIRECT.*$',
  '^\\.\\s*$',
  '^\\|\\s*$'
].join('|'), 'gm');

// Wrap a single long prose line on sentence boundaries (". ", "! ", "? ").
// Avoid splitting markdown tables (lines containing pipes), headers, or list items.
function softWrap(line) {
  if (line.length <= 500) { return line; }
  if (line.indexOf('|') !== -1) { return line; }      // table row -- leave alone
  if (/^\s*[#>\-*]/.test(line)) { return line; }      // header / list / blockquote
  // Split on sentence terminator followed by a space and a capital/digit start.
  var parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/);
  if (parts.length === 1) { return line; }
  return parts.join('\n');
}

function sanitize(text) {
  text = text
    .replace(/\[Wiki\]\([^)]*\)/g, '')
    .replace(/\[Forum Link\]\([^)]*\)/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/Image Description:[^\n]*/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\/Lotus\/Language\/[^\s|)}\]]+/g, '')
    .replace(/\/Lotus\/[^\s|)}\]]+/g, function (m) { return m.split('/').pop(); })
    // Literal \\n in stat descriptions -> space
    .replace(/:\\n\+/g, ': +')
    .replace(/:\\n/g, ': ')
    // Strip zero-width chars (potential homoglyph / injection vector)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Strip UI / gallery box glyphs that survived wiki scrub
    .replace(/[\u25FC\u2588]/g, '')
    // NBSP and thin space -> regular space
    .replace(/[\u00A0\u2009\u202F]/g, ' ')
    // Smart quotes -> ASCII
    .replace(/[\u2018\u2019\u201A\u201B]/g, '\'')
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // En dash -> hyphen (em dash U+2014 is preserved -- canonical join token)
    .replace(/\u2013/g, '-')
    // Unicode bullets -> ASCII hyphen bullet
    .replace(/^[\u2022\u00B7\u25CF\u25E6\u2023\u2043]\s*/gm, '- ')
    .replace(/[\u2022\u00B7\u25CF\u25E6\u2023\u2043]/g, '-')
    // Ellipsis -> three dots
    .replace(/\u2026/g, '...')
    // Multiplication sign -> x (per prompt: write 2.8x)
    .replace(/\u00D7/g, 'x')
    // Comparison operators -> ASCII
    .replace(/\u2265/g, '>=')
    .replace(/\u2264/g, '<=')
    // Strip wiki-UI boilerplate lines (no retrievable facts)
    .replace(NOISE_LINE, '');

  // Soft-wrap long prose lines on sentence boundaries
  text = text.split('\n').map(softWrap).join('\n');

  // Drop ### subsection headers that are immediately followed by another header
  // or end of section (these are empty; they confuse the model into thinking
  // structured data exists when it does not).
  text = text.replace(/^### [^\n]+\n+(?=#)/gm, '');

  return text
    // Double spaces -> single
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+$/gm, '');
}

for (const [h, content] of headingMap) {
  headingMap.set(h, sanitize(content));
}

// --- Step 3: Remove old generated txt files (deferred until after groups defined) ---

// --- Step 4: Define groupings with schema descriptions ---
const groups = {
  'warframe-data-equipment': {
    label: 'Equipment (Warframes, Archwings, Railjack, Companions)',
    schema: 'Each ## entry is one piece of equipment. Stats are inline key: value pairs. Abilities listed under ### Abilities. Crafting components in tables under ### Crafting Components.',
    headings: [
      '# Warframes',
      '# Archwings',
      '# Railjack Components',
      '# Companions — Pets & Sentinels',
    ]
  },
  'warframe-data-weapons': {
    label: 'Weapons (Primary, Secondary, Melee, Arch-Guns, Arch-Melee)',
    schema: 'Each ## entry is one weapon. Meta line: Type | Mastery Req | Riven Disposition. Each ### is an attack mode with **Damage:** breakdown and inline stat line (Crit Chance | Crit Multiplier | Status Chance | Fire Rate). ### Crafting has component tables.',
    headings: [
      '# Primary Weapons',
      '# Secondary Weapons',
      '# Melee Weapons',
      '# Arch-Guns',
      '# Arch-Melee Weapons',
    ]
  },
  'warframe-data-mods': {
    label: 'Mods, Arcanes & Rivens',
    schema: 'Each ## entry is one mod/arcane. Meta line: Rarity | Polarity | Drain | Compatible | Max Rank. ### Stats by Rank lists per-rank values. ### Drop Locations lists enemies with %.',
    headings: [
      '# Mods',
      '# Arcanes',
      '# Riven Mod Tags & Dispositions',
    ]
  },
  'warframe-data-drops-missions': {
    label: 'Mission & Bounty Drop Tables',
    schema: 'Mission rewards organized by ## Planet, ### Node — Mode. Rotation rewards in tables: Item | Rarity | Chance. Bounties show tier rewards with stage and % in tables.',
    headings: [
      '# Mission Rewards',
      '# Sortie Rewards',
      '# Transient Rewards',
      '# Key Rewards',
      '# Cetus Bounty Rewards',
      '# Solaris Bounty Rewards',
      '# Deimos Bounty Rewards',
      '# Zariman Bounty Rewards',
      '# Entrati Lab Rewards',
      '# Hex Bounty Rewards',
    ]
  },
  'warframe-data-drops-relics': {
    label: 'Relics & Item Drop Locations',
    schema: 'Relics by ## Era Name, ### Refinement State with reward tables. Mod/Blueprint locations: ## Item Name with enemy tables showing drop %.',
    headings: [
      '# Void Relics',
      '# Mod Drop Locations',
      '# Blueprint Drop Locations',
    ]
  },
  'warframe-data-drops-enemies': {
    label: 'Enemy Drop Tables',
    schema: 'Each ## is one enemy. Tables list what that enemy drops: mods, blueprints, resources, sigils with rarity and exact % chance.',
    headings: [
      '# Enemy Mod Drop Tables',
      '# Enemy Blueprint Drop Tables',
      '# Resource Drops by Enemy',
      '# Sigil Drops by Enemy',
      '# Additional Item Drops by Enemy',
    ]
  },
  'warframe-data-items': {
    label: 'Items, Enemies & Star Chart',
    schema: 'Resources/Fish/Gear/Quests: ## Name + description + drop sources. Enemies: ## Name with inline stats (Health | Shield | Armor | Faction) and drop tables. Star Chart: ## System with node tables (Node | Levels | Faction).',
    headings: [
      '# Resources',
      '# Fish',
      '# Gear Items',
      '# Quests',
      '# Syndicates',
      '# Worldstate Reference Data',
      '# Enemies',
      '# Star Chart Nodes',
    ]
  },
  'warframe-data-export': {
    label: 'Official DE Export Data',
    schema: 'Authoritative data from Digital Extremes public export. Warframes/Weapons have inline stats. Recipes: ## Item with Credits | Build Time | Rush cost and ingredient tables. Regions: ## Node with System | Type | MR | Level | Faction.',
    headings: [
      '# Public Export — Warframes (Detailed)',
      '# Public Export — Weapons (Detailed)',
      '# Public Export — Mods & Upgrades',
      '# Public Export — Crafting Recipes',
      '# Public Export — Enemies',
      '# Public Export — Factions',
      '# Public Export — Star Chart Regions',
    ]
  },
  'warframe-data-export-extended': {
    label: 'Extended DE Export Data (Focus, Dojo, Nightwave, Vendors, Achievements, Syndicates, Bounties)',
    schema: 'Focus Schools: ## School > ### Upgrade with meta + rank tables. Dojo: ## Category > ### Recipe with costs. Vendors: ## Vendor with item/price tables. Syndicates: ranks + standing thresholds.',
    headings: [
      '# Focus Schools & Operator Upgrades',
      '# Dojo Recipes & Clan Research',
      '# Nightwave',
      '# Vendors & Shops',
      '# Achievements',
      '# Public Export — Syndicates (Detailed)',
      '# Public Export — Bounties (Detailed)',
    ]
  },
  'warframe-data-patchnotes': {
    label: 'Patch Notes History',
    schema: 'Each ## is one update/hotfix. **Date:** and **Type:** on first line. Additions, Changes, Fixes in ### subsections.',
    headings: [
      '# Warframe Patch Notes',
    ]
  },
  'warframe-data-lore': {
    label: 'Lore — Characters & Factions',
    schema: 'Each ## is a character or faction. Content is narrative prose from the Warframe wiki describing backstory, role, and lore significance.',
    headings: [
      '# Wiki — Lore Characters & Factions',
      '# Wiki — Factions',
    ]
  },
  'warframe-data-quests': {
    label: 'Quests — Walkthroughs & Story',
    schema: 'Each ## is a quest. Sections include Synopsis, Walkthrough, and Rewards. Spoiler-heavy story content.',
    headings: [
      '# Wiki — Quest Guide',
    ]
  },
  'warframe-data-mechanics': {
    label: 'Mechanics — Damage, Status Effects & Game Systems',
    schema: 'Each ## is a mechanic or damage type. Content explains formulas, multipliers, status effects, scaling, and interactions.',
    headings: [
      '# Wiki — Game Mechanics',
      '# Wiki — Damage Types',
    ]
  },
  'warframe-data-systems': {
    label: 'Systems — Open Worlds, Endgame, Companions & Modular Equipment',
    schema: 'Each ## is a game system or location. Content covers Trading, Incarnon, Open Worlds, Steel Path, Arbitrations, Eidolons, Liches, companion breeds, and modular weapons (Amps, Zaws, Kitguns, K-Drives, Necramechs).',
    headings: [
      '# Wiki — Open Worlds & Landscapes',
      '# Wiki — Game Systems',
      '# Wiki — Endgame Activities',
      '# Wiki — Companion Types',
      '# Wiki — Modular Equipment',
    ]
  },
  'warframe-data-community-builds': {
    label: 'Community Builds (Overframe.gg, T3-equivalent, community-curated)',
    schema: 'Each ## entry is one community-submitted build flagged `(community-curated, source: Overframe)`. Meta line: Role | Author | Votes | Forma | MR | Overframe build #ID. Role is one of `top` (highest community score for that item — meta/endgame pick), `utility` (title-matched support / CC / farming / stealth / subsume build), or `runner-up` (second highest score, alternative meta). For endgame queries (Steel Path, Netracells, Deep Archimedea, Eidolon, Profit-Taker, level-cap) prefer `top` or `runner-up`; quote `utility` only when the operator requests support / CC / farming / stealth / Helminth context. When enriched, ### Mod Loadout lists each slot as `- S<N> <Mod Name>` (mod names resolved from Overframe\'s mod catalog; rank, polarity, and drain are intentionally omitted — assume max rank unless the author guide says otherwise), followed by ### Author Guide containing the first ~800 chars of the author\'s build write-up. Treat as suggestions only — never override official stats from equipment/weapons/mods/export bundles. Bot output must still never list polarity or drain values.',
    headings: [
      '# Overframe Community Builds — Warframes',
      '# Overframe Community Builds — Archwings',
      '# Overframe Community Builds — Sentinels',
    ]
  },
};

// Deferred cleanup: remove only files matching group names
var managedPrefixes = Object.keys(groups).concat(Object.keys(groups).map(function (k) { return k + '-part'; }));
fs.readdirSync(docsDir)
  .filter(function (f) {
    if (!f.endsWith('.txt')) { return false; }
    return managedPrefixes.some(function (p) { return f.startsWith(p); });
  })
  .forEach(function (f) { fs.unlinkSync(path.join(docsDir, f)); });

// --- Step 5: Write grouped files, split if >3MB ---
function splitOnLines(text, maxSize) {
  var lines = text.split('\n');
  var parts = [];
  var currentLines = [];
  var currentSize = 0;
  for (var i = 0; i < lines.length; i++) {
    var lineSize = Buffer.byteLength(lines[i], 'utf8') + 1; // +1 for newline
    if (currentSize + lineSize > maxSize && currentLines.length > 0) {
      parts.push(currentLines.join('\n'));
      currentLines = [];
      currentSize = 0;
    }
    currentLines.push(lines[i]);
    currentSize += lineSize;
  }
  if (currentLines.length) { parts.push(currentLines.join('\n')); }
  return parts;
}

var totalFiles = 0;
for (const [baseName, group] of Object.entries(groups)) {
  // Build preamble: title, FORMAT line, INDEX line.
  // Tuned for Gemma 4: explicit uppercase labels so a small model can lock onto
  // the structure on a single read; ASCII only; one fact per line.
  var content = '# ' + group.label + '\n';
  if (group.schema) {
    content += 'FORMAT: ' + group.schema + '\n';
  }

  // Count ## entries per section for a compact INDEX
  var tocLines = [];
  for (const h of group.headings) {
    var section = headingMap.get(h);
    if (section) {
      var entryCount = (section.match(/^## /gm) || []).length;
      var sectionName = h.replace(/^# /, '');
      tocLines.push(sectionName + ' (' + entryCount + ' entries)');
    }
  }
  if (tocLines.length >= 1) {
    content += 'INDEX: ' + tocLines.join(' | ') + '\n';
  }
  content += '\n';

  // Append each section separated by a single blank line
  for (const h of group.headings) {
    var section = headingMap.get(h);
    if (section) {
      content += section.trim() + '\n\n';
    } else {
      console.warn('  WARNING: Section not found: ' + h);
    }
  }

  var totalSize = Buffer.byteLength(content, 'utf8');

  if (totalSize <= MAX_SIZE) {
    var filename = baseName + '.txt';
    fs.writeFileSync(path.join(docsDir, filename), content, 'utf8');
    console.log(filename + ': ' + (totalSize / 1024 / 1024).toFixed(2) + ' MB');
    totalFiles++;
  } else {
    var parts = splitOnLines(content, MAX_SIZE);
    for (var i = 0; i < parts.length; i++) {
      var partFilename = baseName + '-part' + (i + 1) + '.txt';
      fs.writeFileSync(path.join(docsDir, partFilename), parts[i], 'utf8');
      var size = Buffer.byteLength(parts[i], 'utf8');
      console.log(partFilename + ': ' + (size / 1024 / 1024).toFixed(2) + ' MB');
      totalFiles++;
    }
  }
}

console.log('\n' + totalFiles + ' grouped files written to docs/');

// --- Step 6: Generate Mastery Rank reference file ---
var mrContent = `# Mastery Rank
FORMAT: Reference doc. ## sections cover earning rules, XP formula, and the full rank table (rank | name | XP req | total XP | test).
INDEX: Earning Mastery Points | XP Formula | Mastery Rank Table

Mastery Ranking (MR) tracks total content experienced. Points come from ranking equipment with Affinity, clearing nodes, Junctions, and Intrinsics. Ranks after MR30 are Legendary Ranks (LR).

## Earning Mastery Points
Weapons/Kitgun Chambers/Zaw Strikes/Amp Prisms/Sentinel weapons/Archwing weapons: 100 per rank to 30 (3,000 total)
Kitguns/Zaws/Amps: must be gilded and re-ranked to award mastery
Paracesis/Kuva/Tenet/Coda weapons: +2 ranks per Forma up to Rank 40 at 5 Forma (4,000 total)
Warframes/Companions/Archwings/K-Drives/Plexus/Necramechs: 200 per rank to 30 (6,000 total)
Necramechs: +2 ranks per Forma up to Rank 40 at 5 Forma (8,000 total)
MOAs/Predasites/Vulpaphylas: must be gilded and re-ranked
First node clear: predetermined mastery points per node
Junction specter: 1,000 points per Junction
Railjack/Drifter Intrinsics: 1,500 per rank
Each item grants mastery once. Polarizing/re-leveling mastered gear does not re-grant.
Variants (MK1, Prime, Vandal, Wraith, Prisma, Kuva, Tenet, etc.) count separately.
Steel Path nodes/Junctions award mastery separately from normal mode.

## XP Formula
Ranks 1-30: 2,500 x Rank^2 total XP required
Legendary ranks: 2,250,000 + (147,500 x LR number)

## Mastery Rank Table
| Rank Name | Rank | Next Rank Req | Total XP | Test |
|---|---|---|---|---|
| Unranked | 0 | 2,500 | 0 | None |
| Initiate | 1 | 7,500 | 2,500 | Primary |
| Silver Initiate | 2 | 12,500 | 10,000 | Sidearm |
| Gold Initiate | 3 | 17,500 | 22,500 | Melee |
| Novice | 4 | 22,500 | 40,000 | Survival (1:30) |
| Silver Novice | 5 | 27,500 | 62,500 | Terminal Hacking |
| Gold Novice | 6 | 32,500 | 90,000 | Targets (3 waves) |
| Disciple | 7 | 37,500 | 122,500 | Timed Exterminate |
| Silver Disciple | 8 | 42,500 | 160,000 | Movement |
| Gold Disciple | 9 | 47,500 | 202,500 | Stealth |
| Seeker | 10 | 52,500 | 250,000 | Defense (10 waves) |
| Silver Seeker | 11 | 57,500 | 302,500 | Timed Exterminate (advanced) |
| Gold Seeker | 12 | 62,500 | 360,000 | Survival (advanced, 2:00) |
| Hunter | 13 | 67,500 | 422,500 | Advanced Timed Exterminate |
| Silver Hunter | 14 | 72,500 | 490,000 | Advanced Stealth |
| Gold Hunter | 15 | 77,500 | 562,500 | Interception (3 rounds) |
| Eagle | 16 | 82,500 | 640,000 | Defense (6 waves, 3 obj) |
| Silver Eagle | 17 | 87,500 | 722,500 | Timed Exterminate (archwing) |
| Gold Eagle | 18 | 92,500 | 810,000 | Advanced Defense (10 waves) |
| Tiger | 19 | 97,500 | 902,500 | Stealth Exterminate (lv30) |
| Silver Tiger | 20 | 102,500 | 1,000,000 | Archwing Time Trial |
| Gold Tiger | 21 | 107,500 | 1,102,500 | Timed Exterminate (lv30) |
| Dragon | 22 | 112,500 | 1,210,000 | Survival (w/Energy drain) |
| Silver Dragon | 23 | 117,500 | 1,322,500 | Mobile Point Capture |
| Gold Dragon | 24 | 122,500 | 1,440,000 | Operator Timed Exterminate |
| Sage | 25 | 127,500 | 1,562,500 | Operator Tower |
| Silver Sage | 26 | 132,500 | 1,690,000 | Timed Exterminate (operator only) |
| Gold Sage | 27 | 137,500 | 1,822,500 | Defense (Operator only) |
| Master | 28 | 142,500 | 1,960,000 | Advanced Landing Pad Capture |
| Middle Master | 29 | 147,500 | 2,102,500 | Survival (Infested, Operator eligible) |
| True Master | 30 | — | 2,250,000 | Final Exam |
| LR1 | L1 | 147,500 | 2,397,500 | — |
| LR2 | L2 | 147,500 | 2,545,000 | — |
| LR3 | L3 | 147,500 | 2,692,500 | — |
| LR4 | L4 | 147,500 | 2,840,000 | — |
| LR5 | L5 | 147,500 | 2,987,500 | — |
`;

fs.writeFileSync(path.join(docsDir, 'warframe-data-mastery-rank.txt'), mrContent, 'utf8');
console.log('warframe-data-mastery-rank.txt: ' + (Buffer.byteLength(mrContent, 'utf8') / 1024).toFixed(1) + ' KB');
totalFiles++;

console.log('\nDone! ' + totalFiles + ' total files written to docs/');
