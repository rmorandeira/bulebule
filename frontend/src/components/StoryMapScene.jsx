import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FXAAShader }     from 'three/examples/jsm/shaders/FXAAShader.js'

// Mundo: X = rama (slot * SLOT_WORLD), Z = profundidad (más negativo = más
// adentro del mapa), Y = altura del terreno. Isométrico, cámara ortográfica.
// Técnica de terreno (color por vértice, el camino se funde en el suelo en
// vez de ser una cinta flotando encima) y vegetación instanciada adaptadas
// de un proyecto three.js propio anterior (Senda 4x4); de ahí también el
// relieve con ruido, el camino sinuoso y los ríos/lagos de más abajo.
const SLOT_WORLD    = 9
const DEPTH_WORLD   = 15
const GROUND_COLORS = [0x6fbf73, 0x7fcf7f, 0x5fae63, 0x74b869]
const PATH_COLOR    = 0xd8b874
const EDGE_COLOR    = 0x8fd67f
const ROCK_TINT     = 0x958f80
const BANK_COLOR    = 0xc9b384
const WATER_SURFACE = 0x3fa0c4
const WATER_LEVEL   = -0.9   // altura del plano de agua, por debajo de la cota 0 del camino
const WATER_BED     = -2.6   // a lo que se hunde el terreno bajo un río/lago
const FOG_COLOR     = 0xcdbf9c
const NODE_COLORS   = { done: 0x8a8a92, current: 0xffb703, locked: 0x5a6a55, boss: 0xef4444 }

// Geometrías y materiales unitarios compartidos — se reutilizan vía
// InstancedMesh para poder meter mucha densidad de vegetación sin coste.
const GEO = {
  trunk: new THREE.CylinderGeometry(0.15, 0.19, 1, 6),
  cone:  new THREE.ConeGeometry(1, 1, 6),
  ball:  new THREE.IcosahedronGeometry(1, 0),
  rock:  new THREE.DodecahedronGeometry(1, 0),
  box:   new THREE.BoxGeometry(1, 1, 1),
  shadow: (() => { const g = new THREE.CircleGeometry(1, 10); g.rotateX(-Math.PI / 2); return g })(),
}
const MT = {
  trunk:  new THREE.MeshLambertMaterial({ color: 0x7a5a3c, flatShading: true }),
  pine:   new THREE.MeshLambertMaterial({ color: 0x4f8a4a, flatShading: true }),
  oak:    new THREE.MeshLambertMaterial({ color: 0x74b566, flatShading: true }),
  rock:   new THREE.MeshLambertMaterial({ color: 0x9c968a, flatShading: true }),
  bush:   new THREE.MeshLambertMaterial({ color: 0x64ab5a, flatShading: true }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
  water:  new THREE.MeshLambertMaterial({ color: WATER_SURFACE, flatShading: true }),
  plank:  new THREE.MeshLambertMaterial({ color: 0x8a6b45, flatShading: true }),
  rail:   new THREE.MeshLambertMaterial({ color: 0x5c4630, flatShading: true }),
}
const SHARED_GEO = new Set(Object.values(GEO))
const SHARED_MAT = new Set(Object.values(MT))

function seededRandom(seed) {
  let t = seed >>> 0
  return function () {
    t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Ruido de valor (2D, suavizado) para el relieve — mismo esquema que Senda 4x4.
function ihash(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = ihash(xi, yi), b = ihash(xi + 1, yi), c = ihash(xi, yi + 1), d = ihash(xi + 1, yi + 1)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}
function smooth01(e0, e1, x) { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
function lerp(a, b, t) { return a + (b - a) * t }

// Colinas suaves lejos del camino — el camino en sí se mantiene siempre
// plano (ver hillT por dPath más abajo), así que esto solo se nota al fondo.
function hillsH(x, z, seed) {
  return (vnoise(x * 0.05 + seed, z * 0.05 + seed * 1.7) - 0.5) * 3.4
       + (vnoise(x * 0.12 + seed * 2.3, z * 0.12 - seed) - 0.5) * 1.2
}

// Interpola entre dos listas de posiciones de carril de tamaño distinto
// (bifurcación o convergencia) emparejando por índice — sin saltos visuales.
function lerpPathXs(aXs, bXs, t) {
  const n = Math.max(aXs.length, bXs.length)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push(lerp(aXs[Math.min(i, aXs.length - 1)], bXs[Math.min(i, bXs.length - 1)], t))
  }
  return out
}

function worldPos(depth, slot, baseDepth) {
  return new THREE.Vector3(slot * SLOT_WORLD, 0, -(depth - baseDepth) * DEPTH_WORLD)
}

function addContactShadow(target, radius) {
  const shadow = new THREE.Mesh(GEO.shadow, MT.shadow)
  shadow.scale.setScalar(radius)
  shadow.position.y = 0.03
  target.add(shadow)
}

// Casa low-poly: caja + tejado a cuatro aguas, color determinista por posición.
function buildBuilding(rng) {
  const w = 2 + rng() * 1.4
  const d = 2 + rng() * 1.4
  const h = 1.8 + rng() * 1.8
  const group = new THREE.Group()

  const bodyColor = new THREE.Color().setHSL(0.05 + rng() * 0.12, 0.35 + rng() * 0.25, 0.6 + rng() * 0.15)
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color: bodyColor, flatShading: true })
  )
  body.position.y = h / 2
  body.castShadow = true
  group.add(body)

  const roofColor = new THREE.Color().setHSL(0.02 + rng() * 0.08, 0.55, 0.32 + rng() * 0.12)
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(w, d) * 0.72, 1.1 + rng() * 0.6, 4),
    new THREE.MeshLambertMaterial({ color: roofColor, flatShading: true })
  )
  roof.rotation.y = Math.PI / 4
  roof.position.y = h + 0.55
  roof.castShadow = true
  group.add(roof)

  return group
}

