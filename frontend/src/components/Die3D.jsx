import { useRef, useEffect, useCallback } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const EDGE_RADIUS = 0.07
const SEGMENTS = 40
const SETTLE_MS = 1800
const RED_VALUES = new Set(['AS', 'K', '8'])

// Face layout: value → which local axis points UP when that value should be on top
const FACE_MAP = [
  { value: 'Q',   axis: [1, 0, 0],  planePos: [0.503, 0, 0],   planeRot: [0, Math.PI / 2, 0] },
  { value: 'J',   axis: [-1, 0, 0], planePos: [-0.503, 0, 0],  planeRot: [0, -Math.PI / 2, 0] },
  { value: 'AS',  axis: [0, 1, 0],  planePos: [0, 0.503, 0],   planeRot: [-Math.PI / 2, 0, 0] },
  { value: 'K',   axis: [0, -1, 0], planePos: [0, -0.503, 0],  planeRot: [Math.PI / 2, 0, 0] },
  { value: '8',   axis: [0, 0, 1],  planePos: [0, 0, 0.503],   planeRot: [0, 0, 0] },
  { value: '7',   axis: [0, 0, -1], planePos: [0, 0, -0.503],  planeRot: [0, Math.PI, 0] },
]

// Snap quaternions: rotate die so value's face points to world +Y
const SNAP_Q = {}
FACE_MAP.forEach(({ value, axis }) => {
  const from = new THREE.Vector3(...axis).normalize()
  const q3 = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, 1, 0))
  SNAP_Q[value] = new CANNON.Quaternion(q3.x, q3.y, q3.z, q3.w)
})

// ─── Geometry (built once) ────────────────────────────────────────────────────

function buildRoundedBox() {
  const geo = new THREE.BoxGeometry(1, 1, 1, SEGMENTS, SEGMENTS, SEGMENTS)
  const pos = geo.attributes.position
  const subSize = 0.5 - EDGE_RADIUS
  const v = new THREE.Vector3()
  const sub = new THREE.Vector3()
  const add = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    sub.set(Math.sign(v.x) * subSize, Math.sign(v.y) * subSize, Math.sign(v.z) * subSize)
    add.copy(v).sub(sub)
    if (add.length() > 1e-4) {
      add.normalize().multiplyScalar(EDGE_RADIUS)
      pos.setXYZ(i, sub.x + add.x, sub.y + add.y, sub.z + add.z)
    }
  }
  pos.needsUpdate = true
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  const merged = mergeVertices(geo)
  merged.computeVertexNormals()
  return merged
}

const roundedBoxGeo = buildRoundedBox()
const facePlaneGeo = new THREE.PlaneGeometry(1 - 2 * EDGE_RADIUS, 1 - 2 * EDGE_RADIUS)

// ─── Textures (built once) ────────────────────────────────────────────────────

function makeFaceTexture(value) {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const isRed = RED_VALUES.has(value)
  const symbolColor = isRed ? '#c0111b' : '#111111'

  // Transparent background — die body color shows through
  ctx.clearRect(0, 0, size, size)

  // Symbol shadow (depth illusion, like a sunken pip)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetX = 3
  ctx.shadowOffsetY = 5

  // Center value — large, bold
  const isLong = value.length > 1
  ctx.fillStyle = symbolColor
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${isLong ? 200 : 230}px Georgia, serif`
  ctx.fillText(value, size / 2, size / 2 + 10)
  ctx.restore()

  // Corner labels (top-left and bottom-right, like real dice)
  ctx.fillStyle = symbolColor
  ctx.font = `bold 80px Georgia, serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(value, 28, 28)
  ctx.save()
  ctx.translate(size - 28, size - 28)
  ctx.rotate(Math.PI)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(value, 0, 0)
  ctx.restore()

  return new THREE.CanvasTexture(canvas)
}

const TEXTURES = {}
for (const v of ['AS', 'K', 'Q', 'J', '8', '7']) TEXTURES[v] = makeFaceTexture(v)

// ─── Physics world (singleton per roll) ──────────────────────────────────────

// Table bounds visible from camera [0,4.5,6] fov=45 looking at scene origin
const WALL_X = 4.2
const WALL_Z_NEAR = 2.5
const WALL_Z_FAR = -2.0

