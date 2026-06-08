export const DICE_ROLL_DURATION_MS = 550

let audioBuffer = null
let audioCtx = null
let activeSource = null
let activeGain = null

async function getBuffer() {
  if (audioBuffer) return audioBuffer
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  const res = await fetch('/assets/dice-roll.wav')
  const arrayBuffer = await res.arrayBuffer()
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  return audioBuffer
}

getBuffer().catch(() => {})

export function stopDiceRoll(fadeMs = 300) {
  if (!activeGain || !activeSource) return
  const gain = activeGain
  const source = activeSource
  activeGain = null
  activeSource = null
  const t = audioCtx.currentTime
  gain.gain.setValueAtTime(gain.gain.value, t)
  gain.gain.linearRampToValueAtTime(0, t + fadeMs / 1000)
  source.stop(t + fadeMs / 1000)
}

export function playDiceRoll() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()

    // Detener tirada anterior si sigue activa
    stopDiceRoll(80)

    const play = (buf) => {
      const source = audioCtx.createBufferSource()
      const gainNode = audioCtx.createGain()

      source.buffer = buf
      source.loop = true
      // Pequeña variación de velocidad en cada tirada para que suene distinto
      source.playbackRate.value = 0.92 + Math.random() * 0.16

      source.connect(gainNode)
      gainNode.connect(audioCtx.destination)
      source.start()

      activeSource = source
      activeGain = gainNode
    }

    if (audioBuffer) {
      play(audioBuffer)
    } else {
      getBuffer().then(play).catch(() => {})
    }
  } catch {
    // Audio bloqueado o no soportado
  }
}
