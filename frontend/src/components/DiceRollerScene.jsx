import { useEffect, useRef, useState } from 'react'
import socket from '../socket'
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
const VALUE_TO_FACE = Object.fromEntries(FACE_VALUES.map((v, i) => [v, i]))
const VALUE_RANK = { AS: 0, K: 1, Q: 2, J: 3, '8': 4, '7': 5 }

// Orientación "limpia" (cara hacia arriba, sin yaw arbitrario) por valor —
// a la que se hace snap al posar cada dado, en vez de dejarlo con el
// aterrizaje bruto de la física (que puede quedar plano pero girado en
// cualquier ángulo sobre el eje vertical, viéndose torcido/superpuesto en
// la rejilla). Ver beginPlace().
const FACE_UP_QUATS = (() => {
  const E = THREE.Euler
  const Q = THREE.Quaternion
  const rotY = deg => new Q().setFromEuler(new E(0, deg * Math.PI / 180, 0))
  // Alineación base: lleva cada cara a +Y mundo (sin garantía de que el
  // texto/pip quede legible desde la cámara — solo la cara correcta arriba).
  const base = [
    new Q().setFromEuler(new E(0, 0,  Math.PI / 2)),  // +X face (K)
    new Q().setFromEuler(new E(0, 0, -Math.PI / 2)),  // -X face (Q)
    new Q(),                                            // +Y face (AS)
    new Q().setFromEuler(new E(Math.PI, 0, 0)),        // -Y face (7)
    new Q().setFromEuler(new E(-Math.PI / 2, 0, 0)),  // +Z face (8)
    new Q().setFromEuler(new E( Math.PI / 2, 0, 0)),  // -Z face (J)
  ]
  // Corrección de roll (giro extra sobre el eje vertical mundo) para que el
  // texto quede derecho y legible — el mapeo de UV de RoundedBoxGeometry no
  // es simétrico entre caras opuestas, así que cada una necesitó verificarse
  // visualmente por separado (colocando el dado a mano y mirando el render).
  return [
    rotY(-90).multiply(base[0]), // K: -90° (sentido contrario al que se probó primero)
    rotY(90).multiply(base[1]),  // Q: +90°
    base[2],                     // AS: pip simétrico
    base[3],                     // 7: pip simétrico
    base[4],                     // 8: legible tal cual
    rotY(180).multiply(base[5]), // J: +180°
  ]
})()

const DIE    = 1.21 * 0.95 * 0.95 // -5% y otro -5% más (pedidos explícitos, 2026-09-17)

// Margen de seguridad (en px CSS) para el ajuste por SUELO completo (pose de
// espera) — a 0 llega justo al borde de la pantalla, tal y como se pidió.
const BOARD_MARGIN_X = 0
const BOARD_MARGIN_Y = 0
// Margen de seguridad para el ajuste por ANCHO de la fila de 3 dados
// asentados (pose de reposo) — se mantiene aparte para poder tocar uno sin
// afectar al otro.
const WIDTH_FIT_MARGIN_X = 16
// Límite "visible" del lado cercano a la cámara (Z positiva) para el ajuste
// por suelo completo — DELIBERADAMENTE menor que la pared física real (WZ),
// para que el punto de salida de los dados (ver launchParams en
// dicePhysics.js) quede fuera del área visible y entren en cuadro al volar
// hacia el fondo (pedido por el usuario, 2026-09-16).
const VISIBLE_NEAR_Z = 1.5

// FOV vertical de la cámara — nombrado para poder derivar de él el ángulo
// exacto del desplazamiento de encuadre de abajo.
const CAMERA_FOV = 38

// Ajuste de encuadre POR VISTA (herramienta de tuning, ver sliders al final
// del componente) — 'view1' = pose "floor" (dados recién lanzados/espera),
// 'view2' = pose "width" (dados recién asentados tras la 1ª tirada), 'view3'
// = pose "parking" (misma pose que view2 pero para la 2ª/3ª tirada, cuando
// hay dados guardados aparcados en la esquina — ver CORNER_X/CORNER_Z más
// abajo); cada una con sus propios 4 parámetros independientes:
//  - shiftPercent: desplazamiento vertical expresado como % EXACTO de la
//    altura visible en NDC (tan(ángulo)=shift%*tan(FOV/2)). Negativo=abajo.
//  - tiltDeg: inclinación adicional de la cámara en grados "en bruto" (no
//    normalizada por FOV) — rota el EJE de la cámara (pitch), no la posición.
//  - camY: desplaza la POSICIÓN de la cámara verticalmente (mundo, no NDC) —
//    a diferencia de tiltDeg, esto mueve la cámara de sitio en vez de girarla.
//  - zoomMultiplier: factor multiplicativo extra sobre el zoom ya calculado
//    por fitZoomToFloor/fitZoomToWidth (encima de sus ajustes ya acumulados).
// Valores fijados a mano con los sliders (2026-09-17) — por defecto si no
// hay nada guardado en localStorage/backoffice. view3 arranca como una copia
// de view2 con un poco menos de zoom (pedido explícitamente así), pendiente
// de afinar con la herramienta de tuning.
const TUNING_STORAGE_KEY = 'diceCameraTuning'
const TUNING_DEFAULTS = {
  view1: { shiftPercent: -0.13, tiltDeg: 1, camY: 5, zoomMultiplier: 1.22 },
  view2: { shiftPercent: -0.13, tiltDeg: 2, camY: 5, zoomMultiplier: 0.95 },
  view3: { shiftPercent: -0.13, tiltDeg: 2, camY: 5, zoomMultiplier: 0.85 },
}
function loadTuning() {
  try {
    const raw = localStorage.getItem(TUNING_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        view1: { ...TUNING_DEFAULTS.view1, ...(parsed.view1 ?? {}) },
        view2: { ...TUNING_DEFAULTS.view2, ...(parsed.view2 ?? {}) },
        view3: { ...TUNING_DEFAULTS.view3, ...(parsed.view3 ?? {}) },
      }
    }
  } catch { /* localStorage no disponible (SSR, privacidad, etc.) */ }
  return { view1: { ...TUNING_DEFAULTS.view1 }, view2: { ...TUNING_DEFAULTS.view2 }, view3: { ...TUNING_DEFAULTS.view3 } }
}
const tuning = loadTuning()

// Factor de zoom extra según el número de jugadores de la sala — pedido
// explícito, 2026-09-17: con más jugadores el marcador ocupa más alto (pese
// al tope+scroll de .scoreboard) y en la práctica el tablero se veía
// recortado en salas grandes (1vs3, 1vs7) aunque en 1vs1 se viera bien.
// Variable mutable de módulo (mismo patrón que `tuning`), actualizada desde
// el componente vía el prop `playerCount` — así fitZoomToFloor/fitZoomToWidth
// (funciones puras de módulo, no closures del componente) pueden leerla sin
// necesidad de pasarla como parámetro por todos los sitios que las llaman.
let playerCountZoomFactor = 1
function zoomFactorForPlayerCount(n) {
  if (!n || n <= 2) return 1
  // -4% de zoom por cada jugador por encima de 2, con un suelo en 0.6 para
  // no alejar en exceso en salas de hasta 10 jugadores.
  return Math.max(0.6, 1 - (n - 2) * 0.04)
}

// Traduce el 'zoomMode' de la cámara ('floor'|'width'|'parking') a la clave
// de tuning correspondiente ('view1'|'view2'|'view3') — mismo concepto, dos
// nombres distintos (uno describe la ESTRATEGIA de encuadre, el otro la
// VISTA de la herramienta de tuning que la usa). 'width' y 'parking' usan la
// misma estrategia de ajuste (fitZoomToWidth), solo cambia qué tuning leen.
const tuningForZoomMode = zoomMode => {
  if (zoomMode === 'parking') return tuning.view3
  if (zoomMode === 'width') return tuning.view2
  return tuning.view1
}

function shiftRadFromValues(shiftPercent, tiltDeg) {
  const fromPercent = Math.atan(
    shiftPercent * Math.tan((CAMERA_FOV / 2) * Math.PI / 180)
  )
  const fromTilt = (tiltDeg * Math.PI) / 180
  return fromPercent + fromTilt
}
function shiftRad(zoomMode) {
  const t = tuningForZoomMode(zoomMode)
  return shiftRadFromValues(t.shiftPercent, t.tiltDeg)
}
function lookAtShifted(camera, target, zoomMode) {
  camera.lookAt(target)
  camera.rotateX(shiftRad(zoomMode))
}
// Coloca la cámara en `pos` aplicando el offset vertical de camY de la vista
// correspondiente — usado en TODOS los sitios que fijan camera.position
// (incluidas las funciones de ajuste de zoom, para que midan desde la
// posición real).
function applyCamPosition(camera, pos, zoomMode) {
  camera.position.set(pos.x, pos.y + tuningForZoomMode(zoomMode).camY, pos.z)
}
// Aplica la pose de cámara DURANTE un tween interpolando también camY y
// shift/tilt entre el tuning de la vista de origen y la de destino (según
// el progreso `te`, 0..1) — antes se aplicaba directamente el tuning de la
// vista DESTINO desde el primer frame del tween, lo que producía un salto
// visible (parpadeo) al reorientar la cámara de golpe justo al empezar la
// transición, con la posición todavía casi en el punto de partida.
function applyCamTweenFrame(camera, pos, look, fromZoomMode, toZoomMode, te) {
  const fromT = tuningForZoomMode(fromZoomMode)
  const toT = tuningForZoomMode(toZoomMode)
  const camY = fromT.camY + (toT.camY - fromT.camY) * te
  const shiftPercent = fromT.shiftPercent + (toT.shiftPercent - fromT.shiftPercent) * te
  const tiltDeg = fromT.tiltDeg + (toT.tiltDeg - fromT.tiltDeg) * te
  camera.position.set(pos.x, pos.y + camY, pos.z)
  camera.lookAt(look)
  camera.rotateX(shiftRadFromValues(shiftPercent, tiltDeg))
}

