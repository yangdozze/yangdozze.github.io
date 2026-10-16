# Beat Visual Studio v10 — METHOD engine test integration

Original code and visual design concepts: METHOD / HiveGlobal https://method.hiveglobal.org/app/ . Permission was reported by the project owner. Attribution retained. 3rd-party bundled source code retains original notices and licensing.

11 METHOD engine families are available through a new editor without the original auth, commercial license API or paid checkout. The independent editor uses public engine adapter interfaces and original engine JS. 

Not a verified complete clone of METHOD: some original features (photo import/AI pose assets, MIDI musical transcription, advanced color/post pipeline, special MIDI Score and Grid/Pads MIDI controls) require additional integration and testing. No experimental Audio-to-MIDI converter reintroduced. STRIP and NIGHT remain in v9, linked from header; existing v9 untouched.

Source segments: original inline METHOD scripts #2 graphics, #3 Dancer WebGL, #4 PULSE Grid/Pads, #5 3D Oscilloscope; shell adapter declarations through original ENGINES registry (account/payment code after registry excluded). New app code: studio.js, index.html, style.css.
