const https = require('https');
const fs = require('fs');
const path = require('path');
const Items = require('@wfcd/items');

const DROP_DATA_URL = 'https://drops.warframestat.us/data/all.json';
const INFO_URL = 'https://drops.warframestat.us/data/info.json';
const OUTPUT_DIR = path.join(__dirname, 'data');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
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

  console.log('\nDone. All data written to', OUTPUT_DIR);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
