// Simulación de física de dados en el servidor — puerto de
// frontend/src/components/DiceRollerScene.jsx sin nada de Three.js/render.
// El servidor es la única fuente de verdad: corre una vez la simulación y
// el resultado (caras + keyframes) se difunde igual a todos los clientes,
// que solo reproducen los datos (ver [[project_dice_sync_bug]] en memoria).

const RAPIER_MODULE = require('@dimforge/rapier3d-compat');

const DIE = 1.21;
const FY = -2.5;
const WX = 4.2;
const WZ = 3.4;
const REST_Y = FY + DIE / 2 + 0.02;

// Colliders estáticos más gruesos que en el cliente original (que usaba 0.1)
// para evitar que los dados rápidos atraviesen el suelo/paredes entre pasos
// de física (tunneling) — la cara interior de cada collider se mantiene en
// la misma posición para no cambiar el área de juego.
const FLOOR_HALF = 0.3;
const WALL_HALF = 0.3;
const WALL_HEIGHT_HALF = 4;

const SIM_TIMESTEP = 1 / 60;
const MAX_STEPS = 400; // tope de seguridad (~6.6s simulados)
const SETTLE_MS = 200;
const KEYFRAME_STRIDE = 3; // ~20 fps de keyframes transmitidos (simulados a 60Hz)
const KEYFRAME_INTERVAL_MS = KEYFRAME_STRIDE * SIM_TIMESTEP * 1000;

// BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z (igual que en el cliente)
const FACE_VALUES = ['K', 'Q', 'AS', '7', '8', 'J'];

const FACE_NORMALS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function rotateVec(q, v) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const cx = qy * v.z - qz * v.y;
  const cy = qz * v.x - qx * v.z;
  const cz = qx * v.y - qy * v.x;
  const c2x = qy * cz - qz * cy;
  const c2y = qz * cx - qx * cz;
  const c2z = qx * cy - qy * cx;
  return {
    x: v.x + 2 * qw * cx + 2 * c2x,
    y: v.y + 2 * qw * cy + 2 * c2y,
    z: v.z + 2 * qw * cz + 2 * c2z,
  };
}

function getTopFace(quat) {
  let best = 0, bestDot = -Infinity;
  FACE_NORMALS.forEach((n, i) => {
    const dot = rotateVec(quat, n).y;
    if (dot > bestDot) { bestDot = dot; best = i; }
  });
  return FACE_VALUES[best];
}

// Deterministic PRNG — misma semilla → misma secuencia siempre
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function launchParams(seed, position, count) {
  const rng = mulberry32(seed);
  const startX = (position - (count - 1) / 2) * 1.6 + (rng() - .5) * 0.4;
  const startZ = 2.8 + (rng() - .5) * 0.3;
  const startY = FY + 0.7 + position * 0.15;
  const vx = (rng() - .5) * 3;
  const vy = 2 + rng() * 2;
  const vz = -8 - rng() * 4;
  const wx = (rng() - .5) * 25;
  const wy = (rng() - .5) * 25;
  const wz = (rng() - .5) * 25;
  return { startX, startY, startZ, vx, vy, vz, wx, wy, wz, rng };
}

let _rapierPromise = null;
function getRapier() {
  if (!_rapierPromise) _rapierPromise = RAPIER_MODULE.init().then(() => RAPIER_MODULE);
  return _rapierPromise;
}

function makeWorld(R) {
  const w = new R.World({ x: 0, y: -28, z: 0 });
  w.timestep = SIM_TIMESTEP;
  const fixed = (tx, ty, tz) => w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(tx, ty, tz));
  const box = (b, hx, hy, hz) =>
    w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.35).setFriction(0.7), b);

  // Suelo: cara superior en el mismo sitio que antes (FY + 0.1), más grosor hacia abajo
  const floorTop = FY + 0.1;
  box(fixed(0, floorTop - FLOOR_HALF, 0), WX, FLOOR_HALF, WZ);

  // Paredes: cara interior en ±WX/±WZ (área de juego sin cambios), más grosor hacia fuera
  const wh = WALL_HEIGHT_HALF, wy = FY + wh;
  box(fixed(WX + WALL_HALF, wy, 0), WALL_HALF, wh, WZ);
  box(fixed(-WX - WALL_HALF, wy, 0), WALL_HALF, wh, WZ);
  box(fixed(0, wy, WZ + WALL_HALF), WX, wh, WALL_HALF);
  box(fixed(0, wy, -WZ - WALL_HALF), WX, wh, WALL_HALF);

  return w;
}

