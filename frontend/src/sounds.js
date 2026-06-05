export const DICE_ROLL_DURATION_MS = 550

export function playDiceRoll() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const sampleRate = ctx.sampleRate
    const bufferSize = Math.floor(sampleRate * (DICE_ROLL_DURATION_MS / 1000))
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate)
    const data = buffer.getChannelData(0)

    // Noise clicks — envelopes más lentos = más grave
    const numClicks = 4 + Math.floor(Math.random() * 3)
    for (let c = 0; c < numClicks; c++) {
      const offset = Math.floor((c / (numClicks - 1)) * bufferSize * 0.72)
      const clickLen = Math.floor(sampleRate * 0.07)
      const amplitude = c === numClicks - 1 ? 0.7 : 0.3 + Math.random() * 0.25
      for (let i = 0; i < clickLen && offset + i < bufferSize; i++) {
        const env = Math.exp(-i / (sampleRate * 0.025))
        data[offset + i] += (Math.random() * 2 - 1) * env * amplitude
      }
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 60

    const gain = ctx.createGain()
    gain.gain.value = 0.8

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start()

    // Componente de baja frecuencia (golpe grave)
    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(90, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.2)
    oscGain.gain.setValueAtTime(0.4, ctx.currentTime)
    oscGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  } catch {
    // Audio bloqueado o no soportado
  }
}
