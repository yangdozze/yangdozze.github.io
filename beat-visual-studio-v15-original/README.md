# VISUALZI / METHOD — original-build parity baseline

Date: 2026-10-16
Original source: https://method.hiveglobal.org/app/#/caustic
Reference mirror: https://wavedropstudio.ru/beat-visual-studio-v15-original/#/caustic
Stable previous VISUALZI v9: https://wavedropstudio.ru/beat-visual-studio-v9/

## What is preserved exactly
The original METHOD page's complete JavaScript product shell (390,558 characters) is in `method-shell-original.js`, not the truncated 138k registry used in v10-v14.
The MP4 muxer, account config, original markup and original CSS are retained. Script assets for all 11 visualizer families are linked to byte-identical copies under `../beat-visual-studio-v10/`. No METHOD visual renderer was rewritten.

The original CSS was recovered directly via the live page's `style.textContent` (49,118 characters). A browser snapshot serialization had previously damaged shorthand font declarations, causing Times New Roman in our mirror. The GitHub file now has the original CSS. As of this QA pass, the static host cache still served the prior CSS snapshot; serving the updated file must be rechecked.

## Browser verification
At 390×844 pixels on 2026-10-16:
- Original `#/caustic`: 03 Bleach, output canvas x 32.5, y 77.890625, width 310, height 551.
- The mirrored `#/caustic` delivered the same scene rectangle and original 11 engine library. It loaded the original shell and displayed 7 canvases within the scene.
- After injecting the exact GitHub CSS into the mirrored browser session, the font family and visible mobile page matched the original screenshot. This validates the CSS fix but not yet the static host's propagation.

The isolated METHOD native-engine test at https://wavedropstudio.ru/beat-visual-studio-v14-method-audio/qa-all-11.html executed create/setAudio/frame for all 11 without exceptions. That diagnostic **is not** a full video/animation parity test. It exposed extreme first-frame costs for Oscilloscope (10,505ms) and high rendering times for Spatial (1,748ms and 859ms). Grid/Pads appeared black when sampled before asynchronous analysis and later showed nonblank graphics after normal demo audio analysis.

## Constraints
This is a reference reproduction, NOT a production replacement of METHOD. Authentication, licenses and paid rendering checks are present unchanged. Do not sign in or enter payment details on the mirror. Some linked authentication functionality may not operate on an unregistered alternate origin.

Before promotion, verify all looks using identical audio/MIDI, timestamps and browser GPU settings, plus mobile Safari, exact export/recording and branded post-processing. No plan or license bypass has been implemented.

## Relationship to VISUALZI
The VISUALZI v9 STRIP/NIGHT product is unmodified. The v15 reference lets a new VISUALZI wrapper be evaluated against original METHOD behavior, without inventing substitute visual algorithms.
