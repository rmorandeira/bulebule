import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'

// Face order for BoxGeometry: +X, -X, +Y, -Y, +Z, -Z
// We assign die values to face indices
const FACE_VALUES = ['K', 'Q', 'AS', '7', '8', 'J']  // [+X, -X, +Y, -Y, +Z, -Z]
const VALUE_TO_FACE = {}
FACE_VALUES.forEach((v, i) => { VALUE_TO_FACE[v] = i })

// Rotation to bring face[i] to point UP (+Y)
const FACE_UP_QUATS = [
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)),  // +X up
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0,  Math.PI / 2)),  // -X up
  new THREE.Quaternion().identity(),                                           // +Y up
  new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),        // -Y up
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),   // +Z up
  new THREE.Quaternion().setFromEuler(new THREE.Euler( Math.PI / 2, 0, 0)),   // -Z up
]

const DIE_SIZE = 0.9
const FLOOR_Y = -2
const WALL_DIST = 4

// Build a canvas texture for a die face
function makeFaceTexture(value) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#e5d9c3'
  roundRect(ctx, 0, 0, size, size, size * 0.18)
  ctx.fill()

  const PIP_PATTERNS = {
    'AS': [0,0,0, 0,1,0, 0,0,0],
    '8':  [1,1,1, 1,1,1, 1,1,1],
    '7':  [1,1,1, 0,1,0, 1,1,1],
  }

  if (value in PIP_PATTERNS) {
    const red = value === 'AS' || value === '8'
    ctx.fillStyle = red ? '#c0392b' : '#1a1a1a'
    const pattern = PIP_PATTERNS[value]
    const pipR = size * 0.065
    const margin = size * 0.2
    const step = (size - margin * 2) / 2
    pattern.forEach((on, i) => {
      if (!on) return
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = margin + col * step
      const y = margin + row * step
      ctx.beginPath()
      ctx.arc(x, y, pipR, 0, Math.PI * 2)
      ctx.fill()
    })
  } else {
    const display = value === 'AS' ? 'A' : value
    const red = value === 'K'
    ctx.fillStyle = red ? '#c0392b' : '#1a1a1a'
    ctx.font = `bold ${size * 0.55}px Georgia, serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(display, size / 2, size / 2)
  }

  return new THREE.CanvasTexture(canvas)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// Build materials for all 6 faces of a die given final value
function buildMaterials(finalValue) {
  return FACE_VALUES.map(faceVal => {
    const tex = makeFaceTexture(faceVal)
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.0 })
  })
}

export default function DiceRollerScene({ values, onSettled }) {
  const mountRef = useRef(null)
  const stateRef = useRef(null)
  const animFrameRef = useRef(null)
  const settledRef = useRef(false)

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (stateRef.current) {
      const { renderer, world } = stateRef.current
      renderer.dispose()
      world.free()
      stateRef.current = null
    }
    settledRef.current = false
  }, [])

  useEffect(() => {
    if (!values?.length || !mountRef.current) return
    cleanup()

    let alive = true

    async function init() {
      const RAPIER = await import('@dimforge/rapier3d-compat')
      await RAPIER.init()
      if (!alive || !mountRef.current) return

      // --- Three.js setup ---
      const el = mountRef.current
      const W = el.offsetWidth || el.parentElement?.offsetWidth || 320
      const H = el.offsetHeight || el.parentElement?.offsetHeight || 240

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
      renderer.setSize(W, H)
      renderer.setClearColor(0xebebeb)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true
      mountRef.current.appendChild(renderer.domElement)

      const scene = new THREE.Scene()

      const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100)
      camera.position.set(0, 8, 6)
      camera.lookAt(0, FLOOR_Y + 1, 0)

      // Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.7)
      scene.add(ambient)
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
      dirLight.position.set(5, 10, 5)
      dirLight.castShadow = true
      scene.add(dirLight)

      // --- Rapier setup ---
      const gravity = { x: 0, y: -20, z: 0 }
      const world = new RAPIER.World(gravity)

      // Floor
      const floorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_Y, 0)
      const floorBody = world.createRigidBody(floorDesc)
      world.createCollider(RAPIER.ColliderDesc.cuboid(WALL_DIST, 0.1, WALL_DIST), floorBody)

      // Walls (invisible, keep dice in view)
      for (const [tx, tz] of [[WALL_DIST, 0], [-WALL_DIST, 0], [0, WALL_DIST], [0, -WALL_DIST]]) {
        const wb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(tx, FLOOR_Y + 2, tz))
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 4, WALL_DIST), wb)
      }

      // --- Dice ---
      const diceData = values.map((value, idx) => {
        const materials = buildMaterials(value)
        const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE)
        const mesh = new THREE.Mesh(geo, materials)
        mesh.castShadow = true
        mesh.receiveShadow = true
        scene.add(mesh)

        // Stagger starting positions
        const spread = 1.5
        const startX = (idx - (values.length - 1) / 2) * spread + (Math.random() - 0.5) * 0.5
        const startZ = (Math.random() - 0.5) * 1.5

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(startX, FLOOR_Y + 6 + idx * 0.5, startZ)
          .setLinvel(
            (Math.random() - 0.5) * 4,
            -2,
            (Math.random() - 0.5) * 4
          )
          .setAngvel({
            x: (Math.random() - 0.5) * 20,
            y: (Math.random() - 0.5) * 20,
            z: (Math.random() - 0.5) * 20
          })

        const body = world.createRigidBody(bodyDesc)
        const collider = RAPIER.ColliderDesc.cuboid(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)
          .setRestitution(0.4)
          .setFriction(0.6)
        world.createCollider(collider, body)

        return { mesh, body, value, settled: false, tweening: false, tweenStart: null, tweenFrom: null }
      })

      stateRef.current = { renderer, scene, camera, world, diceData, RAPIER }

      // --- Render loop ---
      let lastTime = performance.now()
      let allSettledAt = null
      let tweenPhase = false

      function tick(now) {
        if (!alive) return
        animFrameRef.current = requestAnimationFrame(tick)

        const dt = Math.min((now - lastTime) / 1000, 0.05)
        lastTime = now

        if (!tweenPhase) {
          world.timestep = dt
          world.step()

          // Sync mesh positions
          diceData.forEach(d => {
            const pos = d.body.translation()
            const rot = d.body.rotation()
            d.mesh.position.set(pos.x, pos.y, pos.z)
            d.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
          })

          // Check settled: all dice have low velocity
          const allStopped = diceData.every(d => {
            const lv = d.body.linvel()
            const av = d.body.angvel()
            const speed = Math.sqrt(lv.x**2 + lv.y**2 + lv.z**2)
            const spin = Math.sqrt(av.x**2 + av.y**2 + av.z**2)
            return speed < 0.3 && spin < 0.3
          })

          if (allStopped && !allSettledAt) allSettledAt = now
          if (allSettledAt && now - allSettledAt > 300 && !tweenPhase) {
            tweenPhase = true
            // Start tween for each die to show correct face
            diceData.forEach(d => {
              const faceIdx = VALUE_TO_FACE[d.value]
              d.tweenFrom = d.mesh.quaternion.clone()
              d.tweenTarget = FACE_UP_QUATS[faceIdx].clone()
              d.tweenStart = now
            })
          }
        } else {
          // Tween all dice to correct orientation
          const TWEEN_DUR = 500
          let allDone = true
          diceData.forEach(d => {
            if (!d.tweenStart) return
            const t = Math.min((now - d.tweenStart) / TWEEN_DUR, 1)
            const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t  // ease-in-out
            d.mesh.quaternion.slerpQuaternions(d.tweenFrom, d.tweenTarget, ease)
            if (t < 1) allDone = false
          })

          if (allDone && !settledRef.current) {
            settledRef.current = true
            renderer.render(scene, camera)
            setTimeout(() => {
              if (alive) onSettled?.()
            }, 600)
          }
        }

        renderer.render(scene, camera)
      }

      animFrameRef.current = requestAnimationFrame(tick)
    }

    init()

    return () => {
      alive = false
      cleanup()
      if (mountRef.current) {
        const canvas = mountRef.current.querySelector('canvas')
        if (canvas) mountRef.current.removeChild(canvas)
      }
    }
  }, [values?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}