const round = n => Math.round(n * 1000) / 1000;

// Posición de aparcado en esquina para dados ya guardados — misma fórmula
// que el tween cosmético del cliente (rollWithSounds en DiceRollerScene.jsx),
// para que el obstáculo físico coincida exactamente con lo que se ve.
function cornerPos(side, slot) {
  const anchorX = side * (WX - 0.8);
  return { x: anchorX - side * slot * 1.65, y: REST_Y, z: -(WZ - 0.8) };
}

/**
 * Simula el lanzamiento de `seeds.length` dados a la vez.
 *
 * @param {number[]} seeds - una semilla independiente por dado, en orden de "posición de tirada"
 * @param {boolean} sampleKeyframes - si false, solo calcula el resultado final (usado por el harvester offline)
 * @param {{side: 1|-1, count: number}|null} keptCorner - si hay dados ya
 *   guardados aparcados en una esquina (ver cornerPos), se añaden como
 *   obstáculos fijos para que los dados que se tiran choquen con ellos en
 *   vez de atravesarlos. El banco de semillas se generó SIN este obstáculo,
 *   así que el resultado hay que revalidarlo (ver performDiceRoll en server.js).
 * @returns {{ faces: string[], keyframes: number[][][], steps: number }}
 */
async function simulateRoll(seeds, { sampleKeyframes = true, keptCorner = null } = {}) {
  const R = await getRapier();
  const world = makeWorld(R);
  const count = seeds.length;

  if (keptCorner) {
    for (let slot = 0; slot < keptCorner.count; slot++) {
      const p = cornerPos(keptCorner.side, slot);
      const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, p.y, p.z));
      world.createCollider(
        R.ColliderDesc.cuboid(DIE / 2, DIE / 2, DIE / 2).setRestitution(0.1).setFriction(0.9),
        body
      );
    }
  }

  const dice = seeds.map((seed, position) => {
    const p = launchParams(seed, position, count);
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(p.startX, p.startY, p.startZ)
      .setLinearDamping(0.4)
      .setAngularDamping(0.4)
      .setCcdEnabled(true)
      .setLinvel(p.vx, p.vy, p.vz)
      .setAngvel({ x: p.wx, y: p.wy, z: p.wz });
    const body = world.createRigidBody(bd);
    world.createCollider(
      R.ColliderDesc.cuboid(DIE / 2, DIE / 2, DIE / 2).setRestitution(0.2).setFriction(0.9),
      body
    );
    return { body, rng: p.rng };
  });

  const keyframes = [];
  let settleSince = null;
  let step = 0;
  let settled = false;

  while (step < MAX_STEPS && !settled) {
    world.step();
    step++;

    if (sampleKeyframes && step % KEYFRAME_STRIDE === 0) {
      keyframes.push(dice.map(d => {
        const t = d.body.translation(), q = d.body.rotation();
        return [round(t.x), round(t.y), round(t.z), round(q.x), round(q.y), round(q.z), round(q.w)];
      }));
    }

    const allSlow = dice.every(d => {
      const lv = d.body.linvel(), av = d.body.angvel();
      return Math.hypot(lv.x, lv.y, lv.z) < .25 && Math.hypot(av.x, av.y, av.z) < .25;
    });

    if (allSlow) {
      const stacked = dice.filter(d => d.body.translation().y > REST_Y + DIE * 0.65);
      if (stacked.length > 0) {
        stacked.forEach(d => {
          d.body.applyImpulse({ x: (d.rng() - 0.5) * 0.4, y: 0, z: (d.rng() - 0.5) * 0.4 }, true);
        });
        settleSince = null;
      } else if (settleSince === null) {
        settleSince = step;
      } else if ((step - settleSince) * SIM_TIMESTEP * 1000 > SETTLE_MS) {
        settled = true;
      }
    } else {
      settleSince = null;
    }
  }

  const faces = dice.map(d => getTopFace(d.body.rotation()));
  world.free();

  return { faces, keyframes, steps: step };
}

module.exports = { simulateRoll, getRapier, FACE_VALUES, getTopFace, mulberry32, KEYFRAME_INTERVAL_MS, cornerPos };
