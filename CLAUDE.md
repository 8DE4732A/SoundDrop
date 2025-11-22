# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SoundDrop is a web application that transfers files between devices using audio signals. It uses the ggwave.js library to encode/decode data into audible sound, allowing face-to-face file transfers without network connectivity.

## Development Commands

### Running the Application

The app requires an HTTP server (browser security policies require HTTPS/localhost for microphone access):

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx http-server
```

Then visit `http://localhost:8000`

## Architecture

### Core Files

- **index.html**: Single-page UI with two tab panels (send/receive)
- **app.js**: Main application logic (545 lines, all functionality)
- **style.css**: Styling with gradient theme and responsive design
- **External dependency**: ggwave.js v0.4.0 (loaded from CDN)

### Data Flow Architecture

The application uses a chunked transfer protocol over audio:

1. **Sender Flow** (app.js:107-157):
   - File is read as ArrayBuffer
   - Header packet sent first containing: filename, size, type, chunk count
   - File split into 64-byte chunks, base64-encoded
   - Each chunk prefixed with index number
   - Chunks sent sequentially with 1.5s delay between each

2. **Receiver Flow** (app.js:214-343):
   - Microphone captures audio (echo cancellation/noise suppression disabled)
   - ScriptProcessorNode processes audio in 4096-sample buffers
   - ggwave decodes audio back to data
   - Chunks reassembled in order
   - Blob created and download offered when complete

### Protocol Format

```
HEADER|||{"name":"file.txt","size":1024,"type":"text/plain","chunks":16}
CHUNK:::0:::base64data...
CHUNK:::1:::base64data...
...
```

Delimiters:
- `HEADER_DELIMITER = '|||'` (separates packet type from data)
- `CHUNK_DELIMITER = ':::'` (separates chunk index from chunk data)

### Key Technical Constraints

- **MAX_FILE_SIZE**: 100KB (app.js:17)
- **CHUNK_SIZE**: 64 bytes (app.js:18)
- **Sample Rate**: 48000 Hz (app.js:34)
- **Protocol**: `GGWAVE_PROTOCOL_AUDIBLE_FAST` (app.js:169)
- **Transfer Speed**: ~2-3 minutes for 100KB file
- **Optimal Distance**: 1-2 meters between devices

### Audio Processing Details

**Sender (app.js:160-201)**:
- Uses ggwave.encode() to convert text to waveform
- Creates AudioBufferSourceNode
- Plays through speakers
- Volume set to 10 (app.js:170)

**Receiver (app.js:214-271)**:
- MediaStream from microphone (constraints at app.js:218-222)
- ScriptProcessorNode with 4096 buffer size
- Data converted to Int8Array for ggwave.decode()
- Analyser node for waveform visualization (app.js:508-525)

### Waveform Visualization

- Canvas-based real-time audio visualization (app.js:419-541)
- Uses AnalyserNode with FFT size 2048
- Draws on high-DPI canvas with gradient effects
- Only shown during receiving

### State Management

Global state variables (app.js:1-14):
- `ggwave/ggwaveInstance`: Library and instance handles
- `audioContext`: Web Audio API context
- `selectedFile`: Currently selected file for sending
- `receivedData`: Object tracking received header and chunks array
- `isReceiving`: Boolean flag for receive state
- `mediaStream`: Microphone stream reference

## Browser Compatibility

Requires:
- Web Audio API
- MediaDevices API (getUserMedia)
- FileReader API
- Supported: Chrome/Edge (recommended), Firefox, Safari

## Important Implementation Notes

1. **Audio Context Sample Rate**: Must match input/output (48000 Hz recommended)
2. **Microphone Permissions**: Required for receive mode, must be HTTPS or localhost
3. **No Error Recovery**: If transmission fails, page refresh required
4. **Sequential Processing**: Chunks sent with delays, no parallel transmission
5. **No Compression**: Files sent as-is, base64 encoding adds ~33% overhead
6. **Static Protocol**: Protocol ID and volume hardcoded (app.js:169-170)

## File References

- Protocol configuration: app.js:17-20
- ggwave initialization: app.js:23-48
- Send logic: app.js:107-157
- Receive logic: app.js:214-343
- Audio playback: app.js:188-201
- Chunk encoding/decoding: app.js:160-178, 302-343
