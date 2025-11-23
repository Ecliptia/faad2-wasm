import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FAAD2Decoder from '../faad2_node_decoder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    const decoder = new FAAD2Decoder();
    
    try {
        console.log('Initializing decoder...');
        await decoder.ready;
        console.log('Decoder initialized successfully\n');
        
        // Configure decoder with first AAC frame
        console.log('Configuring decoder with first AAC frame...');
        const configResult = await decoder.configure(aacData);
        console.log(`Configuration result:`, configResult);
        console.log('');
        
        let offset = 0;
        let frameCount = 0;
        let totalSamples = 0;
        const pcmChunks = [];
        const maxFrames = 10; // Process first 10 frames for testing
        
        while (offset < aacData.length && frameCount < maxFrames) {
            const chunk = aacData.slice(offset, Math.min(offset + 8192, aacData.length));
            
            console.log(`\n--- Frame ${frameCount + 1} ---`);
            console.log(`Offset: ${offset}, Chunk size: ${chunk.length} bytes`);
            console.log(`Chunk header: ${Array.from(chunk.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
            
            try {
                const result = decoder.decode(chunk);
                
                if (result.pcm && result.pcm.length > 0) {
                    console.log(`✓ Decoded successfully!`);
                    console.log(`  Sample rate: ${result.sampleRate} Hz`);
                    console.log(`  Channels: ${result.channels}`);
                    console.log(`  Samples: ${result.samples}`);
                    console.log(`  PCM data length: ${result.pcm.length} bytes`);
                    console.log(`  Bytes consumed: ${result.bytesConsumed}`);
                    
                    pcmChunks.push(result.pcm);
                    totalSamples += result.samples;
                    offset += result.bytesConsumed;
                    frameCount++;
                } else {
                    console.log(`✗ No PCM data returned`);
                    console.log(`  Bytes consumed: ${result.bytesConsumed || 0}`);
                    offset += result.bytesConsumed || 1024;
                }
            } catch (error) {
                console.error(`✗ Decode error: ${error.message}`);
                console.error(`  Error stack: ${error.stack}`);
                offset += 1024; // Skip forward on error
            }
        }
        
        console.log('\n=== Summary ===');
        console.log(`Frames decoded: ${frameCount}`);
        console.log(`Total samples: ${totalSamples}`);
        console.log(`Total PCM data: ${pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0)} bytes`);
        
        if (pcmChunks.length > 0) {
            const allPcm = Buffer.concat(pcmChunks);
            fs.writeFileSync(outputFile, allPcm);
            console.log(`\n✓ Wrote decoded PCM to: ${outputFile}`);
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
