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
// Uso: node scripts/topupDiceSeedBank.js [--count=N] [--pool=N] [--trials=N]
//        [--iters=N] [--outer=N] [--escape=N] [--budget=MIN]
//
// --count=N restringe la pasada a un solo count (evita construir pools para
// counts que de todas formas no se van a procesar por agotar el presupuesto
// antes de llegar a ellos — ver comentario en main()). Los demás flags
// sobreescriben los valores por defecto de abajo, pensados para poder
// "apretar más" en una pasada dedicada a un count concreto (p.ej. count=5,
// el más difícil de converger) sin afectar al resto.

const fs = require('fs');
const path = require('path');
const { simulateRoll, FACE_VALUES } = require('../game/dicePhysics');

function argNum(flag, def) {
  const a = process.argv.find(x => x.startsWith(`--${flag}=`));
  return a ? Number(a.split('=')[1]) : def;
}

const MIN_PER_BUCKET = 5;
// Bajados de 60/12000 (2026-09-17): 3 fallos seguidos por memoria del
// sistema, siempre en el mismo punto exacto (construyendo pools de
// count=4) — a menos pools/intentos, menos simulateRoll() acumulados antes
// de que el runtime de Rapier libere memoria, a costa de pools más
// pequeñas (puede necesitar más pasadas para converger según el bucket).
// Todos ahora ajustables por CLI — con --count=N aislando la memoria a un
// solo count, hay margen para subirlos en una pasada dedicada (ver arriba).
const POOL_PER_FACE_POSITION = argNum('pool', 30);
const MAX_POOL_TRIALS = argNum('trials', 6000);
const MAX_CONVERGE_ITERS = argNum('iters', 150);
const ESCAPE_EVERY = argNum('escape', 20); // cada N iters sin converger, resiembra todo
const MAX_OUTER_ATTEMPTS = argNum('outer', 40);
const HARD_BUDGET_MS = argNum('budget', 12) * 60 * 1000; // tope global de tiempo (minutos)

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

  // --count=N (opcional): procesa solo ese count en esta pasada. Sin esto,
  // una pasada construye pools para TODOS los counts pendientes pero
  // procesa los targets en el orden en que aparecen en el JSON (4 antes que
  // 5) — si count=4 tiene muchos targets, se come el presupuesto entero
  // antes de tocar ni un solo target de count=5, pese a haber pagado ya el
  // coste (caro) de construirle las pools. Visto en vivo 2026-09-17: una
  // pasada completa de 12 min avanzó count=4 pero count=5 quedó exactamente
  // igual. Con --count=5 esa pasada se dedica entera a los targets que de
  // verdad lo necesitan.
  const onlyCountArg = process.argv.find(a => a.startsWith('--count='));
  const onlyCount = onlyCountArg ? Number(onlyCountArg.split('=')[1]) : null;

  const targets = []; // { count, key, assign }
  for (const [countStr, buckets] of Object.entries(bank)) {
    const count = Number(countStr);
    if (onlyCount != null && count !== onlyCount) continue;
    for (const [key, seedsList] of Object.entries(buckets)) {
      if (seedsList.length < MIN_PER_BUCKET) {
        targets.push({ count, key, assign: key.split(',') });
      }
    }
  }
  console.log(`Buckets a reforzar${onlyCount != null ? ` (solo count=${onlyCount})` : ''}: ${targets.length}`);
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