let world = null

function getWorld() {
  if (!world) {
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -40, 0) })
    world.broadphase = new CANNON.NaiveBroadphase()
    world.allowSleep = true
    world.sleepTimeLimit = 0.15
    world.defaultContactMaterial.restitution = 0.25
    world.defaultContactMaterial.friction = 0.4

    // Floor
    const floor = new CANNON.Body({ mass: 0 })
    floor.addShape(new CANNON.Plane())
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    world.addBody(floor)

    // Side walls to keep dice inside the visible area
    const addWall = (pos, euler) => {
      const b = new CANNON.Body({ mass: 0 })
      b.addShape(new CANNON.Plane())
      b.position.set(...pos)
      b.quaternion.setFromEuler(...euler)
      world.addBody(b)
    }
    addWall([ WALL_X, 0, 0], [0,  -Math.PI / 2, 0])  // right wall
    addWall([-WALL_X, 0, 0], [0,   Math.PI / 2, 0])  // left wall
    addWall([0, 0,  WALL_Z_NEAR], [Math.PI / 2, 0, 0])  // near wall (toward camera)
    addWall([0, 0, WALL_Z_FAR],  [-Math.PI / 2, 0, 0])  // far wall
  }
  return world
}

function resetWorld() { world = null }

// ─── Shared die body (visual only, no physics) ───────────────────────────────

function DieBody({ discarded, interactive, onPointerDownDie, groupRef }) {
  const opacity = discarded ? 0.3 : 1
  return (
    <group
      ref={groupRef}
      onPointerDown={interactive && !discarded ? onPointerDownDie : undefined}
      onClick={interactive && !discarded ? onPointerDownDie : undefined}
    >
      <mesh geometry={roundedBoxGeo} castShadow>
        <meshPhysicalMaterial
          color={0xfafafa}
          roughness={0.08}
          metalness={0}
          clearcoat={1}
          clearcoatRoughness={0.08}
          reflectivity={0.6}
          transparent={discarded}
          opacity={opacity}
        />
      </mesh>
      {FACE_MAP.map(({ value: faceVal, planePos, planeRot }) => (
        <mesh key={faceVal} geometry={facePlaneGeo} position={planePos} rotation={planeRot}>
          <meshStandardMaterial map={TEXTURES[faceVal]} roughness={0.4}
            transparent alphaTest={0.05}
            opacity={opacity} />
        </mesh>
      ))}
      {discarded && (
        <mesh geometry={roundedBoxGeo} scale={1.03}>
          <meshBasicMaterial color={0xff4444} wireframe transparent opacity={0.4} />
        </mesh>
      )}
    </group>
  )
}

// ─── Static die: already settled, no physics ─────────────────────────────────

function StaticDie({ value, startX, discarded, interactive, onPointerDownDie }) {
  const groupRef = useRef()
  const snapQ = SNAP_Q[value]

  useEffect(() => {
    if (!groupRef.current) return
    groupRef.current.position.set(startX, 0.5, 0)
    groupRef.current.quaternion.set(snapQ.x, snapQ.y, snapQ.z, snapQ.w)
  }, [startX, snapQ])

  return <DieBody discarded={discarded} interactive={interactive}
    onPointerDownDie={onPointerDownDie} groupRef={groupRef} />
}

// ─── Physics die: thrown and snapped after settle ────────────────────────────

function PhysicsDie({ value, startX, discarded, interactive, onPointerDownDie }) {
  const groupRef = useRef()
  const bodyRef = useRef()
  const timerRef = useRef(null)

  useEffect(() => {
    const w = getWorld()
    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
      linearDamping: 0.2,
      angularDamping: 0.25,
      allowSleep: true,
    })
    body.position.set(
      startX + (Math.random() - 0.5) * 0.4,
      3.5 + Math.random() * 1.5,
      (Math.random() - 0.5) * 0.6,
    )
    body.quaternion.setFromEuler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
    )
    const lateralForce = (Math.random() - 0.5) * 1.5
    body.applyImpulse(
      new CANNON.Vec3(lateralForce, 0, 0),
      new CANNON.Vec3(0, 0, 0.3),
    )
    w.addBody(body)
    bodyRef.current = body

    timerRef.current = setTimeout(() => {
      body.velocity.setZero()
      body.angularVelocity.setZero()
      body.quaternion.copy(SNAP_Q[value])
      body.position.set(startX, 0.5, 0)
    }, SETTLE_MS)

    return () => {
      clearTimeout(timerRef.current)
      w.removeBody(body)
    }
  }, [value, startX])

  useFrame(() => {
    if (!groupRef.current || !bodyRef.current) return
    const { position: p, quaternion: q } = bodyRef.current
    groupRef.current.position.set(p.x, p.y, p.z)
    groupRef.current.quaternion.set(q.x, q.y, q.z, q.w)
  })

  return <DieBody discarded={discarded} interactive={interactive}
    onPointerDownDie={onPointerDownDie} groupRef={groupRef} />
}

