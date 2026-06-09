import { useEffect, useRef } from 'react'
import * as THREE from 'three'

// BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
const FACE_VALUES = ['K', 'Q', 'AS', '7', '8', 'J']
const VALUE_TO_FACE = Object.fromEntries(FACE_VALUES.map((v, i) => [v, i]))

const FACE_UP_QUATS = (() => {
  const E = THREE.Euler
  const Q = THREE.Quaternion
  return [
    new Q().setFromEuler(new E(-Math.PI / 2, 0,  Math.PI / 2)),  // +X face (K)  → +Y world, text legible
    new Q().setFromEuler(new E(-Math.PI / 2, 0, -Math.PI / 2)),  // -X face (Q)  → +Y world, text legible
    new Q(),                                            // +Y face (AS) → +Y world
    new Q().setFromEuler(new E(Math.PI, 0, 0)),        // -Y face (7)  → +Y world
    new Q().setFromEuler(new E(-Math.PI / 2, 0, 0)),  // +Z face (8)  → +Y world
    new Q().setFromEuler(new E( Math.PI / 2, 0, 0)),  // -Z face (J)  → +Y world
  ]
})()

const DIE    = 0.85
const FY     = -2.5   // floor Y
const WX     = 3.6    // wall half-extent X
const WZ     = 3.0    // wall half-extent Z
const REST_Y   = FY + DIE / 2 + 0.02
const REST_Z   = -1.2  // back of scene = "top" in camera view
const DISCARD_Z = 1.85  // front of scene = "bottom" in camera view
const SLOT_X = (i) => (i - 2) * 1.1   // fixed X per die index

const PIP = {
  AS: [0,0,0, 0,1,0, 0,0,0],
  '8': [1,1,1, 1,1,1, 1,1,1],
  '7': [1,1,1, 0,1,0, 1,1,1],
}