// Calcula el zoom de cámara necesario para que el suelo (WX×WZ) llegue lo
// más cerca posible de los bordes del canvas (menos el margen de seguridad),
// para la pose de cámara dada (posición + punto de mira) y el tamaño actual
// del contenedor. Al ser una cámara en perspectiva y no cenital, el suelo se
// proyecta como un trapecio, no un rectángulo — se usa la esquina más
// ajustada (la que necesita más zoom hacia dentro) para no recortar ninguna,
// aceptando que las demás queden con algo más de margen del pedido.
function fitZoomToFloor(camera, camPos, camLook, mountW, mountH) {
  if (!mountW || !mountH) return 1
  const savedPos  = camera.position.clone()
  const savedQuat = camera.quaternion.clone()
  const savedZoom = camera.zoom
  applyCamPosition(camera, camPos, 'floor')
  lookAtShifted(camera, camLook, 'floor')
  camera.zoom = 1
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const corners = [
    new THREE.Vector3(-WX, FY, -WZ),
    new THREE.Vector3(WX, FY, -WZ),
    new THREE.Vector3(WX, FY, VISIBLE_NEAR_Z),
    new THREE.Vector3(-WX, FY, VISIBLE_NEAR_Z),
  ]
  const targetX = 1 - (2 * BOARD_MARGIN_X) / mountW
  const targetY = 1 - (2 * BOARD_MARGIN_Y) / mountH

  let zoom = Infinity
  corners.forEach(c => {
    const p = c.clone().project(camera)
    if (Math.abs(p.x) > 1e-6) zoom = Math.min(zoom, targetX / Math.abs(p.x))
    if (Math.abs(p.y) > 1e-6) zoom = Math.min(zoom, targetY / Math.abs(p.y))
  })
  // Ajustes pedidos por el usuario (2026-09-16), acumulados: +15% primero,
  // luego -20% sobre ese resultado — cubre tanto la vista de espera como el
  // momento justo antes/durante la tirada, que comparten esta misma pose de
  // cámara y función de encuadre.
  zoom *= 1.15 * 0.8 * tuning.view1.zoomMultiplier * playerCountZoomFactor

  camera.position.copy(savedPos)
  camera.quaternion.copy(savedQuat)
  camera.zoom = savedZoom
  camera.updateProjectionMatrix()
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

// Calcula el zoom para que un ancho concreto del mundo (en X, a una Z dada)
// ocupe el ancho del canvas menos el margen de seguridad — usado para la
// vista de dados ya asentados: la fila de 3 dados de delante debe ocupar
// el ancho de la pantalla, en vez de ajustar al suelo completo (que ahora
// es mucho más profundo que ancho y no es lo que se ve de cerca).
// Factor de ajuste fino sobre el zoom calculado por ancho — el usuario lo
// pidió un 10% menos "exagerado" (2026-09-16) que el ajuste exacto al ancho.
const SETTLE_ZOOM_FUDGE = 0.9

function fitZoomToWidth(camera, camPos, camLook, worldHalfWidth, worldZ, mountW, zoomMode = 'width') {
  if (!mountW) return 1
  const savedPos  = camera.position.clone()
  const savedQuat = camera.quaternion.clone()
  const savedZoom = camera.zoom
  applyCamPosition(camera, camPos, zoomMode)
  lookAtShifted(camera, camLook, zoomMode)
  camera.zoom = 1
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const left  = new THREE.Vector3(-worldHalfWidth, REST_Y, worldZ).project(camera)
  const right = new THREE.Vector3(worldHalfWidth, REST_Y, worldZ).project(camera)
  const targetX = 1 - (2 * WIDTH_FIT_MARGIN_X) / mountW
  const halfNdc = Math.max(Math.abs(left.x), Math.abs(right.x))
  const zoom = (halfNdc > 1e-6 ? targetX / halfNdc : 1) * SETTLE_ZOOM_FUDGE * tuningForZoomMode(zoomMode).zoomMultiplier * playerCountZoomFactor

  camera.position.copy(savedPos)
  camera.quaternion.copy(savedQuat)
  camera.zoom = savedZoom
  camera.updateProjectionMatrix()
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

const FY     = -2.5   // floor Y
// Tablero alargado (2026-09-16 v2, ver backend/game/dicePhysics.js — deben
// coincidir) para que el suelo llene el canvas en contenedores altos y
// estrechos (más profundo que ancho, no solo "más grande en general").
const WX     = 4.3    // wall half-extent X
const WZ     = 7.5    // wall half-extent Z
// Punto de mira de la pose "suelo completo": ya no es el centro del suelo
// físico (Z=0) sino el centro de la zona REALMENTE visible (-WZ..VISIBLE_NEAR_Z),
// para que el recuadro quede centrado en el canvas en vez de desplazado hacia
// el fondo (pedido por el usuario, 2026-09-16).
const FLOOR_LOOK_Z = (VISIBLE_NEAR_Z - WZ) / 2
// Poses de cámara más cenitales (2026-09-16 v2) para que el suelo, ahora
// más profundo que ancho, se proyecte con menos trapecio y aproveche mejor
// contenedores altos y estrechos — antes CAM_FAR_POS=(0,11,16.3) y
// CAM_SETTLE_POS=(0,9.2,4.7) (ángulo mucho más tumbado/cinematográfico).
const CAM_FAR_POS    = { y: 22, z: 8.5 } // esperando / justo antes de tirar
const CAM_SETTLE_POS = { y: 15, z: 5.8 } // dados asentados / resultados
// Punto de partida de la transición de entrada al empezar el turno de un
// jugador — mismo ángulo que CAM_FAR_POS pero mucho más lejos, para que la
// cámara "llegue desde lejos" hasta la vista 1 en vez de aparecer ya ahí
// (pedido explícito, 2026-09-17).
const CAM_ESTABLISHING_POS = { y: CAM_FAR_POS.y * 1.8, z: CAM_FAR_POS.z * 1.8 }
// Duración a la que se "acelera" una transición ligada a un contador cuando
// la acción real de ese contador ocurre antes de tiempo (botón pulsado) —
// pedido explícito, 2026-09-17.
const TWEEN_ACCELERATE_MS = 2000

// Si hay una transición "de contador" (ver startEstablishingTween) en
// marcha, la acorta para que termine dentro de TWEEN_ACCELERATE_MS a partir
// de ahora — salvo que ya le quedase MENOS de eso, en cuyo caso se deja tal
// cual (no tiene sentido alargarla). Como solo se toca `dur` (no
// fromPos/toPos), el camino que sigue la cámara no cambia — solo se recorre
// más rápido, sin saltos. Devuelve true si había una transición que acelerar.
function accelerateEstablishingTween(ctx, now) {
  const tw = ctx.camTween
  if (!tw || !tw.isEstablishing) return false
  const elapsed = now - tw.ts
  if (elapsed >= tw.dur) return false // ya ha terminado
  if (tw.dur - elapsed > TWEEN_ACCELERATE_MS) tw.dur = elapsed + TWEEN_ACCELERATE_MS
  return true
}

// Arranca la transición de entrada "desde lejos" hacia la vista 1, con una
// duración repartida a lo largo de lo que quede de `deadline` (un
// Date.now()-timestamp, típicamente room.turnDeadline) en vez de un tween
// corto fijo — pedido explícito, 2026-09-17, generalizado a CUALQUIER
// momento en el que haya un contador de tiempo visible asociado (empezar a
// tirar por primera vez, o tener que pasar turno porque ya no quedan
// tiradas — ambos casos comparten el mismo `room.turnDeadline`).
//
// Si YA hay una de estas transiciones en marcha (p.ej. la del turno que
// acaba de terminar, todavía acercándose a la vista 1) no se sustituye por
// una nueva desde CAM_ESTABLISHING_POS (eso se vería como un salto hacia
// atrás) — simplemente se acelera (ver accelerateEstablishingTween) para
// que llegue a la MISMA vista 1 mucho antes, continuando desde donde esté.
function startEstablishingTween(ctx, deadline, fallbackMs) {
  const now = performance.now()
  if (accelerateEstablishingTween(ctx, now)) return
  const remaining = deadline ? deadline - Date.now() : fallbackMs
  if (remaining <= 0) return
  const toPos = new THREE.Vector3(0, CAM_FAR_POS.y, CAM_FAR_POS.z)
  const toLook = new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z)
  const fromPos = new THREE.Vector3(0, CAM_ESTABLISHING_POS.y, CAM_ESTABLISHING_POS.z)
  ctx.camTween = {
    fromPos, fromLook: toLook.clone(), fromZoomMode: ctx.camZoomMode,
    toPos, toLook, ts: now, dur: remaining, zoomMode: 'floor',
    fromZoom: fitZoomToFloor(ctx.camera, fromPos, toLook, ctx.mountW, ctx.mountH),
    toZoom: fitZoomToFloor(ctx.camera, toPos, toLook, ctx.mountW, ctx.mountH),
    isEstablishing: true,
  }
}

// Vista 3 → vista 2 al agotar las tiradas del turno, con los dados
// reagrupados (ver el efecto `readyToPass` más abajo) — a diferencia de
// startEstablishingTween, parte de la posición ACTUAL de cámara (no "desde
// lejos") porque ya se estaba viendo la vista 3, y el destino es la vista 2
// en vez de la 1. La duración también se reparte a lo largo de lo que quede
// de `deadline` — pedido explícito, 2026-09-17.
function startRegroupTween(ctx, deadline, fallbackMs) {
  const now = performance.now()
  const remaining = deadline ? deadline - Date.now() : fallbackMs
  if (remaining <= 0) return
  const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
  const toLook = new THREE.Vector3(0, FY + 1.5, 0)
  const fromState = tweenFromState(ctx)
  ctx.camTween = {
    fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
    toPos, toLook, ts: now, dur: remaining, zoomMode: 'width',
    fromZoom: ctx.camCurZoom,
    toZoom: fitZoomToWidth(ctx.camera, toPos, toLook, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, ctx.mountW, 'width'),
  }
}

// +0.06 en vez de +0.02 (2026-09-17): los dados en reposo se veían algo
// hundidos en el suelo y las sombras no se proyectaban bien — más aire
// entre la base del dado y el plano del suelo.
const REST_Y   = FY + DIE / 2 + 0.06
// Separación de los dados al juntarse: la misma que "ayer" (antes del
// tablero agrandado de hoy) — el ajuste de encuadre ya no depende de esto,
// así que no hacía falta tocarlo.
const SLOT_SPACING = 1.78
const ROW_BACK_Z  = -1.4   // 2 dice — back row (top in camera view)
const ROW_FRONT_Z =  0.6   // 3 dice — front row (bottom in camera view)
const DISCARD_Z   =  2.2   // discard zone (furthest forward)
// Medio-ancho de la fila de 3 dados de delante (centro del dado más lejano
// + medio dado) — es el ancho al que se ajusta el zoom cuando los dados se
// asientan (ver fitZoomToWidth).
const FRONT_ROW_HALF_WIDTH = SLOT_SPACING + DIE / 2

// Radio (en unidades de mundo) para redondear las esquinas de la TEXTURA
// del suelo — pedido explícito, 2026-09-17, sustituyendo el recorte previo
// del canvas entero por esto: en vez de recortar toda la vista, solo el
// propio plano del suelo tiene las esquinas redondeadas. 0.4 es una
// aproximación (no hay una conversión exacta de "24px de canvas" a
// unidades de mundo sobre un plano 3D en perspectiva, que además cambia de
// tamaño en pantalla según el zoom) — ajustar si se ve muy sutil o excesivo.
const FLOOR_CORNER_RADIUS = 1.6 // subido de 0.4→0.8→1.6 (pedidos explícitos, 2026-09-17)
// Dibuja la imagen ya cargada en un <canvas> 2D recortado con un trazado de
// rectángulo redondeado (Canvas2D `clip()`) y devuelve una CanvasTexture —
// las esquinas fuera del recorte quedan con alpha=0 de verdad en la propia
// textura. Se probó antes inyectando un discard por SDF en el fragment
// shader del material vía onBeforeCompile, pero rompió el renderizado del
// suelo (dejó de verse la textura del todo) — este método, al no tocar el
// shader del material para nada, es mucho más robusto.
function makeRoundedFloorTexture(image, planeWidth, planeDepth, radius) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const ctx2d = canvas.getContext('2d')
  // Radio en unidades de mundo → fracción de cada eje por separado, para que
  // salga circular de verdad aunque el suelo no sea cuadrado (WX*2≠WZ*2) y
  // la imagen tampoco lo sea.
  const rx = (radius / planeWidth) * canvas.width
  const ry = (radius / planeDepth) * canvas.height
  const r = Math.min(rx, ry, canvas.width / 2, canvas.height / 2)
  const w = canvas.width, h = canvas.height
  ctx2d.beginPath()
  ctx2d.moveTo(r, 0)
  ctx2d.arcTo(w, 0, w, h, r)
  ctx2d.arcTo(w, h, 0, h, r)
  ctx2d.arcTo(0, h, 0, 0, r)
  ctx2d.arcTo(0, 0, w, 0, r)
  ctx2d.closePath()
  ctx2d.clip()
  ctx2d.drawImage(image, 0, 0, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// Esquina segura (superior-izquierda) donde se aparcan los dados guardados
// mientras se relanza el resto — fila horizontal, dados ordenados de
// izquierda a derecha por índice (slot 0 = más a la izquierda). Reintroducido
// (2026-09-17) tras un vaivén: esta vez el aparcado se dispara al confirmar
// la tirada (no antes) y usa la pose "parking" (ver 'view3' de tuning) en
// vez de reencuadrar a la vista de suelo completo.
const CORNER_X = -WX + 1.0
// +1.15 en vez de +1.0 (2026-09-17): el usuario reportó los dados aparcados
// ~16px más cerca de la cámara de lo que deberían — empujados un poco más
// hacia el fondo. Es una corrección aproximada (no hay una conversión
// exacta de px de pantalla a unidades de mundo sin fijar zoom/pose), a
// falta de que el usuario confirme visualmente si hace falta más o menos.
const CORNER_Z = -WZ + 1.15
const CORNER_SLOT_SPACING = 1.4
// Los dados encogen un 15% al aparcarse (pedido explícito) — vuelven a su
// tamaño normal en cuanto salen del parking (descartados o turno nuevo).
const PARKING_SCALE = 0.85
function cornerSlotPos(slot) {
  return { x: CORNER_X + slot * CORNER_SLOT_SPACING, z: CORNER_Z }
}

// Elige la estrategia de ajuste correcta según el modo de la pose actual
// ('width'/'parking' = fila de 3 dados asentados, con distinto tuning cada
// una, 'floor' = suelo completo) — usado por las correcciones genéricas
// (montaje, ResizeObserver, doble rAF) que no saben de antemano qué pose
// está activa.
function refitZoom(camera, pos, look, mode, mountW, mountH) {
  return mode === 'floor'
    ? fitZoomToFloor(camera, pos, look, mountW, mountH)
    : fitZoomToWidth(camera, pos, look, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, mountW, mode)
}

// Dice 0,1 → back row (2 dice centered); 2,3,4 → front row (3 dice)
function slotPos(i) {
  if (i < 2) return { x: (i - 0.5) * SLOT_SPACING, z: ROW_BACK_Z }
  return { x: (i - 3) * SLOT_SPACING, z: ROW_FRONT_Z }
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

// Paleta usada para el bloqueo de un powerup — mismos colores con -50% de
// saturación y -15% de brillo (calculado sobre cada color de BASE_COLORS),
// para que la cara del dado se vea "apagada" sin necesidad de un shader.
const BASE_COLORS = {
  bg:            '#EDE5D2',
  redDeep:       '#6A0000',
  redMain:       '#C02010',
  blackDeep:     '#0A0500',
  blackMain:     '#1E0F00',
  redTexturedPip:  '#ff9999',
  whiteTextured: '#ffffff',
  redTexturedTxt:  '#ffaaaa',
}
const BLOCKED_COLORS = {
  bg:            '#c8bfaa',
  redDeep:       '#160707',
  redMain:       '#5e2b26',
  blackDeep:     '#000000',
  blackMain:     '#000000',
  redTexturedPip:  '#d27979',
  whiteTextured: '#d9d9d9',
  redTexturedTxt:  '#d78686',
}
const highlightRgba = blocked =>
  blocked ? 'rgba(192,95,66,0.18)' : 'rgba(255,120,80,0.18)'
const highlightRgbaBlack = blocked =>
  blocked ? 'rgba(135,107,58,0.15)' : 'rgba(230,160,40,0.15)'

function drawPip(ctx, cx, cy, r, isRed, textured = false, blocked = false) {
  const C = blocked ? BLOCKED_COLORS : BASE_COLORS
  if (textured) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = isRed ? C.redTexturedPip : C.whiteTextured
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
    return
  }
  ctx.fillStyle = isRed ? C.redDeep : C.blackDeep
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = isRed ? C.redMain : C.blackMain
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = isRed ? highlightRgba(blocked) : highlightRgbaBlack(blocked)
  ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.32, r * 0.48, 0, Math.PI * 2); ctx.fill()
}

function makeTex(value, bgImg = null, bgColor = null, blocked = false) {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')
  const C = blocked ? BLOCKED_COLORS : BASE_COLORS

  const textured = bgImg !== null || bgColor !== null
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, S, S)
    ctx.fillStyle = blocked ? 'rgba(10,10,10,0.35)' : 'rgba(10,20,40,0.12)'
    ctx.fillRect(0, 0, S, S)
  } else if (bgColor) {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, S, S)
  } else {
    // Amber base — fills full canvas so rounded-box corners blend
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, S, S)
  }

  const isRed = RED_FACES.has(value)

  if (value in PIP) {
    const pr = S * 0.086, m = S * 0.215, st = (S - m * 2) / 2
    PIP[value].forEach((on, i) => {
      if (!on) return
      let cx = m + (i % 3) * st
      if (value === '8' && Math.floor(i / 3) === 1) cx -= st / 2
      drawPip(ctx, cx, m + Math.floor(i / 3) * st, pr, isRed, textured, blocked)
    })
  } else {
    const label = value === 'AS' ? 'A' : value
    ctx.font = `900 ${S * 0.56}px Georgia,serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    if (textured) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 10
      ctx.fillStyle = isRed ? C.redTexturedTxt : C.whiteTextured
      ctx.fillText(label, S / 2, S / 2)
      ctx.shadowBlur = 0
    } else {
      ctx.fillStyle = isRed ? C.redDeep : C.blackDeep
      ctx.fillText(label, S / 2 + 2, S / 2 + 3)
      ctx.fillStyle = isRed ? C.redMain : C.blackMain
      ctx.fillText(label, S / 2, S / 2)
    }
  }
  return new THREE.CanvasTexture(cv)
}

const _toonGrad = makeToonGradient()

function buildMats(skinId = null, blocked = false) {
  const colorCfg = skinId ? _skinColors[skinId] : null
  if (colorCfg) {
    return FACE_VALUES.map(v => {
      const mat = new THREE.MeshToonMaterial({ map: makeTex(v, null, colorCfg.bg, blocked), gradientMap: _toonGrad })
      mat.transparent = true
      mat.opacity = colorCfg.opacity
      return mat
    })
  }
  const img = skinId ? _skinImgs[skinId] : null
  const bgImg = img?.complete && img.naturalWidth > 0 ? img : null
  return FACE_VALUES.map(v => new THREE.MeshToonMaterial({ map: makeTex(v, bgImg, null, blocked), gradientMap: _toonGrad }))
}

const eio = t => t < .5 ? 2*t*t : -1+(4-2*t)*t
// Ease-out (empieza rápido, decelera hasta el final) — pedido explícito para
// la transición vista 2 → vista 3, 2026-09-17 (el resto de tweens de cámara
// se quedan con el ease-in-out de siempre, `eio`, salvo que se etiqueten con
// `camTween.easing = 'easeOut'`).
const easeOut = t => t * (2 - t)
// Todas las transiciones de cámara (camTween.dur) se multiplican por esto —
// pedido explícito, 2026-09-17: animaciones un 75% más lentas, manteniendo
// el ease-in-out ya existente (eio, arriba).
const CAM_TWEEN_SLOWDOWN = 1.75
const _q0 = new THREE.Quaternion()
const _q1 = new THREE.Quaternion()
const _swayPos = new THREE.Vector3()
const _swayLook = new THREE.Vector3()

// Offset del balanceo sutil de cámara en reposo, en un instante `now` dado
// — función pura para poder llamarla tanto desde el bucle de render como
// desde cualquier sitio que arranque un tween nuevo (ver `tweenFromState`),
// así el punto de partida de la transición coincide EXACTO con lo que se
// está viendo en pantalla en ese momento y no hay salto.
function swayOffset(now) {
  const st = now * 0.001
  return {
    posX: Math.sin(st * 0.6) * 0.035,
    posY: Math.sin(st * 0.45 + 1.3) * 0.02,
    lookX: Math.sin(st * 0.5 + 2.1) * 0.05,
  }
}
// Punto de partida "lógico" (sin balanceo) para un tween nuevo. El balanceo
// (swayOffset) ya NO se decide aquí — se aplica de forma CONTINUA en cada
// frame dentro de step(), tanto en reposo como durante cualquier tween (ver
// más abajo), así que nunca hay un instante en el que "se active/desactive"
// de golpe. La primera versión de esto (2026-09-16) solo lo sumaba en
// reposo, así que se notaba un salto igual al EMPEZAR una transición
// (arrancaba sin balanceo) y otro al TERMINARLA (el balanceo aparecía de
// golpe) — reportado por el usuario, 2026-09-17.
function tweenFromState(ctx) {
  return { pos: ctx.camCurPos.clone(), look: ctx.camCurLook.clone() }
}

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
  values, rollingIndices, pendingDiscards = [], blockedDice = [],
  interactive, onDieClick, onSettled, keyframes, frameIntervalMs = 50, rollId, sorted = false,
  skin = undefined, playerCount = 2, mustPass = false, turnDeadline = null, continueDeadline = null,
  awaitingContinue = false,
}) {
  const mountRef = useRef(null)
  const ctxRef   = useRef(null)
  const propsRef = useRef({})
  propsRef.current = { values, rollingIndices, pendingDiscards, interactive, onDieClick, onSettled, skin }

  // ── Sliders de tuning en vivo (siempre editan la vista activa, viewMode) ─────
  const [shiftPercent, setShiftPercent] = useState(() => Math.round(tuning.view1.shiftPercent * 100))
  const [tiltDeg, setTiltDeg] = useState(() => tuning.view1.tiltDeg)
  const [camY, setCamY] = useState(() => tuning.view1.camY)
  const [zoomPercent, setZoomPercent] = useState(() => Math.round(tuning.view1.zoomMultiplier * 100))
  const [tuningSavedSlot, setTuningSavedSlot] = useState(null) // null | 'view1' | 'view2'
  const [controlsHidden, setControlsHidden] = useState(false)
  // 'view1' (dados recién lanzados, pose de cámara "floor") | 'view2' (dados
  // agrupados listos para seleccionar, pose "width") | null hasta que se
  // resuelve el flag remoto y se entra en la vista por defecto.
  const [viewMode, setViewMode] = useState(null)
  // Controlado en exclusiva por el backoffice (Ajustes → Modo tuning de
  // cámara del tablero de dados) — deliberadamente NO se activa solo por
  // estar en dev: mientras está activo se congela el turno real (ver
  // GameBoard.jsx, tuningModeActive), así que debe depender de un único
  // interruptor explícito y no de en qué entorno corre el build.
  const [tuningEnabledRemotely, setTuningEnabledRemotely] = useState(false)
  // Última tuning guardada en el backend para cada vista — se usa como
  // respaldo al cambiar de vista si este dispositivo no tiene nada en su
  // propio localStorage (p.ej. la primera vez que se abre en un móvil).
  const [remoteTuning, setRemoteTuning] = useState({ view1: null, view2: null, view3: null })
  // Textura de suelo activa (elegida en el backoffice, Ajustes → Texturas
  // del suelo del tablero) — null = sin textura, el suelo se queda invisible
  // (solo sombra) como hasta ahora.
  const [activeFloorTexture, setActiveFloorTexture] = useState(null)
  useEffect(() => {
    socket.emit('get_settings', res => {
      if (!res?.ok) return
      setTuningEnabledRemotely(res.settings?.featureFlags?.diceCameraTuning === true)
      const remote = res.settings?.diceCameraTuning ?? { view1: null, view2: null, view3: null }
      setRemoteTuning(remote)
      // La tuning guardada desde el backoffice debe ser la real para
      // CUALQUIER dispositivo/jugador, no solo un respaldo dentro de la
      // propia herramienta de tuning — antes `remoteTuning` solo se
      // consultaba en `switchToView` (herramienta de tuning), así que un
      // móvil que nunca abrió esa herramienta seguía usando siempre
      // TUNING_DEFAULTS/su localStorage local, sin enterarse nunca de lo
      // guardado por otro dispositivo (bug reportado 2026-09-18). Si este
      // dispositivo ya tiene un ajuste propio sin sincronizar en
      // localStorage (p.ej. mientras se está tuneando en directo aquí
      // mismo), se respeta y no se pisa con lo del backend.
      ;['view1', 'view2', 'view3'].forEach(view => {
        if (!remote[view]) return
        let hasLocalOverride = false
        try { hasLocalOverride = !!localStorage.getItem(`${TUNING_STORAGE_KEY}_${view}`) } catch { /* localStorage no disponible */ }
        if (hasLocalOverride) return
        tuning[view] = { ...tuning[view], ...remote[view] }
      })
      reapplyLiveTuning()
      setActiveFloorTexture(res.settings?.activeFloorTexture ?? null)
    })
  }, [])
  const showTuningControls = tuningEnabledRemotely

  // Actualiza el factor de zoom por nº de jugadores y reencuadra de
  // inmediato con la pose actual (objetivo del tween en marcha, o la pose
  // en reposo si no hay ninguno) — sin este refit explícito, el nuevo
  // factor no se notaría hasta la siguiente tirada/transición.
  useEffect(() => {
    playerCountZoomFactor = zoomFactorForPlayerCount(playerCount)
    const c = ctxRef.current
    if (!c || !c.camera) return
    const target = c.camTween
      ? { pos: c.camTween.toPos, look: c.camTween.toLook, mode: c.camTween.zoomMode }
      : { pos: c.camCurPos, look: c.camCurLook, mode: c.camZoomMode }
    const zoom = refitZoom(c.camera, target.pos, target.look, target.mode, c.mountW, c.mountH)
    if (c.camTween) c.camTween.toZoom = zoom
    else { c.camCurZoom = zoom; c.camera.zoom = zoom; c.camera.updateProjectionMatrix() }
  }, [playerCount])

  // Cuando el jugador ya no puede tirar más y solo le queda pasar turno
  // (botón "Pasar al siguiente jugador", cuenta atrás de 30s ligada a
  // room.turnDeadline): los dados aparcados se reagrupan (dejan de estar
  // "en corner", vuelven a tamaño normal) y la cámara pasa de la vista 3 a
  // la vista 2, con una duración repartida a lo largo de TODO el tiempo que
  // queda de esa cuenta atrás — pedido explícito, 2026-09-17. El paso final
  // a la vista 1 (al pulsar el botón, o al expirar el contador) es una
  // transición aparte, con ease-out y 2000ms fijos — ver el efecto de
  // `mustPass` justo debajo.
  //
  // OJO: `mustPass` se pone a true en cuanto el servidor procesa la última
  // tirada (rollCount llega al máximo), que es ANTES de que esa tirada
  // termine de animarse — si el efecto dependiera solo de `mustPass`,
  // arrancaba el tween largo mientras los dados todavía estaban cayendo, y
  // los tweens del propio lanzamiento/asentado (rollWithSounds, el bloque
  // `if (done)`) lo pisaban a los pocos frames, por eso no se veía durar
  // los 30s. Se añade `rollingIndices.length === 0` para esperar a que esa
  // última tirada haya asentado del todo antes de arrancarlo.
  const readyToPass = mustPass && rollingIndices.length === 0
  useEffect(() => {
    if (!readyToPass) return
    const ctx = ctxRef.current
    if (!ctx || !ctx.camera) return
    const now = performance.now()
    // Los dados recién asentados (los de la última tirada) ya ocupan los
    // slots COMPACTOS 0..N-1 de slotPos (ver beginPlace: se colocan por
    // orden de valor entre solo los que rodaban, sin huecos, no por su
    // índice fijo 0-4). Si al desaparcar los guardados los devolviéramos a
    // slotPos(i) según su índice propio, pisarían esos mismos slots
    // compactos y algunos dados quedaban solapados/ocultos ("perdidos") —
    // bug reportado 2026-09-17. Corregido recalculando el slot de TODOS los
    // dados en juego (aparcados + recién asentados) a la vez, ordenados por
    // valor (As→7, agrupando iguales), igual que hace el efecto `sorted`.
    const grouped = [0, 1, 2, 3, 4]
      .filter(i => ctx.dice[i].phase === 'idle')
      .sort((a, b) => (VALUE_RANK[ctx.dice[a].value] ?? 99) - (VALUE_RANK[ctx.dice[b].value] ?? 99))
    grouped.forEach((dieIdx, slot) => {
      const d = ctx.dice[dieIdx]
      const { x, z } = slotPos(slot)
      d.inCorner = false
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(x, REST_Y, z)
      d.scaleFrom = d.mesh.scale.x
      d.scaleTo = 1
      d.moveTs = now
      d.moveActive = true
    })
    startRegroupTween(ctx, turnDeadline, 30_000)
  }, [readyToPass])

  // Botón "Continuar" de la pausa "esperando al siguiente jugador"
  // (AnimacionNextPlayer, room.awaitingContinue) — a diferencia de tirar o
  // pasar turno, pulsar este botón NO cambia `values` (sigue null hasta que
  // se tire), así que la transición "desde lejos" que arrancó al entrar en
  // esta pausa (ver el efecto de `values → null`) no se acelera sola. Se
  // detecta aquí, en cuanto `awaitingContinue` pasa a false (por clic o por
  // expirar su propio contador de 30s — en ese caso es un no-op, la
  // transición ya habrá terminado sola).
  useEffect(() => {
    if (awaitingContinue) return
    const ctx = ctxRef.current
    if (!ctx || !ctx.camera) return
    accelerateEstablishingTween(ctx, performance.now())
  }, [awaitingContinue])

  // Aplica (o quita) la textura de suelo activa sobre ctx.floor en cuanto se
  // conoce — antes de esto el suelo se crea con ShadowMaterial (invisible,
  // solo sombra) como material de partida.
  useEffect(() => {
    const c = ctxRef.current
    if (!c || !c.floor) return
    if (!activeFloorTexture) {
      if (c.floor.material.map) {
        c.floor.material.dispose()
        c.floor.material = new THREE.ShadowMaterial({ opacity: 0.25 })
      }
      return
    }
    let cancelled = false
    const loader = new THREE.ImageLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(activeFloorTexture, image => {
      if (cancelled) return
      const tex = makeRoundedFloorTexture(image, WX * 2, WZ * 2, FLOOR_CORNER_RADIUS)
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, transparent: true })
      c.floor.material.dispose()
      c.floor.material = mat
    })
    return () => { cancelled = true }
  }, [activeFloorTexture])
  // La línea guía discontinua (límites del tablero) solo se ve en modo
  // tuning — se crea oculta en el montaje y se sincroniza aquí.
  useEffect(() => {
    if (ctxRef.current?.boundaryLine) ctxRef.current.boundaryLine.visible = showTuningControls
  }, [showTuningControls])

  // Guarda los 4 valores actuales para la vista dada (view1/view2):
  // localStorage (para que este dispositivo recuerde esa vista al recargar)
  // y, vía socket, en el backend — así queda visible/copiable desde el
  // backoffice (Ajustes → Modo tuning de cámara del tablero de dados) en vez
  // de vivir solo en la consola de este navegador.
  const savePosition = view => {
    const values = { ...tuning[view] }
    try {
      localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning))
      localStorage.setItem(`${TUNING_STORAGE_KEY}_${view}`, JSON.stringify(values))
    } catch { /* localStorage no disponible */ }
    console.log(`[dice-tuning] guardado ${view}`, values)
    socket.emit('save_dice_camera_tuning', { slot: view, values }, res => {
      if (!res?.ok) console.warn('[dice-tuning] no se pudo guardar en el backoffice:', res?.error)
    })
    setTuningSavedSlot(view)
    setTimeout(() => setTuningSavedSlot(null), 1500)
  }

  const reapplyLiveTuning = () => {
    const c = ctxRef.current
    if (!c || !c.camera) return
    const tw = c.camTween
    const pos  = tw ? tw.toPos  : c.camCurPos
    const look = tw ? tw.toLook : c.camCurLook
    const mode = tw ? tw.zoomMode : c.camZoomMode
    applyCamPosition(c.camera, pos, mode)
    lookAtShifted(c.camera, look, mode)
    const zoom = refitZoom(c.camera, pos, look, mode, c.mountW, c.mountH)
    c.camera.zoom = zoom
    c.camera.updateProjectionMatrix()
    if (tw) tw.toZoom = zoom
    else c.camCurZoom = zoom
  }

  // Cambia a la vista dada: coloca cámara+dados en la pose fija de esa
  // vista (sin animación — es una herramienta de tuning, no una tirada real)
  // y carga la tuning guardada para ella, si la hay.
  const switchToView = view => {
    setViewMode(view)
    let saved = null
    try {
      const raw = localStorage.getItem(`${TUNING_STORAGE_KEY}_${view}`)
      if (raw) saved = JSON.parse(raw)
    } catch { /* localStorage no disponible */ }
    if (!saved) saved = remoteTuning[view]
    if (saved) tuning[view] = { ...tuning[view], ...saved }
    setShiftPercent(Math.round(tuning[view].shiftPercent * 100))
    setTiltDeg(tuning[view].tiltDeg)
    setCamY(tuning[view].camY)
    setZoomPercent(Math.round(tuning[view].zoomMultiplier * 100))

    const c = ctxRef.current
    if (!c || !c.camera) return
    // Pose fija de la vista: view1 = "floor" (dados recién lanzados,
    // esparcidos al azar); view2/view3 comparten posición y mira ("width" /
    // dados agrupados) y solo difieren en el tuning (zoomMode 'width' vs
    // 'parking') — view3 además muestra 2 dados aparcados en la esquina para
    // previsualizar ese escenario.
    const pos  = view === 'view1' ? new THREE.Vector3(0, CAM_FAR_POS.y, CAM_FAR_POS.z)
                                   : new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
    const look = view === 'view1' ? new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z)
                                   : new THREE.Vector3(0, FY + 1.5, 0)
    const mode = view === 'view1' ? 'floor' : view === 'view3' ? 'parking' : 'width'
    // Transición fluida directa desde la pose actual (sea cual sea) hasta la
    // nueva vista — nunca "pasa" por ninguna otra pose intermedia, igual que
    // el resto de tweens de cámara del juego (pedido explícito, 2026-09-17).
    const toZoom = refitZoom(c.camera, pos, look, mode, c.mountW, c.mountH)
    const nowTs = performance.now()
    const fromState = tweenFromState(c, nowTs)
    c.camTween = {
      fromPos: fromState.pos, fromLook: fromState.look, fromZoom: c.camCurZoom,
      fromZoomMode: c.camZoomMode,
      toPos: pos, toLook: look, toZoom, zoomMode: mode, ts: nowTs, dur: 600 * CAM_TWEEN_SLOWDOWN,
    }

    // Coloca los 5 dados: esparcidos al azar (view1), agrupados en su
    // disposición normal (view2), o 2 aparcados en la esquina + 3 en su
    // disposición normal (view3, previsualiza la 2ª/3ª tirada con dados
    // guardados) — solo visual, no hay física real detrás, así que no hace
    // falta el banco de semillas para esto.
    const margin = DIE
    c.dice.forEach((d, i) => {
      let x, z
      d.inCorner = false
      if (view === 'view1') {
        x = (Math.random() * 2 - 1) * (WX - margin)
        z = -WZ + margin + Math.random() * (VISIBLE_NEAR_Z - (-WZ + margin) - margin)
      } else if (view === 'view3' && i < 2) {
        ;({ x, z } = cornerSlotPos(i))
        d.inCorner = true
      } else {
        ;({ x, z } = slotPos(i))
      }
      d.value = FACE_VALUES[i % FACE_VALUES.length]
      d.mesh.position.set(x, REST_Y, z)
      d.mesh.quaternion.copy(FACE_UP_QUATS[i % FACE_UP_QUATS.length])
      d.mesh.scale.setScalar(d.inCorner ? PARKING_SCALE : 1)
      d.scaleFrom = d.scaleTo = d.inCorner ? PARKING_SCALE : 1
      d.mesh.visible = true
      d.phase = 'idle'
      d.moveActive = false
      if (d.isBlocked) { d.isBlocked = false; d.mesh.material = d.matsNormal }
      d.outline.material.color.set(0x000000)
      d.outline.material.transparent = false
      d.outline.material.opacity = 1.0
    })
  }

  // En cuanto el backoffice activa el modo, entra directamente en Vista 1.
  useEffect(() => {
    if (showTuningControls && !viewMode) switchToView('view1')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTuningControls])

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
    // FOV reducido (52°→38°) y cámara más alejada (mismo encuadre, misma
    // dirección de vista) para que la textura de la cara superior de los
    // dados no se lea deformada por la perspectiva cuando están lejos del
    // centro (p.ej. una Q pareciendo una O) — ver vistas "settled"/"wide"
    // más abajo, escaladas con el mismo factor.
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, W / H, 0.1, 100)
    const initialCamPos = new THREE.Vector3(0, CAM_FAR_POS.y, CAM_FAR_POS.z)
    const initialLook = new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z)
    applyCamPosition(camera, initialCamPos, 'floor')
    lookAtShifted(camera, initialLook, 'floor')
    const initialZoom = fitZoomToFloor(camera, initialCamPos, initialLook, W, H)
    camera.zoom = initialZoom
    camera.updateProjectionMatrix()

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
        // ctxRef.current puede no existir aún la primerísima vez que se
        // dispara el observer (antes de crear ctx más abajo) — se ignora,
        // el tamaño inicial ya se usa al construir ctx.
        const c = ctxRef.current
        if (c) {
          c.mountW = rW
          c.mountH = rH
          // Reencuadra con el zoom correcto para el nuevo tamaño (p.ej. al
          // rotar el dispositivo), tanto si hay un tween en marcha como si
          // la cámara está en reposo.
          const target = c.camTween
            ? { pos: c.camTween.toPos, look: c.camTween.toLook, mode: c.camTween.zoomMode }
            : { pos: c.camCurPos, look: c.camCurLook, mode: c.camZoomMode }
          const zoom = refitZoom(camera, target.pos, target.look, target.mode, rW, rH)
          if (c.camTween) c.camTween.toZoom = zoom
          else { c.camCurZoom = zoom; camera.zoom = zoom; camera.updateProjectionMatrix() }
          // renderer.setSize() de arriba redimensiona el <canvas>, lo que
          // por comportamiento estándar del elemento <canvas> BORRA su
          // contenido — sin repintar aquí, el canvas se queda en blanco
          // hasta el siguiente tick() del rAF, y si el ResizeObserver
          // dispara justo después de que ese frame ya se pintó (típico: el
          // HUD cambia de alto al asentarse una tirada — "Tirada X de Y"
          // aparece/cambia — lo que dispara este resize por el reflow del
          // contenedor), ese hueco en blanco llega a verse un frame entero,
          // como un destello (blanco en tema claro) justo al asentar los
          // dados — bug reportado 2026-09-17. Repintar aquí mismo, ya con
          // el tamaño/zoom nuevos, elimina el hueco.
          composer.render()
        }
      }
    })
    ro.observe(mount)

    // Fix: al montar, `mount.offsetWidth/Height` (usado para el `W`/`H`
    // iniciales más arriba) puede leerse ANTES de que el navegador resuelva
    // del todo el layout flex del contenedor (`.dice-box__scene { flex: 1 }`
    // depende de toda la cadena de padres) — si en ese instante mide menos
    // de lo real, el zoom inicial queda calculado para un hueco más pequeño
    // y nada lo vuelve a corregir después (el ResizeObserver solo dispara
    // en CAMBIOS de tamaño, no si ya "acertó" a la primera con un valor
    // insuficiente). Doble rAF: espera a que el navegador termine layout +
    // pintado al menos una vez, y solo entonces mide otra vez y reencuadra.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const c = ctxRef.current
        if (!c) return
        const rect = mount.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        if (Math.round(rect.width) === c.mountW && Math.round(rect.height) === c.mountH) return
        c.mountW = rect.width
        c.mountH = rect.height
        const target = c.camTween
          ? { pos: c.camTween.toPos, look: c.camTween.toLook, mode: c.camTween.zoomMode }
          : { pos: c.camCurPos, look: c.camCurLook, mode: c.camZoomMode }
        const zoom = refitZoom(camera, target.pos, target.look, target.mode, rect.width, rect.height)
        if (c.camTween) c.camTween.toZoom = zoom
        else { c.camCurZoom = zoom; camera.zoom = zoom; camera.updateProjectionMatrix() }
      })
    })

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

    // DEBUG: contorno discontinuo del tablero (límites WX/WZ) — para ver
    // hasta dónde llega el suelo jugable de un vistazo. Solo visible en modo
    // tuning (ver ctx.boundaryLine + el efecto que sincroniza su .visible
    // con showTuningControls más abajo), oculto en partidas normales.
    const boundaryLine = (() => {
      const y = FY + 0.02
      const pts = [
        new THREE.Vector3(-WX, y, -WZ),
        new THREE.Vector3(WX, y, -WZ),
        new THREE.Vector3(WX, y, VISIBLE_NEAR_Z),
        new THREE.Vector3(-WX, y, VISIBLE_NEAR_Z),
        new THREE.Vector3(-WX, y, -WZ),
      ]
      const boundaryGeo = new THREE.BufferGeometry().setFromPoints(pts)
      const boundaryMat = new THREE.LineDashedMaterial({ color: 0xff00ff, dashSize: 0.25, gapSize: 0.15, linewidth: 2 })
      const boundary = new THREE.Line(boundaryGeo, boundaryMat)
      boundary.computeLineDistances()
      boundary.visible = false
      scene.add(boundary)
      return boundary
    })()

    const activeSkin = skin !== undefined ? skin : localStorage.getItem('bule_dice_skin')

    // 5 persistent die meshes
    const dice = Array.from({ length: 5 }, (_, i) => {
      const matsNormal = buildMats(activeSkin)
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE * 0.12),
        matsNormal
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
        // Set de materiales "apagado" (-50% saturación, -15% brillo) que se
        // asigna en vez del normal mientras el dado está bloqueado por un
        // powerup — ver el efecto reactivo a blockedDice más abajo.
        matsNormal, matsBlocked: buildMats(activeSkin, true), isBlocked: false,
        phase: 'hidden',  // hidden|rolling|placing|idle|exiting
        ts: 0, throwPos: -1, lastKfIdx: -1, prevKfY: null, prevKfDy: 0,
        fp: new THREE.Vector3(), tp: new THREE.Vector3(),
        fq: new THREE.Quaternion(), tq: new THREE.Quaternion(),
        moveActive: false, moveTs: 0,
        moveFrom: new THREE.Vector3(), moveTo: new THREE.Vector3(),
        scaleFrom: 1, scaleTo: 1, // ver PARKING_SCALE — solo cambia al aparcar/desaparcar
        exitFrom: new THREE.Vector3(), exitTs: 0,
        hitCooldown: 0, inCorner: false,
      }
    })

    // If texture image not yet loaded when scene init runs, rebuild all dice materials once it loads
    const skinImg = activeSkin ? _skinImgs[activeSkin] : null
    if (skinImg && !skinImg.complete) {
      skinImg.onload = () => {
        dice.forEach(d => {
          d.matsNormal = buildMats(activeSkin)
          d.matsBlocked = buildMats(activeSkin, true)
          d.mesh.material = d.isBlocked ? d.matsBlocked : d.matsNormal
        })
      }
    }

    const ctx = {
      renderer, scene, camera, dice, boundaryLine, floor,
      onExitDone: null, rollId: 0, animId: null,
      // OJO: camCurPos/camCurLook siguen la convención "base sin offset" que
      // usa todo el sistema de tweens (applyCamPosition añade tuning.camY
      // solo al fijar camera.position de verdad) — nunca camera.position.clone().
      camCurPos:  initialCamPos.clone(),
      camCurLook: new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z),
      camCurZoom: camera.zoom,
      camZoomMode: 'floor', // pose inicial = CAM_FAR_POS, se ajusta al suelo
      settleZoomMode: 'width', // a qué vista volver al asentarse (ver rollWithSounds)
      camTween: null,
      mountW: W, mountH: H,
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
  // (los dados bloqueados por un powerup usan su propio color de borde y no
  // se mueven ni pierden opacidad, aunque coincidan con un índice descartado)
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = performance.now()

    const blockedColorByIndex = new Map(blockedDice.map(b => [b.index, b.color]))

    // Discarded dice: arrange centered, evenly spaced — no overlaps
    const discardedIdle = pendingDiscards.filter(i => ctx.dice[i]?.phase === 'idle' && !blockedColorByIndex.has(i))
    const nDiscard = discardedIdle.length

    // Dados "agrupados" (en juego, ni aparcados ni marcados a descartar):
    // ordenados por valor (As→7, agrupando iguales — una escalera ya sale
    // ordenada así sin necesitar detección especial) y repartidos en los
    // slots de lectura (arriba-izquierda → abajo-derecha) en ese orden, en
    // vez de cada uno en su slotPos(i) fijo por índice — así no quedan
    // huecos cuando algunos dados están aparcados o en el cementerio.
    const groupedIdle = [0,1,2,3,4].filter(i => {
      const d = ctx.dice[i]
      return d.phase === 'idle' && !d.inCorner && !discardedIdle.includes(i)
    })
    const groupedSlotByIndex = new Map(
      [...groupedIdle]
        .sort((a, b) => (VALUE_RANK[ctx.dice[a].value] ?? 99) - (VALUE_RANK[ctx.dice[b].value] ?? 99))
        .map((dieIdx, slot) => [dieIdx, slot])
    )

    ctx.dice.forEach((d, i) => {
      if (d.phase !== 'idle') return
      const blockedColor = blockedColorByIndex.get(i)
      const isBlocked = blockedColor !== undefined
      const discarded = !isBlocked && pendingDiscards.includes(i)
      // Un dado aparcado en el área de parking que NO se ha seleccionado
      // para descartar se queda tal cual, quieto en la esquina — no se
      // reagrupa con los demás (pedido explícito del usuario, 2026-09-17).
      if (d.inCorner && !discarded) return
      d.outline.material.color.set(isBlocked ? blockedColor : (discarded ? 0xe63946 : 0x000000))
      // Textura "apagada" (-50% saturación, -15% brillo) mientras el dado
      // está bloqueado por un powerup — ver buildMats(skinId, blocked).
      if (d.isBlocked !== isBlocked) {
        d.isBlocked = isBlocked
        d.mesh.material = isBlocked ? d.matsBlocked : d.matsNormal
      }
      d.mesh.material.forEach(mat => {
        mat.transparent = discarded
        mat.opacity = discarded ? 0.5 : 1.0
      })
      d.moveFrom.copy(d.mesh.position)
      // Cualquier dado que llega hasta aquí NO está en el parking (los que
      // sí lo están se saltaron arriba) — tamaño normal, incluido el que
      // acaba de salir de la esquina hacia el cementerio.
      d.scaleFrom = d.mesh.scale.x
      d.scaleTo = 1
      if (discarded) {
        d.inCorner = false // sale del parking hacia el cementerio
        const slot = discardedIdle.indexOf(i)
        d.moveTo.set((slot - (nDiscard - 1) / 2) * SLOT_SPACING, REST_Y, DISCARD_Z)
      } else {
        const { x, z: slotZ } = slotPos(groupedSlotByIndex.get(i) ?? i)
        d.moveTo.set(x, REST_Y, slotZ)
      }
      d.moveTs = now
      d.moveActive = true
    })

    // Zoom out adaptively when many discards spread the dice wide
    if (nDiscard >= 4) {
      const extra = nDiscard - 3  // 1 for 4 dice, 2 for 5 dice
      const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y + extra * 2.48, CAM_SETTLE_POS.z + extra * 1.91)
      const toLook = new THREE.Vector3(0, FY + 1.5, 0)
      const fromState1 = tweenFromState(ctx, now)
      ctx.camTween = {
        fromPos: fromState1.pos, fromLook: fromState1.look, fromZoomMode: ctx.camZoomMode,
        toPos, toLook, ts: now, dur: 350 * CAM_TWEEN_SLOWDOWN, zoomMode: 'floor',
        fromZoom: ctx.camCurZoom, toZoom: fitZoomToFloor(ctx.camera, toPos, toLook, ctx.mountW, ctx.mountH),
      }
    } else if (nDiscard > 0) {
      // Fewer discards: snap back to normal settled zoom — vista 2 tras la
      // 1ª tirada, vista 3 ("parking") a partir de la 2ª, igual que en el
      // resto de la fase de selección (ver ctx.settleZoomMode).
      const zoomMode = ctx.settleZoomMode || 'width'
      const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
      const toLook = new THREE.Vector3(0, FY + 1.5, 0)
      const fromState2 = tweenFromState(ctx, now)
      ctx.camTween = {
        fromPos: fromState2.pos, fromLook: fromState2.look, fromZoomMode: ctx.camZoomMode,
        toPos, toLook, ts: now, dur: 350 * CAM_TWEEN_SLOWDOWN, zoomMode,
        fromZoom: ctx.camCurZoom, toZoom: fitZoomToWidth(ctx.camera, toPos, toLook, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, ctx.mountW, zoomMode),
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiscards.join(','), blockedDice.map(b => `${b.index}:${b.color}`).join(',')])

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
      d.inCorner = false
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(x, REST_Y, z)
      d.scaleFrom = d.mesh.scale.x
      d.scaleTo = 1
      d.moveTs = now
      d.moveActive = true
    })
    // Reencuadra a la vista "asentada" normal — sin esto, la vista de
    // resultados podía heredar un zoom más alejado de un ajuste anterior
    // (p.ej. el zoom-out por muchos descartes) y el tablero se veía
    // pequeño con mucho margen sobrante alrededor.
    {
      const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
      const toLook = new THREE.Vector3(0, FY + 1.5, 0)
      const fromState = tweenFromState(ctx, now)
      ctx.camTween = {
        fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
        toPos, toLook, ts: now, dur: 350 * CAM_TWEEN_SLOWDOWN, zoomMode: 'width',
        fromZoom: ctx.camCurZoom, toZoom: fitZoomToWidth(ctx.camera, toPos, toLook, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, ctx.mountW),
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted])

  // ── Limpiar dados cuando se reinicia el turno (values → null) ────────────────
  useEffect(() => {
    if (values?.length) return
    const ctx = ctxRef.current
    if (!ctx) return
    // Transición de entrada "desde lejos" al empezar el turno (incluida la
    // primera tirada de la partida, "del hall a la vista 1") — repartida a
    // lo largo de lo que quede del contador REALMENTE activo en ese momento.
    // OJO: al empezar un turno nuevo (o la partida) el servidor pasa antes
    // por una pausa "esperando al siguiente jugador" (room.awaitingContinue
    // + room.continueDeadline, con su propio botón Continuar de 30s en
    // AnimacionNextPlayer) — room.turnDeadline se queda a null durante esa
    // pausa y solo se rellena DESPUÉS, cuando se confirma/expira. Usar
    // turnDeadline aquí hacía que esta transición cayera siempre al tween
    // corto de reserva. Se usa continueDeadline con prioridad si existe, y
    // turnDeadline si no (por si algún día se salta la pausa); si no hay
    // ninguno (pantalla de otro jugador, etc.), cae al tween corto fijo.
    startEstablishingTween(ctx, continueDeadline || turnDeadline, 900 * CAM_TWEEN_SLOWDOWN)
    ctx.dice.forEach(d => {
      d.mesh.visible = false
      d.mesh.scale.setScalar(1)
      d.scaleFrom = 1
      d.scaleTo = 1
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

  // Paso definitivo de la vista 2 a la vista 1 al terminar el turno (botón
  // "Pasar al siguiente jugador" pulsado, o su contador expirado — ambos
  // casos hacen que `mustPass` pase de true a false): transición aparte, NO
  // una aceleración de la que ya estuviera en marcha, con ease-out y 2000ms
  // fijos siempre — pedido explícito, 2026-09-17. Declarado DESPUÉS del
  // efecto "values → null" a propósito: ambos cambian en el mismo
  // room_state (currentPlayerIndex avanza a la vez que este jugador queda
  // `done`), y los efectos de React corren en orden de declaración — este
  // debe pisar al establishing-tween genérico de arriba (que si no,
  // mandaría la cámara "desde lejos" en vez del ease-out corto pedido).
  const prevMustPassRef = useRef(false)
  useEffect(() => {
    const wasMustPass = prevMustPassRef.current
    prevMustPassRef.current = mustPass
    if (!wasMustPass || mustPass) return
    const ctx = ctxRef.current
    if (!ctx || !ctx.camera) return
    const now = performance.now()
    const toPos = new THREE.Vector3(0, CAM_FAR_POS.y, CAM_FAR_POS.z)
    const toLook = new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z)
    const fromState = tweenFromState(ctx)
    ctx.camTween = {
      fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
      toPos, toLook, ts: now, dur: TWEEN_ACCELERATE_MS, zoomMode: 'floor',
      fromZoom: ctx.camCurZoom,
      toZoom: fitZoomToFloor(ctx.camera, toPos, toLook, ctx.mountW, ctx.mountH),
      easing: 'easeOut',
    }
  }, [mustPass])

  const sliderStyle = { WebkitAppearance: 'slider-vertical', width: 28, flex: 1, touchAction: 'none' }
  const labelStyle = {
    fontSize: 10, color: '#fff', background: 'rgba(0,0,0,0.55)',
    padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', whiteSpace: 'nowrap',
  }

  const sliderColStyle = {
    position: 'absolute', top: '8%', height: '68%', zIndex: 30,
    display: 'flex', flexDirection: 'row', gap: 8,
  }
  const sliderGroupStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }

  return (
    <>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {showTuningControls && controlsHidden && (
        <button
          type="button"
          onClick={() => setControlsHidden(false)}
          aria-label="Mostrar controles de tuning"
          style={{
            position: 'absolute', right: 6, bottom: 8, zIndex: 30,
            width: 30, height: 30, borderRadius: '50%', border: 'none',
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 14,
          }}
        >⚙</button>
      )}
      {showTuningControls && !controlsHidden && (
        <>
          {/* Derecha: desplazamiento vertical del encuadre + zoom */}
          <div style={{ ...sliderColStyle, right: 6 }}>
            <div style={sliderGroupStyle}>
              <span style={labelStyle}>↕ {shiftPercent}%</span>
              <input
                type="range" min={-100} max={100} step={1} value={shiftPercent}
                onChange={e => {
                  const v = Number(e.target.value)
                  setShiftPercent(v)
                  tuning[viewMode].shiftPercent = v / 100
                  reapplyLiveTuning()
                }}
                style={sliderStyle}
              />
            </div>
            <div style={sliderGroupStyle}>
              <span style={labelStyle}>zoom {zoomPercent}%</span>
              <input
                type="range" min={50} max={150} step={1} value={zoomPercent}
                onChange={e => {
                  const v = Number(e.target.value)
                  setZoomPercent(v)
                  tuning[viewMode].zoomMultiplier = v / 100
                  reapplyLiveTuning()
                }}
                style={sliderStyle}
              />
            </div>
          </div>
          {/* Izquierda: tilt (rota el eje de la cámara) + posición vertical de la cámara */}
          <div style={{ ...sliderColStyle, left: 6 }}>
            <div style={sliderGroupStyle}>
              <span style={labelStyle}>tilt {tiltDeg}°</span>
              <input
                type="range" min={-30} max={30} step={1} value={tiltDeg}
                onChange={e => {
                  const v = Number(e.target.value)
                  setTiltDeg(v)
                  tuning[viewMode].tiltDeg = v
                  reapplyLiveTuning()
                }}
                style={sliderStyle}
              />
            </div>
            <div style={sliderGroupStyle}>
              <span style={labelStyle}>cam Y {camY.toFixed(1)}</span>
              <input
                type="range" min={-30} max={30} step={0.1} value={camY}
                onChange={e => {
                  const v = Number(e.target.value)
                  setCamY(v)
                  tuning[viewMode].camY = v
                  reapplyLiveTuning()
                }}
                style={sliderStyle}
              />
            </div>
          </div>
          {/* Arriba centro: selector de vista */}
          <div style={{
            position: 'absolute', left: '50%', top: 8, transform: 'translateX(-50%)',
            zIndex: 30, display: 'flex', gap: 6,
          }}>
            <button
              type="button"
              onClick={() => switchToView('view1')}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none',
                background: viewMode === 'view1' ? '#3b82f6' : 'rgba(0,0,0,0.6)',
                color: '#fff', fontWeight: 600,
              }}
            >
              Vista 1
            </button>
            <button
              type="button"
              onClick={() => switchToView('view2')}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none',
                background: viewMode === 'view2' ? '#3b82f6' : 'rgba(0,0,0,0.6)',
                color: '#fff', fontWeight: 600,
              }}
            >
              Vista 2
            </button>
            <button
              type="button"
              onClick={() => switchToView('view3')}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none',
                background: viewMode === 'view3' ? '#3b82f6' : 'rgba(0,0,0,0.6)',
                color: '#fff', fontWeight: 600,
              }}
            >
              Vista 3
            </button>
          </div>
          {/* Abajo centro: guardar la vista activa + ocultar */}
          <div style={{
            position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
            zIndex: 30, display: 'flex', gap: 6,
          }}>
            <button
              type="button"
              disabled={!viewMode}
              onClick={() => viewMode && savePosition(viewMode)}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none',
                background: tuningSavedSlot === viewMode ? '#2ecc71' : 'rgba(0,0,0,0.6)',
                color: '#fff', fontWeight: 600,
              }}
            >
              {tuningSavedSlot === viewMode
                ? 'Guardado ✓'
                : `Guardar ${viewMode === 'view3' ? 'Vista 3' : viewMode === 'view2' ? 'Vista 2' : 'Vista 1'}`}
            </button>
            <button
              type="button"
              onClick={() => setControlsHidden(true)}
              style={{
                fontSize: 12, padding: '5px 10px', borderRadius: 8, border: 'none',
                background: 'rgba(0,0,0,0.6)', color: '#fff', fontWeight: 600,
              }}
            >
              Ocultar controles
            </button>
          </div>
        </>
      )}
    </>
  )
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
    d.inCorner = false
    d.mesh.scale.setScalar(1) // por si venía aparcado (encogido) de una tirada anterior
    d.scaleFrom = 1
    d.scaleTo = 1
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
    // Cada dado necesita su propio set de materiales (no uno compartido):
    // el swap normal/bloqueado de abajo asigna d.mesh.material por dado, y
    // compartir el array haría que el último dado procesado "ganara" para
    // todos.
    const rebuild = () => {
      ctx.dice.forEach(d => {
        d.matsNormal = buildMats(resolvedSkin)
        d.matsBlocked = buildMats(resolvedSkin, true)
        d.mesh.material = d.isBlocked ? d.matsBlocked : d.matsNormal
      })
    }
    if (img && !img.complete) img.onload = rebuild
    else rebuild()
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
      // frenazo brusco en Y (caída seguida de rebote) para disparar el sonido.
      // Umbral bajado de -0.15 a -0.05 (2026-09-17): con la trayectoria de
      // lanzamiento actual (altura/velocidad de salida más moderadas que
      // antes) los deltaY por keyframe rara vez llegaban a -0.15, así que el
      // sonido casi nunca sonaba durante la caída — solo el de agitar el
      // cubilete antes de lanzar.
      if (i0 !== d.lastKfIdx) {
        d.lastKfIdx = i0
        const dy = k0[1] - (d.prevKfY ?? k0[1])
        if (d.prevKfDy < -0.05 && dy > d.prevKfDy * 0.2 && now - d.hitCooldown > 80) {
          playDiceHit(Math.abs(d.prevKfDy) * 20)
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
      const te = eio(t)
      d.mesh.position.lerpVectors(d.fp, d.tp, te)
      d.mesh.quaternion.copy(d.fq).slerp(d.tq, te)
      if (t < 1) done = false
      else { d.mesh.position.copy(d.tp); d.mesh.quaternion.copy(d.tq); d.phase = 'idle' }
    })
    if (done) {
      const faces = ctx.dice.map(d => d.value)
      propsRef.current.onSettled?.(faces)
      // 'width' (vista 2) tras la 1ª tirada del turno, 'parking' (vista 3)
      // tras la 2ª/3ª — fijado en rollWithSounds() al lanzar esta tirada.
      const zoomMode = ctx.settleZoomMode || 'width'
      {
        const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
        const toLook = new THREE.Vector3(0, FY + 1.5, 0)
        const fromState = tweenFromState(ctx, now)
        ctx.camTween = {
          fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
          toPos, toLook, ts: now, dur: 700 * CAM_TWEEN_SLOWDOWN, zoomMode,
          fromZoom: ctx.camCurZoom, toZoom: fitZoomToWidth(ctx.camera, toPos, toLook, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, ctx.mountW, zoomMode),
        }
      }
      // Los dados aparcados en la esquina NO se reagrupan con los recién
      // asentados (pedido explícito del usuario, 2026-09-17) — se quedan en
      // el área de parking hasta que el jugador los seleccione para
      // descartar (entonces van al cementerio, ver el efecto de
      // pendingDiscards) o hasta que empiece un turno nuevo.
    }
  }

  // ── Move tween (discard / return) ────────────────────────────────────────────
  const MOV_DUR = 260
  dice.forEach(d => {
    if (!d.moveActive || d.phase !== 'idle') return
    const t = Math.min((now - d.moveTs) / MOV_DUR, 1)
    const te = eio(t)
    d.mesh.position.lerpVectors(d.moveFrom, d.moveTo, te)
    if (d.scaleFrom !== d.scaleTo) {
      const s = d.scaleFrom + (d.scaleTo - d.scaleFrom) * te
      d.mesh.scale.setScalar(s)
    }
    if (t >= 1) {
      d.mesh.position.copy(d.moveTo)
      d.mesh.scale.setScalar(d.scaleTo)
      d.scaleFrom = d.scaleTo
      d.moveActive = false
    }
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
  // camY/shift/tilt se interpolan TAMBIÉN entre la vista de origen y la de
  // destino durante un tween (antes se aplicaba de golpe el tuning de la
  // vista DESTINO desde el primer frame — provocaba un parpadeo/glitch justo
  // al empezar la transición).
  const wasTweening = !!ctx.camTween
  let fromZoomMode, toZoomMode, te
  if (wasTweening) {
    const t = Math.min((now - ctx.camTween.ts) / ctx.camTween.dur, 1)
    te = (ctx.camTween.easing === 'easeOut' ? easeOut : eio)(t)
    ctx.camCurPos.lerpVectors(ctx.camTween.fromPos, ctx.camTween.toPos, te)
    ctx.camCurLook.lerpVectors(ctx.camTween.fromLook, ctx.camTween.toLook, te)
    fromZoomMode = ctx.camTween.fromZoomMode || ctx.camZoomMode
    toZoomMode = ctx.camTween.zoomMode
    if (ctx.camTween.toZoom != null) {
      const fromZoom = ctx.camTween.fromZoom ?? ctx.camCurZoom
      ctx.camCurZoom = fromZoom + (ctx.camTween.toZoom - fromZoom) * te
      ctx.camera.zoom = ctx.camCurZoom
      ctx.camera.updateProjectionMatrix()
    }
    // OJO: ctx.camZoomMode solo se actualiza al TERMINAR el tween (t>=1), no
    // en cada frame — antes se pisaba con el modo DESTINO desde el primer
    // frame, así que cualquier tween nuevo que interrumpiera a este a medias
    // (aceleración, regroup, etc. — cada vez más frecuente con el sistema de
    // transiciones ligadas a contadores) calculaba su `fromZoomMode` como si
    // ya hubiéramos llegado del todo, aunque camY/shift/tilt seguían a medio
    // interpolar — provocaba un salto brusco de encuadre al encadenar
    // transiciones (bug reportado como "flash", 2026-09-17).
    if (t >= 1) {
      ctx.camTween = null
      if (toZoomMode) ctx.camZoomMode = toZoomMode
    }
  }
  // El balanceo sutil (swayOffset) se suma SIEMPRE, tanto en reposo como
  // durante cualquier tween — antes solo se aplicaba en reposo, así que se
  // notaba un salto tanto al EMPEZAR una transición (el balanceo
  // desaparecía de golpe) como al TERMINARLA (volvía a aparecer de golpe).
  // Sumarlo de forma continua e idéntica en los dos casos, sobre el mismo
  // ctx.camCurPos/camCurLook "lógico" (que en sí nunca tiene el balanceo
  // metido), hace que la posición renderizada sea continua todo el rato, sin
  // ningún instante de transición entre "con balanceo" y "sin él".
  const s = swayOffset(now)
  _swayPos.copy(ctx.camCurPos)
  _swayPos.x += s.posX
  _swayPos.y += s.posY
  _swayLook.copy(ctx.camCurLook)
  _swayLook.x += s.lookX
  if (wasTweening) {
    applyCamTweenFrame(ctx.camera, _swayPos, _swayLook, fromZoomMode, toZoomMode, te)
  } else {
    applyCamPosition(ctx.camera, _swayPos, ctx.camZoomMode)
    lookAtShifted(ctx.camera, _swayLook, ctx.camZoomMode)
  }

}

function beginPlace(ctx, now) {
  // Los dados de esta tirada se ordenan por valor (As→7, agrupando iguales
  // — una escalera ya sale ordenada así sin detección especial) y se
  // reparten en los slots de lectura (arriba-izquierda → abajo-derecha) en
  // ese orden, en vez de cada uno en su slotPos(i) fijo por índice — así no
  // quedan huecos cuando quedan dados aparcados de una tirada anterior (que
  // ya no están en juego aquí, ver keptDice en rollWithSounds()).
  const rollingDice = ctx.dice
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.phase === 'rolling')
    .sort((a, b) => (VALUE_RANK[a.d.value] ?? 99) - (VALUE_RANK[b.d.value] ?? 99))

  rollingDice.forEach(({ d }, slot) => {
    // El valor ya lo fijó doRoll() a partir del resultado autoritativo del
    // servidor — el último keyframe deja el dado con esa cara arriba, pero
    // con el yaw (giro sobre el eje vertical) que le tocó al aterrizar, que
    // puede ser cualquiera. Aquí se reposiciona a la rejilla Y se endereza a
    // una orientación limpia (mismo yaw siempre para un valor dado), o si no
    // los dados se ven torcidos y pueden solaparse visualmente entre sí.
    const { x, z } = slotPos(slot)
    d.mesh.position.y = REST_Y
    d.fp.copy(d.mesh.position)
    d.tp.set(x, REST_Y, z)
    d.fq.copy(d.mesh.quaternion)
    d.tq.copy(FACE_UP_QUATS[VALUE_TO_FACE[d.value] ?? 2])
    d.ts = now
    d.phase = 'placing'
  })
}

function rollWithSounds(ctx, values, rollingIndices, keyframes, frameIntervalMs) {
  ctx.rollId = (ctx.rollId ?? 0) + 1
  const myId = ctx.rollId
  // Solo se aleja a la pose "floor" (vista 1, suelo completo) cuando se
  // tiran los 5 dados a la vez (primera tirada del turno) — a partir de la
  // segunda/tercera tirada, con dados guardados de la jugada, se usa la
  // pose "parking" (vista 3: misma posición que la vista 2 "width", pero con
  // su propio tuning/zoom) en vez de alejarse a vista 1 (pedido por el
  // usuario, 2026-09-17). `ctx.settleZoomMode` guarda a qué vista volver
  // cuando esta tirada termine de asentarse (ver bloque `if (done)` en step()).
  const hasKept = rollingIndices.length < 5
  ctx.settleZoomMode = hasKept ? 'parking' : 'width'
  if (!hasKept) {
    // Esta primera tirada del turno apunta a la MISMA vista 1 que la
    // transición "desde lejos" ligada al contador (ver startEstablishingTween)
    // — si esa transición sigue en marcha (el jugador ha tirado antes de que
    // se agote su cuenta atrás), no hace falta un tween nuevo: basta con
    // acelerar la que ya hay, para que llegue antes sin saltos.
    const nowTs = performance.now()
    if (!accelerateEstablishingTween(ctx, nowTs)) {
      const toPos = new THREE.Vector3(0, CAM_FAR_POS.y, CAM_FAR_POS.z)
      const toLook = new THREE.Vector3(0, FY + 1.5, FLOOR_LOOK_Z)
      const fromState = tweenFromState(ctx, nowTs)
      ctx.camTween = {
        fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
        toPos, toLook, ts: nowTs, dur: 350 * CAM_TWEEN_SLOWDOWN, zoomMode: 'floor',
        fromZoom: ctx.camCurZoom, toZoom: fitZoomToFloor(ctx.camera, toPos, toLook, ctx.mountW, ctx.mountH),
      }
    }
  } else {
    const toPos = new THREE.Vector3(0, CAM_SETTLE_POS.y, CAM_SETTLE_POS.z)
    const toLook = new THREE.Vector3(0, FY + 1.5, 0)
    const nowTs = performance.now()
    const fromState = tweenFromState(ctx, nowTs)
    ctx.camTween = {
      fromPos: fromState.pos, fromLook: fromState.look, fromZoomMode: ctx.camZoomMode,
      toPos, toLook, ts: nowTs, dur: 350 * CAM_TWEEN_SLOWDOWN, zoomMode: 'parking',
      fromZoom: ctx.camCurZoom, toZoom: fitZoomToWidth(ctx.camera, toPos, toLook, FRONT_ROW_HALF_WIDTH, ROW_FRONT_Z, ctx.mountW, 'parking'),
      easing: 'easeOut', // paso vista 2 → vista 3, pedido explícito 2026-09-17
    }
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

  // Los dados guardados de la jugada (no incluidos en esta tirada) se
  // aparcan en la esquina superior-izquierda ("parking") justo al confirmar
  // esta tirada — solo visual, sin obstáculo físico (los dados que caen
  // pueden atravesarlos en la simulación; aceptado para no tener que
  // regenerar el banco de semillas por esto). Ahí se quedan (ya no vuelven
  // solos a su sitio normal al asentarse, ver bloque `if (done)` en step()).
  // Ordenados por valor (As→7, agrupando iguales — una escalera ya sale
  // ordenada así sin necesitar detección especial) de izquierda a derecha.
  const keptDice = [0,1,2,3,4].filter(i =>
    !rollingIndices.includes(i) &&
    ctx.dice[i].mesh.visible &&
    (ctx.dice[i].phase === 'idle' || ctx.dice[i].moveActive)
  ).sort((a, b) => (VALUE_RANK[ctx.dice[a].value] ?? 99) - (VALUE_RANK[ctx.dice[b].value] ?? 99))
  if (keptDice.length > 0) {
    const now = performance.now()
    keptDice.forEach((dieIdx, slot) => {
      const d = ctx.dice[dieIdx]
      const p = cornerSlotPos(slot)
      d.moveFrom.copy(d.mesh.position)
      d.moveTo.set(p.x, REST_Y, p.z)
      d.scaleFrom = d.mesh.scale.x
      d.scaleTo = PARKING_SCALE
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

