# FAAD2 WASM Bindings

This project provides WebAssembly (WASM) bindings for the FAAD2 AAC decoder, enabling AAC audio decoding in both web browsers and Node.js applications. 

**Fork Information:**
- Original project: [ohrstrom/faad2-wasm](https://github.com/ohrstrom/faad2-wasm)
- This fork: [Ecliptia/faad2-wasm](https://github.com/Ecliptia/faad2-wasm)
- Enhancements: Windows build support, Node.js auto-detection, improved documentation

## Features

- ✅ AAC/AAC+ (HE-AAC, HE-AACv2) audio decoding via FAAD2
- ✅ WebAssembly for high performance
- ✅ Works in modern web browsers
- ✅ Node.js support with automatic format detection
- ✅ Support for ADTS and raw AAC streams
- ✅ Automatic AudioSpecificConfig (ASC) extraction
- ✅ Multiple output formats (Float32, Int16, planar)
- ✅ Cross-platform build support (Linux, macOS, Windows)
- ✅ Support for up to 8 channels (7.1 surround sound)

## Prerequisites

### All Platforms
- Git with submodules support
- Python 3.6 or higher
- Node.js 16+ (for Node.js usage)

### Linux/macOS
- Make
- Bash
- Standard build tools (gcc, etc.)

### Windows
- [Make for Windows](http://gnuwin32.sourceforge.net/packages/make.htm) OR use provided `build.bat` script
- [Git for Windows](https://git-scm.com/download/win)
- Python 3 (available via Microsoft Store or python.org)

**Install Make on Windows:**
```powershell
# Using Chocolatey
choco install make

# Or download from GnuWin32
# http://gnuwin32.sourceforge.net/packages/make.htm
```

## Setup

### Linux/macOS

```bash
# Clone repository with submodules
git clone --recursive https://github.com/ohrstrom/faad2-wasm.git
cd faad2-wasm

# Setup submodules and Emscripten SDK
make setup-submodules
make setup-emsdk
```

### Windows (using Make)

```powershell
# Clone repository with submodules
git clone --recursive https://github.com/ohrstrom/faad2-wasm.git
cd faad2-wasm

# Use Windows Makefile
make -f Makefile.win setup-submodules
make -f Makefile.win setup-emsdk
```

### Windows (using build.bat - Recommended)

```powershell
# Clone repository with submodules
git clone --recursive https://github.com/ohrstrom/faad2-wasm.git
cd faad2-wasm

# Use Windows batch script
build.bat setup-submodules
build.bat setup-emsdk

# Or run both at once
build.bat setup
```

## Build

### Linux/macOS

```bash
# Apply necessary patches
make patch-libfaad

# Build for web
make build

# Build for Node.js (optional)
make build-node
```

### Windows (using Make)

```powershell
# Apply patches
make -f Makefile.win patch-libfaad

# Build for web
make -f Makefile.win build

# Build for Node.js
make -f Makefile.win build-node
```

### Windows (using build.bat - Recommended)

```powershell
# Apply patches
build.bat patch-libfaad

# Build for web
build.bat build

# Build for Node.js
build.bat build-node
```

The compiled files will be placed in the `pkg/` directory:
- `faad2_wasm.mjs` - JavaScript module
- `faad2_wasm.wasm` - WebAssembly binary
- `faad2_node_decoder.js` - Node.js decoder module

## Troubleshooting Windows Build Issues

### Issue: `'.' is not recognized as an internal or external command`

**Cause:** The original Makefile uses bash-style commands (`./emsdk`) which don't work on Windows.

**Solution:** Use the Windows-specific build files:
```powershell
# Use build.bat instead
build.bat setup-emsdk

# Or use the Windows Makefile
make -f Makefile.win setup-emsdk
```

### Issue: `emsdk.bat` not found

**Cause:** Emscripten SDK not properly initialized.

**Solution:**
```powershell
cd emsdk
emsdk.bat install 4.0.11
emsdk.bat activate 4.0.11
cd ..
```

### Issue: `patch` command not found

**Cause:** Patch utility not installed on Windows.

**Solution:**
```powershell
# Install via Chocolatey
choco install patch

# Or download from GnuWin32
# http://gnuwin32.sourceforge.net/packages/patch.htm
```

### Issue: Build fails with emcc errors

**Cause:** Emscripten environment not activated.

**Solution:**
```powershell
cd emsdk
call emsdk_env.bat
cd ..
# Then try building again
```


## Usage

### Web Browser Usage

#### Basic Example (Web Audio API)

```javascript
import Faad2Module from './pkg/faad2_wasm.mjs'

const SAMPLE_RATE = {
  1: 8000, 2: 16000, 3: 22050, 4: 32000,
  5: 44100, 6: 48000, 7: 64000, 8: 88200, 9: 96000,
}

class FAAD2Decoder {
  constructor({ output, error }) {
    this.module = null
    this.initialized = false
    this.output = output
    this.error = error
  }

  async configure({ codec, description }) {
    const asc = new Uint8Array(description)

    try {
      if (!this.module) {
        this.module = await Faad2Module()
        console.debug('FAAD2: module loaded')
      }

      const ascPtr = this.module._malloc(asc.length)
      this.module.HEAPU8.set(asc, ascPtr)

      const result = this.module._init_decoder(ascPtr, asc.length)
      this.module._free(ascPtr)

      if (result < 0) {
        throw new Error('Failed to initialize FAAD2 decoder')
      }

      this.initialized = true
      console.debug('FAAD2Decoder: configured', codec)
    } catch (err) {
      this.error(new DOMException(err.message, 'InvalidStateError'))
    }
  }

  async decode(chunk) {
    if (!this.module || !this.initialized) {
      throw new Error('Decoder not initialized')
    }

    const input = new Uint8Array(chunk.byteLength)
    chunk.copyTo(input)

    const inPtr = this.module._malloc(input.length + 64)
    this.module.HEAPU8.set(input, inPtr)
    this.module.HEAPU8.fill(0, inPtr + input.length, inPtr + input.length + 64)

    const maxSamples = 2048 * 2 * 2
    const outputSize = maxSamples * Float32Array.BYTES_PER_ELEMENT
    const outPtr = this.module._malloc(outputSize)

    const packed = this.module._decode_frame(inPtr, input.length, outPtr, outputSize)
    this.module._free(inPtr)

    if (packed <= 0) {
      this.module._free(outPtr)
      return
    }

    const samplerateIndex = (packed >>> 28) & 0xf
    const numChannels = (packed >>> 24) & 0xf
    const samples = packed & 0xffffff
    const samplerate = SAMPLE_RATE[samplerateIndex] || 0

    const numFrames = samples / numChannels
    const planeSize = numFrames * Float32Array.BYTES_PER_ELEMENT

    const raw = new Float32Array(this.module.HEAPU8.buffer, outPtr, samples)
    const buffer = new ArrayBuffer(planeSize * numChannels)
    const left = new Float32Array(buffer, 0, numFrames)
    const right = new Float32Array(buffer, planeSize, numFrames)

    for (let i = 0; i < numFrames; i++) {
      left[i] = raw[i * 2]
      right[i] = raw[i * 2 + 1]
    }

    this.module._free(outPtr)

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: samplerate,
      numberOfFrames: numFrames,
      numberOfChannels: 2,
      timestamp: chunk.timestamp,
      data: buffer,
      transfer: [buffer],
    })

    this.output(audioData)
  }
}

export default FAAD2Decoder
```

### Node.js Usage

#### Installation

```bash
npm install @ohrstrom/faad2-wasm
```

#### Basic Example with Auto-Detection

```javascript
import FAAD2NodeDecoder from '@ohrstrom/faad2-wasm/faad2_node_decoder.js'
import { readFile } from 'fs/promises'

const decoder = new FAAD2NodeDecoder()
await decoder.ready

// Read AAC file (ADTS or raw)
const aacData = await readFile('audio.aac')

// Auto-configure from first frame
await decoder.configure(aacData, true) // true = auto-detect

// Decode frame
const result = decoder.decode(aacData)

if (result) {
  console.log('Sample Rate:', result.sampleRate)
  console.log('Channels:', result.channels)
  console.log('Samples per channel:', result.samplesPerChannel)
  // result.pcm contains Float32Array with interleaved audio data
}

decoder.destroy()
```

#### Explicit ASC Configuration

```javascript
import FAAD2NodeDecoder from '@ohrstrom/faad2-wasm/faad2_node_decoder.js'

const decoder = new FAAD2NodeDecoder()
await decoder.ready

// AudioSpecificConfig: AAC-LC, 44.1kHz, Stereo
const asc = Buffer.from([0x12, 0x10])

await decoder.configure(asc, false) // false = don't auto-detect

// Now decode raw AAC frames
const result = decoder.decode(rawAACFrame)
```

#### Stream Processing

```javascript
import FAAD2NodeDecoder from '@ohrstrom/faad2-wasm/faad2_node_decoder.js'
import { createReadStream } from 'fs'

const decoder = new FAAD2NodeDecoder()
await decoder.ready

const stream = createReadStream('audio.aac')
let firstFrame = true

stream.on('data', (chunk) => {
  try {
    if (firstFrame) {
      decoder.configure(chunk, true)
      firstFrame = false
    }

    const result = decoder.decode(chunk)
    
    if (result) {
      // Process PCM data
      console.log(`Decoded ${result.samplesPerChannel} samples`)
    }
  } catch (err) {
    console.error('Decode error:', err)
  }
})
```

#### Different Output Formats

```javascript
// Float32 interleaved (default)
const float32Result = decoder.decode(aacFrame)
// float32Result.pcm is Float32Array: [L, R, L, R, ...]

// Int16 interleaved (for most audio libraries)
const int16Result = decoder.decodeInt16(aacFrame)
// int16Result.pcm is Int16Array: [L, R, L, R, ...]

// Planar format (separate channels)
const planarResult = decoder.decodePlanar(aacFrame)
// planarResult.channelData[0] = left channel (Float32Array)
// planarResult.channelData[1] = right channel (Float32Array)
```

## Node.js API Reference

### `new FAAD2NodeDecoder()`

Creates a new decoder instance.

```javascript
const decoder = new FAAD2NodeDecoder()
await decoder.ready // Wait for WASM initialization
```

### `decoder.configure(ascOrFirstFrame, autoDetect = true)`

Configures the decoder with AudioSpecificConfig.

**Parameters:**
- `ascOrFirstFrame` (Buffer): 2-byte ASC OR complete AAC frame with ADTS header
- `autoDetect` (boolean): If `true`, automatically extracts ASC from ADTS frame

**Auto-Detection Features:**
- Detects ADTS frames (syncword 0xFFF)
- Extracts audio profile, sample rate, and channel configuration
- Automatically strips ADTS headers during decoding

```javascript
// Auto-detect from ADTS frame
await decoder.configure(adtsFrame, true)

// Use explicit ASC
await decoder.configure(Buffer.from([0x12, 0x10]), false)
```

### `decoder.decode(frameData)`

Decodes AAC frame to PCM Float32.

**Returns:**
```javascript
{
  pcm: Float32Array,        // Interleaved PCM (-1.0 to 1.0)
  sampleRate: number,       // Sample rate in Hz
  channels: number,         // Number of channels
  samplesPerChannel: number // Samples per channel
}
```

### `decoder.decodeInt16(frameData)`

Decodes AAC frame to PCM Int16.

**Returns:**
```javascript
{
  pcm: Int16Array,          // Interleaved PCM (-32768 to 32767)
  sampleRate: number,
  channels: number,
  samplesPerChannel: number
}
```

### `decoder.decodePlanar(frameData)`

Decodes AAC frame to planar format (separate channels).

**Returns:**
```javascript
{
  channelData: Float32Array[], // Array of channels [left, right]
  sampleRate: number,
  channels: number
}
```

### `decoder.reset()`

Resets decoder state.

### `decoder.destroy()`

Releases decoder resources.

## AudioSpecificConfig (ASC)

The ASC is a 2-byte configuration that defines:
- Audio Object Type (profile)
- Sampling Frequency Index
- Channel Configuration

**Example - AAC-LC, 44.1kHz, Stereo:**
```
0x12 0x10
```

**Decoding:**
```
Byte 0: 0x12 = 0001 0010
        ^^^^^ Audio Object Type = 2 (AAC-LC)
             ^^^ Sample Freq Index (part 1) = 4

Byte 1: 0x10 = 0001 0000
        ^ Sample Freq Index (part 2) = 4 (44100 Hz)
         ^^^ Channel Config = 2 (Stereo)
```

## Supported Sample Rates

| Index | Sample Rate |
|-------|-------------|
| 1     | 8000 Hz     |
| 2     | 16000 Hz    |
| 3     | 22050 Hz    |
| 4     | 32000 Hz    |
| 5     | 44100 Hz    |
| 6     | 48000 Hz    |
| 7     | 64000 Hz    |
| 8     | 88200 Hz    |
| 9     | 96000 Hz    |

## Supported Audio Formats

### Audio Codecs
- **AAC-LC** (Low Complexity) - Standard AAC
- **HE-AAC** (High Efficiency AAC / AAC+) - For lower bitrates
- **HE-AACv2** (High Efficiency AAC version 2 / AAC+ v2) - Enhanced low bitrate
- **AAC Main Profile**
- **AAC SSR** (Scalable Sample Rate)
- **AAC LTP** (Long Term Prediction)

### Container Formats
- **ADTS** streams (automatic header detection/removal)
- **Raw AAC** streams (requires AudioSpecificConfig)
- **MP4/M4A** containers (extract AAC frames first)

### Channel Configurations
FAAD2 supports various channel configurations:
- **Mono** (1.0)
- **Stereo** (2.0) 
- **3.0** (Front: L, C, R)
- **4.0** (Front: L, C, R + Back: C)
- **5.0** (Front: L, C, R + Back: L, R)
- **5.1** (Front: L, C, R + Back: L, R + LFE)
- **7.1** (Front: L, C, R + Side: L, R + Back: L, R + LFE)

**Note:** The current Node.js implementation in this fork is optimized for stereo output (2 channels). Multi-channel audio will be downmixed to stereo. For full multi-channel support, use the web version or extend the Node.js decoder.

## Complete Example - AAC to WAV Conversion

```javascript
import FAAD2NodeDecoder from '@ohrstrom/faad2-wasm/faad2_node_decoder.js'
import { readFile, writeFile } from 'fs/promises'

async function aacToWav(inputPath, outputPath) {
  const decoder = new FAAD2NodeDecoder()
  await decoder.ready
  
  const aacData = await readFile(inputPath)
  await decoder.configure(aacData, true)
  
  const result = decoder.decodeInt16(aacData)
  
  if (!result) {
    throw new Error('Failed to decode AAC')
  }
  
  console.log(`Decoded: ${result.sampleRate}Hz, ${result.channels}ch`)
  
  // Create WAV header
  const wavHeader = createWavHeader(
    result.pcm.length * 2,
    result.sampleRate,
    result.channels,
    16
  )
  
  const wavData = Buffer.concat([
    wavHeader,
    Buffer.from(result.pcm.buffer)
  ])
  
  await writeFile(outputPath, wavData)
  console.log(`Saved to ${outputPath}`)
  
  decoder.destroy()
}

function createWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  
  return header
}

// Usage
aacToWav('input.aac', 'output.wav')
  .then(() => console.log('Conversion complete!'))
  .catch(err => console.error('Error:', err))
```

## Build Targets

### All Platforms

- `setup-submodules` - Initialize Git submodules (faad2, emsdk)
- `setup-emsdk` - Install and activate Emscripten SDK
- `setup` - Run both setup targets
- `patch-libfaad` - Apply patches to FAAD2 library
- `ensure-headers` - Copy required header files
- `build` - Build WASM module for web browsers
- `build-node` - Build WASM module for Node.js (optional)
- `clean` - Remove built files
- `help` - Show available targets

### Build Commands by Platform

**Linux/macOS:**
```bash
make [target]
```

**Windows (Make):**
```powershell
make -f Makefile.win [target]
```

**Windows (Batch):**
```powershell
build.bat [target]
```

## Package Information

### Files Included

- `faad2_wasm.mjs` - JavaScript/WASM module (ES6)
- `faad2_wasm.wasm` - WebAssembly binary
- `faad2_decoder.js` - Web Audio API decoder class
- `faad2_node_decoder.js` - Node.js decoder with auto-detection

### NPM Package

```json
{
  "name": "@ecliptia/faad2-wasm",
  "version": "2.11.2",
  "type": "module",
  "main": "faad2_wasm.mjs"
}
```

**Note:** This is a fork of [@ohrstrom/faad2-wasm](https://www.npmjs.com/package/@ohrstrom/faad2-wasm) with Windows build support and Node.js enhancements.

## Performance

- **Decoding Speed:** Real-time or faster on modern hardware
- **Memory Usage:** ~1-2MB for decoder + audio buffers
- **Latency:** Low (frame-by-frame decoding)
- **WASM Optimization:** -O3 (maximum optimization)
- **Supported Sample Rates:** 8kHz to 96kHz
- **Supported Channels:** Up to 8 channels (7.1)

## Technical Limitations

### Current Implementation

The C wrapper (`src/faad2_wasm.c`) uses these settings:
- Output format: `FAAD_FMT_FLOAT` (32-bit float)
- Default sample rate: 48000 Hz
- Maximum frame size: 2048 samples per channel

### Node.js Decoder Specifics

The Node.js decoder (`faad2_node_decoder.js`) currently:
- Processes stereo output (2 channels)
- Multi-channel audio is handled by FAAD2 but decoded output focuses on stereo
- Maximum buffer: 2048 frames × 2 channels

**Why these "limitations"?**
These are not hard limitations of FAAD2 itself, but implementation choices for optimization:
1. **Stereo focus:** Most streaming audio is stereo, optimizing for the common case
2. **Buffer size:** 2048 samples is sufficient for most AAC frames
3. **Float32 output:** Provides best precision for further processing

### Extending the Decoder

To support more channels or different configurations:

1. **Modify the C wrapper** (`src/faad2_wasm.c`):
   ```c
   // Change output format if needed
   config->outputFormat = FAAD_FMT_FLOAT; // or FAAD_FMT_16BIT
   
   // Adjust default sample rate
   config->defSampleRate = 48000;
   ```

2. **Update the Node.js decoder** (`pkg/faad2_node_decoder.js`):
   ```javascript
   // Increase buffer size for more channels
   const maxFrames = 2048 * 2
   const maxChannels = 8 // Support up to 7.1
   ```

3. **Rebuild:**
   ```bash
   ./build.bat build-node
   ```

### FAAD2 Core Capabilities

FAAD2 library itself supports:
- ✅ All AAC profiles (LC, Main, SSR, LTP)
- ✅ HE-AAC (SBR - Spectral Band Replication)
- ✅ HE-AACv2 (PS - Parametric Stereo)
- ✅ Up to 8 channels
- ✅ Sample rates from 8kHz to 96kHz
- ✅ Multiple output formats (16-bit, 24-bit, 32-bit, float, double)


## License

LGPL-3.0-or-later

## Copyrights FAAD2

```text
For FAAD2 the following license applies:

******************************************************************************
** FAAD2 - Freeware Advanced Audio (AAC) Decoder including SBR decoding
** Copyright (C) 2003-2005 M. Bakker, Nero AG, http://www.nero.com
**
** This program is free software; you can redistribute it and/or modify
** it under the terms of the GNU General Public License as published by
** the Free Software Foundation; either version 2 of the License, or
** (at your option) any later version.
**
** This program is distributed in the hope that it will be useful,
** but WITHOUT ANY WARRANTY; without even the implied warranty of
** MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
** GNU General Public License for more details.
**
** You should have received a copy of the GNU General Public License
** along with this program; if not, write to the Free Software
** Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
**
** Any non-GPL usage of this software or parts of this software is strictly
** forbidden.
**
** The "appropriate copyright message" mentioned in section 2c of the GPLv2
** must read: "Code from FAAD2 is copyright (c) Nero AG, www.nero.com"
**
** Commercial non-GPL licensing of this software is possible.
** For more info contact Nero AG through Mpeg4AAClicense@nero.com.
******************************************************************************

Please note that the use of this software may require the payment of
patent royalties. You need to consider this issue before you start
building derivative works. We are not warranting or indemnifying you in
any way for patent royalities! YOU ARE SOLELY RESPONSIBLE FOR YOUR OWN
ACTIONS!
```

## References

- [Original Project - ohrstrom/faad2-wasm](https://github.com/ohrstrom/faad2-wasm)
- [This Fork - Ecliptia/faad2-wasm](https://github.com/Ecliptia/faad2-wasm)
- [FAAD2 GitHub Repository](https://github.com/knik0/faad2)
- [FAAD2 License](https://github.com/knik0/faad2/blob/master/COPYING)
- [Emscripten Documentation](https://emscripten.org/)
- [WebAssembly](https://webassembly.org/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request to [Ecliptia/faad2-wasm](https://github.com/Ecliptia/faad2-wasm).

## Credits

- Original FAAD2 by M. Bakker and Nero AG
- Original WebAssembly bindings by Jonas Ohrstrom ([@ohrstrom](https://github.com/ohrstrom))
- Windows compatibility and Node.js enhancements by Ecliptia team

## Changelog

### v2.11.2-ecliptia.1 (This Fork)
- ✅ Added Windows build support (`build.bat`, `Makefile.win`)
- ✅ Added Node.js decoder with auto-detection (`faad2_node_decoder.js`)
- ✅ Added comprehensive documentation
- ✅ Fixed Windows compilation issues
- ✅ Added ADTS header auto-detection
- ✅ Added multiple output formats (Float32, Int16, Planar)
- ✅ Added stream processing examples

### v2.11.2 (Original)
- Based on FAAD2 v2.11.2
- WebAssembly bindings for browsers
- Basic decoder implementation
