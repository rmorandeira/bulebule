// Ataque final, dedicado, sobre los últimos buckets vacíos del banco de
// semillas — combinaciones de 5 dados con 4 K/Q repetidos + 1 distinto.
// Pools más grandes, más iteraciones, y sigue intentando hasta agotar el
// presupuesto de tiempo (no se rinde tras N intentos como el script base).
//
// Uso: node scripts/attackHardBuckets.js

const fs = require('fs');
const path = require('path');
const { simulateRoll, FACE_VALUES } = require('../game/dicePhysics');

const MIN_PER_BUCKET = 5;
const POOL_PER_FACE_POSITION = 120;
const MAX_POOL_TRIALS = 20000;
const MAX_CONVERGE_ITERS = 300;
const ESCAPE_EVERY = 12;
const TIME_BUDGET_MS = 15 * 60 * 1000;

const TARGET_KEYS = ['K,K,K,K,Q', 'K,K,K,K,J', 'K,K,Q,Q,Q', 'K,Q,Q,Q,Q'];

const randSeed = () => Math.floor(Math.random() * 0xFFFFFFFF);
function pick(arr, fallback) {
  if (arr.length === 0) return fallback();
  return arr[Math.floor(Math.random() * arr.length)];
}

async function buildPools(count, neededFaces) {
  const pools = Array.from({ length: count }, () => Object.fromEntries(FACE_VALUES.map(f => [f, []])));
  for (let position = 0; position < count; position++) {
    let trials = 0;
    while (trials < MAX_POOL_TRIALS) {
      const needed = neededFaces.filter(f => pools[position][f].length < POOL_PER_FACE_POSITION);
      if (needed.length === 0) break;
      const seeds = Array.from({ length: count }, () => randSeed());
      const candidateSeed = seeds[position];
      const { faces } = await simulateRoll(seeds, { sampleKeyframes: false });
      trials++;
      const landed = faces[position];
      if (needed.includes(landed) && pools[position][landed].length < POOL_PER_FACE_POSITION) {
        pools[position][landed].push(candidateSeed);
      }
    }
    console.log(`  pool position=${position}: ${trials} pruebas, ` +
      neededFaces.map(f => `${f}=${pools[position][f].length}`).join(' '));
  }
  return pools;
}

async function converge(count, assign, pools) {
  let seeds = assign.map((face, p) => pick(pools[p][face], randSeed));
  for (let iter = 0; iter < MAX_CONVERGE_ITERS; iter++) {
    const { faces } = await simulateRoll(seeds, { sampleKeyframes: false });
    const wrong = [];
    faces.forEach((f, p) => { if (f !== assign[p]) wrong.push(p); });
    if (wrong.length === 0) return seeds;
    if (iter > 0 && iter % ESCAPE_EVERY === 0) {
      seeds = assign.map((face, p) => pick(pools[p][face], randSeed));
    } else {
      wrong.forEach(p => { seeds[p] = pick(pools[p][assign[p]], randSeed); });
    }
  }
  return null;
}

async function main() {
  const bankPath = path.join(__dirname, '..', 'game', 'diceSeedBank.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

  const neededFaces = [...new Set(TARGET_KEYS.flatMap(k => k.split(',')))];
  console.log(`Construyendo pools grandes para count=5 (caras: ${neededFaces.join(',')})...`);
  const pools = await buildPools(5, neededFaces);

  const t0 = Date.now();
  for (const key of TARGET_KEYS) {
    const bucket = bank['5'][key] ?? (bank['5'][key] = []);
    const target = key.split(',');
    let attempts = 0;
    while (bucket.length < MIN_PER_BUCKET && Date.now() - t0 < TIME_BUDGET_MS) {
      attempts++;
      const assign = [...target].sort(() => Math.random() - 0.5);
      const seeds = await converge(5, assign, pools);
      if (seeds) bucket.push(seeds);
      fs.writeFileSync(bankPath, JSON.stringify(bank)); // guarda progreso incremental
    }
    console.log(`${key} → ${bucket.length}/${MIN_PER_BUCKET} (${attempts} intentos, ${((Date.now() - t0) / 1000).toFixed(0)}s acumulados)`);
    if (Date.now() - t0 >= TIME_BUDGET_MS) { console.log('Presupuesto de tiempo agotado.'); break; }
  }

  console.log(`\nGuardado en ${bankPath} (${(fs.statSync(bankPath).size / 1024).toFixed(1)} KB)`);
  const stillEmpty = TARGET_KEYS.filter(k => (bank['5'][k] ?? []).length === 0);
  console.log(stillEmpty.length ? `Siguen vacíos: ${stillEmpty.join(' | ')}` : 'Todos completados.');
}

main().catch(e => { console.error(e); process.exit(1); });
