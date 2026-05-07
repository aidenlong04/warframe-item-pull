const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const Items = require('@wfcd/items');

const DROP_DATA_URL = 'https://drops.warframestat.us/data/all.json';
const INFO_URL = 'https://drops.warframestat.us/data/info.json';
const DE_INDEX_URL = 'https://origin.warframe.com/PublicExport/index_en.txt.lzma';
const DE_INDEX_LOCAL = path.join(__dirname, 'docs', 'index_en.txt.lzma');
const DE_CONTENT_BASE = 'http://content.warframe.com/PublicExport/Manifest/';
const OUTPUT_DIR = path.join(__dirname, 'data');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      // Buffer chunks then decode once, so multi-byte UTF-8 characters
      // that straddle chunk boundaries are not corrupted.
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function fetchBinary(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function fetchText(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      // Buffer then decode to avoid corrupting multi-byte UTF-8 sequences
      // split across chunk boundaries (em-dash, smart quotes, ellipsis, etc.).
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function decompressLzma(lzmaPath) {
  // DE uses LZMA SDK format; use system unlzma for reliable decoding
  return execSync(`unlzma -c "${lzmaPath}"`).toString();
}

function parseDeIndex(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function write(filename, data) {
  const file = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  -> ${file}`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Drop table metadata
  console.log('Fetching drop table metadata...');
  const info = await fetch(INFO_URL);
  write('info.json', info);

  // 2. Full drop tables (all sections)
  console.log('Fetching full drop tables...');
  const all = await fetch(DROP_DATA_URL);

  // Write the combined file
  write('all.json', all);

  // Write each section individually
  for (const [key, value] of Object.entries(all)) {
    write(`${key}.json`, value);
  }

  // 3. @wfcd/items — all items grouped by category
  console.log('Pulling @wfcd/items data...');
  const items = new Items();
  const byCategory = {};
  for (const item of items) {
    const cat = item.category || 'Unknown';
    if (!byCategory[cat]) { byCategory[cat] = []; }
    byCategory[cat].push(item);
  }

  write('items-all.json', [...items]);
  for (const [cat, list] of Object.entries(byCategory)) {
    const safe = cat.replace(/[^a-zA-Z0-9-]/g, '_');
    write(`items-${safe}.json`, list);
  }

  // 4. warframe-worldstate-data — all worldstate reference data
  console.log('Pulling warframe-worldstate-data...');
  const wsd = (await import('warframe-worldstate-data')).default;
  const wsdDir = path.join(OUTPUT_DIR, 'worldstate-data');
  fs.mkdirSync(wsdDir, { recursive: true });

  function writeWsd(filename, data) {
    const file = path.join(wsdDir, filename);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`  -> ${file}`);
  }

  // Separate locale data from top-level datasets
  const localeKeys = wsd.locales || [];
  for (const [key, value] of Object.entries(wsd)) {
    if (key === 'locales') {
      writeWsd('locales.json', value);
    } else if (localeKeys.includes(key) || (typeof value === 'object' && value !== null && value.solNodes)) {
      // Locale bundle — write to subfolder
      const locDir = path.join(wsdDir, key);
      fs.mkdirSync(locDir, { recursive: true });
      for (const [subKey, subVal] of Object.entries(value)) {
        const file = path.join(locDir, `${subKey}.json`);
        fs.writeFileSync(file, JSON.stringify(subVal, null, 2));
        console.log(`  -> ${file}`);
      }
    } else {
      writeWsd(`${key}.json`, value);
    }
  }

  // 5. @wfcd/patchlogs — all Warframe patch notes
  console.log('Pulling @wfcd/patchlogs...');
  const patchlogs = require('./node_modules/@wfcd/patchlogs/data/patchlogs.json');
  write('patchlogs.json', patchlogs);

  // 6. @wfcd/relics — generated relic data
  console.log('Pulling @wfcd/relics...');
  const { Generator } = require('@wfcd/relics');
  const relicGen = new Generator();
  await relicGen.generate();
  write('relics-generated.json', relicGen.relics);

  // 7. warframe-public-export-plus — full public export data
  console.log('Pulling warframe-public-export-plus...');
  const publicExport = require('warframe-public-export-plus');
  const peDir = path.join(OUTPUT_DIR, 'public-export');
  fs.mkdirSync(peDir, { recursive: true });
  for (const [key, value] of Object.entries(publicExport)) {
    if (typeof value === 'function') { continue; }
    const file = path.join(peDir, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    console.log(`  -> ${file}`);
  }

  // 8. warframe-riven-info — riven disposition tags
  console.log('Pulling warframe-riven-info...');
  const rivenTags = require('./node_modules/warframe-riven-info/riven_tags.json');
  write('riven-tags.json', rivenTags);

  // 9. DE Public Export (direct) — fetch index + manifests from origin/content servers
  console.log('Fetching DE Public Export index...');
  const deDir = path.join(OUTPUT_DIR, 'de-public-export');
  fs.mkdirSync(deDir, { recursive: true });
  try {
    let indexText;
    const tmpLzma = path.join(deDir, 'index_en.txt.lzma');

    // Try fetching from origin server first, fall back to local file
    try {
      const indexBuf = await fetchBinary(DE_INDEX_URL);
      fs.writeFileSync(tmpLzma, indexBuf);
      indexText = decompressLzma(tmpLzma);
      console.log('  Fetched fresh index from origin server');
    } catch (originErr) {
      console.warn(`  Origin server unavailable (${originErr.message}), checking local index...`);
      if (fs.existsSync(DE_INDEX_LOCAL)) {
        indexText = decompressLzma(DE_INDEX_LOCAL);
        console.log('  Using local index file:', DE_INDEX_LOCAL);
      } else {
        throw new Error('No index available (origin blocked, no local file)');
      }
    }

    const entries = parseDeIndex(indexText);
    fs.writeFileSync(path.join(deDir, 'index_en.txt'), indexText);
    console.log(`  -> ${entries.length} manifest entries in index`);

    // Fetch each manifest JSON from the content server
    for (const entry of entries) {
      const manifestUrl = DE_CONTENT_BASE + entry;
      const baseName = entry.split('!')[0];
      const outFile = path.join(deDir, baseName);
      try {
        const raw = await fetchText(manifestUrl);
        try {
          const parsed = JSON.parse(raw);
          fs.writeFileSync(outFile, JSON.stringify(parsed, null, 2));
        } catch (_) {
          fs.writeFileSync(outFile, raw);
        }
        console.log(`  -> ${outFile}`);
      } catch (fetchErr) {
        console.warn(`  !! Failed to fetch ${baseName}: ${fetchErr.message}`);
      }
    }
  } catch (deErr) {
    console.warn(`DE Public Export fetch failed: ${deErr.message}`);
    console.warn('Using warframe-public-export-plus npm package (already fetched in step 7).');
  }

  console.log('\nDone. All data written to', OUTPUT_DIR);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
