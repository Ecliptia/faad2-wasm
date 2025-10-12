import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let Faad2ModuleFactory
try {
  const module = await import('./faad2_wasm.mjs')
  Faad2ModuleFactory = module.default
} catch (err) {
  console.error('Failed to load FAAD2 WASM module:', err.message)
}

const SAMPLE_RATE = {
  1: 8000,
  2: 16000,
  3: 22050,
  4: 32000,
  5: 44100,
  6: 48000,
  7: 64000,
  8: 88200,
  9: 96000,
}

class FAAD2NodeDecoder {
  constructor() {
    this.module = null
    this.initialized = false
    this.sampleRate = 0
    this.channels = 0
    this.ready = this._init()
  }

  async _init() {
    if (!this.module) {
      const wasmPath = join(__dirname, 'faad2_wasm.wasm')
      const wasmBinary = await readFile(wasmPath)
      
      this.module = await Faad2ModuleFactory({
        wasmBinary,
      })
      
      console.debug('FAAD2: Node.js module loaded')
      if (this.module._get_faad_capabilities) {
        console.debug('FAAD2: capabilities', this.module._get_faad_capabilities())
      }
    }
  }

  /**
   * Automatically detects AudioSpecificConfig (ASC) from first AAC frame
   * @param {Buffer} aacData - Raw AAC data or ADTS
   * @returns {Buffer} - Extracted AudioSpecificConfig
   */
  _extractASC(aacData) {
    // Check for ADTS header (syncword 0xFFF)
    if (aacData.length >= 7) {
      const syncword = (aacData[0] << 4) | (aacData[1] >> 4)
      if (syncword === 0xFFF) {
        // ADTS frame detected - extract ASC from header
        const profile = ((aacData[2] >> 6) & 0x03) + 1
        const sampleRateIndex = (aacData[2] >> 2) & 0x0F
        const channelConfig = ((aacData[2] & 0x01) << 2) | ((aacData[3] >> 6) & 0x03)
        
        // Build ASC (2 bytes)
        const asc = Buffer.alloc(2)
        asc[0] = (profile << 3) | (sampleRateIndex >> 1)
        asc[1] = ((sampleRateIndex & 0x01) << 7) | (channelConfig << 3)
        
        console.debug('FAAD2: Detected ADTS - profile:', profile, 'sr_idx:', sampleRateIndex, 'ch:', channelConfig)
        return asc
      }
    }
    
    // If not ADTS, assume first bytes are ASC
    if (aacData.length >= 2) {
      return aacData.slice(0, 2)
    }
    
    throw new Error('Unable to extract AudioSpecificConfig')
  }

  /**
   * Remove ADTS header if present
   * @param {Buffer} aacData - AAC frame with possible ADTS header
   * @returns {Buffer} - Raw AAC data without header
   */
  _stripADTS(aacData) {
    if (aacData.length >= 7) {
      const syncword = (aacData[0] << 4) | (aacData[1] >> 4)
      if (syncword === 0xFFF) {
        const protectionAbsent = (aacData[1] & 0x01)
        const headerSize = protectionAbsent ? 7 : 9
        return aacData.slice(headerSize)
      }
    }
    return aacData
  }