function makeTex(value) {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')
  // Fill full canvas so corners match the die face color (no black edges)
  ctx.fillStyle = '#f5f2ee'
  ctx.fillRect(0, 0, S, S)
  const r = S * 0.18
  ctx.fillStyle = '#f5f2ee'
  ctx.beginPath()
  ctx.moveTo(r, 0); ctx.lineTo(S-r, 0); ctx.arcTo(S, 0, S, r, r)
  ctx.lineTo(S, S-r); ctx.arcTo(S, S, S-r, S, r)
  ctx.lineTo(r, S); ctx.arcTo(0, S, 0, S-r, r)
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath(); ctx.fill()
  if (value in PIP) {
    ctx.fillStyle = (value === 'AS' || value === '8') ? '#c0392b' : '#1a1a1a'
    const pr = S*0.065, m = S*0.22, st = (S-m*2)/2
    PIP[value].forEach((on, i) => {
      if (!on) return
      ctx.beginPath()
      ctx.arc(m+(i%3)*st, m+Math.floor(i/3)*st, pr, 0, Math.PI*2)
      ctx.fill()
    })
  } else {
    ctx.fillStyle = value === 'K' ? '#c0392b' : '#1a1a1a'
    ctx.font = `bold ${S*.55}px Georgia,serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(value === 'AS' ? 'A' : value, S/2, S/2)
  }
  return new THREE.CanvasTexture(cv)
}

function buildMats() {
  return FACE_VALUES.map(v => new THREE.MeshStandardMaterial({ map: makeTex(v), roughness: 0.4 }))
}

const eio = t => t < .5 ? 2*t*t : -1+(4-2*t)*t
const mag = v => Math.sqrt(v.x**2 + v.y**2 + v.z**2)

// ─────────────────────────────────────────────────────────────────────────────

export default function DiceRollerScene({
  values, rollingIndices, pendingDiscards = [],
  interactive, onDieClick, onSettled,
}) {
  const mountRef  = useRef(null)
  const labelsRef = useRef(null)
  const ctxRef    = useRef(null)
  const propsRef  = useRef({})
  propsRef.current = { values, rollingIndices, pendingDiscards, interactive, onDieClick, onSettled, labelsEl: labelsRef.current }

  // ── Init Three.js scene (once) ──────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let alive = true

    const W = mount.offsetWidth  || mount.parentElement?.offsetWidth  || 360
    const H = mount.offsetHeight || mount.parentElement?.offsetHeight || 240

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0xebebeb)
    mount.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
    camera.position.set(0, 7, 5.5)
    camera.lookAt(0, FY + 1.5, 0)

    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(4, 10, 6)
    scene.add(dir)

    // 5 persistent die meshes
    const dice = Array.from({ length: 5 }, (_, i) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(DIE, DIE, DIE),
        buildMats()
      )
      mesh.userData.idx = i
      mesh.visible = false
      scene.add(mesh)

      // Red outline shown when die is marked for discard
      const outline = new THREE.Mesh(
        new THREE.BoxGeometry(DIE * 1.18, DIE * 1.18, DIE * 1.18),
        new THREE.MeshBasicMaterial({ color: 0xe63946, side: THREE.BackSide })
      )
      outline.visible = false
      mesh.add(outline)

      return {
        mesh, outline, body: null, value: null,
        phase: 'hidden',  // hidden|rolling|facing|placing|idle
        ts: 0,
        fq: new THREE.Quaternion(), tq: new THREE.Quaternion(),
        fp: new THREE.Vector3(),    tp: new THREE.Vector3(),
        moveActive: false, moveTs: 0,
        moveFrom: new THREE.Vector3(), moveTo: new THREE.Vector3(),
      }
    })

    const ctx = {
      renderer, scene, camera, dice,
      RAPIER: null, world: null,
      pendingRoll: null, settleSince: null, animId: null,
    }
    ctxRef.current = ctx

    // Click to discard
    const ray = new THREE.Raycaster()
    const m2  = new THREE.Vector2()
    function onTap(e) {
      if (!propsRef.current.interactive) return
      const rect = renderer.domElement.getBoundingClientRect()
      const touch = e.changedTouches?.[0] ?? e.touches?.[0]
      const cx = touch ? touch.clientX : e.clientX
      const cy = touch ? touch.clientY : e.clientY
      m2.x = ((cx - rect.left) / rect.width)  *  2 - 1
      m2.y = ((cy - rect.top)  / rect.height) * -2 + 1
      ray.setFromCamera(m2, camera)
      const clickable = dice.filter(d => d.phase === 'idle' && d.mesh.visible).map(d => d.mesh)
      const hits = ray.intersectObjects(clickable)
      if (hits.length) propsRef.current.onDieClick?.(hits[0].object.userData.idx)
    }
    renderer.domElement.addEventListener('click', onTap)
    renderer.domElement.addEventListener('touchend', onTap)

    // Render loop
    function tick(now) {
      if (!alive) return
      ctx.animId = requestAnimationFrame(tick)
      step(ctx, now, propsRef)
      renderer.render(scene, camera)
    }
    ctx.animId = requestAnimationFrame(tick)

    // Async Rapier init
    import('@dimforge/rapier3d-compat').then(async R => {
      await R.init()
      if (!alive) return
      ctx.RAPIER = R
      ctx.world  = makeWorld(R)
      if (ctx.pendingRoll) {
        doRoll(ctx, ...ctx.pendingRoll)
        ctx.pendingRoll = null
      }
    })

    return () => {
      alive = false
      cancelAnimationFrame(ctx.animId)
      renderer.domElement.removeEventListener('click', onTap)
      renderer.domElement.removeEventListener('touchend', onTap)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  // ── Roll trigger ────────────────────────────────────────────────────────────
  const rollKey = `${rollingIndices?.slice().sort().join(',')}_${values?.join(',')}`
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || !values?.length || !rollingIndices?.length) return
    if (ctx.RAPIER && ctx.world) doRoll(ctx, [...values], [...rollingIndices])
    else ctx.pendingRoll = [[...values], [...rollingIndices]]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey])

  // ── Pending discards: borde rojo + mover al fondo (o devolver) ─────────────
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = performance.now()
    ctx.dice.forEach((d, i) => {
      if (d.phase !== 'idle') return
      const discarded = pendingDiscards.includes(i)
      d.outline.visible = discarded
      const targetZ = discarded ? DISCARD_Z : REST_Z
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(SLOT_X(i), REST_Y, targetZ)
      d.moveTs = now
      d.moveActive = true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiscards.join(',')])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labelsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} style={{
            display: 'none',
            position: 'absolute',
            transform: 'translateX(-50%)',
            color: '#e63946',
            fontWeight: 800,
            fontSize: '9px',
            letterSpacing: '2px',
            textShadow: '0 1px 3px rgba(0,0,0,0.55)',
            whiteSpace: 'nowrap',
          }}>DESCARTE</div>
        ))}
      </div>
    </div>
  )
}

// ─── Scene helpers (no React state closures) ──────────────────────────────────

function makeWorld(R) {
  const w = new R.World({ x: 0, y: -20, z: 0 })
  const fixed = (tx, ty, tz) => w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(tx, ty, tz))
  const box   = (b, hx, hy, hz) => w.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setRestitution(0.35).setFriction(0.7), b)
  // floor
  box(fixed(0, FY, 0), WX, 0.1, WZ)
  // 4 walls
  const wh = 4, wy = FY + wh
  box(fixed( WX, wy, 0), 0.1, wh, WZ)
  box(fixed(-WX, wy, 0), 0.1, wh, WZ)
  box(fixed(0, wy,  WZ), WX, wh, 0.1)
  box(fixed(0, wy, -WZ), WX, wh, 0.1)
  return w
}

function doRoll(ctx, values, rollingIndices) {
  const { RAPIER: R, world, dice } = ctx
  ctx.settleSince = null

  rollingIndices.forEach((i, slot) => {
    // Remove old body
    if (dice[i].body) { world.removeRigidBody(dice[i].body); dice[i].body = null }

    dice[i].value = values[i]

    const startX = (slot - (rollingIndices.length - 1) / 2) * 1.2 + (Math.random() - .5) * .4
    const startZ = (Math.random() - .5) * 1.2
    const startY = FY + 5.5 + slot * .6

    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(startX, startY, startZ)
      .setLinvel((Math.random()-.5)*3, -2, (Math.random()-.5)*2)
      .setAngvel({ x: (Math.random()-.5)*20, y: (Math.random()-.5)*20, z: (Math.random()-.5)*20 })

    const body = world.createRigidBody(bd)
    world.createCollider(
      R.ColliderDesc.cuboid(DIE/2, DIE/2, DIE/2).setRestitution(0.35).setFriction(0.7),
      body
    )

    dice[i].body  = body
    dice[i].phase = 'rolling'
    dice[i].moveActive = false
    dice[i].mesh.visible = true
    dice[i].mesh.position.set(startX, startY, startZ)
    dice[i].outline.visible = false
    dice[i].mesh.material.forEach(mat => { mat.transparent = false; mat.opacity = 1.0 })
  })
}

function step(ctx, now, propsRef) {
  const { world, dice } = ctx
  if (!world) return

  const rolling = dice.filter(d => d.phase === 'rolling')

  // ── Physics ─────────────────────────────────────────────────────────────────
  if (rolling.length > 0) {
    world.step()
    rolling.forEach(d => {
      const p = d.body.translation(), q = d.body.rotation()
      d.mesh.position.set(p.x, p.y, p.z)
      d.mesh.quaternion.set(q.x, q.y, q.z, q.w)
    })

    const slow = rolling.every(d => mag(d.body.linvel()) < .25 && mag(d.body.angvel()) < .25)
    if (slow) {
      if (!ctx.settleSince) ctx.settleSince = now
      else if (now - ctx.settleSince > 400) {
        ctx.settleSince = null
        beginFace(ctx, now)
      }
    } else {
      ctx.settleSince = null
    }
  }

  // ── Face tween ───────────────────────────────────────────────────────────────
  const facing = dice.filter(d => d.phase === 'facing')
  if (facing.length > 0) {
    const DUR = 420
    let done = true
    facing.forEach(d => {
      const t = Math.min((now - d.ts) / DUR, 1)
      d.mesh.quaternion.slerpQuaternions(d.fq, d.tq, eio(t))
      if (t < 1) done = false
    })
    if (done) {
      facing.forEach(d => { d.mesh.quaternion.copy(d.tq) })
      beginPlace(ctx, now)
    }
  }

  // ── Place tween ──────────────────────────────────────────────────────────────
  const placing = dice.filter(d => d.phase === 'placing')
  if (placing.length > 0) {
    const DUR = 550
    let done = true
    placing.forEach(d => {
      const t = Math.min((now - d.ts) / DUR, 1)
      d.mesh.position.lerpVectors(d.fp, d.tp, eio(t))
      if (t < 1) done = false
      else { d.mesh.position.copy(d.tp); d.phase = 'idle' }
    })
    if (done) propsRef.current.onSettled?.()
  }

  // ── Move tween (discard / return) ────────────────────────────────────────────
  const MOV_DUR = 380
  dice.forEach(d => {
    if (!d.moveActive || d.phase !== 'idle') return
    const t = Math.min((now - d.moveTs) / MOV_DUR, 1)
    d.mesh.position.lerpVectors(d.moveFrom, d.moveTo, eio(t))
    if (t >= 1) { d.mesh.position.copy(d.moveTo); d.moveActive = false }
  })

  // ── DESCARTE labels ──────────────────────────────────────────────────────────
  updateLabels(ctx, propsRef.current)
}

function beginFace(ctx, now) {
  ctx.dice.forEach(d => {
    if (d.phase !== 'rolling') return
    const fi = VALUE_TO_FACE[d.value] ?? 2
    d.fq.copy(d.mesh.quaternion)
    d.tq.copy(FACE_UP_QUATS[fi])
    d.ts = now
    d.phase = 'facing'
    if (d.body) { ctx.world.removeRigidBody(d.body); d.body = null }
  })
}

function beginPlace(ctx, now) {
  // Only newly settled dice need placing; idle (kept) dice stay where they are
  ctx.dice.forEach((d, i) => {
    if (d.phase !== 'facing') return
    d.fp.copy(d.mesh.position)
    d.tp.set(SLOT_X(i), REST_Y, REST_Z)
    d.ts = now
    d.phase = 'placing'
  })
}

function updateLabels(ctx, props) {
  const container = props.labelsEl
  if (!container) return
  const { dice, camera, renderer } = ctx
  const pending = props.pendingDiscards ?? []
  const rect = renderer.domElement.getBoundingClientRect()

  for (let i = 0; i < 5; i++) {
    const label = container.children[i]
    if (!label) continue
    const d = dice[i]

    if (!pending.includes(i) || d.phase !== 'idle') {
      label.style.display = 'none'
      continue
    }

    // Project position just below the die
    const pos = d.mesh.position.clone()
    pos.y -= DIE * 0.85
    pos.project(camera)

    const x = (pos.x * 0.5 + 0.5) * rect.width
    const y = (-pos.y * 0.5 + 0.5) * rect.height

    label.style.display = 'block'
    label.style.left = `${x}px`
    label.style.top  = `${y}px`
  }
}
