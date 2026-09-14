import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass }     from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { FXAAShader }     from 'three/examples/jsm/shaders/FXAAShader.js'

// Skin config: image-based or flat-color
const _skinImgs = {
  'dice-marble':       new window.Image(),
  'dice-marble-black': new window.Image(),
  'dice-marble-red':   new window.Image(),
  'dice-marble-green': new window.Image(),
}
_skinImgs['dice-marble'].src       = '/assets/dice/marble-texture.png'
_skinImgs['dice-marble-black'].src = '/assets/dice/marble-black-texture.png'
_skinImgs['dice-marble-red'].src   = '/assets/dice/marble-red-texture.png'
_skinImgs['dice-marble-green'].src = '/assets/dice/marble-green-texture.png'

const _skinColors = {
  'dice-transp-red': { bg: '#dc2626', opacity: 0.5 },
}

// BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
const FACE_VALUES = ['K', 'Q', 'AS', '7', '8', 'J']
const VALUE_RANK = { AS: 0, K: 1, Q: 2, J: 3, '8': 4, '7': 5 }

const DIE    = 1.21
const FY     = -2.5   // floor Y
const WX     = 4.2    // wall half-extent X
const WZ     = 3.4    // wall half-extent Z
const REST_Y   = FY + DIE / 2 + 0.02
const ROW_BACK_Z  = -1.4   // 2 dice — back row (top in camera view)
const ROW_FRONT_Z =  0.6   // 3 dice — front row (bottom in camera view)
const DISCARD_Z   =  2.2   // discard zone (furthest forward)

// Dice 0,1 → back row (2 dice centered); 2,3,4 → front row (3 dice)
function slotPos(i) {
  if (i < 2) return { x: (i - 0.5) * 1.78, z: ROW_BACK_Z }
  return { x: (i - 3) * 1.78, z: ROW_FRONT_Z }
}

const PIP = {
  AS: [0,0,0, 0,1,0, 0,0,0],
  '8': [1,1,1, 0,1,1, 1,1,1],  // 8 puntos rojos: 3+2+3, fila central centrada
  '7': [1,1,1, 0,1,0, 1,1,1],  // 7 puntos negros
}

function makeToonGradient() {
  const cv = document.createElement('canvas')
  cv.width = 4; cv.height = 1
  const c = cv.getContext('2d')
  c.fillStyle = '#2E2418'; c.fillRect(0, 0, 1, 1)   // warm shadow
  c.fillStyle = '#8C7C60'; c.fillRect(1, 0, 1, 1)   // warm taupe
  c.fillStyle = '#DDD8C8'; c.fillRect(2, 0, 1, 1)   // bone mid-light
  c.fillStyle = '#FFFFFF'; c.fillRect(3, 0, 1, 1)   // white lit
  const tex = new THREE.CanvasTexture(cv)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  return tex
}

// AS, K, 8 → rojo   |   Q, J, 7 → negro
const RED_FACES = new Set(['AS', 'K', '8'])

function drawPip(ctx, cx, cy, r, isRed, textured = false) {
  if (textured) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = isRed ? '#ff9999' : '#ffffff'
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    return
  }
  ctx.fillStyle = isRed ? '#6A0000' : '#0A0500'
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = isRed ? '#C02010' : '#1E0F00'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = isRed ? 'rgba(255,120,80,0.18)' : 'rgba(230,160,40,0.15)'
  ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.32, r * 0.48, 0, Math.PI * 2); ctx.fill()
}

