export function playDiceRoll() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const sampleRate = ctx.sampleRate
    const bufferSize = Math.floor(sampleRate * 0.55)
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate)
    const data = buffer.getChannelData(0)

    // Several noise bursts simulating dice hitting the surface
    const numClicks = 4 + Math.floor(Math.random() * 3)
    for (let c = 0; c < numClicks; c++) {
      const offset = Math.floor((c / (numClicks - 1)) * bufferSize * 0.72)
      const clickLen = Math.floor(sampleRate * 0.045)
      const amplitude = c === numClicks - 1 ? 0.65 : 0.25 + Math.random() * 0.2
      for (let i = 0; i < clickLen && offset + i < bufferSize; i++) {
        const env = Math.exp(-i / (sampleRate * 0.013))
        data[offset + i] += (Math.random() * 2 - 1) * env * amplitude
      }
    }

    const source = ctx.createBufferSource()
    source.buffer = buffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = 280

    const gain = ctx.createGain()
    gain.gain.value = 0.8

    source.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    source.start()
  } catch {
    // Audio blocked or not supported
  }
}
