# METHOD Bleach / Displaced / Thermal

Original author and code: https://method.hiveglobal.org/app/#/caustic (METHOD / HiveGlobal).

The CAUSTIC function and CausticAdapter object were extracted directly from the METHOD browser application on 2026-10-16. Their inner source bodies are not modified. Rights and attribution remain with the METHOD authors; the project owner reports permission from the author to integrate them.

Only two METHOD Bleach looks are exposed: `disp` (Displaced) and `out` (Thermal). Their tracker HUD is entirely drawn by the native renderer, not by any added overlay. Native settings: 540x960, Displace 1, Speed .97, Tracker .65, Caption 17px.

STRIP, NIGHT and existing audio/MIDI import and video export are kept. No Audio-to-MIDI.

## METHOD Native Library v10
Reused original METHOD engine bodies for Retro, Contour, Dust, Spatial, Volume, as served from method.hiveglobal.org on 2026-10-16. Their original adapters are included separately. The BVS wrappers, toolbar and controls are new. Source credit remains METHOD / HiveGlobal. Their original authentication, payment, entitlement and rendering quota system is not copied. Authorization is based on the user's report from the developer. This v10 is experimental until browser smoke tests pass.

MIDI / Score **audio transcription** is deliberately not imported: user explicitly requested no Audio-to-MIDI. STRIP/NIGHT continue accepting real .mid MIDI and WAV/MP3 as they did in v9. Dancer, Grid/Pads and Oscilloscope are still pending integration.
