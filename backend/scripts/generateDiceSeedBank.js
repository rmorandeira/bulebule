// Genera backend/game/diceSeedBank.json — un banco de semillas de física ya
// verificadas, agrupadas por (cuántos dados se tiran a la vez) x (qué
// combinación exacta de caras hace falta). Se ejecuta una sola vez offline
// (o cada vez que cambien los parámetros de física en dicePhysics.js), no en
// cada partida.
//
// Por qué hace falta esto en vez de solo confiar en rollDie() + física libre:
// los dados chocan entre sí durante la tirada, así que no se puede validar
// cada dado por separado con garantías — hay que verificar la tirada conjunta
// completa. Ver [[project_dice_sync_bug]] en memoria.
//
// Estrategia en dos fases para que sea rápido:
//   Fase 1: para cada (count, posición) se buscan semillas "candidatas" que,
//     lanzadas junto a vecinos de relleno aleatorios, tienden a caer en cada
//     cara — mucho más barato que buscar a ciegas la combinación conjunta.
//   Fase 2: para cada combinación objetivo, se combinan candidatas de cada
//     posición (ya sesgadas hacia la cara que toca) y se verifica la tirada
//     conjunta real; solo se guarda si el resultado conjunto coincide exacto.
//
// Uso: node scripts/generateDiceSeedBank.js

const fs = require('fs');
const path = require('path');
const { simulateRoll, FACE_VALUES } = require('../game/dicePhysics');

const MIN_PER_BUCKET = 5;
const POOL_PER_FACE_POSITION = 30;
const MAX_POOL_TRIALS = 6000;
const MAX_CONVERGE_ITERS = 100; // reintentos por intento de convergencia (solo se resiembran las posiciones que fallan)
const MAX_OUTER_ATTEMPTS = 20;  // intentos de convergencia por entrada de bucket

const CANON_ORDER = ['AS', 'K', 'Q', 'J', '8', '7'];
const randSeed = () => Math.floor(Math.random() * 0xFFFFFFFF);

function sortedKey(values) {
  return [...values].sort((a, b) => CANON_ORDER.indexOf(a) - CANON_ORDER.indexOf(b)).join(',');
}

function combinationsWithRepetition(values, k) {
  const results = [];
  (function rec(start, cur) {
    if (cur.length === k) { results.push([...cur]); return; }
    for (let i = start; i < values.length; i++) {
      cur.push(values[i]);
      rec(i, cur);
      cur.pop();
    }
  })(0, []);
  return results;
}

// Fase 1: pools[count][position][face] = [seed, ...]
async function buildPools(counts) {
  const pools = {};
  for (const count of counts) {
    pools[count] = Array.from({ length: count }, () => Object.fromEntries(FACE_VALUES.map(f => [f, []])));
    for (let position = 0; position < count; position++) {
      let trials = 0;
      while (trials < MAX_POOL_TRIALS) {
        const needed = FACE_VALUES.filter(f => pools[count][position][f].length < POOL_PER_FACE_POSITION);
        if (needed.length === 0) break;
        const seeds = Array.from({ length: count }, () => randSeed());
        const candidateSeed = seeds[position];
        const { faces } = await simulateRoll(seeds, { sampleKeyframes: false });
        trials++;
        const landed = faces[position];
        if (needed.includes(landed) && pools[count][position][landed].length < POOL_PER_FACE_POSITION) {
          pools[count][position][landed].push(candidateSeed);
        }
      }
      console.log(`  pool count=${count} position=${position}: ${trials} pruebas, ` +
        FACE_VALUES.map(f => `${f}=${pools[count][position][f].length}`).join(' '));
    }
  }
  return pools;
}

function pick(arr, fallback) {
  if (arr.length === 0) return fallback();
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fase 2: búsqueda adaptativa por bucket — se fija cada posición en cuanto
// acierta su valor objetivo y solo se resiembran (desde el pool de esa
// posición/cara) las que aún fallan. Mucho más eficiente que probar
// combinaciones completas al azar, porque no hace falta que las 5
// posiciones acierten a la vez en un solo intento.
async function converge(count, assign, pools) {
  let seeds = assign.map((face, p) => pick(pools[count][p][face], randSeed));
  for (let iter = 0; iter < MAX_CONVERGE_ITERS; iter++) {
    const { faces } = await simulateRoll(seeds, { sampleKeyframes: false });
    const wrong = [];
    faces.forEach((f, p) => { if (f !== assign[p]) wrong.push(p); });
    if (wrong.length === 0) return seeds;
    wrong.forEach(p => { seeds[p] = pick(pools[count][p][assign[p]], randSeed); });
  }
  return null;
}

async function fillBuckets(counts, pools) {
  const bank = {};
  const coverage = [];

  for (const count of counts) {
    bank[count] = {};
    const targets = combinationsWithRepetition(FACE_VALUES, count);
    for (const target of targets) {
      const key = sortedKey(target);
      bank[count][key] = [];
      let outer = 0;
      while (bank[count][key].length < MIN_PER_BUCKET && outer < MAX_OUTER_ATTEMPTS) {
        outer++;
        const assign = [...target].sort(() => Math.random() - 0.5); // orden libre — el hand es un multiset
        const seeds = await converge(count, assign, pools);
        if (seeds) bank[count][key].push(seeds);
      }
      coverage.push({ count, key, found: bank[count][key].length, outer });
    }
    const done = coverage.filter(c => c.count === count);
    console.log(`  count=${count}: ${done.filter(c => c.found >= MIN_PER_BUCKET).length}/${done.length} buckets completos`);
  }
  return { bank, coverage };
}

async function main() {
  const counts = [1, 2, 3, 4, 5];
  const t0 = Date.now();

  console.log('Fase 1: construyendo pools de semillas candidatas por posición/cara...');
  const pools = await buildPools(counts);
  console.log(`Fase 1 completa en ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const t1 = Date.now();
  console.log('Fase 2: verificando combinaciones conjuntas por bucket...');
  const { bank, coverage } = await fillBuckets(counts, pools);
  console.log(`Fase 2 completa en ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  const empty = coverage.filter(c => c.found === 0);
  const short = coverage.filter(c => c.found > 0 && c.found < MIN_PER_BUCKET);
  console.log(`\nBuckets totales: ${coverage.length}`);
  console.log(`Buckets vacíos (0 semillas): ${empty.length}`);
  console.log(`Buckets incompletos (<${MIN_PER_BUCKET}): ${short.length}`);
  if (empty.length) console.log('Vacíos:', empty.map(c => `${c.count}:${c.key}`).join(' | '));

  const outPath = path.join(__dirname, '..', 'game', 'diceSeedBank.json');
  fs.writeFileSync(outPath, JSON.stringify(bank));
  console.log(`\nGuardado en ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
  console.log(`Tiempo total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
