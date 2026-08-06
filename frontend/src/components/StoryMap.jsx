import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import socket from '../socket'

const StoryMapScene = lazy(() => import('./StoryMapScene'))

// Debe coincidir con STORY_BOSS_INTERVAL en backend/server.js — el servidor
// es quien valida de verdad; aquí solo se usa para pintar el icono de boss.
const BOSS_INTERVAL = 5
const NODES_BEHIND  = 2
const NODES_AHEAD   = 4

function fmtCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// PRNG determinista (mulberry32) — mismo patrón que DiceRollerScene, sembrado
// por nodo para que la forma del camino sea estable entre renders/sesiones.
function seededRandom(seed) {
  let t = seed >>> 0
  return function () {
    t = (t + 0x6D2B79F5) | 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// Posiciones (ramas) del nodo en esa profundidad: -1 izquierda, 0 centro, 1 derecha.
// El nodo 1 y los bosses siempre están centrados y solos (los caminos convergen
// antes de cada boss); el resto puede bifurcarse en 1 o 2 ramas.
function nodeSlots(mapSeed, depth, isBoss) {
  if (depth <= 1 || isBoss) return [0]
  const rnd = seededRandom((mapSeed + depth * 7919) >>> 0)()
  if (rnd < 0.35) return [-1, 1]
  if (rnd < 0.65) return [-1]
  if (rnd < 0.90) return [1]
  return [0]
}

export default function StoryMap({ user, playerName, onBack }) {
  const [progress, setProgress] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [creating, setCreating] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const tickRef = useRef(null)

  useEffect(() => {
    socket.emit('get_story_progress', (res) => {
      setLoading(false)
      if (!res?.ok) return setError(res?.error || 'No se pudo cargar el progreso')
      setProgress(res)
      setCountdown(res.nextLifeInSeconds ?? 0)
    })
  }, [])

  useEffect(() => {
    clearInterval(tickRef.current)
    if (!progress || progress.lives >= progress.maxLives) return
    tickRef.current = setInterval(() => {
      setCountdown(c => (c > 0 ? c - 1 : 0))
    }, 1000)
    return () => clearInterval(tickRef.current)
  }, [progress])

  function fight() {
    if (!progress || progress.lives <= 0 || creating) return
    setCreating(true)
    setError('')
    socket.emit('create_room', {
      playerName,
      roomName: 'Modo Historia',
      vsBot: true,
      maxPlayers: 1 + progress.opponentCount,
      maxRounds: 0,
      isPrivate: false,
      diceSkin: localStorage.getItem('bule_dice_skin') ?? null,
      storyNode: progress.currentNode,
    }, (res) => {
      setCreating(false)
      if (!res?.ok) setError(res?.error || 'No se pudo iniciar el combate')
      // Si res.ok, App.jsx toma el relevo en cuanto llegue el room_state
    })
  }

  // Filas del camino, del nodo 1 en adelante — bifurcaciones deterministas
  // por seed, convergen siempre antes de cada boss. La escena 3D las coloca
  // de atrás (nodo 1) hacia delante según se avanza.
  const rows = useMemo(() => {
    if (!progress) return []
    const from = Math.max(1, progress.currentNode - NODES_BEHIND)
    const to   = progress.currentNode + NODES_AHEAD
    const list = []
    for (let d = from; d <= to; d++) {
      const isBoss = d % BOSS_INTERVAL === 0
      const state  = d < progress.currentNode ? 'done' : d === progress.currentNode ? 'current' : 'locked'
      list.push({
        depth: d,
        isBoss,
        state,
        nodes: nodeSlots(progress.mapSeed, d, isBoss).map(slot => ({ slot })),
      })
    }
    return list
  }, [progress?.mapSeed, progress?.currentNode])

  function handleSelectNode(depth) {
    if (progress && depth === progress.currentNode) fight()
  }

  return (
    <div className="story">
      <header className="usec__header">
        <button className="usec__back" onClick={onBack} aria-label="Volver">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <p className="story__title">Modo Historia</p>
        <div className="story__lives">
          {Array.from({ length: progress?.maxLives ?? 5 }, (_, i) => (
            <span key={i} className={`story__life${progress && i < progress.lives ? ' story__life--full' : ''}`}>♥</span>
          ))}
        </div>
      </header>

      {loading && <p className="usec__empty">Cargando...</p>}
      {error && <p className="rl__error">{error}</p>}

      {progress && (
        <>
          {progress.lives < progress.maxLives && (
            <p className="story__life-timer">Próxima vida en {fmtCountdown(countdown)}</p>
          )}

          <div className="story__scene-wrap">
            <Suspense fallback={<p className="usec__empty">Generando mapa...</p>}>
              <StoryMapScene rows={rows} currentNode={progress.currentNode} onSelectNode={handleSelectNode} />
            </Suspense>
          </div>
        </>
      )}

      {progress && (
        <div className="rl__create-bar">
          <button className="rl__create-bar-btn" onClick={fight} disabled={progress.lives <= 0 || creating}>
            {creating ? 'Preparando...' : progress.lives <= 0 ? 'Sin vidas' : progress.isBoss ? 'Combatir al boss' : 'Combatir'}
          </button>
        </div>
      )}
    </div>
  )
}