// ─── Scene (steps world once per frame) ──────────────────────────────────────

// rolledIndices: null = todos animan (primera tirada) | number[] = solo esos índices animan
function DiceScene({ dice, discardedIndices, interactive, onDiscard, rolledIndices }) {
  const discardedSet = new Set(discardedIndices)
  const spacing = 1.5
  const totalWidth = (dice.length - 1) * spacing
  const startXList = dice.map((_, i) => i * spacing - totalWidth / 2)

  useFrame((_, delta) => {
    if (world) world.step(1 / 60, delta, 3)
  })

  useEffect(() => () => resetWorld(), [])

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 10, 6]} intensity={1.4} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-near={0.5} shadow-camera-far={30}
        shadow-camera-left={-8} shadow-camera-right={8}
        shadow-camera-top={6} shadow-camera-bottom={-6} />
      <pointLight position={[-4, 5, 2]} intensity={0.5} color="#aabbff" />
      <pointLight position={[4, 5, -2]} intensity={0.3} color="#ffffff" />

      {dice.map((value, i) => {
        const shouldAnimate = rolledIndices === null || rolledIndices.includes(i)
        const DieComponent = shouldAnimate ? PhysicsDie : StaticDie
        return (
          <DieComponent
            key={`${i}-${value}`}
            value={value}
            startX={startXList[i]}
            discarded={discardedSet.has(i)}
            interactive={interactive}
            onPointerDownDie={() => onDiscard?.(i)}
          />
        )
      })}

      {/* Green felt table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 12]} />
        <meshStandardMaterial color="#2d6a4f" roughness={0.95} />
      </mesh>
    </>
  )
}

// ─── Container with swipe-out-to-discard ──────────────────────────────────────

export default function Die3DScene({ dice = [], discardedIndices = [], interactive = false, onDiscard, rolling, rolledIndices = null }) {
  const containerRef = useRef()
  const draggedDieRef = useRef(null)
  // Remount scene only when dice values change (not on rolling state changes)
  const sceneKey = dice.join(',')

  const handleDiePointerDown = useCallback((index) => {
    draggedDieRef.current = index
  }, [])

  // Swipe outside the rectangle → discard the die being dragged
  function onTouchEnd(e) {
    if (!interactive || draggedDieRef.current === null) return
    const touch = e.changedTouches?.[0]
    if (!touch) { draggedDieRef.current = null; return }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) { draggedDieRef.current = null; return }
    const outside =
      touch.clientX < rect.left || touch.clientX > rect.right ||
      touch.clientY < rect.top  || touch.clientY > rect.bottom
    if (outside) onDiscard?.(draggedDieRef.current)
    draggedDieRef.current = null
  }

  function onTouchStart() {
    draggedDieRef.current = null
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        width: '100%',
        height: 260,
        borderRadius: 16,
        overflow: 'hidden',
        background: '#1a3d2b',
        touchAction: 'none',
      }}
    >
      <Canvas
        key={sceneKey}
        camera={{ position: [0, 4.5, 6.5], fov: 45, near: 0.1, far: 60 }}
        shadows
      >
        <DiceScene
          dice={dice}
          discardedIndices={discardedIndices}
          interactive={interactive}
          rolledIndices={rolledIndices}
          onDiscard={(i) => {
            draggedDieRef.current = i
            handleDiePointerDown(i)
            onDiscard?.(i)
          }}
        />
      </Canvas>
    </div>
  )
}
