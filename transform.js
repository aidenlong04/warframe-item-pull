/**
 * transform.js — Converts all pulled Warframe JSON data into
 * Spark AI-readable Markdown documentation files.
 *
 * Run after pull.js:  npm run transform
 *
 * Output: docs/  (one .md per topic, structured for AI consumption)
 *
 * Design:
 *  - Each file has a front-matter header with title + description
 *  - Natural-language sentences + tables instead of raw JSON
 *  - Every item gets its name, description, and all relevant stats
 *  - Modular: each converter is a function; add new ones at the bottom
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
  fs.writeFileSync(full, content);
  _fileCount++;
  console.log(`  -> docs/${relPath}`);
}

function esc(s) {
  if (s == null) { return ''; }
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function pct(n) {
  if (n == null) { return '—'; }
  return `${Number(n).toFixed(2)}%`;
}

function heading(title, description) {
  return `# ${title}\n\n${description}\n\n`;
}

function formatDrop(d) {
  return `${d.location} (${pct(d.chance)})`;
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

  for (const wf of items) {
    md += `## ${wf.name}\n\n`;
    if (wf.description) { md += `${wf.description}\n\n`; }

    // Stats table
    md += '| Stat | Value |\n|---|---|\n';
    if (wf.health != null) { md += `| Health | ${wf.health} |\n`; }
    if (wf.shield != null) { md += `| Shield | ${wf.shield} |\n`; }
    if (wf.armor != null) { md += `| Armor | ${wf.armor} |\n`; }
    if (wf.power != null) { md += `| Energy | ${wf.power} |\n`; }
    if (wf.sprint != null) { md += `| Sprint Speed | ${wf.sprint} |\n`; }
    if (wf.aura) { md += `| Aura Polarity | ${wf.aura} |\n`; }
    if (wf.masteryReq) { md += `| Mastery Req | ${wf.masteryReq} |\n`; }
    md += '\n';

    // Abilities
    if (wf.abilities && wf.abilities.length) {
      md += '### Abilities\n\n';
      for (const ab of wf.abilities) {
        md += `**${ab.name}:** ${ab.description || 'No description available.'}\n\n`;
      }
    }

    // Components / Crafting
    if (wf.components && wf.components.length) {
      md += '### Crafting Components\n\n';
      md += '| Component | Count | Drops |\n|---|---|---|\n';
      for (const comp of wf.components) {
        const drops = (comp.drops || [])
          .map(formatDrop)
          .join('; ') || '—';
        md += `| ${esc(comp.name)} | ${comp.itemCount || 1} | ${esc(drops)} |\n`;
      }
      md += '\n';
    }

    // Patch history (concise)
    if (wf.patchlogs && wf.patchlogs.length) {
      md += `### Patch History (${wf.patchlogs.length} entries)\n\n`;
      for (const p of wf.patchlogs.slice(0, 5)) {
        md += `- **${p.name}** (${p.date || ''}): ${esc((p.changes || p.additions || p.fixes || '').slice(0, 200))}\n`;
      }
      if (wf.patchlogs.length > 5) { md += `- ...and ${wf.patchlogs.length - 5} more patches\n`; }
      md += '\n';
    }
  }

  writeMd('warframes.md', md);
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

    for (const w of items) {
      md += `## ${w.name}\n\n`;
      if (w.description) { md += `${w.description}\n\n`; }

      // General info
      const meta = [];
      if (w.type) { meta.push(`**Type:** ${w.type}`); }
      if (w.masteryReq) { meta.push(`**Mastery Req:** ${w.masteryReq}`); }
      if (w.disposition) { meta.push(`**Riven Disposition:** ${w.disposition}`); }
      if (meta.length) { md += meta.join(' | ') + '\n\n'; }

      // Attacks
      if (w.attacks && w.attacks.length) {
        for (const atk of w.attacks) {
          md += `### ${atk.name || 'Attack'}\n\n`;
          if (atk.damage && typeof atk.damage === 'object') {
            const dmgParts = Object.entries(atk.damage)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${k}: ${v}`);
            if (dmgParts.length) { md += `**Damage:** ${dmgParts.join(', ')}\n\n`; }
          }
          const stats = [];
          if (atk.crit_chance != null) { stats.push(`Crit Chance: ${pct(atk.crit_chance * 100)}`); }
          if (atk.crit_mult != null) { stats.push(`Crit Multiplier: ${atk.crit_mult}x`); }
          if (atk.status_chance != null) { stats.push(`Status Chance: ${pct(atk.status_chance * 100)}`); }
          if (atk.speed != null) { stats.push(`Fire Rate: ${atk.speed}`); }
          if (stats.length) { md += stats.join(' | ') + '\n\n'; }
        }
      }

      // Components
      if (w.components && w.components.length) {
        md += '### Crafting\n\n| Component | Count | Drops |\n|---|---|---|\n';
        for (const c of w.components) {
          const drops = (c.drops || []).map(formatDrop).join('; ') || '—';
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

  for (const m of items) {
    md += `## ${m.name}\n\n`;
    if (m.description) { md += `${m.description}\n\n`; }

    const meta = [];
    if (m.rarity) { meta.push(`**Rarity:** ${m.rarity}`); }
    if (m.polarity) { meta.push(`**Polarity:** ${m.polarity}`); }
    if (m.baseDrain != null) { meta.push(`**Drain:** ${m.baseDrain}`); }
    if (m.compatName) { meta.push(`**Compatible:** ${m.compatName}`); }
    if (m.isAugment) { meta.push('**Augment**'); }
    if (m.isPrime) { meta.push('**Prime**'); }
    if (m.fusionLimit != null) { meta.push(`**Max Rank:** ${m.fusionLimit}`); }
    if (meta.length) { md += meta.join(' | ') + '\n\n'; }

    // Level stats
    if (m.levelStats && m.levelStats.length) {
      md += '### Stats by Rank\n\n';
      for (let i = 0; i < m.levelStats.length; i++) {
        const stats = (m.levelStats[i].stats || []).join(', ');
        if (stats) { md += `- **Rank ${i}:** ${stats}\n`; }
      }
      md += '\n';
    }

    // Drops
    if (m.drops && m.drops.length) {
      md += '### Drop Locations\n\n';
      for (const d of m.drops) {
        md += `- ${d.location} — ${d.rarity || ''} (${pct(d.chance)})\n`;
      }
      md += '\n';
    }
  }

  writeMd('mods.md', md);
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

  for (const a of items) {
    md += `## ${a.name}\n\n`;
    if (a.description) { md += `${a.description}\n\n`; }

    if (a.levelStats && a.levelStats.length) {
      md += '### Stats by Rank\n\n';
      for (let i = 0; i < a.levelStats.length; i++) {
        const stats = (a.levelStats[i].stats || []).join(', ');
        if (stats) { md += `- **Rank ${i}:** ${stats}\n`; }
      }
      md += '\n';
    }

    if (a.drops && a.drops.length) {
      md += '### Drop Sources\n\n';
      for (const d of a.drops) {
        md += `- ${d.location} — ${d.type || ''} (${pct(d.chance)})\n`;
      }
      md += '\n';
    }
  }

  writeMd('arcanes.md', md);
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

  for (const c of [...pets, ...sents]) {
    md += `## ${c.name}\n\n`;
    if (c.description) { md += `${c.description}\n\n`; }

    md += '| Stat | Value |\n|---|---|\n';
    if (c.health != null) { md += `| Health | ${c.health} |\n`; }
    if (c.shield != null) { md += `| Shield | ${c.shield} |\n`; }
    if (c.armor != null) { md += `| Armor | ${c.armor} |\n`; }
    if (c.power != null) { md += `| Energy | ${c.power} |\n`; }
    md += '\n';

    if (c.components && c.components.length) {
      md += '### Crafting\n\n| Component | Count |\n|---|---|\n';
      for (const comp of c.components) {
        md += `| ${esc(comp.name)} | ${comp.itemCount || 1} |\n`;
      }
      md += '\n';
    }
  }

  writeMd('companions.md', md);
}

// ---------------------------------------------------------------------------
// 6. Archwings
// ---------------------------------------------------------------------------
function transformArchwings() {
  const items = tryLoad('items-Archwing.json');
  if (!items) { return; }

  let md = heading('Archwings', 'All Archwing flight suits with stats, abilities, and crafting data.');

  for (const a of items) {
    md += `## ${a.name}\n\n`;
    if (a.description) { md += `${a.description}\n\n`; }

    md += '| Stat | Value |\n|---|---|\n';
    if (a.health != null) { md += `| Health | ${a.health} |\n`; }
    if (a.shield != null) { md += `| Shield | ${a.shield} |\n`; }
    if (a.armor != null) { md += `| Armor | ${a.armor} |\n`; }
    if (a.power != null) { md += `| Energy | ${a.power} |\n`; }
    md += '\n';

    if (a.abilities && a.abilities.length) {
      md += '### Abilities\n\n';
      for (const ab of a.abilities) {
        md += `**${ab.name}:** ${ab.description || ''}\n\n`;
      }
    }
  }

  writeMd('archwings.md', md);
}

// ---------------------------------------------------------------------------
// 7. Railjack
// ---------------------------------------------------------------------------
function transformRailjack() {
  const items = tryLoad('items-Railjack.json');
  if (!items) { return; }

  let md = heading('Railjack Components', 'All Railjack ship components, armaments, and avionics.');

  for (const r of items) {
    md += `## ${r.name}\n\n`;
    if (r.description) { md += `${r.description}\n\n`; }
    if (r.type) { md += `**Type:** ${r.type}\n\n`; }
  }

  writeMd('railjack.md', md);
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
      md += `## ${name}\n\n`;
      for (const [state, rewards] of Object.entries(states)) {
        md += `### ${state}\n\n`;
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
    md += '---\n\n## Relic Descriptions\n\n';
    for (const r of itemRelics) {
      if (r.description) { md += `**${r.name}:** ${r.description}\n\n`; }
    }
  }

  writeMd('relics.md', md);
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
    md += `## ${planet}\n\n`;
    for (const [node, info] of Object.entries(nodes)) {
      md += `### ${node} — ${info.gameMode || 'Unknown'}${info.isEvent ? ' (Event)' : ''}\n\n`;
      if (info.rewards) {
        // Check if rewards uses rotation letters (A/B/C) or numeric keys (flat list)
        const entries = Object.entries(info.rewards);
        const hasRotations = entries.some(([k]) => /^[A-Z]$/.test(k));

        if (hasRotations) {
          for (const [rot, rewards] of entries) {
            if (!Array.isArray(rewards)) { continue; }
            md += `**Rotation ${rot}:**\n\n`;
            md += '| Item | Rarity | Chance |\n|---|---|---|\n';
            for (const rw of rewards) {
              md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
            }
            md += '\n';
          }
        } else {
          // Flat reward list (numeric keys or single-item objects)
          md += '| Item | Rarity | Chance |\n|---|---|---|\n';
          for (const [, rw] of entries) {
            if (rw && typeof rw === 'object' && rw.itemName) {
              md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
            }
          }
          md += '\n';
        }
      }
    }
  }

  writeMd('mission-rewards.md', md);
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
      md += `## ${esc(label)}\n\n`;

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
          md += `**Rotation ${rot}:**\n\n| Item | Rarity | Chance |\n|---|---|---|\n`;
          for (const rw of rws) {
            md += `| ${esc(rw.itemName)} | ${rw.rarity || '—'} | ${pct(rw.chance)} |\n`;
          }
          md += '\n';
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
      md += `## ${obj}\n\n| Item | Rarity | Chance | Rotation |\n|---|---|---|---|\n`;
      for (const rw of rewards) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} | ${rw.rotation || '—'} |\n`;
      }
      md += '\n';
    }
    writeMd('sortie-rewards.md', md);
  }

  // Transient
  const trans = tryLoad('transientRewards.json');
  if (trans && trans.length) {
    let md = heading(
      'Transient Rewards',
      'Special mission reward tables including Derelict Vault mods, Arbitrations, and other transient objectives.'
    );
    for (const entry of trans) {
      md += `## ${entry.objectiveName || 'Unknown'}\n\n`;
      md += '| Item | Rarity | Chance | Rotation |\n|---|---|---|---|\n';
      for (const rw of (entry.rewards || [])) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} | ${rw.rotation || '—'} |\n`;
      }
      md += '\n';
    }
    writeMd('transient-rewards.md', md);
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
      md += `## ${entry.modName || 'Unknown'}\n\n`;
      if (entry.enemies && entry.enemies.length) {
        md += '| Enemy | Enemy Drop Chance | Rarity | Chance |\n|---|---|---|---|\n';
        for (const e of entry.enemies) {
          md += `| ${esc(e.enemyName)} | ${pct(e.enemyModDropChance)} | ${e.rarity} | ${pct(e.chance)} |\n`;
        }
      }
      md += '\n';
    }
    writeMd('mod-locations.md', md);
  }

  const enemyMod = tryLoad('enemyModTables.json');
  if (enemyMod && enemyMod.length) {
    let md = heading(
      'Enemy Mod Drop Tables',
      'Every enemy and which mods they drop, organized by enemy name with base mod drop chances.'
    );
    for (const entry of enemyMod) {
      md += `## ${entry.enemyName || 'Unknown'}\n\n`;
      md += `**Base Mod Drop Chance:** ${pct(entry.enemyModDropChance)}\n\n`;
      if (entry.mods && entry.mods.length) {
        md += '| Mod | Rarity | Chance |\n|---|---|---|\n';
        for (const m of entry.mods) {
          md += `| ${esc(m.modName)} | ${m.rarity} | ${pct(m.chance)} |\n`;
        }
      }
      md += '\n';
    }
    writeMd('enemy-mod-tables.md', md);
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
    md += `## ${entry.itemName || entry.blueprintName || 'Unknown'}\n\n`;
    if (entry.enemies && entry.enemies.length) {
      md += '| Enemy | Blueprint Drop % | Item Drop % | Rarity | Chance |\n|---|---|---|---|---|\n';
      for (const e of entry.enemies) {
        md += `| ${esc(e.enemyName)} | ${pct(e.enemyBlueprintDropChance)} | ${pct(e.enemyItemDropChance)} | ${e.rarity} | ${pct(e.chance)} |\n`;
      }
    }
    md += '\n';
  }

  writeMd('blueprint-locations.md', md);

  // Enemy blueprint tables
  const enemyBp = tryLoad('enemyBlueprintTables.json');
  if (enemyBp && enemyBp.length) {
    let md2 = heading(
      'Enemy Blueprint Drop Tables',
      'Every enemy and which blueprints they can drop, organized by enemy.'
    );
    for (const entry of enemyBp) {
      md2 += `## ${entry.enemyName || 'Unknown'}\n\n`;
      const allItems = [...(entry.items || []), ...(entry.mods || [])];
      if (allItems.length) {
        md2 += '| Item | Rarity | Chance |\n|---|---|---|\n';
        for (const it of allItems) {
          md2 += `| ${esc(it.itemName || it.modName)} | ${it.rarity} | ${pct(it.chance)} |\n`;
        }
      }
      md2 += '\n';
    }
    writeMd('enemy-blueprint-tables.md', md2);
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
  for (const entry of arr) {
    md += `## ${entry.keyName || entry.objectiveName || 'Key Mission'}\n\n`;
    const rewards = entry.rewards;
    if (Array.isArray(rewards)) {
      md += '| Item | Rarity | Chance |\n|---|---|---|\n';
      for (const rw of rewards) {
        md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
      }
    } else if (rewards && typeof rewards === 'object') {
      for (const [rot, rws] of Object.entries(rewards)) {
        if (!Array.isArray(rws)) { continue; }
        md += `**Rotation ${rot}:**\n\n| Item | Rarity | Chance |\n|---|---|---|\n`;
        for (const rw of rws) {
          md += `| ${esc(rw.itemName)} | ${rw.rarity} | ${pct(rw.chance)} |\n`;
        }
        md += '\n';
      }
    }
    md += '\n';
  }

  writeMd('key-rewards.md', md);
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

  for (const [file, title, desc] of cats) {
    const items = tryLoad(file);
    if (!items || !items.length) { continue; }

    let md = heading(title, desc);

    for (const item of items) {
      md += `## ${item.name}\n\n`;
      if (item.description) { md += `${item.description}\n\n`; }

      const meta = [];
      if (item.type) { meta.push(`**Type:** ${item.type}`); }
      if (item.tradable) { meta.push('**Tradable**'); }
      if (meta.length) { md += meta.join(' | ') + '\n\n'; }

      if (item.drops && item.drops.length) {
        md += '### Drop Sources\n\n';
        for (const d of item.drops.slice(0, 20)) {
          md += `- ${d.location} — ${d.rarity || ''} (${pct(d.chance)})\n`;
        }
        if (item.drops.length > 20) { md += `- ...and ${item.drops.length - 20} more sources\n`; }
        md += '\n';
      }
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`${safe}.md`, md);
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

  for (const p of logs) {
    md += `## ${p.name || 'Untitled'}\n\n`;
    md += `**Date:** ${p.date || 'Unknown'} | **Type:** ${p.type || 'Update'}`;
    if (p.url) { md += ` | [Forum Link](${p.url})`; }
    md += '\n\n';

    if (p.description) { md += `${p.description}\n\n`; }
    if (p.additions) { md += `### Additions\n\n${p.additions}\n\n`; }
    if (p.changes) { md += `### Changes\n\n${p.changes}\n\n`; }
    if (p.fixes) { md += `### Fixes\n\n${p.fixes}\n\n`; }
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
    md += `## ${category}\n\n`;
    md += '| Tag | Prefix | Suffix | Weight |\n|---|---|---|---|\n';
    for (const e of entries) {
      md += `| ${esc(e.tag)} | ${esc(e.prefix)} | ${esc(e.suffix)} | ${e.value} |\n`;
    }
    md += '\n';
  }

  writeMd('riven-tags.md', md);
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
      md += `## ${name}\n\n`;
      if (typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) {
          if (k === 'name') { continue; }
          md += `**${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}\n\n`;
        }
      }
    }
  } else if (typeof data === 'object') {
    for (const [key, val] of Object.entries(data)) {
      md += `## ${key}\n\n`;
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

  writeMd('syndicates.md', md);
}

// ---------------------------------------------------------------------------
// 19. Public Export — Warframes (resolved names via dict_en)
// ---------------------------------------------------------------------------
function transformPublicExport() {
  const dict = tryLoad('public-export/dict_en.json');
  if (!dict) { return; }

  function resolve(key) {
    if (!key) { return ''; }
    return dict[key] || key.split('/').pop() || key;
  }

  // Warframes
  const wfs = tryLoad('public-export/ExportWarframes.json');
  if (wfs) {
    let md = heading(
      'Public Export — Warframes (Detailed)',
      'Official Digital Extremes Warframe data export with resolved English names. ' +
      'Includes precise stat numbers, ability energy costs, mastery requirements, and variant info.'
    );

    for (const [, wf] of Object.entries(wfs)) {
      const name = resolve(wf.name);
      md += `## ${name}\n\n`;
      const desc = resolve(wf.description);
      if (desc && desc !== name) { md += `${desc}\n\n`; }

      md += '| Stat | Value |\n|---|---|\n';
      if (wf.health != null) { md += `| Health | ${wf.health} |\n`; }
      if (wf.shield != null) { md += `| Shield | ${wf.shield} |\n`; }
      if (wf.armor != null) { md += `| Armor | ${wf.armor} |\n`; }
      if (wf.power != null) { md += `| Energy | ${wf.power} |\n`; }
      if (wf.stamina != null) { md += `| Stamina | ${wf.stamina} |\n`; }
      if (wf.masteryReq != null) { md += `| Mastery Req | ${wf.masteryReq} |\n`; }
      md += '\n';

      if (wf.abilities && wf.abilities.length) {
        md += '### Abilities\n\n';
        for (const ab of wf.abilities) {
          md += `**${resolve(ab.name)}:** ${resolve(ab.description)}\n`;
          if (ab.energyRequiredToActivate) { md += `  Energy Cost: ${ab.energyRequiredToActivate}\n`; }
          md += '\n';
        }
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

    for (const [, w] of Object.entries(wpns)) {
      const name = resolve(w.name);
      md += `## ${name}\n\n`;
      const desc = resolve(w.description);
      if (desc && desc !== name) { md += `${desc}\n\n`; }

      md += '| Stat | Value |\n|---|---|\n';
      if (w.totalDamage != null) { md += `| Total Damage | ${w.totalDamage} |\n`; }
      if (w.criticalChance != null) { md += `| Crit Chance | ${pct(w.criticalChance * 100)} |\n`; }
      if (w.criticalMultiplier != null) { md += `| Crit Multiplier | ${w.criticalMultiplier}x |\n`; }
      if (w.procChance != null) { md += `| Status Chance | ${pct(w.procChance * 100)} |\n`; }
      if (w.fireRate != null) { md += `| Fire Rate | ${w.fireRate} |\n`; }
      if (w.accuracy != null) { md += `| Accuracy | ${w.accuracy} |\n`; }
      if (w.magazineSize != null) { md += `| Magazine | ${w.magazineSize} |\n`; }
      if (w.reloadTime != null) { md += `| Reload | ${w.reloadTime}s |\n`; }
      if (w.multishot != null) { md += `| Multishot | ${w.multishot} |\n`; }
      if (w.masteryReq != null) { md += `| Mastery Req | ${w.masteryReq} |\n`; }
      md += '\n';

      // Damage breakdown
      if (w.damagePerShot && Array.isArray(w.damagePerShot)) {
        const dmg = w.damagePerShot
          .map((v, i) => [dmgTypes[i] || `Type${i}`, v])
          .filter(([, v]) => v > 0);
        if (dmg.length) {
          md += '**Damage Breakdown:** ' + dmg.map(([t, v]) => `${t}: ${v.toFixed(1)}`).join(', ') + '\n\n';
        }
      }
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

    for (const [, m] of Object.entries(mods)) {
      md += `## ${resolve(m.name)}\n\n`;
      const desc = resolve(m.description);
      if (desc) { md += `${desc}\n\n`; }

      const meta = [];
      if (m.rarity) { meta.push(`**Rarity:** ${m.rarity}`); }
      if (m.polarity) { meta.push(`**Polarity:** ${m.polarity}`); }
      if (m.baseDrain != null) { meta.push(`**Drain:** ${m.baseDrain}`); }
      if (m.fusionLimit != null) { meta.push(`**Max Rank:** ${m.fusionLimit}`); }
      if (m.type) { meta.push(`**Type:** ${m.type}`); }
      if (m.compatName) { meta.push(`**Compat:** ${resolve(m.compatName)}`); }
      if (meta.length) { md += meta.join(' | ') + '\n\n'; }
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

    for (const [recipeKey, r] of Object.entries(recipes)) {
      const result = resolve(r.resultType) || recipeKey;
      md += `## ${result}\n\n`;
      md += `**Credits:** ${r.buildPrice || 0} | **Build Time:** ${r.buildTime ? (r.buildTime / 3600).toFixed(1) + 'h' : '—'} | **Rush:** ${r.skipBuildTimePrice || 0} Platinum\n\n`;

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
    for (const [, e] of Object.entries(enemies)) {
      md += `## ${resolve(e.name)}\n\n`;
      const desc = resolve(e.description);
      if (desc) { md += `${desc}\n\n`; }
    }
    writeMd('public-export/enemies.md', md);
  }

  // Factions
  const factions = tryLoad('public-export/ExportFactions.json');
  if (factions) {
    let md = heading('Public Export — Factions', 'All factions in Warframe.');
    for (const [, f] of Object.entries(factions)) {
      md += `## ${resolve(f.name)}\n\n`;
      const desc = resolve(f.description);
      if (desc) { md += `${desc}\n\n`; }
    }
    writeMd('public-export/factions.md', md);
  }

  // Regions / Star Chart
  const regions = tryLoad('public-export/ExportRegions.json');
  if (regions) {
    let md = heading('Public Export — Star Chart Regions', 'All Star Chart regions/nodes with mission types and requirements.');
    for (const [regionKey, r] of Object.entries(regions)) {
      md += `## ${resolve(r.name) || regionKey}\n\n`;
      const meta = [];
      if (r.systemIndex != null) { meta.push(`System: ${r.systemIndex}`); }
      if (r.nodeType != null) { meta.push(`Type: ${r.nodeType}`); }
      if (r.masteryReq) { meta.push(`MR: ${r.masteryReq}`); }
      if (r.minEnemyLevel) { meta.push(`Level: ${r.minEnemyLevel}-${r.maxEnemyLevel || '?'}`); }
      if (r.factionIndex != null) { meta.push(`Faction: ${r.factionIndex}`); }
      if (meta.length) { md += meta.join(' | ') + '\n\n'; }
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

    md += `## ${name}\n\n`;

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
    for (const entry of arr) {
      const name = entry.enemyName || entry.name || 'Unknown';
      md += `## ${esc(name)}\n\n`;

      const items = entry.items || entry.resources || entry.rewards || [];
      if (Array.isArray(items) && items.length) {
        md += '| Item | Rarity | Chance |\n|---|---|---|\n';
        for (const it of items) {
          md += `| ${esc(it.itemName || it.name)} | ${it.rarity || '—'} | ${pct(it.chance)} |\n`;
        }
      }
      md += '\n';
    }

    const safe = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    writeMd(`${safe}.md`, md);
  }
}

// ---------------------------------------------------------------------------
// 22. Index / Table of Contents
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
- [Warframes](warframes.md) — All Warframes with stats, abilities, and crafting
- [Primary Weapons](weapons/primary-weapons.md) — Rifles, shotguns, bows, launchers
- [Secondary Weapons](weapons/secondary-weapons.md) — Pistols, thrown, dual wield
- [Melee Weapons](weapons/melee-weapons.md) — Swords, polearms, heavy blades
- [Arch-Guns](weapons/arch-guns.md) — Archwing primary weapons
- [Arch-Melee](weapons/arch-melee-weapons.md) — Archwing melee weapons
- [Archwings](archwings.md) — Flight suit stats and abilities
- [Railjack](railjack.md) — Ship components and armaments
- [Companions](companions.md) — Pets and Sentinels

### Modding
- [Mods](mods.md) — Full mod database with stats per rank
- [Arcanes](arcanes.md) — Arcane enhancements
- [Riven Tags](riven-tags.md) — Riven stat tags and dispositions

### Drop Tables
- [Mission Rewards](mission-rewards.md) — Every mission's rotation rewards
- [Relics](relics.md) — Void relic reward tables
- [Sortie Rewards](sortie-rewards.md) — Daily sortie drop tables
- [Transient Rewards](transient-rewards.md) — Vault mods, Arbitrations, etc.
- [Mod Locations](mod-locations.md) — Which enemies drop which mods
- [Enemy Mod Tables](enemy-mod-tables.md) — Mods organized by enemy
- [Blueprint Locations](blueprint-locations.md) — Blueprint drop sources
- [Enemy Blueprint Tables](enemy-blueprint-tables.md) — Blueprints by enemy
- [Key Rewards](key-rewards.md) — Key-locked mission rewards

### Bounties
- [Cetus Bounties](bounties/cetus-bounty-rewards.md) — Plains of Eidolon
- [Solaris Bounties](bounties/solaris-bounty-rewards.md) — Orb Vallis
- [Deimos Bounties](bounties/deimos-bounty-rewards.md) — Cambion Drift
- [Zariman Bounties](bounties/zariman-bounty-rewards.md) — Zariman Ten Zero
- [Entrati Lab](bounties/entrati-lab-rewards.md) — Entrati Lab missions
- [Hex Bounties](bounties/hex-bounty-rewards.md) — Hex missions

### Items
- [Resources](resources.md) — Crafting materials and drop sources
- [Fish](fish.md) — Fish species across open worlds
- [Gear](gear-items.md) — Gear wheel items
- [Quests](quests.md) — All quest descriptions

### Reference
- [Syndicates](syndicates.md) — Syndicate info
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

### Enemy Drops
- [Resource Drops by Enemy](resource-drops-by-enemy.md)
- [Sigil Drops by Enemy](sigil-drops-by-enemy.md)
- [Additional Drops by Enemy](additional-item-drops-by-enemy.md)
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
  writeIndex();

  console.log(`\nDone. ${_fileCount} documentation files written to docs/`);
}

main();
