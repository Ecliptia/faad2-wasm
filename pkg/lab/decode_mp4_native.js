import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FAAD2Decoder from '../faad2_node_decoder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple MP4 parser to extract AAC audio
class MP4Parser {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    readUInt32() {
        const value = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    readUInt16() {
        const value = this.buffer.readUInt16BE(this.offset);
        this.offset += 2;
        return value;
    }

    readUInt8() {
        const value = this.buffer.readUInt8(this.offset);
        this.offset += 1;
        return value;
    }

    read(length) {
        const data = this.buffer.slice(this.offset, this.offset + length);
        this.offset += length;
        return data;
    }

    skip(length) {
        this.offset += length;
    }

    readBox() {
        if (this.offset >= this.buffer.length) return null;

        const size = this.readUInt32();
        const type = this.read(4).toString('ascii');
        const data = this.read(size - 8);

        return { type, size, data };
    }

    findBox(type, data = this.buffer) {
        const parser = new MP4Parser(data);
        while (parser.offset < data.length) {
            const box = parser.readBox();
            if (!box) break;
            if (box.type === type) return box;
        }
        return null;
    }

    findBoxPath(types) {
        let current = this.buffer;
        for (const type of types) {
            const parser = new MP4Parser(current);
            const box = parser.findBox(type, current);
            if (!box) return null;
            current = box.data;
        }
        return current;
    }
}

function extractAudioFromMP4(mp4Buffer) {
    console.log('=== Parsing MP4 Container ===\n');
    const parser = new MP4Parser(mp4Buffer);
    
    // Find moov box
    const moov = parser.findBox('moov');
    if (!moov) {
        throw new Error('No moov box found in MP4');
    }
    console.log('✓ Found moov box');

    // Find trak boxes
    const moovParser = new MP4Parser(moov.data);
    const tracks = [];
    while (moovParser.offset < moov.data.length) {
        const box = moovParser.readBox();
        if (!box) break;
        if (box.type === 'trak') {
            tracks.push(box);
        }
    }
    console.log(`✓ Found ${tracks.length} tracks`);

    // Find audio track
    let audioTrack = null;
    let audioTrackId = null;
    for (const trak of tracks) {
        const mdia = new MP4Parser(trak.data).findBox('mdia', trak.data);
        if (!mdia) continue;
        
        const hdlr = new MP4Parser(mdia.data).findBox('hdlr', mdia.data);
        if (!hdlr) continue;
        
        const hdlrParser = new MP4Parser(hdlr.data);
        hdlrParser.skip(8); // version + flags + pre_defined
        const handlerType = hdlrParser.read(4).toString('ascii');
        
        if (handlerType === 'soun') {
            audioTrack = trak;
            // Get track ID from tkhd
            const tkhd = new MP4Parser(trak.data).findBox('tkhd', trak.data);
            if (tkhd) {
                const tkhdParser = new MP4Parser(tkhd.data);
                const version = tkhdParser.readUInt8();
                tkhdParser.skip(3); // flags
                if (version === 1) {
                    tkhdParser.skip(16); // creation_time + modification_time
                } else {
                    tkhdParser.skip(8);
                }
                audioTrackId = tkhdParser.readUInt32();
            }
            break;
        }
    }

    if (!audioTrack) {
        throw new Error('No audio track found in MP4');
    }
    console.log(`✓ Found audio track (ID: ${audioTrackId})`);

    // Extract AudioSpecificConfig from esds
    const stsd = new MP4Parser(audioTrack.data).findBox('stsd', 
        new MP4Parser(audioTrack.data).findBox('stbl', 
            new MP4Parser(audioTrack.data).findBox('minf', 
                new MP4Parser(audioTrack.data).findBox('mdia', audioTrack.data).data
            ).data
        ).data
    );

    let audioConfig = null;
    if (stsd) {
        const stsdParser = new MP4Parser(stsd.data);
        stsdParser.skip(8); // version + flags + entry_count
        const sampleEntrySize = stsdParser.readUInt32();
        const sampleEntryType = stsdParser.read(4).toString('ascii');
        console.log(`✓ Audio codec: ${sampleEntryType}`);
        
        stsdParser.skip(6 + 2); // reserved + data_reference_index
        stsdParser.skip(8); // version + revision
        stsdParser.skip(4); // vendor
        const channelCount = stsdParser.readUInt16();
        const sampleSize = stsdParser.readUInt16();
        stsdParser.skip(4); // pre_defined + reserved
        const sampleRate = stsdParser.readUInt32() >>> 16;
        
        console.log(`  Channels: ${channelCount}`);
        console.log(`  Sample Size: ${sampleSize} bits`);
        console.log(`  Sample Rate: ${sampleRate} Hz`);

        // Find esds box in sample entry
        const esds = new MP4Parser(stsd.data).findBox('esds', stsd.data);
        if (esds) {
            const esdsParser = new MP4Parser(esds.data);
            esdsParser.skip(4); // version + flags
            
            // Parse ES_Descriptor
            let tag = esdsParser.readUInt8();
            if (tag === 0x03) { // ES_DescrTag
                let size = 0;
                let byte;
                do {
                    byte = esdsParser.readUInt8();
                    size = (size << 7) | (byte & 0x7F);
                } while (byte & 0x80);
                
                esdsParser.skip(3); // ES_ID + flags
                
                // DecoderConfigDescriptor
                tag = esdsParser.readUInt8();
                if (tag === 0x04) {
                    size = 0;
                    do {
                        byte = esdsParser.readUInt8();
                        size = (size << 7) | (byte & 0x7F);
                    } while (byte & 0x80);
                    
                    esdsParser.skip(13); // objectTypeIndication + streamType + bufferSizeDB + maxBitrate + avgBitrate
                    
                    // DecoderSpecificInfo
                    tag = esdsParser.readUInt8();
                    if (tag === 0x05) {
                        size = 0;
                        do {
                            byte = esdsParser.readUInt8();
                            size = (size << 7) | (byte & 0x7F);
                        } while (byte & 0x80);
                        
                        audioConfig = esdsParser.read(size);
                        console.log(`✓ Found AudioSpecificConfig: ${audioConfig.toString('hex')}`);
                    }
                }
            }
        }
    }

    // Find mdat box (audio data)
    const mdat = parser.findBox('mdat');
    if (!mdat) {
        throw new Error('No mdat box found in MP4');
    }
    console.log(`✓ Found mdat box (${mdat.data.length} bytes)\n`);

    return {
        audioConfig,
        audioData: mdat.data,
        trackId: audioTrackId
    };
}

async function testMP4Decode() {
    console.log('=== HE-AAC MP4 Decoding Test (Native) ===\n');
    
    const mp4File = path.join(__dirname, 'input.mp4');
    const outputFile = path.join(__dirname, 'decoded_native.pcm');
    const output16File = path.join(__dirname, 'decoded_native_16bit.pcm');
    
    if (!fs.existsSync(mp4File)) {
        console.error('Error: input.mp4 not found!');
        console.log('Please download the test file first.');
        return;
    }
    
    // Read MP4 file
    console.log('Reading MP4 file...');
    const mp4Buffer = fs.readFileSync(mp4File);
    console.log(`✓ Loaded ${mp4Buffer.length} bytes\n`);
    
    // Extract audio from MP4
    const { audioConfig, audioData } = extractAudioFromMP4(mp4Buffer);
    
    if (!audioConfig) {
        console.error('✗ Could not extract AudioSpecificConfig');
        return;
    }
    
    // Initialize decoder
    console.log('=== Initializing FAAD2 Decoder ===\n');
    const decoder = new FAAD2Decoder();
    await decoder.ready;
    console.log('✓ Decoder ready');
    
    // Configure with AudioSpecificConfig
    console.log('Configuring decoder with ASC...');
    await decoder.configure(audioConfig, false);
    console.log('✓ Decoder configured\n');
    
    // Decode audio data
    console.log('=== Decoding Audio ===\n');
    console.log(`Processing ${audioData.length} bytes of audio data...`);
    
    const pcmChunks = [];
    let totalSamples = 0;
    let frameCount = 0;
    let offset = 0;
    
    // Process in chunks
    const chunkSize = 4096;
    while (offset < audioData.length) {
        const chunk = audioData.slice(offset, Math.min(offset + chunkSize, audioData.length));
        
        try {
            const result = decoder.decode(chunk);
            
            if (result && result.pcm && result.pcm.length > 0) {
                pcmChunks.push(result.pcm);
                totalSamples += result.samplesPerChannel;
                frameCount++;
                
                if (frameCount === 1) {
                    console.log(`First successful frame:`);
                    console.log(`  Sample Rate: ${result.sampleRate} Hz`);
                    console.log(`  Channels: ${result.channels}`);
                    console.log(`  Samples per Channel: ${result.samplesPerChannel}`);
                    console.log(``);
                }
                
                if (frameCount % 100 === 0) {
                    console.log(`  Decoded ${frameCount} frames (${totalSamples} samples)...`);
                }
                
                offset += chunkSize;
            } else {
                offset += chunkSize;
            }
        } catch (error) {
            offset += chunkSize;
        }
    }
    
    console.log('\n=== Decoding Complete ===');
    console.log(`Total frames decoded: ${frameCount}`);
    console.log(`Total samples per channel: ${totalSamples}`);
    console.log(`Total PCM floats: ${pcmChunks.reduce((sum, c) => sum + c.length, 0)}`);
    
    if (pcmChunks.length > 0) {
        // Combine all PCM chunks
        const totalLength = pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const allPcm = new Float32Array(totalLength);
        let writeOffset = 0;
        for (const chunk of pcmChunks) {
            allPcm.set(chunk, writeOffset);
            writeOffset += chunk.length;
        }
        
        // Save Float32
        fs.writeFileSync(outputFile, Buffer.from(allPcm.buffer));
        console.log(`\n✓ Saved Float32 PCM: ${outputFile}`);
        console.log(`  Size: ${allPcm.buffer.byteLength} bytes`);
        
        // Save Int16
        const pcm16 = new Int16Array(allPcm.length);
        for (let i = 0; i < allPcm.length; i++) {
            const s = Math.max(-1, Math.min(1, allPcm[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        fs.writeFileSync(output16File, Buffer.from(pcm16.buffer));
        console.log(`✓ Saved Int16 PCM: ${output16File}`);
        console.log(`  Size: ${pcm16.buffer.byteLength} bytes`);
        
        console.log(`\n✓ Decode complete! Play with:`);
        console.log(`  ffplay -f s16le -ar 44100 -channels 2 ${output16File}`);
    } else {
        console.log('\n✗ No audio data decoded');
    }
    
    decoder.destroy();
    console.log('\nDecoder destroyed');
}

testMP4Decode().catch(error => {
    console.error('\n✗ Fatal error:', error.message);
    console.error(error.stack);
});
