import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FAAD2Decoder from '../faad2_node_decoder.js';
import * as MP4Box from 'mp4box';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create WAV file header
function createWAVHeader(dataSize, sampleRate, channels, bitsPerSample) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20);  // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    return header;
}

async function extractAudioWithMP4Box(mp4FilePath) {
    return new Promise((resolve, reject) => {
        console.log('=== Parsing MP4 with MP4Box ===\n');
        
        const mp4boxfile = MP4Box.createFile();
        const audioSamples = [];
        let audioTrack = null;
        let audioConfig = null;
        
        mp4boxfile.onError = (e) => reject(new Error(`MP4Box error: ${e}`));
        
        mp4boxfile.onReady = (info) => {
            console.log('✓ MP4 file parsed successfully\n');
            console.log('Movie info:');
            console.log(`  Duration: ${info.duration / info.timescale} seconds`);
            console.log(`  Timescale: ${info.timescale}`);
            console.log(`  Brands: ${info.brands.join(', ')}`);
            console.log(`\nTracks found: ${info.tracks.length}`);
            
            // Find audio track
            for (const track of info.tracks) {
                console.log(`\nTrack ${track.id}:`);
                console.log(`  Type: ${track.type}`);
                console.log(`  Codec: ${track.codec}`);
                console.log(`  Duration: ${track.duration / track.timescale} seconds`);
                
                if (track.type === 'audio') {
                    audioTrack = track;
                    console.log(`  Sample Rate: ${track.audio.sample_rate} Hz`);
                    console.log(`  Channels: ${track.audio.channel_count}`);
                    console.log(`  Sample Size: ${track.audio.sample_size} bits`);
                    
                    // Get decoder config (AudioSpecificConfig)
                    // Try multiple ways to get the config
                    if (track.codec_config) {
                        audioConfig = Buffer.from(track.codec_config);
                        console.log(`  ✓ AudioSpecificConfig (codec_config): ${audioConfig.toString('hex')}`);
                    } else if (track.audio.decoder_config) {
                        audioConfig = Buffer.from(track.audio.decoder_config);
                        console.log(`  ✓ AudioSpecificConfig (decoder_config): ${audioConfig.toString('hex')}`);
                    } else {
                        // Try to get from track description
                        const trak = mp4boxfile.getTrackById(track.id);
                        if (trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl && trak.mdia.minf.stbl.stsd) {
                            const entries = trak.mdia.minf.stbl.stsd.entries;
                            if (entries && entries.length > 0 && entries[0].esds) {
                                const esds = entries[0].esds;
                                if (esds.esd && esds.esd.descs && esds.esd.descs.length > 0) {
                                    const desc = esds.esd.descs[0];
                                    if (desc.dec_config && desc.dec_config.length > 0) {
                                        audioConfig = Buffer.from(desc.dec_config);
                                        console.log(`  ✓ AudioSpecificConfig (esds): ${audioConfig.toString('hex')}`);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            if (!audioTrack) {
                reject(new Error('No audio track found'));
                return;
            }
            
            // If no AudioSpecificConfig found, create one from codec string
            if (!audioConfig && audioTrack.codec) {
                // Parse codec string like "mp4a.40.5"
                const codecParts = audioTrack.codec.split('.');
                if (codecParts.length >= 3 && codecParts[0] === 'mp4a' && codecParts[1] === '40') {
                    const objectType = parseInt(codecParts[2], 10);
                    console.log(`\nCreating AudioSpecificConfig from codec string:`);
                    console.log(`  Codec: ${audioTrack.codec}`);
                    console.log(`  Object Type: ${objectType} (${objectType === 5 ? 'HE-AAC' : objectType === 2 ? 'AAC-LC' : 'Unknown'})`);
                    
                    // For HE-AAC (objectType 5), we need to create proper ASC
                    // HE-AAC uses AAC-LC (2) as base + SBR extension
                    const sampleRate = audioTrack.audio.sample_rate;
                    const channels = audioTrack.audio.channel_count;
                    
                    // Get sample rate index
                    const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
                    let sampleRateIndex = sampleRates.indexOf(sampleRate);
                    if (sampleRateIndex === -1) sampleRateIndex = 15; // escape value
                    
                    if (objectType === 5) {
                        // HE-AAC: use half sample rate for core
                        const coreSampleRate = sampleRate / 2;
                        let coreSampleRateIndex = sampleRates.indexOf(coreSampleRate);
                        if (coreSampleRateIndex === -1) coreSampleRateIndex = 15;
                        
                        // ASC for HE-AAC: [5 bits audioObjectType][4 bits sampleRateIndex][4 bits channelConfig]
                        //                 [5 bits extensionAudioObjectType=5][4 bits extSampleRateIndex]
                        audioConfig = Buffer.alloc(4);
                        audioConfig[0] = (objectType << 3) | (coreSampleRateIndex >> 1);
                        audioConfig[1] = ((coreSampleRateIndex & 0x1) << 7) | (channels << 3) | 0x04; // syncExtensionType start
                        audioConfig[2] = 0x56; // syncExtensionType continued + SBR flag
                        audioConfig[3] = 0xE5 | (sampleRateIndex << 3); // actual output sample rate
                        
                        console.log(`  Core Sample Rate: ${coreSampleRate} Hz (index ${coreSampleRateIndex})`);
                        console.log(`  Output Sample Rate: ${sampleRate} Hz (index ${sampleRateIndex})`);
                        console.log(`  Channels: ${channels}`);
                        console.log(`  ✓ Generated HE-AAC AudioSpecificConfig: ${audioConfig.toString('hex')}`);
                    } else {
                        // Standard AAC-LC
                        audioConfig = Buffer.alloc(2);
                        audioConfig[0] = (objectType << 3) | (sampleRateIndex >> 1);
                        audioConfig[1] = ((sampleRateIndex & 0x1) << 7) | (channels << 3);
                        
                        console.log(`  Sample Rate: ${sampleRate} Hz (index ${sampleRateIndex})`);
                        console.log(`  Channels: ${channels}`);
                        console.log(`  ✓ Generated AAC-LC AudioSpecificConfig: ${audioConfig.toString('hex')}`);
                    }
                }
            }
            
            console.log(`\n=== Extracting Audio Samples ===\n`);
            
            // Set extraction options
            mp4boxfile.setExtractionOptions(audioTrack.id, null, {
                nbSamples: Infinity
            });
            
            mp4boxfile.start();
        };
        
        mp4boxfile.onSamples = (id, user, samples) => {
            console.log(`Received ${samples.length} samples from track ${id}`);
            audioSamples.push(...samples);
        };
        
        // Read and append file data
        const fileData = fs.readFileSync(mp4FilePath);
        const arrayBuffer = new Uint8Array(fileData).buffer;
        arrayBuffer.fileStart = 0;
        
        mp4boxfile.appendBuffer(arrayBuffer);
        mp4boxfile.flush();
        
        // Wait a bit for processing
        setTimeout(() => {
            resolve({
                audioConfig,
                samples: audioSamples,
                track: audioTrack
            });
        }, 100);
    });
}

async function testMP4NativeDecode() {
    console.log('=== HE-AAC MP4 Decoding Test (100% Native JS) ===\n');
    
    const mp4File = path.join(__dirname, 'input.mp4');
    const outputFile = path.join(__dirname, 'decoded_native.pcm');
    const output16File = path.join(__dirname, 'decoded_native_16bit.pcm');
    
    if (!fs.existsSync(mp4File)) {
        console.error('✗ Error: input.mp4 not found!');
        return;
    }
    
    try {
        // Extract audio using MP4Box
        const { audioConfig, samples, track } = await extractAudioWithMP4Box(mp4File);
        
        if (!audioConfig) {
            console.error('✗ No AudioSpecificConfig found');
            return;
        }
        
        if (samples.length === 0) {
            console.error('✗ No audio samples found');
            return;
        }
        
        console.log(`\n✓ Extracted ${samples.length} audio samples`);
        console.log(`  Total audio data: ${samples.reduce((sum, s) => sum + s.size, 0)} bytes\n`);
        
        // Initialize FAAD2 decoder
        console.log('=== Initializing FAAD2 Decoder ===\n');
        const decoder = new FAAD2Decoder();
        await decoder.ready;
        console.log('✓ Decoder ready');
        
        // For MP4 extracted samples (raw AAC without ADTS), we MUST provide correct ASC
        // Create proper ASC based on codec info
        let finalASC;
        
        if (track && track.codec === 'mp4a.40.5') {
            // HE-AAC v1: Use AAC-LC ASC and let FAAD2 detect SBR implicitly
            const channels = track.audio.channel_count;
            
            // Use 22050 Hz (core rate) for HE-AAC
            const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
            const sampleRateIndex = 7; // 22050 Hz
            
            finalASC = Buffer.alloc(2);
            finalASC[0] = (2 << 3) | (sampleRateIndex >> 1); // AAC-LC (2)
            finalASC[1] = ((sampleRateIndex & 0x1) << 7) | (channels << 3);
            
            console.log(`Generated ASC for HE-AAC (implicit SBR):`);
            console.log(`  Profile: AAC-LC (2) - SBR will be detected from bitstream`);
            console.log(`  Core Sample Rate: 22050 Hz (index ${sampleRateIndex})`);
            console.log(`  Channels: ${channels}`);
            console.log(`  ASC bytes: ${finalASC.toString('hex')}`);
            console.log(``);
        } else if (audioConfig) {
            finalASC = audioConfig;
            console.log(`Using provided ASC: ${finalASC.toString('hex')}\n`);
        }
        
        if (!finalASC) {
            throw new Error('Cannot create AudioSpecificConfig');
        }
        
        console.log(`Configuring decoder with ASC: ${finalASC.toString('hex')}`);
        await decoder.configure(finalASC, false); // false = use ASC as-is, don't try to detect
        console.log('✓ Decoder configured\n');
        
        // Decode samples
        console.log('=== Decoding Audio Samples ===\n');
        const pcmChunks = [];
        let totalSamples = 0;
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < samples.length; i++) {
            const sample = samples[i];
            const sampleData = Buffer.from(sample.data);
            
            try {
                const result = decoder.decode(sampleData);
                
                if (result && result.pcm && result.pcm.length > 0) {
                    if (successCount === 0) {
                        console.log(`First successful decode (sample ${i}):`);
                        console.log(`  Sample Rate: ${result.sampleRate} Hz`);
                        console.log(`  Channels: ${result.channels}`);
                        console.log(`  Samples per Channel: ${result.samplesPerChannel}`);
                        console.log(`  PCM Length: ${result.pcm.length}`);
                        console.log(`  PCM Range: [${Math.min(...result.pcm).toFixed(4)}, ${Math.max(...result.pcm).toFixed(4)}]\n`);
                    }
                    
                    pcmChunks.push(result.pcm);
                    totalSamples += result.samplesPerChannel;
                    successCount++;
                    
                    if (successCount % 100 === 0) {
                        console.log(`  Progress: ${successCount}/${samples.length} samples decoded...`);
                    }
                } else {
                    failCount++;
                }
            } catch (error) {
                failCount++;
                if (failCount <= 5) {
                    console.log(`  Sample ${i} decode error: ${error.message}`);
                }
            }
        }
        
        console.log('\n=== Decoding Summary ===');
        console.log(`Total samples processed: ${samples.length}`);
        console.log(`Successfully decoded: ${successCount} (${(successCount/samples.length*100).toFixed(1)}%)`);
        console.log(`Failed: ${failCount} (${(failCount/samples.length*100).toFixed(1)}%)`);
        console.log(`Total PCM samples per channel: ${totalSamples}`);
        console.log(`Total PCM floats: ${pcmChunks.reduce((sum, c) => sum + c.length, 0)}`);
        
        if (track) {
            const duration = totalSamples / 44100; // Assuming 44100 Hz output
            console.log(`Duration: ${duration.toFixed(2)} seconds`);
        }
        
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
            console.log(`\n✓ Saved Float32 PCM: ${path.basename(outputFile)}`);
            console.log(`  Size: ${(allPcm.buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
            
            // Get sample rate from first decoded result
            const testResult = decoder.decode(Buffer.from(samples[0].data));
            const sampleRate = testResult?.sampleRate || 44100;
            
            // Convert to Int16
            const pcm16 = new Int16Array(allPcm.length);
            for (let i = 0; i < allPcm.length; i++) {
                const s = Math.max(-1, Math.min(1, allPcm[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            fs.writeFileSync(output16File, Buffer.from(pcm16.buffer));
            console.log(`✓ Saved Int16 PCM: ${path.basename(output16File)}`);
            console.log(`  Size: ${(pcm16.buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
            
            // Create WAV file with proper header
            const wavFile = path.join(__dirname, 'decoded_native.wav');
            const wavHeader = createWAVHeader(pcm16.buffer.byteLength, sampleRate, 2, 16);
            const wavData = Buffer.concat([wavHeader, Buffer.from(pcm16.buffer)]);
            fs.writeFileSync(wavFile, wavData);
            console.log(`✓ Saved WAV file: ${path.basename(wavFile)}`);
            console.log(`  Size: ${(wavData.length / 1024 / 1024).toFixed(2)} MB`);
            
            console.log(`\n✅ SUCCESS! Audio decoded using FAAD2-WASM`);
            console.log(`\nPlay with:`);
            console.log(`  ffplay ${wavFile}`);
        } else {
            console.log('\n✗ No audio data was successfully decoded');
        }
        
        decoder.destroy();
        console.log('\nDecoder destroyed');
        
    } catch (error) {
        console.error('\n✗ Fatal error:', error.message);
        console.error(error.stack);
    }
}

testMP4NativeDecode().catch(console.error);
