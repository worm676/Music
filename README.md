# Nightshade Studio

A purple-and-black music creation studio that runs in the browser.

- **Import instrumentals**: drag in MP3/WAV/M4A files, or paste a YouTube link.
- **Voice overlay**: record vocals over the beat from your mic (count-in, latency compensation, monitoring), or import a vocal take.
- **FL Studio-style playlist**: tracks with clips you can drag in time and between tracks, trim from either edge, split, duplicate and delete. Snap-to-grid, zoom, loop region, metronome.
- **Mixer per track**: volume, pan, reverb (FX), mute, solo, record-arm.
- **AI Beat (prompt-to-beat)**: describe a beat ("dark trap beat with heavy 808s and eerie bells, 140 bpm") and it composes drums, bass/808, chords and melody, as separate stems or one mixed clip.
- **Export**: render the whole arrangement to a WAV file.

## Run it

```bash
npm start            # http://localhost:3000
```

No npm dependencies are needed. Node 18+.

### YouTube import

YouTube import uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) on the server:

```bash
npm run setup:youtube    # pip install yt-dlp
```

Optional env vars: `PORT`, `YTDLP_PATH` (custom yt-dlp binary), `YT_MAX_DURATION` (seconds, default 900).
Only import audio you have the rights to use.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| R | Record on the armed track |
| L | Toggle loop |
| Shift + drag ruler | Set loop region |
| Ctrl/Cmd + D | Duplicate selected clip |
| S | Split selected clip at playhead |
| Delete | Delete selected clip |
| Alt while dragging | Ignore snap |
| Home / Enter | Jump to start |

## How the AI Beat works

`public/js/beatgen.js` reads the prompt for genre (trap, drill, boom bap, lo-fi, house, techno, R&B, pop, reggaeton, afrobeats, drum & bass, synthwave), mood (major/minor/eerie/jazzy), tempo, key, instruments and exclusions ("no drums"). It then synthesizes every part with the Web Audio API in an `OfflineAudioContext`. It runs fully offline, needs no API key, and gives a new variation on every click. By default the prompt's genre sets the project tempo; tick **Match project BPM** to lock it to an imported instrumental instead.

## Project layout

```
server.js                      static server + /api/youtube (yt-dlp)
public/index.html              UI
public/styles.css              purple/black theme
public/js/app.js               audio engine, playlist, recording, import/export
public/js/beatgen.js           prompt-to-beat generator
public/js/recorder-worklet.js  sample-accurate mic capture
public/js/wav.js               WAV encoder
```
