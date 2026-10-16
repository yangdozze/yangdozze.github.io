# VISUALZI / METHOD — source-fidelity and runtime QA
2026-10-16

## Unchanged source verified against the current METHOD page
Reference: https://method.hiveglobal.org/app/#/caustic
Downloaded the original page's inline scripts and compared **Git blob SHA-1** values against the four files in `beat-visual-studio-v10/`. All four match bit-for-bit (including leading/trailing whitespace).

| Original inline script | Repository file | Git blob SHA-1 | Exact |
|---|---|---|---|
| Visual engines (script 2) | method-visual-engines.js | 0237f0bf27aa46d1e2d80de3557f9b8e62f1d0bc | yes |
| Dancer (script 3) | method-dancer.js | 7c85ed435309362aad1867b17cf87ebeb5d6d379 | yes |
| Readout Grid/Pads (script 4) | method-readout.js | b7f4981ebe5ea122dc57563199af662535576d11 | yes |
| Oscilloscope (script 5) | method-oscilloscope.js | 78cf7f070998077106626472eb28780e6ffe71f5 | yes |

### Significant divergence
The original main METHOD shell is ~390,554 characters. `method-registry.js` stops after its first ~138,706 characters and appends a small `METHOD_V10` export. This truncates the original Product/Workspace code, including major parts of its Post, Branding, Recorder, precise playback controls and UI.

The missing original `midiDemoScore()` helper was restored **verbatim** in `beat-visual-studio-v14-method-audio/method-midi-original.js`.

The four original renderer source files have NOT been modified to address performance. v14 uses:
- The actual source Canvas directly for preview (not copied into another 2D Canvas at each animation frame).
- The actual original METHOD AudioEngine with `heard()`-based clock, setBuffer/play/pause/seek.
- Original pattern of one cached instance per visualizer (`Inst[id]`) and per-track audio analysis version (`AudioEngine.ver`).
- Lazy initialization/manual preview for known expensive GPU/CPU methods; no fake replacement renderer.
- Separate library tabs for Audio, MIDI, All. v9 STRIP/NIGHT remains separately linked and unmodified.

## All 11 families — isolated original-adapter smoke test
Source-specific page: https://wavedropstudio.ru/beat-visual-studio-v14-method-audio/qa-all-11.html

Using the **original** `create() → setAudio() → frame()` with a synthetic 2-second 22,050 Hz PCM, a real browser completed 11/11 engine calls without a thrown JS exception. These single runs are not a performance guarantee across browsers/devices.

| Family | init ms | frame 0.25 s ms | frame 0.65 s ms | note |
|---|---:|---:|---:|---|
| MIDI / Score | 1 | 32 | 1 | visible note frames |
| Retro | 0 | 29 | 6 | moving frames |
| Bleach / Caustic | 1 | 492 | 37 | first frame expensive |
| Contour | 34 | 17 | 5 | moving frames |
| Dust | 69 | 1 | 1 | minimal pixels in this sample |
| Spatial | 121 | 1748 | 859 | very heavy |
| Volume | 202 | 5 | 2 | moving frames |
| Dancer | 29 | 87 | 2 | moving frames |
| Grid | 0 | 287 | 0 | black in immediate isolated call: async analysis not yet completed |
| Pads | 0 | 3 | 0 | black in immediate isolated call: async analysis not yet completed |
| Oscilloscope | 15 | 10505 | 22 | extreme initial frame |

## Additional real-track/demo-browser checks
- v14 audio demo, audio clock and pause, Retro and Bleach tested in browser.
- Grid and Pads were retested **after** the asynchronous analyser completed using the actual METHOD 15-second PCM demo: both rendered actual non-black beat layouts and waveforms. Grid frame measurements included 505/344 ms during setup, ~6/1 ms later; Pads about 8/1 ms later.
- MIDI / Score showed actual **demo** note graphics without MIDI-file upload, but the demo must not be presented as a transcription of the user's audio.
- These tests do **not** prove side-by-side pixel-identical final exports against the original site. METHOD's original Branding and Post pipeline have not yet been reproduced in full in the separate VISUALZI host.

## Still required before claiming a faithful full port
1. Restore the original compositing / colour grade / branding pipeline, without replacing the original engine animation.
2. Compare every look and mode with the same PCM and timestamps on both hosts, including actual exported video frames, geometry and timing.
3. Test on a physical iPhone Safari at both 9:16 and 16:9 with actual file uploads. Desktop benchmarks cannot be extrapolated to iPhone.
4. End-to-end export with sound, seek, loop and track changes.
5. Clearly display when MIDI mode uses a demo rather than user's `.mid`.

**Do not promote v14 as a complete identical METHOD clone.** It is an isolated native-engine and original-audio transport integration test.