function buildNodeMarker(state, isBoss) {
  const group = new THREE.Group()
  const color = isBoss ? NODE_COLORS.boss : NODE_COLORS[state]
  const scale = isBoss ? 1.4 : 1

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6 * scale, 1.8 * scale, 0.4, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2ead6, flatShading: true })
  )
  base.position.y = 0.2
  group.add(base)

  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(0.8 * scale, 2.2 * scale, 6),
    new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: state === 'current' ? 0.35 : 0.05 })
  )
  pin.position.y = 1.5 * scale
  group.add(pin)

  return group
}

// Puente de tablones sobre un cauce — solo aparece donde el camino cruza el río.
function boxAt(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(GEO.box, mat)
  m.scale.set(w, h, d)
  m.position.set(x, y, z)
  m.castShadow = true
  return m
}
function buildBridge(riverSpan) {
  const g = new THREE.Group()
  const len = riverSpan + 2.4
  g.add(boxAt(2.9, 0.18, len, MT.plank, 0, 0.05, 0))
  g.add(boxAt(0.24, 0.85, len, MT.rail, -1.4, 0.48, 0))
  g.add(boxAt(0.24, 0.85, len, MT.rail, 1.4, 0.48, 0))
  return g
}

// Ríos y lagos: posiciones/formas deterministas por semilla, generados una
// vez por reconstrucción del mapa. El río serpentea cruzando el camino (como
// función de x); los lagos quedan siempre fuera del valle del camino.
function riverZAt(river, x) {
  return river.z + Math.sin(x * river.freq + river.phase) * river.amp
}
function waterInfluence(x, z, water) {
  let t = 0
  if (water.river) {
    const d = Math.abs(z - riverZAt(water.river, x))
    t = Math.max(t, 1 - smooth01(water.river.halfW, water.river.halfW + 3.5, d))
  }
  for (const lk of water.lakes) {
    const d = Math.hypot(x - lk.x, z - lk.z) - lk.r
    t = Math.max(t, 1 - smooth01(0, 4, d))
  }
  return t
}
function planWater(rowMeta, seedBase) {
  const rng = seededRandom((seedBase ^ 0x51a3c9) >>> 0)
  let river = null
  if (rowMeta.length > 1 && rng() < 0.55) {
    const first = rowMeta[0], last = rowMeta[rowMeta.length - 1]
    const zMin = Math.min(first.z, last.z), zMax = Math.max(first.z, last.z)
    river = {
      z: zMin + (zMax - zMin) * (0.25 + rng() * 0.5),
      amp: 2 + rng() * 2.5,
      freq: 0.045 + rng() * 0.03,
      phase: rng() * Math.PI * 2,
      halfW: 2.6 + rng() * 1.1,
    }
  }
  const lakes = []
  rowMeta.forEach(rm => {
    if (rng() < 0.28) {
      const side = rng() < 0.5 ? -1 : 1
      const lx = rm.xOff + side * (rm.halfW + 5 + rng() * 6)
      const lz = rm.z + (rng() - 0.5) * DEPTH_WORLD * 0.7
      const nearPath = rm.pathXs.some(px => Math.abs(lx - px) < 20)
      if (!nearPath) lakes.push({ x: lx, z: lz, r: 4 + rng() * 4.5 })
    }
  })
  return { river, lakes }
}
function buildWaterMeshes(rowMeta, water) {
  const group = new THREE.Group()
  if (water.river) {
    const xOffCenter = rowMeta.reduce((s, r) => s + r.xOff, 0) / rowMeta.length
    const spanX = SLOT_WORLD * 6
    const SEG = 28
    const positions = []
    for (let i = 0; i <= SEG; i++) {
      const x = xOffCenter - spanX / 2 + (i / SEG) * spanX
      const z = riverZAt(water.river, x)
      positions.push(x, WATER_LEVEL, z - water.river.halfW, x, WATER_LEVEL, z + water.river.halfW)
    }
    const indices = []
    for (let i = 0; i < SEG; i++) {
      const a0 = i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3
      indices.push(a0, b0, a1, a1, b0, b1)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    group.add(new THREE.Mesh(geo, MT.water))
  }
  for (const lk of water.lakes) {
    const geo = new THREE.CircleGeometry(lk.r, 20)
    geo.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geo, MT.water)
    mesh.position.set(lk.x, WATER_LEVEL, lk.z)
    group.add(mesh)
  }
  return group
}

