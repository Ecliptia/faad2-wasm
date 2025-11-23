import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FAAD2Decoder from '../faad2_node_decoder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseADTS(data, offset = 0) {
    if (offset + 7 > data.length) return null;
    
    const syncword = (data[offset] << 4) | (data[offset + 1] >> 4);
    if (syncword !== 0xFFF) return null;
    
    const protectionAbsent = (data[offset + 1] & 0x01);
    const profile = ((data[offset + 2] >> 6) & 0x03) + 1;
    const sampleRateIndex = (data[offset + 2] >> 2) & 0x0F;
    const channelConfig = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] >> 6) & 0x03);
    const frameLength = ((data[offset + 3] & 0x03) << 11) | (data[offset + 4] << 3) | ((data[offset + 5] >> 5) & 0x07);
    const headerSize = protectionAbsent ? 7 : 9;
    
    const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const profiles = ['', 'AAC Main', 'AAC LC', 'AAC SSR', 'AAC LTP', 'HE-AAC', 'HE-AAC v2'];
    
    return {
        syncword,
        profile,
        profileName: profiles[profile] || `Profile ${profile}`,
        sampleRateIndex,
        sampleRate: sampleRates[sampleRateIndex],
        channelConfig,
        channels: channelConfig === 7 ? 8 : channelConfig,
        frameLength,
        headerSize,
        protectionAbsent,
        dataLength: frameLength - headerSize
    };
}

async function testHEAAC() {
    console.log('=== Testing HE-AAC Decoder ===\n');
    
    const inputFile = path.join(__dirname, 'output.aac');
    const outputFile = path.join(__dirname, 'decoded.pcm');
    
    if (!fs.existsSync(inputFile)) {
        console.error('Error: output.aac not found!');
        return;
    }
    
    const aacData = fs.readFileSync(inputFile);
    console.log(`Input file size: ${aacData.length} bytes`);
    console.log(`First bytes: ${Array.from(aacData.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}\n`);
    
    // Parse first ADTS frame
    const firstFrame = parseADTS(aacData, 0);
    if (firstFrame) {
        console.log('First ADTS frame info:');
        console.log(`  Profile: ${firstFrame.profileName} (${firstFrame.profile})`);
        console.log(`  Sample rate: ${firstFrame.sampleRate} Hz (index ${firstFrame.sampleRateIndex})`);
        console.log(`  Channels: ${firstFrame.channels} (config ${firstFrame.channelConfig})`);
        console.log(`  Frame length: ${firstFrame.frameLength} bytes`);
        console.log(`  Header size: ${firstFrame.headerSize} bytes`);
        console.log(`  Data length: ${firstFrame.dataLength} bytes\n`);
    }
    
    const decoder = new FAAD2Decoder();
    
    try {
        console.log('Initializing decoder...');
        await decoder.ready;
        console.log('✓ Decoder initialized\n');
        
        // Configure decoder with first AAC frame
        console.log('Configuring decoder with first frame...');
        await decoder.configure(aacData);
        console.log('✓ Decoder configured\n');
        
        let offset = 0;
        let frameCount = 0;
        let totalSamples = 0;
        const pcmChunks = [];
        const maxFrames = 50; // Process first 50 frames for testing
        
        while (offset < aacData.length && frameCount < maxFrames) {
            const frameInfo = parseADTS(aacData, offset);
            
            if (!frameInfo) {
                console.log(`✗ No ADTS header found at offset ${offset}`);
                break;
            }
            
            const frameData = aacData.slice(offset, offset + frameInfo.frameLength);
            
            console.log(`\n--- Frame ${frameCount + 1} ---`);
            console.log(`  Offset: ${offset}`);
            console.log(`  Length: ${frameInfo.frameLength} bytes (${frameInfo.dataLength} data)`);
            console.log(`  Profile: ${frameInfo.profileName}`);
            console.log(`  Sample rate: ${frameInfo.sampleRate} Hz`);
            console.log(`  Channels: ${frameInfo.channels}`);
            
            try {
                const result = decoder.decode(frameData);
                
                if (result && result.pcm && result.pcm.length > 0) {
                    console.log(`  ✓ Decoded successfully!`);
                    console.log(`    Sample rate: ${result.sampleRate} Hz`);
                    console.log(`    Channels: ${result.channels}`);
                    console.log(`    Samples per channel: ${result.samplesPerChannel}`);
                    console.log(`    Total samples: ${result.pcm.length}`);
                    console.log(`    PCM range: [${Math.min(...result.pcm).toFixed(4)}, ${Math.max(...result.pcm).toFixed(4)}]`);
                    
                    pcmChunks.push(result.pcm);
                    totalSamples += result.samplesPerChannel;
                    frameCount++;
                } else {
                    console.log(`  ✗ No PCM data returned (null or empty)`);
                }
            } catch (error) {
                console.error(`  ✗ Decode error: ${error.message}`);
            }
            
            offset += frameInfo.frameLength;
        }
        
        console.log('\n=== Summary ===');
        console.log(`Frames processed: ${frameCount}`);
        console.log(`Total samples per channel: ${totalSamples}`);
        console.log(`Total PCM floats: ${pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)}`);
        console.log(`Duration: ${(totalSamples / (firstFrame?.sampleRate || 44100)).toFixed(2)} seconds`);
        
        if (pcmChunks.length > 0) {
            // Convert Float32Array chunks to Buffer
            const allPcmFloats = new Float32Array(pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0));
            let offset = 0;
            for (const chunk of pcmChunks) {
                allPcmFloats.set(chunk, offset);
                offset += chunk.length;
            }
            
            // Write as raw float32
            const buffer = Buffer.from(allPcmFloats.buffer);
            fs.writeFileSync(outputFile, buffer);
            console.log(`\n✓ Wrote decoded PCM (float32) to: ${outputFile}`);
            console.log(`  File size: ${buffer.length} bytes`);
            
            // Also save as 16-bit PCM for easier playback
            const pcm16File = outputFile.replace('.pcm', '_16bit.pcm');
            const pcm16 = new Int16Array(allPcmFloats.length);
            for (let i = 0; i < allPcmFloats.length; i++) {
                const s = Math.max(-1, Math.min(1, allPcmFloats[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            fs.writeFileSync(pcm16File, Buffer.from(pcm16.buffer));
            console.log(`✓ Wrote decoded PCM (int16) to: ${pcm16File}`);
            console.log(`  File size: ${pcm16.byteLength} bytes`);
            
            if (firstFrame) {
                console.log(`\nTo play with ffplay:`);
                console.log(`  ffplay -f s16le -ar ${firstFrame.sampleRate} -ac ${firstFrame.channels} ${pcm16File}`);
            }
        }
        
    } catch (error) {
        console.error('\n✗ Fatal error:', error.message);
        console.error(error.stack);
    } finally {
        decoder.destroy();
        console.log('\nDecoder destroyed');
    }
}

testHEAAC().catch(console.error);