function makeTex(value, bgImg = null, bgColor = null) {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')

  const textured = bgImg !== null || bgColor !== null
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, S, S)
    ctx.fillStyle = 'rgba(10,20,40,0.12)'
    ctx.fillRect(0, 0, S, S)
  } else if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, S, S)
  } else {
    // Amber base — fills full canvas so rounded-box corners blend
    ctx.fillStyle = '#EDE5D2'
    ctx.fillRect(0, 0, S, S)
  }

  const isRed = RED_FACES.has(value)

  if (value in PIP) {
    const pr = S * 0.086, m = S * 0.215, st = (S - m * 2) / 2
    PIP[value].forEach((on, i) => {
      if (!on) return
      let cx = m + (i % 3) * st
      if (value === '8' && Math.floor(i / 3) === 1) cx -= st / 2
      drawPip(ctx, cx, m + Math.floor(i / 3) * st, pr, isRed, textured)
    })
  } else {
    const label = value === 'AS' ? 'A' : value
    ctx.font = `900 ${S * 0.56}px Georgia,serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    if (textured) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 10
      ctx.fillStyle = isRed ? '#ffaaaa' : '#ffffff'
      ctx.fillText(label, S / 2, S / 2)
      ctx.shadowBlur = 0
    } else {
      ctx.fillStyle = isRed ? '#6A0000' : '#0A0500'
      ctx.fillText(label, S / 2 + 2, S / 2 + 3)
      ctx.fillStyle = isRed ? '#C02010' : '#1E0F00'
      ctx.fillText(label, S / 2, S / 2)
    }
  }
  return new THREE.CanvasTexture(cv)
}

const _toonGrad = makeToonGradient()

function buildMats(skinId = null) {
  const colorCfg = skinId ? _skinColors[skinId] : null
  if (colorCfg) {
    return FACE_VALUES.map(v => {
      const mat = new THREE.MeshToonMaterial({ map: makeTex(v, null, colorCfg.bg), gradientMap: _toonGrad })
      mat.transparent = true
      mat.opacity = colorCfg.opacity
      return mat
    })
  }
  const img = skinId ? _skinImgs[skinId] : null
  const bgImg = img?.complete && img.naturalWidth > 0 ? img : null
  return FACE_VALUES.map(v => new THREE.MeshToonMaterial({ map: makeTex(v, bgImg), gradientMap: _toonGrad }))
}

const eio = t => t < .5 ? 2*t*t : -1+(4-2*t)*t
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()

const _diceSounds = ['/assets/dado1.mp3', '/assets/dado2.mp3', '/assets/dado3.mp3'].map(s => new Audio(s))
let _diceSoundIdx = 0
function playDiceHit(impact = 3) {
  const a = _diceSounds[_diceSoundIdx % 3]
  _diceSoundIdx++
  a.currentTime = 0
  a.volume = Math.min(impact / 10, 1) * 0.75
  a.play().catch(() => {})
}

const _eliminarAudio = new Audio('/assets/eliminar_dados.mp3')

// ─────────────────────────────────────────────────────────────────────────────

export default function DiceRollerScene({
  values, rollingIndices, pendingDiscards = [],
  interactive, onDieClick, onSettled, keyframes, frameIntervalMs = 50, rollId, sorted = false,
  skin = undefined,
}) {
  const mountRef = useRef(null)
  const ctxRef   = useRef(null)
  const propsRef = useRef({})
  propsRef.current = { values, rollingIndices, pendingDiscards, interactive, onDieClick, onSettled, skin }

  // ── Init Three.js scene (once) ──────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let alive = true

    const W = mount.offsetWidth  || mount.parentElement?.offsetWidth  || 360
    const H = mount.offsetHeight || mount.parentElement?.offsetHeight || 240

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (document.documentElement.getAttribute('data-theme') === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    renderer.setClearColor(isDark ? 0x2c2c2e : 0xebebeb)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    mount.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 100)
    camera.position.set(0, 7.5, 11.5)
    camera.lookAt(0, FY + 1.5, 0)

    // FXAA post-process composer
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const fxaa = new ShaderPass(FXAAShader)
    fxaa.material.uniforms.resolution.value.set(
      1 / (W * Math.min(window.devicePixelRatio, 2)),
      1 / (H * Math.min(window.devicePixelRatio, 2))
    )
    composer.addPass(fxaa)

    // Keep renderer + camera in sync with element size
    const ro = new ResizeObserver(entries => {
      const { width: rW, height: rH } = entries[0].contentRect
      if (rW > 0 && rH > 0) {
        const pr = Math.min(window.devicePixelRatio, 2)
        renderer.setSize(rW, rH)
        renderer.setPixelRatio(pr)
        composer.setSize(rW, rH)
        fxaa.material.uniforms.resolution.value.set(1 / (rW * pr), 1 / (rH * pr))
        camera.aspect = rW / rH
        camera.updateProjectionMatrix()
      }
    })
    ro.observe(mount)

    scene.add(new THREE.AmbientLight(0xFFFAF0, 0.80))
    const dir = new THREE.DirectionalLight(0xFFFDF0, 1.8)
    dir.position.set(4, 10, 6)
    dir.castShadow = true
    dir.shadow.mapSize.width  = 1024
    dir.shadow.mapSize.height = 1024
    dir.shadow.camera.near = 1
    dir.shadow.camera.far  = 30
    dir.shadow.camera.left   = -8
    dir.shadow.camera.right  =  8
    dir.shadow.camera.top    =  8
    dir.shadow.camera.bottom = -8
    dir.shadow.bias = -0.002
    scene.add(dir)

    // Floor plane — only receives shadows (not visible as a flat color, blends with bg)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WX * 2, WZ * 2),
      new THREE.ShadowMaterial({ opacity: 0.25 })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = FY + 0.01
    floor.receiveShadow = true
    scene.add(floor)

    const activeSkin = skin !== undefined ? skin : localStorage.getItem('bule_dice_skin')

    // 5 persistent die meshes
    const dice = Array.from({ length: 5 }, (_, i) => {
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE * 0.12),
        buildMats(activeSkin)
      )
      mesh.userData.idx = i
      mesh.visible = false
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)

      // Cell-shading outline — black by default, red when marked for discard
      const outline = new THREE.Mesh(
        new RoundedBoxGeometry(DIE * 1.11, DIE * 1.11, DIE * 1.11, 4, DIE * 0.14),
        new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide })
      )
      outline.visible = true
      mesh.add(outline)

      return {
        mesh, outline, value: null,
        phase: 'hidden',  // hidden|rolling|placing|idle|exiting
        ts: 0, throwPos: -1, lastKfIdx: -1, prevKfY: null, prevKfDy: 0,
        fp: new THREE.Vector3(), tp: new THREE.Vector3(),
        moveActive: false, moveTs: 0,
        moveFrom: new THREE.Vector3(), moveTo: new THREE.Vector3(),
        exitFrom: new THREE.Vector3(), exitTs: 0,
        hitCooldown: 0, inCorner: false,
      }
    })

    // If texture image not yet loaded when scene init runs, rebuild all dice materials once it loads
    const skinImg = activeSkin ? _skinImgs[activeSkin] : null
    if (skinImg && !skinImg.complete) {
      skinImg.onload = () => {
        const mats = buildMats(activeSkin)
        dice.forEach(d => { d.mesh.material = mats })
      }
    }

    const ctx = {
      renderer, scene, camera, dice,
      onExitDone: null, rollId: 0, animId: null,
      camCurPos:  new THREE.Vector3(0, 7.5, 11.5),
      camCurLook: new THREE.Vector3(0, FY + 1.5, 0),
      camTween: null,
      lastSkin: activeSkin,
    }
    ctxRef.current = ctx

    // Click to discard
    const ray = new THREE.Raycaster()
    const m2  = new THREE.Vector2()
    function onTap(e) {
      if (!propsRef.current.interactive) return
      if (e.cancelable) e.preventDefault()  // evita que touchend dispare también click
      const rect = renderer.domElement.getBoundingClientRect()
      const touch = e.changedTouches?.[0] ?? e.touches?.[0]
      const cx = touch ? touch.clientX : e.clientX
      const cy = touch ? touch.clientY : e.clientY
      m2.x = ((cx - rect.left) / rect.width)  *  2 - 1
      m2.y = ((cy - rect.top)  / rect.height) * -2 + 1
      ray.setFromCamera(m2, camera)
      const clickable = dice.filter(d => (d.phase === 'idle' || d.moveActive) && d.mesh.visible).map(d => d.mesh)
      const hits = ray.intersectObjects(clickable, false)
      if (hits.length) propsRef.current.onDieClick?.(hits[0].object.userData.idx)
    }
    renderer.domElement.addEventListener('click',    onTap)
    renderer.domElement.addEventListener('touchend', onTap, { passive: false })

    // Render loop
    function tick(now) {
      if (!alive) return
      ctx.animId = requestAnimationFrame(tick)
      step(ctx, now, propsRef)
      composer.render()
    }
    ctx.animId = requestAnimationFrame(tick)

    return () => {
      alive = false
      ro.disconnect()
      cancelAnimationFrame(ctx.animId)
      renderer.domElement.removeEventListener('click', onTap)
      renderer.domElement.removeEventListener('touchend', onTap)
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, [])

  // ── Roll trigger ────────────────────────────────────────────────────────────
  // rollId identifica la tirada de forma unívoca (lo asigna el servidor) — los
  // keyframes ya vienen calculados por el backend, aquí solo se reproducen.
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || !values?.length || !rollingIndices?.length || !keyframes?.length) return
    rollWithSounds(ctx, [...values], [...rollingIndices], keyframes, frameIntervalMs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId])

  // ── Pending discards: borde rojo + alpha 50% + mover al fondo ──────────────
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = performance.now()

    // Discarded dice: arrange centered, evenly spaced — no overlaps
    const discardedIdle = pendingDiscards.filter(i => ctx.dice[i]?.phase === 'idle')
    const nDiscard = discardedIdle.length

    ctx.dice.forEach((d, i) => {
      if (d.phase !== 'idle') return
      const discarded = pendingDiscards.includes(i)
      d.outline.material.color.set(discarded ? 0xe63946 : 0x000000)
      d.mesh.material.forEach(mat => {
        mat.transparent = discarded
        mat.opacity = discarded ? 0.5 : 1.0
      })
      const { x, z: slotZ } = slotPos(i)
      d.moveFrom.copy(d.mesh.position)
      if (discarded) {
        const slot = discardedIdle.indexOf(i)
        d.moveTo.set((slot - (nDiscard - 1) / 2) * 1.78, REST_Y, DISCARD_Z)
      } else {
        d.moveTo.set(x, REST_Y, slotZ)
      }
      d.moveTs = now
      d.moveActive = true
    })

    // Zoom out adaptively when many discards spread the dice wide
    if (nDiscard >= 4) {
      const extra = nDiscard - 3  // 1 for 4 dice, 2 for 5 dice
      ctx.camTween = {
        fromPos: ctx.camCurPos.clone(), fromLook: ctx.camCurLook.clone(),
        toPos: new THREE.Vector3(0, 6.2 + extra * 1.75, 3.3 + extra * 1.35),
        toLook: new THREE.Vector3(0, FY + 1.5, 0),
        ts: now, dur: 350,
      }
    } else if (nDiscard > 0) {
      // Fewer discards: snap back to normal settled zoom
      ctx.camTween = {
        fromPos: ctx.camCurPos.clone(), fromLook: ctx.camCurLook.clone(),
        toPos: new THREE.Vector3(0, 6.2, 3.3),
        toLook: new THREE.Vector3(0, FY + 1.5, 0),
        ts: now, dur: 350,
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiscards.join(',')])

  // ── Ordenar dados por valor cuando el jugador finaliza su turno ───────────────
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || !sorted) return
    const now = performance.now()
    const visible = [0,1,2,3,4].filter(i => ctx.dice[i].mesh.visible && ctx.dice[i].phase === 'idle')
    if (visible.length < 2) return
    const ordered = [...visible].sort((a, b) =>
      (VALUE_RANK[ctx.dice[a].value] ?? 99) - (VALUE_RANK[ctx.dice[b].value] ?? 99)
    )
    ordered.forEach((dieIdx, slot) => {
      const d = ctx.dice[dieIdx]
      const { x, z } = slotPos(slot)
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(x, REST_Y, z)
      d.moveTs = now
      d.moveActive = true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted])

  // ── Limpiar dados cuando se reinicia el turno (values → null) ────────────────
  useEffect(() => {
    if (values?.length) return
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.camTween = {
      fromPos: ctx.camCurPos.clone(), fromLook: ctx.camCurLook.clone(),
      toPos: new THREE.Vector3(0, 7.5, 11.5), toLook: new THREE.Vector3(0, FY + 1.5, 0),
      ts: performance.now(), dur: 350,
    }
    ctx.dice.forEach(d => {
      d.mesh.visible = false
      d.mesh.material.forEach(mat => { mat.transparent = false; mat.opacity = 1.0 })
      d.outline.material.color.set(0x000000)
      d.outline.material.transparent = false
      d.outline.material.opacity = 1.0
      d.phase = 'hidden'
      d.moveActive = false
      d.inCorner = false
    })
    ctx.onExitDone = null
    ctx.keyframes = null
  }, [values])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}

// ─── Scene helpers (no React state closures) ──────────────────────────────────

// El servidor ya corrió la física una vez (ver backend/game/dicePhysics.js) y
// manda la trayectoria completa — aquí solo se coloca cada dado en su primer
// keyframe y se deja que step() reproduzca el resto.
function doRoll(ctx, values, rollingIndices, keyframes, frameIntervalMs) {
  const { dice } = ctx
  ctx.keyframes = keyframes
  ctx.frameIntervalMs = frameIntervalMs
  ctx.rollStartTs = performance.now()

  rollingIndices.forEach((i, position) => {
    const d = dice[i]
    d.value = values[i]
    d.throwPos = position
    d.phase = 'rolling'
    d.moveActive = false
    d.mesh.visible = true
    d.outline.material.color.set(0x000000)
    d.outline.material.transparent = false
    d.outline.material.opacity = 1.0
    d.mesh.material.forEach(mat => { mat.transparent = false; mat.opacity = 1.0 })
    d.lastKfIdx = -1
    d.prevKfY = null
    d.prevKfDy = 0
    d.hitCooldown = 0

    const first = keyframes[0]?.[position]
    if (first) {
      d.mesh.position.set(first[0], first[1], first[2])
      d.mesh.quaternion.set(first[3], first[4], first[5], first[6])
    }
  })
}

function step(ctx, now, propsRef) {
  const { dice } = ctx

  // Detect skin changes every frame (handles both prop changes and localStorage updates)
  const propSkin = propsRef.current.skin
  const resolvedSkin = propSkin !== undefined ? propSkin : localStorage.getItem('bule_dice_skin')
  if (resolvedSkin !== ctx.lastSkin) {
    ctx.lastSkin = resolvedSkin
    const img = resolvedSkin ? _skinImgs[resolvedSkin] : null
    if (img && !img.complete) {
      img.onload = () => {
        const mats = buildMats(resolvedSkin)
        ctx.dice.forEach(d => { d.mesh.material = mats })
      }
    } else {
      const mats = buildMats(resolvedSkin)
      ctx.dice.forEach(d => { d.mesh.material = mats })
    }
  }

  const rolling = dice.filter(d => d.phase === 'rolling')

  // ── Reproducción de keyframes (calculados una vez en el servidor — misma
  // animación en todos los dispositivos, ver [[project_dice_sync_bug]]) ────────
  if (rolling.length > 0 && ctx.keyframes?.length) {
    const elapsed = now - ctx.rollStartTs
    const frameFloat = elapsed / ctx.frameIntervalMs
    const lastIdx = ctx.keyframes.length - 1
    const i0 = Math.min(Math.floor(frameFloat), lastIdx)
    const i1 = Math.min(i0 + 1, lastIdx)
    const frac = i0 === i1 ? 0 : Math.min(Math.max(frameFloat - i0, 0), 1)
    const frame0 = ctx.keyframes[i0], frame1 = ctx.keyframes[i1]

    rolling.forEach(d => {
      const k0 = frame0[d.throwPos], k1 = frame1[d.throwPos]
      if (!k0) return
      d.mesh.position.set(
        k0[0] + (k1[0] - k0[0]) * frac,
        k0[1] + (k1[1] - k0[1]) * frac,
        k0[2] + (k1[2] - k0[2]) * frac
      )
      _q0.set(k0[3], k0[4], k0[5], k0[6])
      _q1.set(k1[3], k1[4], k1[5], k1[6])
      d.mesh.quaternion.copy(_q0).slerp(_q1, frac)

      // Bounce sound: cada vez que se avanza a un nuevo keyframe, detecta un
      // frenazo brusco en Y (caída seguida de rebote) para disparar el sonido
      if (i0 !== d.lastKfIdx) {
        d.lastKfIdx = i0
        const dy = k0[1] - (d.prevKfY ?? k0[1])
        if (d.prevKfDy < -0.15 && dy > d.prevKfDy * 0.2 && now - d.hitCooldown > 80) {
          playDiceHit(Math.abs(d.prevKfDy) * 10)
          d.hitCooldown = now
        }
        d.prevKfDy = dy
        d.prevKfY = k0[1]
      }
    })

    if (frameFloat >= lastIdx) beginPlace(ctx, now)
  }

  // ── Animación de agrupación (placing tween) ──────────────────────────────────
  const placing = dice.filter(d => d.phase === 'placing')
  if (placing.length > 0) {
    const DUR = 420
    let done = true
    placing.forEach(d => {
      const t = Math.min((now - d.ts) / DUR, 1)
      d.mesh.position.lerpVectors(d.fp, d.tp, eio(t))
      if (t < 1) done = false
      else { d.mesh.position.copy(d.tp); d.phase = 'idle' }
    })
    if (done) {
      const faces = ctx.dice.map(d => d.value)
      propsRef.current.onSettled?.(faces)
      ctx.camTween = {
        fromPos: ctx.camCurPos.clone(), fromLook: ctx.camCurLook.clone(),
        toPos: new THREE.Vector3(0, 6.2, 3.3), toLook: new THREE.Vector3(0, FY + 1.5, 0),
        ts: now, dur: 700,
      }
      // Return any corner-parked dice to their home slots
      ctx.dice.forEach((d, i) => {
        if (!d.inCorner) return
        d.inCorner = false
        const { x, z } = slotPos(i)
        d.moveFrom.copy(d.mesh.position)
        d.moveTo.set(x, REST_Y, z)
        d.moveTs = now
        d.moveActive = true
      })
    }
  }

  // ── Move tween (discard / return) ────────────────────────────────────────────
  const MOV_DUR = 260
  dice.forEach(d => {
    if (!d.moveActive || d.phase !== 'idle') return
    const t = Math.min((now - d.moveTs) / MOV_DUR, 1)
    d.mesh.position.lerpVectors(d.moveFrom, d.moveTo, eio(t))
    if (t >= 1) { d.mesh.position.copy(d.moveTo); d.moveActive = false }
  })

  // ── Exit tween (discarded dice fade out before new roll) ─────────────────────
  const exiting = dice.filter(d => d.phase === 'exiting')
  exiting.forEach(d => {
    const dur = d.exitDur ?? 600
    const t = (now - d.exitTs) / dur
    const c = Math.min(t, 1)
    d.mesh.position.x = d.exitFrom.x
    d.mesh.position.y = d.exitFrom.y - c * c * 2
    d.mesh.position.z = d.exitFrom.z + c * 0.4
    d.mesh.material.forEach(mat => { mat.opacity = 1 - c })
    d.outline.material.transparent = true
    d.outline.material.opacity = 1 - c
    if (t >= 1) {
      d.mesh.visible = false
      d.mesh.material.forEach(mat => { mat.transparent = false; mat.opacity = 1.0 })
      d.outline.material.transparent = false
      d.outline.material.opacity = 1.0
      d.outline.material.color.set(0x000000)
      d.phase = 'hidden'
    }
  })
  if (ctx.onExitDone && exiting.length > 0 && exiting.every(d => d.phase === 'hidden')) {
    const cb = ctx.onExitDone
    ctx.onExitDone = null
    cb()
  }

  // ── Camera tween (zoom in/out) ────────────────────────────────────────────────
  if (ctx.camTween) {
    const t = Math.min((now - ctx.camTween.ts) / ctx.camTween.dur, 1)
    const te = eio(t)
    ctx.camCurPos.lerpVectors(ctx.camTween.fromPos, ctx.camTween.toPos, te)
    ctx.camCurLook.lerpVectors(ctx.camTween.fromLook, ctx.camTween.toLook, te)
    ctx.camera.position.copy(ctx.camCurPos)
    ctx.camera.lookAt(ctx.camCurLook)
    if (t >= 1) ctx.camTween = null
  }

}

function beginPlace(ctx, now) {
  ctx.dice.forEach((d, i) => {
    if (d.phase !== 'rolling') return
    // El valor ya lo fijó doRoll() a partir del resultado autoritativo del
    // servidor — el último keyframe ya deja el dado en esa cara, esto solo
    // recoloca al hueco de la rejilla (evita que aparezca "flotando" si el
    // último keyframe quedó ligeramente descuadrado).
    const { x, z } = slotPos(i)
    d.mesh.position.y = REST_Y
    d.fp.copy(d.mesh.position)
    d.tp.set(x, REST_Y, z)
    d.ts = now
    d.phase = 'placing'
  })
}

function rollWithSounds(ctx, values, rollingIndices, keyframes, frameIntervalMs) {
  ctx.rollId = (ctx.rollId ?? 0) + 1
  const myId = ctx.rollId
  ctx.camTween = {
    fromPos: ctx.camCurPos.clone(), fromLook: ctx.camCurLook.clone(),
    toPos: new THREE.Vector3(0, 7.5, 11.5), toLook: new THREE.Vector3(0, FY + 1.5, 0),
    ts: performance.now(), dur: 350,
  }

  const launchPhysics = () => {
    if (ctx.rollId !== myId) return
    doRoll(ctx, values, rollingIndices, keyframes, frameIntervalMs)
  }

  const playCubilete = () => {
    if (ctx.rollId !== myId) return
    const a = new Audio('/assets/cubilete.mp3')
    let done = false
    const go = () => { if (!done) { done = true; launchPhysics() } }
    const t = setTimeout(go, 4000)
    a.addEventListener('ended', () => { clearTimeout(t); go() }, { once: true })
    a.addEventListener('error', () => { clearTimeout(t); go() }, { once: true })
    a.play().catch(go)
  }

  const needExit = rollingIndices.filter(i => {
    const d = ctx.dice[i]
    return d && d.mesh.visible && (d.phase === 'idle' || d.moveActive)
  })

  // Kept dice: slide to a random top corner (left or right) while discarded dice exit
  const keptDice = [0,1,2,3,4].filter(i =>
    !rollingIndices.includes(i) &&
    ctx.dice[i].mesh.visible &&
    (ctx.dice[i].phase === 'idle' || ctx.dice[i].moveActive)
  )
  if (keptDice.length > 0 && needExit.length > 0) {
    const now = performance.now()
    // side: +1 = right wall, -1 = left wall. Random each roll.
    const side = Math.random() < 0.5 ? 1 : -1
    const anchorX = side * (WX - 0.8)   // ±3.4 — just inside the wall
    const cornerZ = -(WZ - 0.8)          // -2.6 — just inside the back wall
    keptDice.forEach((dieIdx, slot) => {
      const d = ctx.dice[dieIdx]
      // Expand dice away from the wall so they don't overlap
      const x = anchorX - side * slot * 1.65
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(x, REST_Y, cornerZ)
      d.moveTs = now
      d.moveActive = true
      d.inCorner = true
    })
  }

  if (needExit.length > 0) {
    _eliminarAudio.currentTime = 0
    _eliminarAudio.play().catch(() => {})
    const elimDur = (isFinite(_eliminarAudio.duration) && _eliminarAudio.duration > 0.05)
      ? _eliminarAudio.duration * 1000
      : 800

    const now = performance.now()
    needExit.forEach(i => {
      const d = ctx.dice[i]
      d.exitFrom.copy(d.mesh.position)
      d.exitTs = now
      d.exitDur = elimDur
      d.phase = 'exiting'
      d.moveActive = false
      d.mesh.material.forEach(mat => { mat.transparent = true })
    })
    ctx.onExitDone = playCubilete
    return
  }

  playCubilete()
}