  /**
   * Initialize decoder with ASC (can be provided or auto-detected)
   * @param {Buffer} ascOrFirstFrame - ASC or first AAC frame
   * @param {boolean} autoDetect - If true, attempts to auto-detect ASC
   */
  async configure(ascOrFirstFrame, autoDetect = true) {
    await this.ready
    
    let asc
    if (autoDetect && ascOrFirstFrame.length > 2) {
      // Try to extract ASC automatically
      asc = this._extractASC(ascOrFirstFrame)
    } else {
      // Use provided ASC directly
      asc = ascOrFirstFrame
    }

    const ascPtr = this.module._malloc(asc.length)
    this.module.HEAPU8.set(asc, ascPtr)

    const result = this.module._init_decoder(ascPtr, asc.length)
    this.module._free(ascPtr)

    if (result < 0) {
      throw new Error('Failed to initialize FAAD2 decoder')
    }

    this.initialized = true

    console.debug(
      'FAAD2NodeDecoder: configured with ASC',
      Array.from(asc)
        .map(b => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`)
        .join(', ')
    )
  }

  /**
   * Decode AAC frame
   * @param {Buffer} frameData - AAC frame (with or without ADTS header)
   * @returns {Object} - { pcm: Float32Array, sampleRate: number, channels: number, samplesPerChannel: number }
   */
  decode(frameData) {
    if (!this.module || !this.initialized) {
      throw new Error('Decoder not initialized. Call configure() first.')
    }

    // Remove ADTS header if present
    const rawAAC = this._stripADTS(frameData)

    const inputLength = rawAAC.length
    const pad = 64
    const inPtr = this.module._malloc(inputLength + pad)
    this.module.HEAPU8.set(rawAAC, inPtr)
    this.module.HEAPU8.fill(0, inPtr + inputLength, inPtr + inputLength + pad)

    const maxFrames = 2048 * 2
    const maxChannels = 2
    const maxSamples = maxFrames * maxChannels
    const outputSize = maxSamples * Float32Array.BYTES_PER_ELEMENT
    const outPtr = this.module._malloc(outputSize)

    const packed = this.module._decode_frame(inPtr, rawAAC.length, outPtr, outputSize)
    this.module._free(inPtr)

    if (packed <= 0) {
      this.module._free(outPtr)
      return null
    }

    const samplerateIndex = (packed >>> 28) & 0xf
    const numChannels = (packed >>> 24) & 0xf
    const samples = packed & 0xffffff
    const samplerate = SAMPLE_RATE[samplerateIndex] || 0

    this.sampleRate = samplerate
    this.channels = numChannels

    const numFrames = samples / numChannels

    // Return interleaved Float32 PCM
    const pcm = new Float32Array(this.module.HEAPU8.buffer, outPtr, samples).slice()
    
    this.module._free(outPtr)

    return {
      pcm,
      sampleRate: samplerate,
      channels: numChannels,
      samplesPerChannel: numFrames,
    }
  }

  /**
   * Decode and convert to PCM Int16 (compatible with most Node.js audio libraries)
   * @param {Buffer} frameData - AAC frame
   * @returns {Object} - { pcm: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number }
   */
  decodeInt16(frameData) {
    const result = this.decode(frameData)
    if (!result) return null

    const pcmInt16 = new Int16Array(result.pcm.length)
    for (let i = 0; i < result.pcm.length; i++) {
      pcmInt16[i] = Math.max(-1, Math.min(1, result.pcm[i])) * 32767
    }

    return {
      pcm: pcmInt16,
      sampleRate: result.sampleRate,
      channels: result.channels,
      samplesPerChannel: result.samplesPerChannel,
    }
  }

  /**
   * Decode and return PCM separated by channel
   * @param {Buffer} frameData - AAC frame
   * @returns {Object} - { channelData: Float32Array[], sampleRate: number, channels: number }
   */
  decodePlanar(frameData) {
    const result = this.decode(frameData)
    if (!result) return null

    const channelData = []
    for (let ch = 0; ch < result.channels; ch++) {
      const channelSamples = new Float32Array(result.samplesPerChannel)
      for (let i = 0; i < result.samplesPerChannel; i++) {
        channelSamples[i] = result.pcm[i * result.channels + ch]
      }
      channelData.push(channelSamples)
    }

    return {
      channelData,
      sampleRate: result.sampleRate,
      channels: result.channels,
    }
  }

  reset() {
    this.initialized = false
    this.sampleRate = 0
    this.channels = 0
  }

  destroy() {
    this.reset()
    // Note: WASM module doesn't require manual destruction
  }
  }
}

export default FAAD2NodeDecoder
