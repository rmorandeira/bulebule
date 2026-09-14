// Pasada de refuerzo sobre backend/game/diceSeedBank.json: ataca solo los
// buckets que quedaron vacíos o incompletos (ver generateDiceSeedBank.js),
// casi todos combinaciones de count=5 con varios K/Q repetidos — las caras
// menos favorecidas por la física, donde 5 trayectorias "parecidas" (todas
// tendiendo al mismo valor) tienden a chocar entre sí de forma correlacionada.
//
// Dos mejoras sobre el script base para intentar romper esa correlación:
//   - pools más grandes específicamente para las posiciones/caras que hacen falta
//   - "escape": cada N iteraciones sin converger, se resiembran TODAS las
//     posiciones a la vez (no solo las que fallan) para salir de mínimos locales
//
// Uso: node scripts/topupDiceSeedBank.js

const fs = require('fs');
const path = require('path');
const { simulateRoll, FACE_VALUES } = require('../game/dicePhysics');

const MIN_PER_BUCKET = 5;
const POOL_PER_FACE_POSITION = 60;
const MAX_POOL_TRIALS = 12000;
const MAX_CONVERGE_ITERS = 150;
const ESCAPE_EVERY = 20;         // cada N iters sin converger, resiembra todo
const MAX_OUTER_ATTEMPTS = 40;
const HARD_BUDGET_MS = 12 * 60 * 1000; // tope global de tiempo

const CANON_ORDER = ['AS', 'K', 'Q', 'J', '8', '7'];
const randSeed = () => Math.floor(Math.random() * 0xFFFFFFFF);

function sortedKey(values) {
  return [...values].sort((a, b) => CANON_ORDER.indexOf(a) - CANON_ORDER.indexOf(b)).join(',');
}

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
      seeds = assign.map((face, p) => pick(pools[p][face], randSeed)); // resiembra todo
    } else {
      wrong.forEach(p => { seeds[p] = pick(pools[p][assign[p]], randSeed); });
    }
  }
  return null;
}

async function main() {
  const bankPath = path.join(__dirname, '..', 'game', 'diceSeedBank.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

  const targets = []; // { count, key, assign }
  for (const [countStr, buckets] of Object.entries(bank)) {
    const count = Number(countStr);
    for (const [key, seedsList] of Object.entries(buckets)) {
      if (seedsList.length < MIN_PER_BUCKET) {
        targets.push({ count, key, assign: key.split(',') });
      }
    }
  }
  console.log(`Buckets a reforzar: ${targets.length}`);
  if (targets.length === 0) { console.log('Nada que hacer.'); return; }

  // Solo hace falta pool para las cuentas/caras involucradas
  const byCount = {};
  targets.forEach(t => { (byCount[t.count] ??= new Set()); t.assign.forEach(f => byCount[t.count].add(f)); });

  const poolsByCount = {};
  for (const [countStr, facesSet] of Object.entries(byCount)) {
    const count = Number(countStr);
    console.log(`Construyendo pools para count=${count} (caras: ${[...facesSet].join(',')})...`);
    poolsByCount[count] = await buildPools(count, [...facesSet]);
  }

  const t0 = Date.now();
  let filled = 0, stillEmpty = 0, stillShort = 0;
  for (const t of targets) {
    if (Date.now() - t0 > HARD_BUDGET_MS) {
      console.log('Presupuesto de tiempo agotado, dejando el resto tal cual.');
      break;
    }
    const bucket = bank[t.count][t.key];
    let outer = 0;
    while (bucket.length < MIN_PER_BUCKET && outer < MAX_OUTER_ATTEMPTS) {
      outer++;
      const assign = [...t.assign].sort(() => Math.random() - 0.5);
      const seeds = await converge(t.count, assign, poolsByCount[t.count]);
      if (seeds) bucket.push(seeds);
    }
    if (bucket.length === 0) stillEmpty++;
    else if (bucket.length < MIN_PER_BUCKET) stillShort++;
    else filled++;
    console.log(`  ${t.count}:${t.key} → ${bucket.length}/${MIN_PER_BUCKET} (${outer} intentos)`);
  }

  fs.writeFileSync(bankPath, JSON.stringify(bank));
  console.log(`\nCompletados del todo: ${filled} | aún incompletos: ${stillShort} | aún vacíos: ${stillEmpty}`);
  console.log(`Guardado en ${bankPath} (${(fs.statSync(bankPath).size / 1024).toFixed(1)} KB)`);
  console.log(`Tiempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
