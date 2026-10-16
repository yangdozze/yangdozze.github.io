# VISUALZI Studio v12 test · 2026-10-16

Preview: https://wavedropstudio.ru/beat-visual-studio-v12-test/

## Goal and source attribution
A light, responsive independent shell around **eleven original METHOD/HiveGlobal engine adapters** already staged under `../beat-visual-studio-v10/`. Their original source implementation is reused, not redrawn as a mockup. Original project: https://method.hiveglobal.org/app/. Permission has been relayed by project owner; no written license terms are asserted here. Two **original VISUALZI** classic scenes, STRIP and NIGHT, are loaded from v9. No change to v9, v10, or v11 URLs. No Audio-to-MIDI conversion.

## Engine inventory
- Native METHOD (11): MIDI/Score, Retro, Bleach, Contour, Dust, Spatial, Volume, Dancer, Grid, Pads, Oscilloscope
- VISUALZI v9 (2): STRIP, NIGHT
- Audio tab: 12 / 13 (everything except MIDI/Score)
- MIDI tab: 5 / 13 (MIDI/Score, Grid, Pads, STRIP, NIGHT). Grid/Pads need accompanying audio for use of the actual MIDI override.

## Real preview performance control
- No continuous native rendering while playback is paused or tab hidden.
- Light and medium engines use a preview cadence with dynamic frame-time backoff.
- Spatial and Volume native create/render are deferred **until explicit user action** (Render Frame or Export), even on selection. This avoids freezing the page merely while browsing presets.
- On >180 ms frame times, preview backs off; on heavy >450 ms frames, live update halts and displays a warning.
- These policies reduce unnecessary workload; they **do not make the underlying heavy METHOD WebGL renderer inherently fast**.
- Frame-accurate offline export uses existing v10 Mediabunny/WebCodecs implementation. The user chooses output FPS/resolution separately from preview mode.

## Verification performed (browser)
- v12 page loads and style categories can be clicked.
- Grid, Pads, STRIP and NIGHT have rendered visible nonblank frames on browser demo PCM.
- Native adapter smoke test: https://wavedropstudio.ru/beat-visual-studio-v12-test/qa-all-v2.html
- One-frame / two-frame test on 11 original METHOD adapters: **0 thrown JS exceptions** in tested browser.
- In that test Spatial took 1776 / 1940 ms to render; other timings are diagnostic only and include 0ms results where GPU work might be queued rather than completed.

## Remaining limitations / unverified
- No systematic MP4 export/long-duration audio sync verification; must run separate real-file video validation.
- No pixel-identical comparison of rendered frames against ORIGINAL METHOD's user session; reuse of engine source is not itself proof of identical pixels when shell state differs.
- iPhone Safari performance and mobile viewport screenshots remain unverified.
- Each advanced METHOD panel, post-FX and branding layout is not yet fully exposed in v12. Only native adapter metadata controls are represented.
- Very expensive Spatial/Volume rendering will still be expensive *once explicitly activated*.
