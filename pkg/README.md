# FAAD2 WASM Bindings

This project provides a WebAssembly (WASM) binding for the FAAD2 AAC decoder, allowing it to be used in web applications.  
The main motivation to provide a WASM based `FAAD2Decoder` replacement is to support decoding of AAC audio streams in environments where the native `AudioDecoder` API is not available or does not support AAC.

Currently only Chromium-based seem to natively support AAC-HE decoding - but there is no support for PS (Parametric Stereo).
This library allows you to decode AAC-HE and AAC-HE-v2 with PS in browsers that do not support it natively.

## Usage

### Browser Usage

```javascript
import FAAD2Decoder from '@ohrstrom/faad2-wasm/faad2_decoder.js'
```

`FAAD2Decoder` works as a drop-in replacement for [AudioDecoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioDecoder)

```javascript
const audioDecoder = new FAAD2Decoder({
  output: processAudio,
  error: onEncoderError,
});

const asc = new Uint8Array([0x13, 0x14, 0x56, 0xe5, 0x98])  
await audioDecoder.configure({
  'mp4a.40.5',
  sampleRate: 48_000,
  numberOfChannels: 2,
  description: asc.buffer,
})

```

### Node.js Usage

```javascript
import FAAD2NodeDecoder from '@ohrstrom/faad2-wasm/faad2_node_decoder.js'

const decoder = new FAAD2NodeDecoder()
await decoder.ready

// Decode AAC data
const aacData = Buffer.from([/* your AAC data */])
const pcmData = await decoder.decode(aacData)

console.log('Sample Rate:', decoder.sampleRate)
console.log('Channels:', decoder.channels)
console.log('PCM Data:', pcmData) // Float32Array
```

The Node.js decoder automatically detects:
- ADTS headers and extracts AudioSpecificConfig
- Sample rate and channel configuration
- Supports stereo output (2 channels)
- Returns Float32Array with decoded PCM audio

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

Also see [github.com/knik0/faad2](https://github.com/knik0/faad2) and
[COPYING](https://github.com/knik0/faad2/blob/master/COPYING)