function nearestStrip(strips, z) {
  let best = strips[0], bd = Infinity
  for (const s of strips) { const d = Math.abs(s.z - z); if (d < bd) { bd = d; best = s } }
  return best
}
function groundYAt(x, z, strips, seedBase, water) {
  const st = nearestStrip(strips, z)
  let dPath = Infinity
  for (const px of st.pathXs) dPath = Math.min(dPath, Math.abs(x - px))
  const hillT = smooth01(6, 16, dPath)
  let y = hillsH(x, z, seedBase) * hillT
  const wT = waterInfluence(x, z, water)
  if (wT > 0) y = lerp(y, WATER_BED, wT)
  return y
}

// Terreno: malla continua (no un rectángulo) con color por vértice — el
// camino se funde en el verde en vez de ser una cinta flotando encima, y el
// borde tiene un remate más claro. El camino se cimbrea con una curva suave
// por tramo (cero exactamente en cada nodo, máxima a mitad de camino, así
// los nodos nunca se desplazan) y el relieve se aplana del todo cerca del
// camino, subiendo a colinas solo lejos de él.
function buildTerrain(explored, baseDepth, seedBase) {
  const rng = seededRandom(seedBase)
  const rowMeta = explored.map(row => ({
    depth: row.depth,
    z: -(row.depth - baseDepth) * DEPTH_WORLD,
    halfW: SLOT_WORLD * (1.8 + rng() * 1.3),
    xOff: (rng() - 0.5) * SLOT_WORLD * 0.8,
    pathXs: row.nodes.map(n => n.slot * SLOT_WORLD),
  }))
  const first = rowMeta[0], last = rowMeta[rowMeta.length - 1]
  const padded = [
    { ...first, z: first.z + DEPTH_WORLD * 1.4, halfW: first.halfW * 0.65 },
    ...rowMeta,
    { ...last, z: last.z - DEPTH_WORLD * 1.4, halfW: last.halfW * 0.65 },
  ]

  const water = planWater(rowMeta, seedBase)

  const bendRng = seededRandom((seedBase ^ 0x7a3d21) >>> 0)
  const segBend = padded.map((_, i) => (i === 0 || i === padded.length - 2) ? 0 : (bendRng() - 0.5) * 3.6)

  const ZSUB = 5, XSUB = 12
  const strips = []
  for (let i = 0; i < padded.length - 1; i++) {
    const a = padded[i], b = padded[i + 1]
    const bendAmp = segBend[i]
    for (let s = 0; s < ZSUB; s++) {
      const t = s / ZSUB
      const bend = Math.sin(t * Math.PI) * bendAmp + Math.sin(t * Math.PI * 3) * bendAmp * 0.18
      strips.push({
        z: lerp(a.z, b.z, t),
        halfW: lerp(a.halfW, b.halfW, t),
        xOff: lerp(a.xOff, b.xOff, t) + bend,
        pathXs: lerpPathXs(a.pathXs, b.pathXs, t).map(px => px + bend),
      })
    }
  }
  const lastP = padded[padded.length - 1]
  strips.push({ z: lastP.z, halfW: lastP.halfW, xOff: lastP.xOff, pathXs: lastP.pathXs })

  const positions = [], colors = []
  const yRng   = seededRandom((seedBase ^ 0x2545f491) >>> 0)
  const jitRng = seededRandom((seedBase ^ 0x9e3779b9) >>> 0)
  const col = new THREE.Color()
  const pathCol = new THREE.Color(PATH_COLOR)
  const edgeCol = new THREE.Color(EDGE_COLOR)
  const rockCol = new THREE.Color(ROCK_TINT)
  const bankCol = new THREE.Color(BANK_COLOR)

  for (const st of strips) {
    for (let c = 0; c <= XSUB; c++) {
      const u = c / XSUB
      const x = st.xOff - st.halfW + u * st.halfW * 2

      let dPath = Infinity
      for (const px of st.pathXs) dPath = Math.min(dPath, Math.abs(x - px))
      const distToEdge = st.halfW - Math.abs(x - st.xOff)
      const hillT = smooth01(6, 16, dPath)

      let y = hillsH(x, st.z, seedBase) * hillT + (yRng() - 0.5) * 0.35
      const wT = waterInfluence(x, st.z, water)
      if (wT > 0) y = lerp(y, WATER_BED, wT)
      positions.push(x, y, st.z)

      col.setHex(GROUND_COLORS[Math.floor(jitRng() * GROUND_COLORS.length)])
      const j = (jitRng() - 0.5) * 0.06
      col.r = Math.max(0, col.r + j); col.g = Math.max(0, col.g + j); col.b = Math.max(0, col.b + j)

      if (wT > 0.12) {
        col.lerp(bankCol, Math.min(1, wT / 0.5))
      } else if (dPath < 2.2) {
        col.lerp(pathCol, Math.pow(1 - Math.min(1, dPath / 2.2), 2))
      } else if (distToEdge < 2) {
        col.lerp(edgeCol, Math.max(0, 1 - distToEdge / 2) * 0.6)
      } else if (jitRng() < 0.04) {
        col.lerp(rockCol, 0.5)
      }
      colors.push(col.r, col.g, col.b)
    }
  }

  const rowsN = strips.length
  const indices = []
  for (let r = 0; r < rowsN - 1; r++) {
    for (let c = 0; c < XSUB; c++) {
      const a0 = r * (XSUB + 1) + c, a1 = a0 + 1
      const b0 = a0 + (XSUB + 1), b1 = b0 + 1
      indices.push(a0, b0, a1, a1, b0, b1)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })
  )
  mesh.receiveShadow = true
  return { mesh, rowMeta, strips, water }
}

// Fondo con degradado (cielo alto → horizonte cálido) — la cámara isométrica
// no rota nunca, así que un lienzo estático basta y es mucho más barato que
// una cúpula 3D.
function buildSkyTexture() {
  const c = document.createElement('canvas')
  c.width = 8; c.height = 256
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#5f96cf')
  g.addColorStop(0.5, '#a9cbe0')
  g.addColorStop(0.8, '#e7d9b8')
  g.addColorStop(1, '#d7c9a6')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 8, 256)
  return new THREE.CanvasTexture(c)
}

export default function StoryMapScene({ rows, currentNode, onSelectNode }) {
  const mountRef  = useRef(null)
  const ctxRef    = useRef(null)
  const dataRef   = useRef({})
  dataRef.current = { rows, currentNode, onSelectNode }

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let alive = true

    const W = mount.offsetWidth  || 360
    const H = mount.offsetHeight || 480

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const skyTex = buildSkyTexture()
    scene.background = skyTex
    // La cámara está a ~90 unidades del target (ver applyCamera): la niebla
    // debe empezar más allá de eso, no antes, o taparía todo el contenido.
    scene.fog = new THREE.Fog(FOG_COLOR, 130, 250)

    const VIEW_SIZE = 26
    const camera = new THREE.OrthographicCamera(-VIEW_SIZE, VIEW_SIZE, VIEW_SIZE, -VIEW_SIZE, 0.1, 300)
    // Isométrico clásico (~35° desde la vertical) — el ángulo casi cenital
    // aplanaba demasiado árboles y casas frente a las referencias.
    const camDir = new THREE.Vector3(0.5, 1, 0.5).normalize()
    const target = new THREE.Vector3(0, 0, 0)
    function applyCamera() {
      camera.position.copy(target).addScaledVector(camDir, 90)
      camera.lookAt(target)
    }
    applyCamera()

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const fxaa = new ShaderPass(FXAAShader)
    composer.addPass(fxaa)

    function resize(rW, rH) {
      const pr = Math.min(window.devicePixelRatio, 2)
      renderer.setSize(rW, rH)
      renderer.setPixelRatio(pr)
      composer.setSize(rW, rH)
      fxaa.material.uniforms.resolution.value.set(1 / (rW * pr), 1 / (rH * pr))
      const aspect = rW / rH
      camera.left   = -VIEW_SIZE * aspect
      camera.right  =  VIEW_SIZE * aspect
      camera.top    =  VIEW_SIZE
      camera.bottom = -VIEW_SIZE
      camera.updateProjectionMatrix()
    }
    resize(W, H)
    const ro = new ResizeObserver(entries => {
      const { width: rW, height: rH } = entries[0].contentRect
      if (rW > 0 && rH > 0) resize(rW, rH)
    })
    ro.observe(mount)

    // Hemisférica (cielo/suelo) en vez de ambiental plana, más el sol
    // proyectando sombra real — antes castShadow no estaba activado y las
    // sombras de árboles/casas nunca llegaban a dibujarse.
    scene.add(new THREE.HemisphereLight(0xaed4f0, 0x6b5a3a, 0.95))
    const sun = new THREE.DirectionalLight(0xfff2da, 1.15)
    sun.position.set(42, 58, 26)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    const shc = sun.shadow.camera
    shc.left = -100; shc.right = 100; shc.top = 60; shc.bottom = -160
    shc.near = 1; shc.far = 260
    sun.shadow.bias = -0.0015
    scene.add(sun)

    // Grupo raíz del contenido generado — se reconstruye entero cuando cambian
    // los datos (nodo actual, filas visibles), no en cada frame.
    const world = new THREE.Group()
    scene.add(world)

    const nodeMeshes = []

    function clearWorld() {
      while (world.children.length) {
        const obj = world.children.pop()
        obj.traverse?.(o => {
          if (o.geometry && !SHARED_GEO.has(o.geometry)) o.geometry.dispose()
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material]
            mats.forEach(m => { if (m && !SHARED_MAT.has(m)) m.dispose() })
          }
        })
      }
      nodeMeshes.length = 0
    }

    function rebuild() {
      clearWorld()
      const { rows, currentNode } = dataRef.current
      if (!rows || !rows.length) return

      // Niebla de guerra: se genera con detalle todo hasta el nodo actual
      // (ya explorado); el siguiente nodo alcanzable solo se ve como
      // marcador suelto, sin entorno alrededor; nada más allá se genera.
      const revealed = rows.filter(r => r.depth <= currentNode + 1)
      const explored = revealed.filter(r => r.depth <= currentNode)
      const baseDepth = revealed[0]?.depth ?? currentNode
      const terrainSeed = (currentNode * 104729) >>> 0

      let rowMeta = null, strips = null, water = { river: null, lakes: [] }
      if (explored.length) {
        const built = buildTerrain(explored, baseDepth, terrainSeed)
        world.add(built.mesh)
        world.add(buildWaterMeshes(built.rowMeta, built.water))
        rowMeta = built.rowMeta
        strips = built.strips
        water = built.water

        // Puentes: solo donde el camino cruza de verdad el río.
        if (water.river) {
          explored.forEach((row, i) => {
            const rm = rowMeta[i]
            rm.pathXs.forEach(laneX => {
              const d = Math.abs(rm.z - riverZAt(water.river, laneX))
              if (d < water.river.halfW + 1.5) {
                const bridge = buildBridge(water.river.halfW * 2)
                bridge.position.set(laneX, WATER_LEVEL + 0.06, rm.z)
                world.add(bridge)
              }
            })
          })
        }
      }

      // Vegetación, rocas (instanciadas, alta densidad) y casas (grupos
      // individuales, para variar tejado/color) — solo en zonas exploradas,
      // apoyadas sobre la altura real del terreno y evitando el agua.
      const bucket = { trunk: [], pine: [], oak: [], rock: [], bush: [], shadow: [] }
      const P4 = new THREE.Vector3(), Q4 = new THREE.Quaternion(), S4 = new THREE.Vector3()
      const AX = new THREE.Vector3(0, 1, 0)
      function pushInst(key, x, y, z, sx, sy, sz, ry) {
        Q4.setFromAxisAngle(AX, ry); P4.set(x, y, z); S4.set(sx, sy, sz)
        bucket[key].push(new THREE.Matrix4().compose(P4, Q4, S4))
      }

      explored.forEach((row, i) => {
        const rng = seededRandom((currentNode * 7919 + row.depth * 131) >>> 0)
        const rm = rowMeta[i]
        const maxDist = Math.max(4, rm.halfW - 1.2)
        row.nodes.forEach(n => {
          const center = worldPos(row.depth, n.slot, baseDepth)

          const houses = 2 + Math.floor(rng() * 2)
          for (let i2 = 0; i2 < houses; i2++) {
            const angle = rng() * Math.PI * 2
            const dist = 3 + rng() * maxDist * 0.65
            const bx = center.x + Math.cos(angle) * dist
            const bz = center.z + Math.sin(angle) * dist
            if (waterInfluence(bx, bz, water) > 0.15) continue
            const by = groundYAt(bx, bz, strips, terrainSeed, water)
            const b = buildBuilding(rng)
            b.position.set(bx, by, bz)
            b.rotation.y = rng() * Math.PI * 2
            addContactShadow(b, 1.6)
            world.add(b)
          }

          const items = 22 + Math.floor(rng() * 14)
          for (let i2 = 0; i2 < items; i2++) {
            const angle = rng() * Math.PI * 2
            const dist = 2 + rng() * maxDist
            const x = center.x + Math.cos(angle) * dist
            const z = center.z + Math.sin(angle) * dist
            if (waterInfluence(x, z, water) > 0.2) continue
            const gy = groundYAt(x, z, strips, terrainSeed, water)
            const ry = rng() * Math.PI * 2
            const roll = rng()
            if (roll < 0.4) {
              const s = 0.75 + rng() * 0.5, tall = 2.4 * s
              pushInst('trunk', x, gy + tall * 0.5, z, s, tall, s, ry)
              pushInst('pine', x, gy + tall + 1.1 * s, z, 1.4 * s, 2.6 * s, 1.4 * s, ry)
              pushInst('shadow', x, gy, z, 0.8 * s, 1, 0.8 * s, 0)
            } else if (roll < 0.65) {
              const s = 0.7 + rng() * 0.45, tall = 1.7 * s
              pushInst('trunk', x, gy + tall * 0.5, z, s * 0.8, tall, s * 0.8, ry)
              pushInst('oak', x, gy + tall + 0.55 * s, z, 1.1 * s, 0.95 * s, 1.1 * s, ry)
              pushInst('shadow', x, gy, z, 0.9 * s, 1, 0.9 * s, 0)
            } else if (roll < 0.82) {
              const s = 0.45 + rng() * 0.5
              pushInst('rock', x, gy + s * 0.4, z, s, s * 0.8, s, ry)
              pushInst('shadow', x, gy, z, 0.7 * s, 1, 0.7 * s, 0)
            } else {
              const s = 0.35 + rng() * 0.3
              pushInst('bush', x, gy + s * 0.35, z, s * 1.3, s, s * 1.3, ry)
              pushInst('shadow', x, gy, z, 0.6 * s, 1, 0.6 * s, 0)
            }
          }
        })
      })

      function mkInst(key, geo, mat) {
        const arr = bucket[key]
        if (!arr.length) return
        const im = new THREE.InstancedMesh(geo, mat, arr.length)
        for (let i = 0; i < arr.length; i++) im.setMatrixAt(i, arr[i])
        im.instanceMatrix.needsUpdate = true
        im.castShadow = key !== 'shadow'
        world.add(im)
      }
      mkInst('trunk', GEO.trunk, MT.trunk)
      mkInst('pine', GEO.cone, MT.pine)
      mkInst('oak', GEO.ball, MT.oak)
      mkInst('rock', GEO.rock, MT.rock)
      mkInst('bush', GEO.ball, MT.bush)
      mkInst('shadow', GEO.shadow, MT.shadow)

      // Marcadores de nodo (todas las filas reveladas, incluida la siguiente alcanzable)
      revealed.forEach(row => {
        row.nodes.forEach(n => {
          const marker = buildNodeMarker(row.state, row.isBoss)
          const pos = worldPos(row.depth, n.slot, baseDepth)
          marker.position.copy(pos)
          marker.userData.depth = row.depth
          marker.userData.selectable = row.state === 'current'
          world.add(marker)
          nodeMeshes.push(marker)
        })
      })

      // Centrar cámara sobre el nodo actual la primera vez que se genera
      const currentRow = revealed.find(r => r.depth === currentNode)
      if (currentRow) {
        const p = worldPos(currentNode, currentRow.nodes[0].slot, baseDepth)
        target.set(p.x, 0, p.z)
        applyCamera()
      }
    }
    rebuild()

    // ── Pan de cámara (drag) ────────────────────────────────────────────────
    const forward = new THREE.Vector3(-camDir.x, 0, -camDir.z).normalize()
    const right   = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    let dragging = false, dragged = false, lastX = 0, lastY = 0

    function panLimits() {
      const { rows, currentNode } = dataRef.current
      if (!rows?.length) return null
      const baseDepth = rows[0].depth
      const minDepth = Math.max(rows[0].depth, currentNode - 4)
      const maxDepth = Math.min(rows[rows.length - 1].depth, currentNode + 1)
      return {
        minZ: -(maxDepth - baseDepth) * DEPTH_WORLD - DEPTH_WORLD,
        maxZ: -(minDepth - baseDepth) * DEPTH_WORLD + DEPTH_WORLD,
        minX: -SLOT_WORLD * 2.2, maxX: SLOT_WORLD * 2.2,
      }
    }

    function onPointerDown(e) {
      dragging = true; dragged = false
      lastX = e.clientX; lastY = e.clientY
      renderer.domElement.setPointerCapture(e.pointerId)
    }
    function onPointerMove(e) {
      if (!dragging) return
      const dx = e.clientX - lastX, dy = e.clientY - lastY
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true
      lastX = e.clientX; lastY = e.clientY
      const unitsPerPx = (camera.top - camera.bottom) / renderer.domElement.clientHeight
      target.addScaledVector(right, -dx * unitsPerPx)
      target.addScaledVector(forward, dy * unitsPerPx)
      const lim = panLimits()
      if (lim) {
        target.x = Math.min(lim.maxX, Math.max(lim.minX, target.x))
        target.z = Math.min(lim.maxZ, Math.max(lim.minZ, target.z))
      }
      applyCamera()
    }
    function onPointerUp(e) {
      dragging = false
      renderer.domElement.releasePointerCapture(e.pointerId)
      if (!dragged) handleTap(e)
    }

    const ray = new THREE.Raycaster()
    const m2  = new THREE.Vector2()
    function handleTap(e) {
      const rect = renderer.domElement.getBoundingClientRect()
      m2.x = ((e.clientX - rect.left) / rect.width)  *  2 - 1
      m2.y = ((e.clientY - rect.top)  / rect.height) * -2 + 1
      ray.setFromCamera(m2, camera)
      const selectable = nodeMeshes.filter(m => m.userData.selectable)
      const hits = ray.intersectObjects(selectable, true)
      if (hits.length) {
        let obj = hits[0].object
        while (obj && obj.userData.depth === undefined) obj = obj.parent
        if (obj) dataRef.current.onSelectNode?.(obj.userData.depth)
      }
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup',   onPointerUp)

    // ── Render loop ──────────────────────────────────────────────────────────
    let animId
    function tick(now) {
      if (!alive) return
      animId = requestAnimationFrame(tick)
      nodeMeshes.forEach(m => {
        if (m.userData.selectable) {
          const s = 1 + Math.sin(now / 300) * 0.08
          m.scale.setScalar(s)
        }
      })
      composer.render()
    }
    animId = requestAnimationFrame(tick)

    ctxRef.current = { rebuild }

    return () => {
      alive = false
      cancelAnimationFrame(animId)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup',   onPointerUp)
      clearWorld()
      skyTex.dispose()
      composer.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerar el mundo cuando cambian los datos (no en cada frame)
  useEffect(() => {
    ctxRef.current?.rebuild?.()
  }, [rows, currentNode])

  return <div ref={mountRef} className="story__scene" />
}
