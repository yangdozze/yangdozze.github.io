
/* ===== READOUT ENGINE — beat-reading visualizers (METHOD 09 Grid, 10 Pads) =====
   From the approved Readout Lab (readout_lab_test_7.html): shared helpers, FFT, offline analysis (tempo, downbeat, key,
   kick / snare / hat hits, 808 and notes, chords, spectrogram, waveform), MIDI input, the shared frame and the concepts.
   Its demo-beat synthesizer and its page (player, UI, recording) are left out: METHOD gives it audio, a clock and controls.
   Changes for METHOD, each marked "METHOD:": the frame scales by its short side (16:9), Grid's cells fit a wide frame,
   Pads' screen is as wide as its pads, the frame can leave room above and below (library cards), Punch is an amount, Window and Hold scale the bottom panel's span and how long hits stay lit, and glyph widths are
   measured again once the web fonts arrive. Public object: window.PULSE */
/* Readout Lab — shared helpers */
(function (G) {
  'use strict';
  const U = {};
  U.TAU = Math.PI * 2;
  U.clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.mod = (a, n) => ((a % n) + n) % n;
  U.smooth = t => { t = U.clamp(t); return t * t * (3 - 2 * t); };
  U.easeOut = t => { t = U.clamp(t); const u = 1 - t; return 1 - u * u * u; };
  U.easeOut5 = t => { t = U.clamp(t); const u = 1 - t; return 1 - u * u * u * u * u; };
  U.NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  U.pcName = pc => U.NOTES[U.mod(pc, 12)];
  U.noteName = m => U.NOTES[U.mod(m, 12)] + (Math.floor(m / 12) - 1);
  U.midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  U.hzMidi = f => 69 + 12 * Math.log2(f / 440);
  U.hash = n => {
    let x = Math.imul(n | 0, 374761393) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 15), 2246822519);
    x = Math.imul(x ^ (x >>> 13), 3266489917);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };
  U.rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  U.percentile = (arr, p, maxN = 200000) => {
    const n = arr.length; if (!n) return 0;
    const step = Math.max(1, Math.floor(n / maxN));
    const tmp = new Float32Array(Math.ceil(n / step));
    for (let i = 0, j = 0; i < n; i += step, j++) tmp[j] = arr[i];
    tmp.sort();
    const k = Math.min(tmp.length - 1, Math.max(0, Math.round(p / 100 * (tmp.length - 1))));
    return tmp[k];
  };
  /* last index with evs[i][key] <= t (sorted), -1 if none */
  U.lastAt = (evs, t, key = 't') => {
    let lo = 0, hi = evs.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (evs[m][key] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  /* linear sample of a per-frame array at time t */
  U.sample = (arr, fps, t) => {
    const x = t * fps, i = Math.floor(x), n = arr.length;
    if (i < 0) return arr[0] || 0;
    if (i >= n - 1) return arr[n - 1] || 0;
    const f = x - i; return arr[i] * (1 - f) + arr[i + 1] * f;
  };
  U.fmtTime = t => {
    t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };
  U.fmtClock = t => {
    t = Math.max(0, Math.floor(t)); const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };
  G.PULSE = G.PULSE || {};
  G.PULSE.U = U;
})(typeof window !== 'undefined' ? window : globalThis);

/* Readout Lab — real-input FFT (packed into a half-size complex FFT), Hann window,
 * amplitude-calibrated: a full-scale sine reads 1.0 */
(function (G) {
  'use strict';
  const cache = new Map();
  function FFT(n) {
    if (cache.has(n)) return cache.get(n);
    const h = n >> 1, q = h >> 1;
    const lv = Math.round(Math.log2(h));
    const rev = new Uint32Array(h);
    for (let i = 0; i < h; i++) { let r = 0, x = i; for (let j = 0; j < lv; j++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    const cs = new Float64Array(q), sn = new Float64Array(q);
    for (let i = 0; i < q; i++) { cs[i] = Math.cos(2 * Math.PI * i / h); sn[i] = Math.sin(2 * Math.PI * i / h); }
    const tc = new Float64Array(h + 1), ts = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) { tc[k] = Math.cos(2 * Math.PI * k / n); ts[k] = Math.sin(2 * Math.PI * k / n); }
    const re = new Float64Array(h), im = new Float64Array(h);
    const win = new Float64Array(n); let wsum = 0;
    for (let i = 0; i < n; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n); wsum += win[i]; }
    const g = 2 / wsum;

    function run() {
      for (let i = 0; i < h; i++) {
        const j = rev[i];
        if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      }
      for (let size = 2; size <= h; size <<= 1) {
        const half = size >> 1, step = h / size;
        for (let i = 0; i < h; i += size) {
          for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half, c = cs[k], s = sn[k];
            const tr = re[b] * c + im[b] * s, ti = im[b] * c - re[b] * s;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
    }
    /* windowed amplitude spectrum of real x around sample c → out[0..n/2] */
    function amp(x, c, out) {
      const s0 = c - h, L = x.length;
      if (s0 >= 0 && s0 + n <= L) {
        for (let m = 0, i = 0; m < h; m++, i += 2) { re[m] = x[s0 + i] * win[i]; im[m] = x[s0 + i + 1] * win[i + 1]; }
      } else {
        for (let m = 0, i = 0; m < h; m++, i += 2) {
          const j = s0 + i;
          re[m] = (j >= 0 && j < L) ? x[j] * win[i] : 0;
          im[m] = (j + 1 >= 0 && j + 1 < L) ? x[j + 1] * win[i + 1] : 0;
        }
      }
      run();
      out[0] = Math.abs(re[0] + im[0]) * g * 0.5;
      out[h] = Math.abs(re[0] - im[0]) * g * 0.5;
      for (let k = 1; k < h; k++) {
        const zr = re[k], zi = im[k], cr = re[h - k], ci = -im[h - k];
        const er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci);
        const dr = 0.5 * (zr - cr), di = 0.5 * (zi - ci);
        const or = di, oi = -dr, c = tc[k], s = ts[k];
        const xr = er + c * or + s * oi, xi = ei + c * oi - s * or;
        out[k] = Math.sqrt(xr * xr + xi * xi) * g;
      }
      return out;
    }
    const o = { n, amp, wsum };
    cache.set(n, o);
    return o;
  }
  G.PULSE.FFT = FFT;
})(typeof window !== 'undefined' ? window : globalThis);

/* Readout Lab — offline analysis of a track.
 * Computed once, up front:
 *   tempo + downbeat, key, kick / snare / hat hits, 808 pitch (YIN), upper notes, chords per beat,
 *   a log-frequency spectrogram (Uint8) and a min/max waveform envelope.
 */
(function (G) {
  'use strict';
  const { U, FFT } = G.PULSE;
  const FPS = 100;   // main frames: spectrum, hits, levels
  const FPS2 = 50;   // 808 pitch
  const FPS3 = 25;   // fine spectrum: notes, chroma, low end of the spectrogram

  function lp2(x, y, sr, fc, q) {
    const w = 2 * Math.PI * fc / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i], yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = yi; y[i] = yi;
    }
    return y;
  }
  function decimate(x, sr, k, fc) {
    const y = new Float32Array(x.length);
    lp2(x, y, sr, fc, 0.5412); lp2(y, y, sr, fc, 1.3066);
    const out = new Float32Array(Math.floor(x.length / k));
    for (let i = 0; i < out.length; i++) out[i] = y[i * k];
    return out;
  }
  /* pitch by normalized cross-correlation: amplitude-invariant, so a decaying 808 reads true */
  function yin(x, c, W, tmin, tmax, buf) {
    const s = c - (W >> 1);
    if (s < 0 || s + W + tmax + 2 >= x.length) return { tau: 0, conf: 0 };
    let e1 = 0; for (let j = 0; j < W; j++) e1 += x[s + j] * x[s + j];
    if (e1 < 1e-10) return { tau: 0, conf: 0 };
    const rho = buf.d;
    let e2 = 0; for (let j = 0; j < W; j++) { const v = x[s + j + 1]; e2 += v * v; }
    for (let tau = 1; tau <= tmax + 1; tau++) {
      if (tau > 1) { const out = x[s + tau - 1], inn = x[s + tau - 1 + W]; e2 += inn * inn - out * out; }
      let r = 0; for (let j = 0; j < W; j++) r += x[s + j] * x[s + j + tau];
      rho[tau] = r / Math.sqrt(e1 * Math.max(e2, 1e-12));
    }
    let mx = -1; for (let tau = tmin; tau <= tmax; tau++) if (rho[tau] > mx) mx = rho[tau];
    let best = -1;
    for (let tau = tmin + 1; tau < tmax; tau++) {
      if (rho[tau] >= rho[tau - 1] && rho[tau] >= rho[tau + 1] && rho[tau] >= 0.88 * mx) { best = tau; break; }
    }
    if (best < 0) return { tau: 0, conf: 0 };
    let tb = best;
    const a = rho[best - 1], b = rho[best], e = rho[best + 1], den = a - 2 * b + e;
    if (den < 0) tb = best + U.clamp(0.5 * (a - e) / den, -0.5, 0.5);
    return { tau: tb, conf: b };
  }
  function semiWeights(hz, H, p) {
    const fc = U.midiHz(p), binSemi = 12 * Math.log2((fc + hz) / fc), sig = Math.max(0.3, 0.55 * binSemi);
    const lo = Math.floor(fc * Math.pow(2, -2.5 * sig / 12) / hz), hi = Math.ceil(fc * Math.pow(2, 2.5 * sig / 12) / hz);
    const ks = [], ws = [];
    for (let k = Math.max(1, lo); k <= Math.min(H - 1, hi); k++) {
      const d = 12 * Math.log2(k * hz / fc) / sig; ks.push(k); ws.push(Math.exp(-0.5 * d * d));
    }
    let mx = 0; for (const w of ws) mx = Math.max(mx, w);
    return { ks: Int32Array.from(ks), ws: Float32Array.from(ws, w => w / (mx || 1)) };
  }

  const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  function corr(a, b) {
    let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12;
    let nn = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; nn += x * y; da += x * x; db += y * y; }
    return nn / Math.sqrt(da * db || 1);
  }
  const CHORD_T = [
    ['', [0, 4, 7], 0], ['m', [0, 3, 7], 0], ['dim', [0, 3, 6], 0.08], ['sus4', [0, 5, 7], 0.07],
    ['7', [0, 4, 7, 10], 0.07], ['m7', [0, 3, 7, 10], 0.06], ['maj7', [0, 4, 7, 11], 0.08],
  ];

  async function analyse(chs, sr, onProgress) {
    onProgress = onProgress || (() => {});
    const T0 = performance.now();
    const n = chs[0].length, dur = n / sr, nc = chs.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < nc; c++) { const ch = chs[c], g = 1 / nc; for (let i = 0; i < n; i++) mono[i] += ch[i] * g; }
    let peak = 1e-9;
    for (let i = 0; i < n; i++) { const a = mono[i] < 0 ? -mono[i] : mono[i]; if (a > peak) peak = a; }

    let lastY = performance.now();
    const tick = async p => {
      if (performance.now() - lastY > 35) { onProgress(p); await new Promise(r => setTimeout(r, 0)); lastY = performance.now(); }
    };

    /* ---------- decimation chain ---------- */
    const k2 = Math.max(1, Math.round(sr / 22050));
    const x2 = k2 > 1 ? decimate(mono, sr, k2, 0.9 * sr / (2 * k2)) : mono;
    const r2 = sr / k2;
    await tick(0.03);
    const x4 = decimate(x2, r2, 2, 0.9 * r2 / 4), r4 = r2 / 2;
    const x16 = decimate(x4, r4, 4, 300), r16 = r4 / 4;
    /* the 808 reader only wants fundamentals: a steep low-pass keeps pads and chords out of it */
    lp2(x16, x16, r16, 150, 0.5412); lp2(x16, x16, r16, 150, 1.3066); lp2(x16, x16, r16, 150, 0.5412); lp2(x16, x16, r16, 150, 1.3066);
    await tick(0.06);

    const nF = Math.max(8, Math.floor(dur * FPS) + 1);
    const lastP = (nF - 1) >> 1, nP = lastP + 1;
    const lastQ = (nF - 1) >> 2, nQ = lastQ + 1;

    /* ---------- display bins ---------- */
    const NB = 120, fLo = 35, fHi = Math.min(11000, 0.46 * r2);
    const edges = new Float32Array(NB + 1), centers = new Float32Array(NB), tilt = new Float32Array(NB);
    for (let b = 0; b <= NB; b++) edges[b] = fLo * Math.pow(fHi / fLo, b / NB);
    for (let b = 0; b < NB; b++) { centers[b] = Math.sqrt(edges[b] * edges[b + 1]); tilt[b] = 4.5 * Math.log2(centers[b] / 1000); }
    let bSplit = 0; while (bSplit < NB && centers[bSplit] < 400) bSplit++;

    const N2 = r2 > 30000 ? 2048 : 1024, F2 = FFT(N2), H2 = N2 >> 1, hz2 = r2 / N2;
    const A2 = new Float32Array(H2 + 1), M2 = new Float32Array(H2 + 1), M2p = new Float32Array(H2 + 1);
    const N4 = 4096, F4 = FFT(N4), H4 = N4 >> 1, hz4 = r4 / N4, A4 = new Float32Array(H4 + 1);
    const N5 = 2048, F5 = FFT(N5), H5 = N5 >> 1, hz5 = r4 / N5, A5 = new Float32Array(H5 + 1);

    function binMap(hz, H, b0, b1) {
      const m = [];
      for (let b = b0; b < b1; b++) {
        const k0 = Math.ceil(edges[b] / hz), k1 = Math.min(H, Math.floor(edges[b + 1] / hz - 1e-9));
        const x = centers[b] / hz, kc = Math.max(0, Math.min(H - 1, Math.floor(x)));
        m.push({ k0, k1, kc, fr: x - kc });
      }
      return m;
    }
    const mapHi = binMap(hz2, H2, bSplit, NB), mapLo = binMap(hz4, H4, 0, bSplit);
    const binPow = (A, mp) => {
      if (mp.k1 >= mp.k0) { let p = 0; for (let k = mp.k0; k <= mp.k1; k++) p += A[k] * A[k]; return p; }
      const a = A[mp.kc] * (1 - mp.fr) + A[mp.kc + 1] * mp.fr; return a * a;
    };
    const kb = f => Math.max(1, Math.min(H2, Math.round(f / hz2)));
    const R_K = [kb(30), kb(120)], R_S = [kb(1500), kb(5200)], R_H = [kb(6500), kb(fHi)];
    const R_MID = [kb(250), kb(2000)], R_HIGH = [kb(2000), kb(6000)], R_AIR = [kb(6000), kb(fHi)];
    const kf = f => Math.max(1, Math.min(H4, Math.round(f / hz4)));
    const R_SUB = [kf(25), kf(60)], R_BASS = [kf(60), kf(250)];

    const PLO = 36, PHI = 96, NS = PHI - PLO + 1, PSPLIT = 60;
    const semis = [];
    for (let p = PLO; p <= PHI; p++) semis.push(p < PSPLIT ? semiWeights(hz4, H4, p) : semiWeights(hz5, H5, p));

    const specDb = new Float32Array(nF * NB), lowDb = new Float32Array(nQ * Math.max(1, bSplit));
    const flK = new Float32Array(nF), flS = new Float32Array(nF), flH = new Float32Array(nF), flA = new Float32Array(nF);
    const pMid = new Float32Array(nF), pHigh = new Float32Array(nF), pAir = new Float32Array(nF), pLow = new Float32Array(nF);
    const pSub = new Float32Array(nQ), pBass = new Float32Array(nQ);
    const semE = new Float32Array(nQ * NS);
    const f0 = new Float32Array(nP), f0c = new Float32Array(nP), lowE = new Float32Array(nP);
    const yW = Math.round(0.14 * r16), yMax = Math.floor(r16 / 28), yMin = Math.max(2, Math.floor(r16 / 320));
    const ybuf = { d: new Float64Array(yMax + 4) };

    /* block energy of x2 per frame → RMS */
    const eb = new Float64Array(nF);
    { const hop = r2 / FPS; for (let i = 0; i < x2.length; i++) { const f = Math.min(nF - 1, Math.floor(i / hop)); eb[f] += x2[i] * x2[i]; } }
    const rms = new Float32Array(nF);
    { const hop = r2 / FPS; for (let i = 0; i < nF; i++) { let e = 0, c = 0; for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < nF) { e += eb[k]; c++; } rms[i] = Math.sqrt(e / (c * hop)); } }

    F2.amp(x2, Math.round((nF - 1) / FPS * r2), A2);
    for (let k = 1; k < H2; k++) M2p[k] = Math.log1p(300 * A2[k]);
    for (let i = 0; i < nF; i++) {
      const t = i / FPS;
      F2.amp(x2, Math.round(t * r2), A2);
      let fk = 0, fs = 0, fh = 0, fa = 0;
      for (let k = 1; k < H2; k++) {
        const m = Math.log1p(300 * A2[k]); M2[k] = m;
        const prev = k >= R_S[0] ? Math.max(M2p[k - 1], M2p[k], M2p[k + 1]) : M2p[k];
        const d = m - prev;
        if (d > 0) {
          fa += d;
          if (k <= R_K[1]) { if (k >= R_K[0]) fk += d; }
          else if (k >= R_S[0] && k <= R_S[1]) fs += d;
          else if (k >= R_H[0] && k <= R_H[1]) fh += d;
        }
      }
      flK[i] = fk; flS[i] = fs; flH[i] = fh; flA[i] = fa;
      const tmp = M2p; M2p.set(M2); void tmp;
      let s = 0;
      for (let k = R_MID[0]; k < R_MID[1]; k++) s += A2[k] * A2[k]; pMid[i] = s; s = 0;
      for (let k = R_HIGH[0]; k < R_HIGH[1]; k++) s += A2[k] * A2[k]; pHigh[i] = s; s = 0;
      for (let k = R_AIR[0]; k <= R_AIR[1]; k++) s += A2[k] * A2[k]; pAir[i] = s; s = 0;
      for (let k = R_K[0]; k <= R_K[1]; k++) s += A2[k] * A2[k]; pLow[i] = s;
      for (let b = bSplit; b < NB; b++) specDb[i * NB + b] = 10 * Math.log10(binPow(A2, mapHi[b - bSplit]) + 1e-14) + tilt[b];

      if ((i & 1) === 0) {
        const j = i >> 1, c16 = Math.round(t * r16), y = yin(x16, c16, yW, yMin, yMax, ybuf);
        f0[j] = y.tau > 0 ? r16 / y.tau : 0; f0c[j] = y.conf;
        let le = 0; const s0 = c16 - (yW >> 1);
        for (let z = 0; z < yW; z++) { const v = x16[s0 + z] || 0; le += v * v; }
        lowE[j] = le / yW;
      }
      if ((i & 3) === 0) {
        const q = i >> 2, c4 = Math.round(t * r4);
        F4.amp(x4, c4, A4);
        for (let b = 0; b < bSplit; b++) lowDb[q * bSplit + b] = 10 * Math.log10(binPow(A4, mapLo[b]) + 1e-14) + tilt[b];
        s = 0; for (let k = R_SUB[0]; k < R_SUB[1]; k++) s += A4[k] * A4[k]; pSub[q] = s;
        s = 0; for (let k = R_BASS[0]; k < R_BASS[1]; k++) s += A4[k] * A4[k]; pBass[q] = s;
        F5.amp(x4, c4, A5);
        for (let z = 0; z < NS; z++) {
          const sw = semis[z], A = (PLO + z) < PSPLIT ? A4 : A5, ks = sw.ks, ws = sw.ws;
          let e2 = 0; for (let u = 0; u < ks.length; u++) { const a = A[ks[u]]; e2 += ws[u] * a * a; }
          semE[q * NS + z] = e2;
        }
      }
      if ((i & 31) === 0) await tick(0.08 + 0.7 * i / nF);
    }
    await tick(0.8);

    for (let i = 0; i < nF; i++) {
      const x = i / 4, q = Math.min(lastQ, Math.floor(x)), q2 = Math.min(lastQ, q + 1), f = x - Math.floor(x);
      for (let b = 0; b < bSplit; b++) specDb[i * NB + b] = lowDb[q * bSplit + b] * (1 - f) + lowDb[q2 * bSplit + b] * f;
    }
    const sref = U.percentile(specDb, 99.6), RANGE = 54;
    const spec = new Uint8Array(nF * NB);
    for (let i = 0; i < spec.length; i++) {
      const v = (specDb[i] - (sref - RANGE)) / RANGE;
      spec[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }

    /* ---------- waveform envelope, 500 per second ---------- */
    const WF = 500, bs = sr / WF, nW = Math.ceil(n / bs);
    const wmin = new Float32Array(nW), wmax = new Float32Array(nW);
    for (let w = 0; w < nW; w++) {
      const a0 = Math.floor(w * bs), a1 = Math.min(n, Math.floor((w + 1) * bs));
      let lo = 0, hi = 0;
      for (let j = a0; j < a1; j++) { const v = mono[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
      wmin[w] = lo / peak; wmax[w] = hi / peak;
    }
    await tick(0.84);

    /* ---------- hits ---------- */
    const pA = U.percentile(flA, 99.3) || 1;
    const nrm = a => { const r = Math.max(U.percentile(a, 99.3), 0.035 * pA) || 1; return Float32Array.from(a, v => v / r); };
    const oK = nrm(flK), oS = nrm(flS), oH = nrm(flH), oA = Float32Array.from(flA, v => v / pA);
    function pick(o, delta, minGap) {
      const ev = [], L = o.length;
      for (let i = 0; i < L - 2; i++) {
        const v = o[i];
        if (v < delta || (i > 0 && v < o[i - 1]) || (i > 1 && v < o[i - 2]) || v <= o[i + 1] || v < o[i + 2]) continue;
        let s = 0, c = 0;
        for (let k = Math.max(0, i - 10); k <= Math.min(L - 1, i + 3); k++) { s += o[k]; c++; }
        if (v < (s / c) * 1.3 + 0.5 * delta) continue;
        const t = i / FPS, last = ev[ev.length - 1];
        if (last && t - last.t < minGap) { if (v > last.v) { last.t = t; last.v = v; } continue; }
        ev.push({ t, v });
      }
      const ref = ev.length ? U.percentile(Float32Array.from(ev, e => e.v), 85) : 1;
      for (const e of ev) e.s = U.clamp(e.v / (ref || 1), 0.15, 1);
      return ev;
    }
    let kicks = pick(oK, 0.2, 0.1), snares = pick(oS, 0.26, 0.09), hats = pick(oH, 0.2, 0.05);
    const near = (list, t, w) => { const i = U.lastAt(list, t + w); return i >= 0 && list[i].t >= t - w ? list[i] : null; };
    const snares0 = snares;
    snares = snares.filter(e => { const k = near(kicks, e.t, 0.03); return !(k && k.s > e.s * 1.4 && e.s < 0.6); });
    kicks = kicks.filter(e => { const s = near(snares0, e.t, 0.03); return !(s && s.s > 0.55 && e.s < 0.5 && s.s > e.s * 1.3); });
    hats = hats.filter(e => { const s = near(snares, e.t, 0.03); return !(s && e.s < 0.85); });
    const onsets = pick(oA, 0.12, 0.05);

    /* ---------- tempo ---------- */
    const odf = new Float32Array(nF);
    for (let i = 0; i < nF; i++) odf[i] = Math.min(1.5, oK[i]) + 0.8 * Math.min(1.5, oS[i]) + 0.4 * Math.min(1.5, oH[i]);
    const pre = new Float64Array(nF + 1);
    for (let i = 0; i < nF; i++) pre[i + 1] = pre[i] + odf[i];
    const od = new Float32Array(nF);
    for (let i = 0; i < nF; i++) { const a = Math.max(0, i - 20), b = Math.min(nF, i + 21); od[i] = Math.max(0, odf[i] - (pre[b] - pre[a]) / (b - a)); }
    const BMIN = 75, BMAX = 175;
    const lagMin = Math.floor(FPS * 60 / BMAX), lagMax = Math.ceil(FPS * 60 / BMIN);
    const ac = new Float32Array(2 * lagMax + 3);
    for (let L = lagMin; L <= 2 * lagMax + 2 && L < nF; L++) {
      let s = 0; for (let i = 0; i + L < nF; i++) s += od[i] * od[i + L];
      ac[L] = s / (nF - L);
    }
    let bestL = lagMin, bestSc = -1;
    for (let L = lagMin; L <= lagMax; L++) {
      const b = 60 * FPS / L, prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 122) / 0.9, 2));
      const sc = (ac[L] + 0.5 * ac[2 * L]) * prior;
      if (sc > bestSc) { bestSc = sc; bestL = L; }
    }
    let lagF = bestL;
    if (bestL > lagMin && bestL < lagMax) {
      const a = ac[bestL - 1], b = ac[bestL], e = ac[bestL + 1], den = a - 2 * b + e;
      if (den < 0) lagF = bestL + 0.5 * (a - e) / den;
    }
    let bpm = 60 * FPS / lagF;
    const hatsPerBeat = hats.length / Math.max(1, dur / (60 / bpm));
    if (bpm < 96 && bpm * 2 <= BMAX && hatsPerBeat >= 2.8) bpm *= 2;
    const nzIdx = []; for (let i = 0; i < nF; i++) if (od[i] > 0.02) nzIdx.push(i);
    const sharp = b => {
      const P = 60 * FPS / b, h = new Float32Array(48);
      for (const i of nzIdx) h[Math.floor(((i % P) / P) * 48) % 48] += od[i];
      let s1 = 0, s2 = 0; for (let k = 0; k < 48; k++) { s1 += h[k]; s2 += h[k] * h[k]; }
      return s2 / (s1 * s1 || 1);
    };
    { let bestS = -1, bpmR = bpm; for (let b = bpm * 0.98; b <= bpm * 1.02; b += 0.01) { const s = sharp(b); if (s > bestS) { bestS = s; bpmR = b; } } bpm = bpmR; }
    const snapTol = dur < 40 ? 0.35 : 0.15;
    bpm = Math.abs(bpm - Math.round(bpm)) < snapTol ? Math.round(bpm) : Math.round(bpm * 10) / 10;

    function phaseFor(bpmX) {
      const P = 60 * FPS / bpmX, hb = new Float32Array(64);
      for (let i = 0; i < nF; i++) {
        const v = Math.min(1.5, oK[i]) + 0.7 * Math.min(1.5, oS[i]) + 0.25 * Math.min(1.5, oH[i]);
        if (v > 0.05) hb[Math.floor(((i % P) / P) * 64) % 64] += v;
      }
      let bi = 0, bv = -1;
      for (let b = 0; b < 64; b++) { const v = 0.5 * hb[(b + 63) % 64] + hb[b] + 0.5 * hb[(b + 1) % 64]; if (v > bv) { bv = v; bi = b; } }
      const phase = (bi + 0.5) / 64 * P;
      let bestOff = 0, bestDs = -1e9;
      for (let off = 0; off < 4; off++) {
        let ds = 0;
        for (const e of kicks) {
          const bf = (e.t * FPS - phase) / P, r = Math.round(bf);
          if (Math.abs(bf - r) > 0.2) continue;
          const m = U.mod(r - off, 4); if (m === 0) ds += e.s; else if (m === 2) ds += 0.3 * e.s;
        }
        for (const e of snares) {
          const bf = (e.t * FPS - phase) / P, r = Math.round(bf);
          if (Math.abs(bf - r) > 0.2) continue;
          if (U.mod(r - off, 4) === 0) ds -= 0.6 * e.s;
        }
        if (ds > bestDs + 1e-6) { bestDs = ds; bestOff = off; }
      }
      const bar = 4 * 60 / bpmX;
      let b0 = U.mod((phase + bestOff * P) / FPS, bar);
      if (b0 > bar - 0.08) b0 -= bar;
      return b0;
    }
    const beat0 = phaseFor(bpm);
    await tick(0.88);

    /* ---------- 808 / bass pitch ---------- */
    const leDb = Float32Array.from(lowE, v => 10 * Math.log10(v + 1e-12));
    const leRef = U.percentile(leDb, 98);
    const bassOn = new Uint8Array(nP), bm = new Float32Array(nP);
    for (let j = 0; j < nP; j++) {
      const on = leDb[j] > leRef - 24 && f0c[j] > 0.8 && f0[j] > 26 && f0[j] < 300;
      bassOn[j] = on ? 1 : 0; bm[j] = on ? U.hzMidi(f0[j]) : 0;
    }
    const bmMed = new Float32Array(nP);
    for (let j = 0; j < nP; j++) {
      if (!bassOn[j]) continue;
      const w = [];
      for (let z = j - 2; z <= j + 2; z++) if (z >= 0 && z < nP && bassOn[z]) w.push(bm[z]);
      w.sort((a, b) => a - b); bmMed[j] = w[w.length >> 1];
    }
    const kickF = new Uint8Array(nP);
    for (const e of kicks) { const j = Math.round(e.t * FPS2); for (let z = j - 1; z <= j + 1; z++) if (z >= 0 && z < nP) kickF[z] = 1; }
    let bassNotes = [];
    {
      let cur = null, pend = null, pendN = 0;
      const close = t => { if (cur) { cur.t1 = t; if (cur.t1 - cur.t0 > 0.05) bassNotes.push(cur); cur = null; } };
      const open = (t, p) => {
        const i = U.lastAt(kicks, t + 0.03);
        const k = i >= 0 && kicks[i].t >= t - 0.16 ? kicks[i] : null;
        const prevEnd = bassNotes.length ? bassNotes[bassNotes.length - 1].t1 : -1;
        const t0 = k && k.t >= prevEnd - 0.01 ? Math.min(t, k.t) : t;
        cur = { p, t0, t1: t, vals: [], last: t, kick: !!k, lo: 1e9, hi: -1e9 };
      };
      for (let j = 0; j < nP; j++) {
        const t = j / FPS2;
        if (!bassOn[j]) { if (cur && t - cur.last > 0.05) close(cur.last + 1 / FPS2); continue; }
        const q = Math.round(bmMed[j]);
        if (!cur) open(t, q);
        else if (q !== cur.p) {
          if (pend === q) pendN++; else { pend = q; pendN = 1; }
          if (pendN >= 2) { close(t - 1 / FPS2); open(t - 1 / FPS2, q); pend = null; pendN = 0; }
        } else {
          pend = null; pendN = 0;
          if (kickF[j] && !kickF[Math.max(0, j - 2)] && t - cur.t0 > 0.15) { close(t - 0.02); open(t, q); }
        }
        if (cur) { cur.vals.push(bmMed[j] - cur.p); cur.last = t; cur.lo = Math.min(cur.lo, bm[j]); cur.hi = Math.max(cur.hi, bm[j]); }
      }
      if (cur) close(cur.last + 1 / FPS2);
      for (const b of bassNotes) { const v = b.vals.sort((x, y) => x - y); b.c = v.length ? 100 * v[v.length >> 1] : 0; }
      bassNotes = bassNotes.filter(b => {
        const d = b.t1 - b.t0;
        if (Math.abs(b.c) > 45) return false;
        if (b.kick && (d < 0.2 || (b.hi - b.lo > 1.5 && d < 0.4))) return false;
        return true;
      });
      for (const b of bassNotes) { b.v = 1; delete b.vals; delete b.last; delete b.kick; delete b.lo; delete b.hi; }
    }

    /* ---------- upper notes (25 fps) ---------- */
    const semDb = Float32Array.from(semE, v => 10 * Math.log10(v + 1e-12));
    const gRef = U.percentile(semDb, 99.5);
    const bassAtQ = q => { const j = Math.min(nP - 1, q * 2); return bassOn[j] ? Math.round(bmMed[j]) : -99; };
    let notes = [];
    {
      const active = new Map(), QLO = 48 - PLO, dtq = 1 / FPS3;
      for (let q = 0; q < nQ; q++) {
        const base = q * NS, t = q / FPS3;
        let fmax = -1e9; for (let z = QLO; z < NS; z++) fmax = Math.max(fmax, semDb[base + z]);
        const cand = [];
        for (let z = QLO; z < NS; z++) {
          const v = semDb[base + z];
          if (v < gRef - 36 || v < fmax - 15) continue;
          if (v < semDb[base + z - 1] || (z < NS - 1 && v < semDb[base + z + 1])) continue;
          let s = 0, c = 0;
          for (let u = Math.max(0, z - 6); u <= Math.min(NS - 1, z + 6); u++) if (u !== z) { s += semDb[base + u]; c++; }
          if (v - s / c < 6.5) continue;
          cand.push(z);
        }
        const acc = [], bq = bassAtQ(q);
        for (const z of cand) {
          const p = PLO + z, v = semDb[base + z];
          let harm = false;
          for (const a of cand) {
            if (a >= z) break;
            const d = p - (PLO + a);
            if ((d === 12 || d === 19 || d === 24 || d === 28) && v < semDb[base + a] + 2) { harm = true; break; }
          }
          if (!harm && bq > 0) {
            const d = p - bq;
            if (d === 19 || d === 28) harm = true;
            else if ((d === 12 || d === 24 || d === 31 || d === 34 || d === 36) && v < fmax - 4) harm = true;
          }
          if (!harm) acc.push(z);
        }
        acc.sort((a, b) => semDb[base + b] - semDb[base + a]);
        if (acc.length > 5) acc.length = 5;
        const seen = new Set();
        for (const z of acc) {
          const p = PLO + z; seen.add(p);
          const a = active.get(p);
          if (a) { a.last = t; a.vmax = Math.max(a.vmax, semDb[base + z]); a.n++; }
          else active.set(p, { p, t0: t, last: t, vmax: semDb[base + z], n: 1 });
        }
        for (const [p, a] of active) {
          if (!seen.has(p) && t - a.last > dtq * 1.5) { active.delete(p); if (a.n >= 3) notes.push({ p, t0: a.t0, t1: a.last + dtq, v: a.vmax }); }
        }
      }
      for (const a of active.values()) if (a.n >= 3) notes.push({ p: a.p, t0: a.t0, t1: a.last + dtq, v: a.vmax });
      for (const nt of notes) {
        nt.v = U.clamp((nt.v - (gRef - 36)) / 36);
        let bestO = null, bd = 1e9;
        const i0 = Math.max(0, U.lastAt(onsets, nt.t0 - 0.06));
        for (let i = i0; i < onsets.length && onsets[i].t <= nt.t0 + 0.16; i++) {
          const d = Math.abs(onsets[i].t - (nt.t0 + 0.05));
          if (onsets[i].t >= nt.t0 - 0.06 && d < bd) { bd = d; bestO = onsets[i]; }
        }
        if (bestO) nt.t0 = bestO.t;
        if (nt.t1 < nt.t0 + 0.08) nt.t1 = nt.t0 + 0.08;
      }
      notes.sort((a, b) => a.t0 - b.t0 || a.p - b.p);
    }

    /* ---------- chroma ---------- */
    const kickQ = new Uint8Array(nQ);
    for (const e of kicks) { const q = Math.round(e.t * FPS3); for (let z = q - 1; z <= q + 1; z++) if (z >= 0 && z < nQ) kickQ[z] = 1; }
    const chromaRaw = new Float32Array(nQ * 12), chromaE = new Float32Array(nQ);
    for (let q = 0; q < nQ; q++) {
      const base = q * NS; let mx = 0, sum = 0;
      for (let z = 12; z < NS; z++) { const a = Math.sqrt(semE[base + z]); chromaRaw[q * 12 + U.mod(PLO + z, 12)] += a; }
      for (let k = 0; k < 12; k++) { mx = Math.max(mx, chromaRaw[q * 12 + k]); sum += chromaRaw[q * 12 + k]; }
      chromaE[q] = sum;
      if (mx > 0) for (let k = 0; k < 12; k++) chromaRaw[q * 12 + k] /= mx;
    }
    const ceRef = U.percentile(chromaE, 95) || 1;
    for (let q = 0; q < nQ; q++) chromaE[q] = U.clamp(chromaE[q] / ceRef);
    const chroma = new Float32Array(nQ * 12);
    for (let q = 0; q < nQ; q++) for (let k = 0; k < 12; k++) {
      const v = chromaRaw[q * 12 + k] * Math.min(1, chromaE[q] * 1.6), prev = q ? chroma[(q - 1) * 12 + k] : 0;
      chroma[q * 12 + k] = v > prev ? prev + (v - prev) * 0.75 : prev + (v - prev) * 0.3;
    }

    const A = {
      dur, sr, fps: FPS, fps2: FPS2, fps3: FPS3, nF, nP, nQ, peak,
      spec, NB, fLo, fHi, specRange: RANGE, wmin, wmax, wfps: WF,
      rms, kicks, snares, hats, onsets,
      bpm, beat0, spb: 60 / bpm, bpmAuto: bpm, beat0Auto: beat0,
      f0, f0c, bassOn, bassMidi: bmMed, bassNotes, notes, chroma, chromaRaw, chromaE, kickQ,
      ms: 0,
    };
    A.phaseFor = phaseFor;

    /* ---------- key ---------- */
    {
      const ku = new Float64Array(12), kbv = new Float64Array(12);
      for (let q = 0; q < nQ; q++) { if (kickQ[q]) continue; const w = U.sample(rms, FPS, q / FPS3) * chromaE[q]; for (let k = 0; k < 12; k++) ku[k] += chromaRaw[q * 12 + k] * w; }
      for (const b of bassNotes) if (b.t1 - b.t0 >= 0.28) kbv[U.mod(b.p, 12)] += b.t1 - b.t0;
      let su = 0, sb = 0; for (let k = 0; k < 12; k++) { su += ku[k]; sb += kbv[k]; }
      const kp = new Float64Array(12);
      const bassW = 0.6 * Math.min(1, (sb / Math.max(1, dur)) / 0.4);
      for (let k = 0; k < 12; k++) kp[k] = ku[k] / (su || 1) + bassW * kbv[k] / (sb || 1);
      A.key = A.keyAuto = chooseKey(A, kp, kbv, bassW);
    }

    /* ---------- levels ---------- */
    const toDb = v => 10 * Math.log10(v + 1e-12);
    const meters = [], meterRef = [];
    const srcs = [[pSub, FPS3], [pBass, FPS3], [pMid, FPS], [pHigh, FPS], [pAir, FPS]];
    for (const [arr, fps] of srcs) {
      const d = new Float32Array(nF);
      for (let i = 0; i < nF; i++) d[i] = toDb(fps === FPS ? arr[i] : U.sample(arr, FPS3, i / FPS));
      meterRef.push(U.percentile(d, 99.5));
      const m = new Float32Array(nF); let prev = -200;
      for (let i = 0; i < nF; i++) { prev = Math.max(d[i], prev - 0.26); m[i] = prev; }
      meters.push(m);
    }
    const loRef = U.percentile(Float32Array.from(pLow, toDb), 99);
    const lo = new Float32Array(nF), hi = new Float32Array(nF);
    for (let i = 0, pl = 0, ph = 0; i < nF; i++) {
      const v = U.clamp((toDb(pLow[i]) - (loRef - 30)) / 30);
      pl = v > pl ? v : pl * 0.9; lo[i] = pl;
      const h = Math.max(Math.min(1, oS[i]), 0.7 * Math.min(1, oH[i]));
      ph = h > ph ? h : ph * 0.8; hi[i] = ph;
    }
    const rmsRef = U.percentile(rms, 99) || 1;
    Object.assign(A, { meters, meterRef, lo, hi, loud: Float32Array.from(rms, v => U.clamp(v / rmsRef)) });
    buildChords(A);
    A.ms = Math.round(performance.now() - T0);
    onProgress(1);
    return A;
  }

  /* key from 12 pitch-class weights and the bass's pitch-class durations; shared by the audio reader and MIDI */
  function chooseKey(A, kp, kbv, bassW) {
    let sb = 0; for (let k = 0; k < 12; k++) sb += kbv[k];
    let best = { pc: 0, minor: true, r: -2 };
    const rs = [];
    for (let pc = 0; pc < 12; pc++) {
      const rot = Array.from({ length: 12 }, (_, i) => kp[(i + pc) % 12]);
      const rM = corr(rot, KS_MAJ), rm = corr(rot, KS_MIN);
      rs.push([rM, rm]);
      if (rM > best.r) best = { pc, minor: false, r: rM };
      if (rm > best.r) best = { pc, minor: true, r: rm };
    }
    /* relative major / minor share a scale: decide by the tonic's weight in the bass, the opening chord and a minor bias */
    const rel = best.minor ? { pc: (best.pc + 3) % 12, minor: false } : { pc: (best.pc + 9) % 12, minor: true };
    rel.r = rs[rel.pc][rel.minor ? 1 : 0];
    A.key = best; buildChords(A);
    const first = A.chords.find(c => c.root >= 0);
    const tri = (pc, minor) => kp[pc] + kp[(pc + (minor ? 3 : 4)) % 12] + kp[(pc + 7) % 12];
    const firstMinor = first ? /^[A-G]#?m(?!aj)/.test(first.name) : false;
    const sc = k => 0.6 * k.r + (sb ? bassW * kbv[k.pc] / sb : 0) + 0.5 * tri(k.pc, k.minor) + (first && first.root === k.pc && firstMinor === k.minor ? 0.4 : 0) + (k.minor ? 0.06 : 0);
    if (sc(rel) > sc(best)) best = rel;
    const scl = best.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    best.scale = scl.map(i => (best.pc + i) % 12);
    best.name = U.pcName(best.pc) + (best.minor ? ' MIN' : ' MAJ');
    return best;
  }

  /* chords per beat: from chroma + the 808 root, or from the MIDI notes when those are the source */
  function buildChords(A) {
    const out = [], spb = A.spb, nb = Math.ceil(A.dur / spb) + 1;
    const first = A.beat0 - Math.ceil(A.beat0 / spb) * spb;
    const lastQ = A.nQ - 1, midi = A.source === 'midi' ? A.notes : null;
    for (let b = 0; b < nb; b++) {
      const t0 = first + b * spb, t1 = t0 + spb;
      if (t1 <= 0 || t0 >= A.dur) continue;
      const v = new Float64Array(12); let e = 0, cnt = 0;
      if (midi) {
        for (let i = U.lastAt(midi, t1, 't0'); i >= 0; i--) {
          const n = midi[i]; if (n.t0 < t0 - 30) break;
          const ov = Math.min(t1, n.t1) - Math.max(t0, n.t0);
          if (ov > 0.02) v[U.mod(n.p, 12)] += ov * (0.4 + 0.6 * n.v);
        }
        let mx = 0, npc = 0; for (let k = 0; k < 12; k++) mx = Math.max(mx, v[k]);
        for (let k = 0; k < 12; k++) if (v[k] > 0.2 * mx) npc++;
        e = mx > 0 && npc >= 2 ? 1 : 0;
      } else {
        const q0 = Math.max(0, Math.floor((t0 + 0.1) * A.fps3)), q1 = Math.min(lastQ, Math.ceil((t1 + 0.04) * A.fps3));
        for (let q = q0; q < q1; q++) {
          const w = A.chromaE[q]; e += w; cnt++;
          if (A.kickQ[q]) continue;
          for (let k = 0; k < 12; k++) v[k] += A.chromaRaw[q * 12 + k] * w;
        }
        e /= Math.max(1, cnt);
      }
      let bassPc = -1;
      const bi = U.lastAt(A.bassNotes, (t0 + t1) / 2, 't0');
      if (bi >= 0 && A.bassNotes[bi].t1 > t0 && A.bassNotes[bi].t1 - A.bassNotes[bi].t0 >= (midi ? 0.1 : 0.28)) bassPc = U.mod(A.bassNotes[bi].p, 12);
      if (bassPc >= 0) { let mx = 0; for (let k = 0; k < 12; k++) mx = Math.max(mx, v[k]); v[bassPc] += 0.5 * mx; }
      let nv = 0; for (let k = 0; k < 12; k++) nv += v[k] * v[k]; nv = Math.sqrt(nv) || 1;
      let best = null;
      if (e > 0.18) {
        for (let r = 0; r < 12; r++) for (const [suf, iv, pen] of CHORD_T) {
          let dot = 0, nt = 0;
          for (let i = 0; i < iv.length; i++) { const w = i === 0 ? 1.25 : 1; dot += w * v[(r + iv[i]) % 12]; nt += w * w; }
          const s = dot / (nv * Math.sqrt(nt)) - pen + (bassPc === r ? 0.1 : 0);
          if (!best || s > best.s) best = { s, root: r, suf, pcs: iv.map(i => (r + i) % 12) };
        }
      }
      out.push(best && best.s > 0.55
        ? { t0, t1, root: best.root, name: U.pcName(best.root) + best.suf, pcs: best.pcs }
        : { t0, t1, root: -1, name: '', pcs: [] });
    }
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i - 1].name === out[i + 1].name && out[i].name !== out[i - 1].name) out[i] = Object.assign({}, out[i - 1], { t0: out[i].t0, t1: out[i].t1 });
    }
    const merged = [];
    for (const c of out) {
      const l = merged[merged.length - 1];
      if (l && l.name === c.name) l.t1 = c.t1; else merged.push(Object.assign({}, c));
    }
    A.chords = merged;
  }

  function setTempo(A, bpm, beat0) {
    A.bpm = bpm; A.spb = 60 / bpm;
    if (beat0 != null) { const bar = 4 * A.spb; beat0 = U.mod(beat0, bar); if (beat0 > bar - 0.08) beat0 -= bar; A.beat0 = beat0; }
    else A.beat0 = A.phaseFor(bpm);
    buildChords(A);
  }

  G.PULSE.analyse = analyse;
  G.PULSE._pitch = { yin, decimate, lp2 };
  G.PULSE.setTempo = setTempo;
  G.PULSE.buildChords = buildChords;
  G.PULSE.chooseKey = chooseKey;
})(typeof window !== 'undefined' ? window : globalThis);

/* Readout Lab — MIDI input, and the note source every concept reads (audio analysis or a MIDI file) */
(function (G) {
  'use strict';
  const { U, setTempo } = G.PULSE;

  /* Standard MIDI File → { bpm, kick, snare, hat, perc, bass, mel, tracks } (times in seconds from tick 0) */
  function parseMidi(buf) {
    const d = new DataView(buf), n = buf.byteLength;
    const tag = at => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
    if (n < 14 || tag(0) !== 'MThd') throw new Error('not-midi');
    const hlen = d.getUint32(4), div = d.getUint16(12);
    if (div & 0x8000) throw new Error('smpte');
    let p = 8 + hlen;
    const vlq = () => { let v = 0, b, k = 0; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while ((b & 0x80) && ++k < 4); return v; };
    const tempos = [], raw = [];
    while (p + 8 <= n) {
      const id = tag(p), len = d.getUint32(p + 4); p += 8;
      const end = Math.min(n, p + len);
      if (id !== 'MTrk') { p = end; continue; }
      let tick = 0, run = 0, name = '';
      const evs = [];
      try {
        while (p < end) {
          tick += vlq();
          let st = d.getUint8(p);
          if (st < 0x80) { if (!run) break; st = run; } else { p++; if (st < 0xF0) run = st; }
          if (st === 0xFF) {
            const type = d.getUint8(p++), l = vlq();
            if (type === 0x51 && l === 3) tempos.push({ tick, us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
            else if ((type === 0x03 || type === 0x04) && !name) { let s = ''; for (let i = 0; i < l && p + i < end; i++) s += String.fromCharCode(d.getUint8(p + i)); name = s.replace(/\0/g, '').trim(); }
            p += l;
            if (type === 0x2F) break;
          } else if (st === 0xF0 || st === 0xF7) {
            p += vlq();
          } else {
            const hi = st & 0xF0, ch = st & 0x0F, a = d.getUint8(p++);
            const b = (hi === 0xC0 || hi === 0xD0) ? 0 : d.getUint8(p++);
            if (hi === 0x90 && b > 0) evs.push({ tick, on: 1, ch, k: a, v: b });
            else if (hi === 0x80 || (hi === 0x90 && b === 0)) evs.push({ tick, on: 0, ch, k: a });
          }
        }
      } catch (e) { /* truncated track: keep what was read */ }
      p = end;
      raw.push({ name, evs });
    }
    tempos.sort((a, b) => a.tick - b.tick);
    const tempoKnown = tempos.length > 0;
    if (!tempoKnown) tempos.push({ tick: 0, us: 500000 });
    if (tempos[0].tick > 0) tempos.unshift({ tick: 0, us: tempos[0].us });
    const seg = [];
    for (let i = 0, acc = 0; i < tempos.length; i++) {
      if (i) acc += (tempos[i].tick - tempos[i - 1].tick) * tempos[i - 1].us / div / 1e6;
      seg.push({ tick: tempos[i].tick, us: tempos[i].us, sec: acc });
    }
    const sec = tick => { let j = seg.length - 1; while (j > 0 && seg[j].tick > tick) j--; return seg[j].sec + (tick - seg[j].tick) * seg[j].us / div / 1e6; };

    const groups = [];
    for (const tr of raw) {
      const byCh = new Map(), open = new Map();
      const add = (o, offTick) => {
        if (!byCh.has(o.ch)) byCh.set(o.ch, []);
        const t0 = sec(o.tick);
        byCh.get(o.ch).push({ p: o.k, t0, t1: Math.max(sec(offTick), t0 + 0.03), v: o.v / 127 });
      };
      for (const e of tr.evs) {
        const key = e.ch * 128 + e.k;
        if (e.on) { if (!open.has(key)) open.set(key, []); open.get(key).push(e); }
        else { const q = open.get(key); if (q && q.length) add(q.shift(), e.tick); }
      }
      for (const q of open.values()) for (const o of q) add(o, o.tick + div / 4);
      for (const [ch, notes] of byCh) groups.push({ name: tr.name, ch, notes: notes.sort((a, b) => a.t0 - b.t0) });
    }

    const out = { kick: [], snare: [], hat: [], perc: [], bass: [], mel: [], tracks: groups.length, bpm: 60e6 / tempos[0].us, tempoKnown };
    if (!(out.bpm > 20 && out.bpm < 400)) out.bpm = 120;
    const spb = 60 / out.bpm;
    /* General MIDI drum map: channel 10, or any track named like a kit (Ableton drum racks, FPC) */
    const gm = nt => { const k = nt.p; return k === 35 || k === 36 ? 'kick' : k >= 37 && k <= 40 ? 'snare' : k === 42 || k === 44 || k === 46 ? 'hat' : 'perc'; };
    /* a one-shot on a single pitch with no telling name (an FL channel called after its sample): read its rhythm */
    const byRhythm = list => {
      const q = spb / 4, bars = new Map();
      let back = 0;
      for (const n of list) {
        const k = Math.round(n.t0 / q), st = U.mod(k, 16), bar = Math.floor(k / 16);
        if (!bars.has(bar)) bars.set(bar, 0);
        if (st === 0) bars.set(bar, 1);
        if (st === 4 || st === 8 || st === 12) back++;
      }
      const beats = (list[list.length - 1].t0 - list[0].t0) / spb + 1, dens = list.length / beats;
      let ones = 0; for (const v of bars.values()) ones += v;
      const f0 = ones / bars.size;
      if (dens >= 1.5) return 'hat';
      if (f0 >= 0.5) return 'kick';
      if (f0 < 0.3 && back / list.length >= 0.6) return 'snare';
      return 'perc';
    };
    const MEL = /lead|melod|key|piano|pluck|pad|chord|bell|guitar|gtr|string|synth|vox|vocal|arp|flute|brass|organ|choir|rhodes/;
    const melGroups = [];
    for (const gp of groups) {
      const nm = (gp.name || '').toLowerCase();
      let kind = null;
      if (gp.ch === 9) kind = 'gm';
      else if (/kick|kik|\bbd\b|bass ?drum/.test(nm)) kind = 'kick';
      else if (/snare|clap|\bsnap|\bsd\b|\bcp\b|\brim/.test(nm)) kind = 'snare';
      else if (/hi.?hats?|(^|[^a-z])hats?\b|\bhh\b|\boh\b|open ?h|\bride\b|shaker/.test(nm)) kind = 'hat';
      else if (/perc|\btoms?\b|conga|bongo|tamb|cowbell|crash|\bcym|\bfx\b|riser|impact/.test(nm)) kind = 'perc';
      else if (/drum|\bkit\b|\bfpc\b|battery/.test(nm)) kind = 'gm';
      else if (/808|bass|\bsub\b/.test(nm)) kind = 'bass';
      else if (!MEL.test(nm) && gp.notes.length >= 4 && gp.notes.every(n => n.p === gp.notes[0].p)) {
        const ds = gp.notes.map(n => n.t1 - n.t0).sort((a, b) => a - b);
        if (ds[ds.length >> 1] <= 0.35 * spb) kind = byRhythm(gp.notes);
      }
      if (kind === 'gm') { for (const nt of gp.notes) out[gm(nt)].push({ t: nt.t0, s: nt.v }); continue; }
      if (kind === 'bass') { for (const nt of gp.notes) out.bass.push(Object.assign({ c: 0 }, nt)); continue; }
      if (kind) { for (const nt of gp.notes) out[kind].push({ t: nt.t0, s: nt.v }); continue; }
      melGroups.push(gp);
    }
    if (!out.bass.length && melGroups.length > 1) {
      let best = null, bm = 1e9;
      for (const gp of melGroups) { const ps = gp.notes.map(x => x.p).sort((a, b) => a - b); const med = ps[ps.length >> 1]; if (med < bm) { bm = med; best = gp; } }
      if (best && bm < 50) { for (const nt of best.notes) out.bass.push(Object.assign({ c: 0 }, nt)); melGroups.splice(melGroups.indexOf(best), 1); }
    }
    for (const gp of melGroups) for (const nt of gp.notes) out.mel.push(nt);
    const byT = (a, b) => a.t - b.t, byT0 = (a, b) => a.t0 - b.t0 || a.p - b.p;
    for (const k of ['kick', 'snare', 'hat', 'perc']) out[k].sort(byT);
    out.bass.sort(byT0); out.mel.sort(byT0);
    return out;
  }

  /* the key of the MIDI notes themselves: held notes weighted by length and velocity, the bass by length */
  function midiKey(A, m) {
    const ku = new Float64Array(12), kbv = new Float64Array(12);
    let tA = 1e9, tB = 0;
    for (const n of m.mel) { ku[U.mod(n.p, 12)] += (n.t1 - n.t0) * (0.4 + 0.6 * n.v); tA = Math.min(tA, n.t0); tB = Math.max(tB, n.t1); }
    for (const b of m.bass) { if (b.t1 - b.t0 >= 0.1) kbv[U.mod(b.p, 12)] += b.t1 - b.t0; tA = Math.min(tA, b.t0); tB = Math.max(tB, b.t1); }
    let su = 0, sb = 0; for (let k = 0; k < 12; k++) { su += ku[k]; sb += kbv[k]; }
    if (!su && !sb) return null;
    const bassW = 0.6 * Math.min(1, (sb / Math.max(1, tB - tA)) / 0.4), kp = new Float64Array(12);
    for (let k = 0; k < 12; k++) kp[k] = ku[k] / (su || 1) + bassW * kbv[k] / (sb || 1);
    return G.PULSE.chooseKey(A, kp, kbv, bassW);
  }

  /* switch the events every concept reads; 'audio' restores what the analysis found. Tempo, chords and the
     auto key follow the source; a key the user picked by hand stays. */
  function applySource(A, which) {
    if (!A.audioSet) A.audioSet = { kicks: A.kicks, snares: A.snares, hats: A.hats, bassNotes: A.bassNotes, notes: A.notes, keyAuto: A.keyAuto };
    const m = A.midiSet, picked = A.key !== A.keyAuto ? A.key : null;
    if (which === 'midi' && m) {
      if (m.tempoKnown === false && !m.rescaled) {
        /* no tempo in the file: its times were read at 120 BPM, so stretch them onto the track's own tempo */
        const k = (60 / A.bpmAuto) / 0.5;
        for (const key of ['kick', 'snare', 'hat', 'perc']) for (const e of m[key]) e.t *= k;
        for (const key of ['bass', 'mel']) for (const n of m[key]) { n.t0 *= k; n.t1 *= k; }
        m.bpm = A.bpmAuto; m.rescaled = true;
      }
      Object.assign(A, { kicks: m.kick, snares: m.snare, hats: m.hat, perc: m.perc, bassNotes: m.bass, notes: m.mel, source: 'midi' });
      let b = Math.round(m.bpm * 100) / 100; if (Math.abs(b - Math.round(b)) < 0.02) b = Math.round(b);
      if (b >= 40 && b <= 250) setTempo(A, b, 0);
      if (m.key === undefined) m.key = midiKey(A, m);
      A.keyAuto = m.key || A.audioSet.keyAuto;
    } else {
      Object.assign(A, A.audioSet, { perc: [], source: 'audio' });
      if (A.bpm !== A.bpmAuto || A.beat0 !== A.beat0Auto) setTempo(A, A.bpmAuto, A.beat0Auto);
    }
    G.PULSE.buildChords(A);
    A.key = picked || A.keyAuto;
    A.ver = (A.ver || 0) + 1;
  }

  /* the notes the concepts draw: from audio, short and quiet detections are left out; from MIDI, everything */
  function noteSet(A) {
    if (A._ns && A._ns.ver === (A.ver || 0)) return A._ns;
    const mel = A.source === 'midi' ? A.notes.slice() : A.notes.filter(n => n.t1 - n.t0 >= 0.14 && n.v >= 0.22);
    const bass = A.bassNotes.slice();
    const all = [...mel.map(n => Object.assign({ bass: false }, n)), ...bass.map(n => Object.assign({ bass: true }, n))]
      .sort((a, b) => a.t0 - b.t0 || a.p - b.p);
    A._ns = { ver: A.ver || 0, mel, bass, all };
    return A._ns;
  }

  G.PULSE.parseMidi = parseMidi;
  G.PULSE.applySource = applySource;
  G.PULSE.noteSet = noteSet;
})(typeof window !== 'undefined' ? window : globalThis);

/* Readout Lab — the shared frame: palette, layout, type helpers, header, readout row, bottom panel */
(function (G) {
  'use strict';
  const { U } = G.PULSE;
  const MONO = "'Plex Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace";
  const SANS = "'Geist', 'Helvetica Neue', Arial, sans-serif";

  const PALETTES = {
    black: { bg: '#000000', ink: '#F1F1EF', dim: 'rgba(241,241,239,0.56)', faint: 'rgba(241,241,239,0.27)', ghost: 'rgba(241,241,239,0.095)', acc: '#F0641E', inkRGB: [241, 241, 239] },
    paper: { bg: '#E9E9E5', ink: '#0B0B0B', dim: 'rgba(11,11,11,0.58)', faint: 'rgba(11,11,11,0.28)', ghost: 'rgba(11,11,11,0.085)', acc: '#E0531A', inkRGB: [11, 11, 11] },
  };
  function palette(paper, accent) {
    const p = Object.assign({}, PALETTES[paper ? 'paper' : 'black']);
    if (!accent) p.acc = p.ink;
    return p;
  }

  /* ---------- type ---------- */
  const widthCache = new Map();
  if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => widthCache.clear());   // METHOD: fonts load after the first frames
  function charW(g, font, ch) {
    const k = font + '\u0000' + ch;
    let w = widthCache.get(k);
    if (w === undefined) { w = g.measureText(ch).width; widthCache.set(k, w); if (widthCache.size > 4000) widthCache.clear(); }
    return w;
  }
  /* tracked text; returns its width */
  function label(g, str, x, y, o = {}) {
    const size = o.size || 22, weight = o.weight || 500, font = o.font || MONO;
    const f = `${weight} ${size}px ${font}`;
    g.font = f; g.fillStyle = o.color || '#fff'; g.textBaseline = o.base || 'alphabetic';
    const sp = (o.track ?? 0.12) * size;
    str = String(str);
    let w = 0; const ws = [];
    for (const ch of str) { const cw = charW(g, f, ch); ws.push(cw); w += cw + sp; }
    w -= sp;
    const align = o.align || 'left';
    let cx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    if (o.measure) return w;
    g.textAlign = 'left';
    let i = 0;
    for (const ch of str) { g.fillText(ch, cx, y); cx += ws[i++] + sp; }
    return w;
  }

  /* ---------- layout ---------- */
  function layout(W, H, bottom, padY) {
    const s = Math.min(W, H) / 1080, m = Math.round(64 * s), ar = H / W;   // METHOD: scale by the short side, so 16:9 (1920 x 1080) keeps the 9:16 sizes
    const py = Math.round(padY || 0);   // METHOD: extra room above and below (a library card crops the frame's top and bottom)
    const on = bottom !== 'off';
    const headBase = py + m + 24 * s;
    const headBottom = py + m + 74 * s;
    const panelH = on ? Math.round((ar > 1.6 ? 250 : ar > 1.15 ? 180 : 140) * s) : 0;
    const axisH = on ? Math.round(36 * s) : 0;
    const gutter = Math.round(78 * s);
    const panel = { x: m + gutter, y: H - py - m - axisH - panelH, w: W - 2 * m - gutter, h: panelH };
    const readY = on ? panel.y - Math.round(30 * s) : H - py - m;
    const stageTop = headBottom + Math.round(30 * s);
    const stage = { x: m, y: stageTop, w: W - 2 * m, h: readY - Math.round(64 * s) - stageTop };
    return { W, H, s, m, headBase, panel, readY, stage, gutter };
  }

  /* ---------- per-frame features ---------- */
  function hitEnv(evs, t, tau) {
    const i = U.lastAt(evs, t); if (i < 0) return 0;
    let v = 0;
    for (let k = i; k >= Math.max(0, i - 3); k--) { const dt = t - evs[k].t; if (dt > tau * 7) break; v = Math.max(v, evs[k].s * Math.exp(-dt / tau)); }
    return v;
  }
  function features(A, t) {
    const spb = A.spb, F = { t };
    F.beat = (t - A.beat0) / spb; F.bi = Math.floor(F.beat); F.bf = F.beat - F.bi;
    F.bar = Math.floor(F.bi / 4); F.bib = U.mod(F.bi, 4);
    F.st = Math.floor(F.beat * 4); F.s16 = U.mod(F.st, 16);
    F.barT0 = A.beat0 + F.bar * 4 * spb;
    F.kick = hitEnv(A.kicks, t, 0.16); F.snare = hitEnv(A.snares, t, 0.13); F.hat = hitEnv(A.hats, t, 0.06);
    const ki = U.lastAt(A.kicks, t), si = U.lastAt(A.snares, t), hi = U.lastAt(A.hats, t);
    F.ki = ki; F.si = si; F.hti = hi;
    F.lastKick = ki >= 0 ? A.kicks[ki] : null; F.lastSnare = si >= 0 ? A.snares[si] : null; F.lastHat = hi >= 0 ? A.hats[hi] : null;
    F.loud = U.sample(A.loud, A.fps, t); F.lo = U.sample(A.lo, A.fps, t); F.hi = U.sample(A.hi, A.fps, t);
    const ci = U.lastAt(A.chords, t, 't0');
    F.chord = ci >= 0 && A.chords[ci].t1 > t ? A.chords[ci] : null; F.chordI = ci;
    let e = 0, c = 0;
    for (let i = Math.max(0, Math.floor((t - 0.3) * A.fps)); i <= Math.min(A.nF - 1, Math.floor(t * A.fps)); i++) { e += A.rms[i] * A.rms[i]; c++; }
    F.db = 10 * Math.log10((c ? e / c : 0) + 1e-10);
    return F;
  }

  /* ---------- spectrogram images (alpha masks) ---------- */
  const CH = 2048;
  function specImages(A) {
    if (A._img) return A._img;
    const imgs = [], NB = A.NB, LUT = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) LUT[v] = Math.round(255 * Math.pow(v / 255, 1.35));
    for (let c0 = 0; c0 < A.nF; c0 += CH) {
      const w = Math.min(CH, A.nF - c0);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = NB;
      const x = cv.getContext('2d'), im = x.createImageData(w, NB), d = im.data;
      for (let i = 0; i < w; i++) for (let b = 0; b < NB; b++) {
        const v = LUT[A.spec[(c0 + i) * NB + b]], o = ((NB - 1 - b) * w + i) * 4;
        d[o] = 255; d[o + 1] = 255; d[o + 2] = 255; d[o + 3] = v;
      }
      x.putImageData(im, 0, 0);
      imgs.push({ c0, w, cv });
    }
    A._img = imgs;
    return imgs;
  }
  let tmp = null, tmpX = null;
  function tmpCanvas(w, h) {
    if (!tmp) { tmp = document.createElement('canvas'); tmpX = tmp.getContext('2d'); }
    if (tmp.width !== w || tmp.height !== h) { tmp.width = w; tmp.height = h; }
    return tmpX;
  }

  /* ---------- header + readout ---------- */
  function header(g, L, X) {
    const { P, s, st, A } = X;
    const tw = label(g, (st.title || 'UNTITLED').toUpperCase(), L.m, L.headBase, { size: 30 * s, weight: 500, track: 0.16, color: P.ink, measure: true });
    let title = (st.title || 'UNTITLED').toUpperCase();
    const maxW = L.W * 0.52;
    if (tw > maxW) { while (title.length > 3 && label(g, title + '…', 0, 0, { size: 30 * s, track: 0.16, measure: true }) > maxW) title = title.slice(0, -1); title += '…'; }
    label(g, title, L.m, L.headBase, { size: 30 * s, weight: 500, track: 0.16, color: P.ink });
    if (st.artist) label(g, st.artist.toUpperCase(), L.m, L.headBase + 38 * s, { size: 21 * s, weight: 400, track: 0.16, color: P.dim });
    const bpm = Math.round(A.bpm * 10) / 10;
    label(g, `${bpm} BPM  ·  ${A.key.name}`, L.W - L.m, L.headBase, { size: 26 * s, weight: 500, track: 0.12, color: P.ink, align: 'right' });
  }
  function readout(g, L, X) {
    const { P, s, t, F } = X;
    const y = L.readY;
    label(g, U.fmtTime(t), L.m, y, { size: 22 * s, weight: 500, track: 0.08, color: P.ink });
    const db = Math.max(-60, F.db);
    label(g, `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`, L.W - L.m, y, { size: 22 * s, weight: 500, track: 0.08, color: P.dim, align: 'right' });
    const sq = 10 * s, gp = 5 * s, tot = 16 * sq + 15 * gp, x0 = L.W / 2 - tot / 2, yy = y - 8 * s - sq / 2;
    for (let i = 0; i < 16; i++) {
      const x = x0 + i * (sq + gp);
      if (i === F.s16) { g.fillStyle = P.acc; g.fillRect(x, yy, sq, sq); continue; }
      g.fillStyle = i < F.s16 ? P.faint : P.ghost; g.fillRect(x, yy, sq, sq);
      if (i % 4 === 0) { g.strokeStyle = P.dim; g.lineWidth = 1.2 * s; g.strokeRect(x + 0.6 * s, yy + 0.6 * s, sq - 1.2 * s, sq - 1.2 * s); }
    }
  }

  /* ---------- bottom panels ---------- */
  function panelSpan(A) { return U.clamp(8 * A.spb, 2.5, 6); }

  function drawSpectro(g, L, X) {
    const { P, s, t, A } = X, R = L.panel, span = panelSpan(A) * (X.st.span || 1);   // METHOD: Window knob
    const imgs = specImages(A);
    const w = Math.round(R.w), h = Math.round(R.h), x = tmpCanvas(w, h);
    x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, w, h);
    x.imageSmoothingEnabled = true;
    const f1 = t * A.fps, f0 = f1 - span * A.fps, pxPerF = w / (f1 - f0);
    for (const im of imgs) {
      const a = Math.max(f0, im.c0), b = Math.min(f1, im.c0 + im.w);
      if (b <= a) continue;
      x.drawImage(im.cv, a - im.c0, 0, b - a, A.NB, (a - f0) * pxPerF, 0, (b - a) * pxPerF, h);
    }
    if (f0 < 0 && A.loopy) {
      /* looping demo: wrap the end of the track in front of its start */
      for (const im of imgs) {
        const a = Math.max(A.nF + f0, im.c0), b = Math.min(A.nF, im.c0 + im.w);
        if (b <= a) continue;
        x.drawImage(im.cv, a - im.c0, 0, b - a, A.NB, (a - A.nF - f0) * pxPerF, 0, (b - a) * pxPerF, h);
      }
    }
    x.globalCompositeOperation = 'source-in'; x.fillStyle = P.ink; x.fillRect(0, 0, w, h);
    g.drawImage(tmp, R.x, R.y);
    /* frequency axis */
    const fy = f => R.y + R.h - R.h * Math.log(f / A.fLo) / Math.log(A.fHi / A.fLo);
    for (const [f, txt] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
      if (f > A.fHi * 1.02) continue;
      const y = Math.max(R.y + 8 * s, fy(Math.min(f, A.fHi)));
      label(g, txt, R.x - 26 * s, y + 7 * s, { size: 19 * s, weight: 400, track: 0.04, color: P.dim, align: 'right' });
      g.fillStyle = P.dim; g.fillRect(R.x - 16 * s, y - 0.75 * s, 9 * s, 1.5 * s);
    }
    /* time axis */
    const yT = R.y + R.h + 28 * s;
    for (let sec = Math.ceil(t - span); sec <= Math.floor(t); sec++) {
      const xx = R.x + (sec - (t - span)) / span * R.w;
      if (sec < 0 && !A.loopy) continue;
      g.fillStyle = P.faint; g.fillRect(xx - 0.75 * s, R.y + R.h + 4 * s, 1.5 * s, 8 * s);
      if (xx > R.x + 30 * s && xx < R.x + R.w - 30 * s) label(g, U.fmtClock(A.loopy ? U.mod(sec, A.dur) : sec), xx, yT, { size: 18 * s, weight: 400, track: 0.04, color: P.dim, align: 'center' });
    }
  }

  function drawWave(g, L, X) {
    const { P, s, t, A } = X, R = L.panel, span = panelSpan(A) * (X.st.span || 1);   // METHOD: Window knob
    const nowX = R.x + R.w * 0.8, pre = span * 0.8, post = span * 0.2;
    const w = Math.round(R.w), cy = R.y + R.h / 2, amp = R.h * 0.47;
    const wf = A.wfps, n = A.wmin.length;
    const paths = [new Path2D(), new Path2D()];
    for (let i = 0; i < w; i++) {
      const xx = R.x + i + 0.5;
      const ta = t - pre + (i / w) * span, tb = ta + span / w;
      let a = Math.floor(ta * wf), b = Math.max(a + 1, Math.floor(tb * wf));
      let lo = 0, hi = 0;
      for (let k = a; k < b; k++) {
        let kk = k;
        if (kk < 0 || kk >= n) { if (!A.loopy) continue; kk = U.mod(kk, n); }
        if (A.wmin[kk] < lo) lo = A.wmin[kk]; if (A.wmax[kk] > hi) hi = A.wmax[kk];
      }
      const p = xx < nowX ? paths[0] : paths[1];
      p.moveTo(xx, cy - hi * amp - 0.5); p.lineTo(xx, cy - lo * amp + 0.5);
    }
    g.lineWidth = 1;
    g.strokeStyle = P.ink; g.stroke(paths[0]);
    g.strokeStyle = P.faint; g.stroke(paths[1]);
    g.fillStyle = P.acc; g.fillRect(nowX - 1 * s, R.y - 6 * s, 2 * s, R.h + 12 * s);
    /* beat ticks + bar numbers */
    const spb = A.spb, b0 = Math.ceil((t - pre - A.beat0) / spb), b1 = Math.floor((t + post - A.beat0) / spb);
    const yT = R.y + R.h + 28 * s;
    for (let b = b0; b <= b1; b++) {
      const tb = A.beat0 + b * spb, xx = nowX + (tb - t) / span * R.w, down = U.mod(b, 4) === 0;
      g.fillStyle = down ? P.dim : P.faint;
      g.fillRect(xx - 0.75 * s, R.y + R.h + 4 * s, 1.5 * s, (down ? 12 : 6) * s);
      const nBars = Math.max(1, Math.round(A.dur / (4 * spb))), barN = A.loopy ? U.mod(Math.floor(b / 4), nBars) + 1 : Math.max(0, Math.floor(b / 4) + 1);
      if (down && xx > R.x + 20 * s && xx < R.x + R.w - 20 * s) label(g, String(barN).padStart(2, '0'), xx, yT, { size: 18 * s, weight: 400, track: 0.04, color: P.dim, align: 'center' });
    }
    label(g, 'L+R', R.x - 26 * s, cy + 7 * s, { size: 17 * s, weight: 400, track: 0.06, color: P.faint, align: 'right' });
  }

  const peakMem = { key: null, v: null };
  function drawBars(g, L, X) {
    const { P, s, t, A } = X, R = L.panel, NBAR = 72, NB = A.NB;
    const fi = Math.max(0, Math.min(A.nF - 1, Math.round(t * A.fps)));
    const bw = R.w / NBAR;
    for (let k = 0; k < NBAR; k++) {
      const b0 = Math.floor(k * NB / NBAR), b1 = Math.max(b0 + 1, Math.floor((k + 1) * NB / NBAR));
      let v = 0, pk = 0;
      for (let b = b0; b < b1; b++) v = Math.max(v, A.spec[fi * NB + b]);
      for (let f = Math.max(0, fi - 70); f <= fi; f += 2) {
        let m = 0; for (let b = b0; b < b1; b++) m = Math.max(m, A.spec[f * NB + b]);
        const fall = (fi - f) / A.fps;
        pk = Math.max(pk, m / 255 - Math.max(0, fall - 0.35) * 1.4);
      }
      v /= 255;
      const hh = Math.pow(v, 1.25) * R.h, x = R.x + k * bw;
      g.fillStyle = P.ink; g.fillRect(x + bw * 0.22, R.y + R.h - hh, bw * 0.56, hh);
      const py = R.y + R.h - Math.pow(Math.max(0, pk), 1.25) * R.h;
      g.fillStyle = pk > v + 0.02 ? P.dim : P.acc; g.fillRect(x + bw * 0.22, py - 2 * s, bw * 0.56, 2.5 * s);
    }
    const fx = f => R.x + R.w * Math.log(f / A.fLo) / Math.log(A.fHi / A.fLo);
    for (const [f, txt] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
      if (f > A.fHi) continue;
      label(g, txt, fx(f), R.y + R.h + 28 * s, { size: 18 * s, weight: 400, track: 0.04, color: P.dim, align: 'center' });
      g.fillStyle = P.faint; g.fillRect(fx(f) - 0.75 * s, R.y + R.h + 4 * s, 1.5 * s, 8 * s);
    }
    label(g, 'dB', R.x - 26 * s, R.y + 18 * s, { size: 17 * s, weight: 400, track: 0.06, color: P.faint, align: 'right' });
  }

  function drawFrame(g, st, t, concepts) {
    const A = st.A, W = g.canvas.width, H = g.canvas.height;
    const c = concepts[st.ci];
    const bottom = st.bottom === 'auto' ? c.bottom : st.bottom;
    const L = layout(W, H, bottom, st.padY);
    const P = palette(st.paper, st.accent), F = features(A, t);
    const X = { A, F, P, s: L.s, t, st, L, cache: c.cache || (c.cache = {}) };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    g.save();
    const punch = typeof st.punch === 'number' ? st.punch : st.punch === 'hard' ? 0.06 : st.punch === 'soft' ? 0.025 : 0;   // METHOD: Punch knob (an amount)
    if (punch && F.kick > 0.001) {
      const R = L.stage, k = 1 + punch * F.kick, px = R.x + R.w / 2, py = R.y + R.h / 2;
      g.translate(px, py); g.scale(k, k); g.translate(-px, -py);
    }
    c.draw(g, L.stage, X);
    g.restore();
    g.globalAlpha = 1;
    header(g, L, X);
    readout(g, L, X);
    if (bottom === 'spectro') drawSpectro(g, L, X);
    else if (bottom === 'wave') drawWave(g, L, X);
    else if (bottom === 'bars') drawBars(g, L, X);
    return L;
  }

  G.PULSE.frame = { MONO, SANS, palette, label, layout, features, hitEnv, drawFrame, specImages };
})(typeof window !== 'undefined' ? window : globalThis);

/* Readout Lab — the concepts. Each draws into the stage rect R between the header and the readout row. */
(function (G) {
  'use strict';
  const { U } = G.PULSE;
  const { label } = G.PULSE.frame;
  const TAU = Math.PI * 2;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const tempoKey = A => A.dur + '|' + A.bpm + '|' + A.beat0 + '|' + (A.ver || 0);
  const notes = A => G.PULSE.noteSet(A);
  function eventsIn(evs, a, b) { const out = []; let i = U.lastAt(evs, b); for (; i >= 0 && evs[i].t >= a; i--) out.push(evs[i]); return out; }
  /* notes overlapping [a, b], from a list sorted by t0 */
  function overlap(list, a, b) {
    const out = [];
    for (let i = U.lastAt(list, b, 't0'); i >= 0; i--) { const n = list[i]; if (n.t0 < a - 12) break; if (n.t1 >= a) out.push(n); }
    return out.reverse();
  }
  /* the demo loops: give scrolling views the copies before and after it */
  function looped(A, list, isNote) {
    if (!A.loopy) return list;
    const d = A.dur, out = [];
    for (const off of [-d, 0, d]) for (const e of list) out.push(isNote ? Object.assign({}, e, { t0: e.t0 + off, t1: e.t1 + off }) : Object.assign({}, e, { t: e.t + off }));
    out.sort(isNote ? (a, b) => a.t0 - b.t0 || a.p - b.p : (a, b) => a.t - b.t);
    return out;
  }
  function usedPitches(list, max, extra) {
    const m = new Map();
    for (const n of list) m.set(n.p, (m.get(n.p) || 0) + (n.t1 - n.t0) + (extra ? extra(n) : 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(e => e[0]);
  }
  function pitchRange(list) {
    let lo = 1e9, hi = -1e9;
    for (const n of list) { if (n.p < lo) lo = n.p; if (n.p > hi) hi = n.p; }
    return lo > hi ? [48, 60] : [lo, Math.max(hi, lo + 1)];
  }
  function barLabel(A, bar) {
    const nB = Math.max(1, Math.round(A.dur / (4 * A.spb)));
    return String(A.loopy ? U.mod(bar, nB) + 1 : Math.max(0, bar + 1)).padStart(2, '0');
  }
  function rrect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  const C = [];

  /* ================================================================== kept from round 1 */

  /* ------------------------------------------------------------------ GRID */
  C.push({
    id: 'grid', name: 'GRID', group: 'kept', bottom: 'wave',
    line: 'The drums program themselves into a 16-step grid as the track plays.',
    draw(g, R, X) {
      const { A, F, P, s, t, cache } = X, hold = X.st.hold || 1;   // METHOD: Hold knob
      if (cache.k !== tempoKey(A)) {
        cache.k = tempoKey(A);
        const map = new Map(), q = A.spb / 4;
        const put = (e, lane, extra) => {
          const k = Math.round((e.t - A.beat0) / q), bar = Math.floor(k / 16), st = U.mod(k, 16);
          if (!map.has(bar)) map.set(bar, []);
          map.get(bar).push(Object.assign({ lane, st, t: e.t, s: e.s ?? 1 }, extra));
        };
        for (const e of A.kicks) put(e, 0); for (const e of A.snares) put(e, 1); for (const e of A.hats) put(e, 2);
        for (const b of A.bassNotes) put({ t: b.t0, s: 1 }, 3, { p: b.p });
        cache.map = map;
      }
      const lanes = ['KICK', 'SNARE', 'HAT', '808'];
      const labW = 84 * s, gap = 9 * s, headRow = 44 * s, avail = R.h - headRow;
      // METHOD: in a wide frame (16:9) the height decides the cell (two bars stacked at least) and the grid is centred
      const cell = Math.min((R.w - labW - 15 * gap) / 16, (avail - 6 * gap) / 8.7), gw = 16 * cell + 15 * gap, gx = R.x + labW + Math.max(0, (R.w - labW - gw) / 2);
      const gH = 4 * cell + 3 * gap, gGap = cell * 0.7, pitch = gH + gGap;
      const nG = Math.max(2, Math.min(5, Math.floor((avail + gGap) / pitch)));
      const totalH = nG * gH + (nG - 1) * gGap, top = R.y + headRow + (avail - totalH) / 2;
      const slide = U.easeOut((t - F.barT0) / 0.16);
      for (let st = 0; st < 16; st++) {
        const x = gx + st * (cell + gap) + cell / 2, beat = st % 4 === 0;
        if (beat) label(g, String(st + 1), x, top - 22 * s, { size: 17 * s, weight: 500, track: 0.04, color: st === F.s16 ? P.acc : P.dim, align: 'center' });
        else { g.fillStyle = st === F.s16 ? P.acc : P.faint; g.fillRect(x - 2 * s, top - 30 * s, 4 * s, 4 * s); }
      }
      g.save();
      g.beginPath(); g.rect(R.x - 8 * s, top - 7 * s, R.w + 16 * s, totalH + 14 * s); g.clip();
      for (let k = nG; k >= 0; k--) {
        const bar = F.bar - k;
        const y0 = top + (nG - 1 - k + (1 - slide)) * pitch;
        let alpha = k === 0 ? 1 : [1, 0.62, 0.44, 0.3, 0.2, 0.12][Math.min(5, k)];
        if (k === 0) alpha *= U.clamp(0.35 + slide);
        if (k === nG) alpha *= 1 - slide;
        if (alpha <= 0.01 || y0 > top + totalH + 4 || y0 + gH < top - pitch) continue;
        g.globalAlpha = alpha;
        for (let ln = 0; ln < 4; ln++) for (let st = 0; st < 16; st++) {
          const x = gx + st * (cell + gap), y = y0 + ln * (cell + gap);
          g.fillStyle = k === 0 && st === F.s16 ? P.faint : P.ghost;
          g.fillRect(x, y, cell, cell);
        }
        const nBars = Math.max(1, Math.round(A.dur / (4 * A.spb)));
        const evs = cache.map.get(A.loopy ? U.mod(bar, nBars) : bar) || [];
        for (const e of evs) {
          if (k === 0 && e.t > t + 0.002) continue;
          const age = t - e.t, x = gx + e.st * (cell + gap), y = y0 + e.lane * (cell + gap);
          let sz = cell * (0.6 + 0.4 * e.s);
          if (k === 0 && age < 0.14 * hold) sz *= 1 + 0.32 * (1 - age / (0.14 * hold));
          sz = Math.min(sz, cell + gap * 1.6);
          g.fillStyle = k === 0 && age < 0.2 * hold ? P.acc : P.ink;
          g.fillRect(x + (cell - sz) / 2, y + (cell - sz) / 2, sz, sz);
          if (e.lane === 3 && sz > cell * 0.8) label(g, U.noteName(e.p), x + cell / 2, y + cell / 2 + 5 * s, { size: 14 * s, weight: 600, track: 0, color: P.bg, align: 'center' });
        }
        if (k === 0) {
          for (let ln = 0; ln < 4; ln++) label(g, lanes[ln], gx - 16 * s, y0 + ln * (cell + gap) + cell / 2 + 6 * s, { size: 16 * s, weight: 500, track: 0.12, color: P.dim, align: 'right' });
          g.strokeStyle = P.ink; g.lineWidth = 2 * s;
          g.strokeRect(gx + F.s16 * (cell + gap) - 4.5 * s, y0 - 4.5 * s, cell + 9 * s, gH + 9 * s);
        } else {
          label(g, barLabel(A, bar), gx - 16 * s, y0 + gH / 2 + 8 * s, { size: 22 * s, weight: 500, track: 0.06, color: P.dim, align: 'right' });
        }
      }
      g.restore();
      g.globalAlpha = 1;
    },
  });

  /* ------------------------------------------------------------------ TAPE */
  C.push({
    id: 'tape', name: 'TAPE', group: 'kept', bottom: 'spectro',
    line: 'The waveform as a falling slab. Every kick and snare is tagged with its time.',
    draw(g, R, X) {
      const { A, F, P, s, t } = X;
      const cx = R.x + R.w / 2, nowY = R.y + R.h * 0.62, fut = 1.5 * A.spb, v = (nowY - R.y) / fut;
      const halfW = R.w * 0.42 * (1 + 0.035 * F.kick), rowH = Math.max(2, Math.round(2 * s));
      const wf = A.wfps, n = A.wmin.length;
      const env = (ta, tb) => {
        let a = Math.floor(ta * wf), b = Math.max(a + 1, Math.ceil(tb * wf)), m = 0;
        for (let k = a; k < b; k++) {
          let kk = k; if (kk < 0 || kk >= n) { if (!A.loopy) continue; kk = U.mod(kk, n); }
          const e = Math.max(A.wmax[kk], -A.wmin[kk]); if (e > m) m = e;
        }
        return m;
      };
      g.fillStyle = P.ghost; g.fillRect(cx - 0.75 * s, R.y, 1.5 * s, R.h);
      const tags = [...eventsIn(A.kicks, t - (R.y + R.h - nowY) / v - 0.05, t + fut).map(e => ['KICK', e]), ...eventsIn(A.snares, t - (R.y + R.h - nowY) / v - 0.05, t + fut).map(e => ['SNARE', e])];
      for (const [nm, e] of tags) {
        const y = nowY - (e.t - t) * v; if (y < R.y + 10 * s || y > R.y + R.h) continue;
        const age = t - e.t, hot = age >= 0 && age < 0.14;
        g.fillStyle = hot ? P.acc : age < 0 ? P.ghost : P.faint;
        g.fillRect(R.x, y - (hot ? 1.5 : 0.75) * s, R.w, (hot ? 3 : 1.5) * s);
        const col = hot ? P.ink : age < 0 ? P.faint : P.dim;
        label(g, nm, R.x + R.w, y - 9 * s, { size: 16 * s, weight: 500, track: 0.14, color: col, align: 'right' });
        label(g, U.fmtTime(A.loopy ? U.mod(e.t, A.dur) : e.t), R.x, y - 9 * s, { size: 16 * s, weight: 400, track: 0.06, color: col });
      }
      const ys = [], ws = [];
      for (let y = R.y; y <= R.y + R.h; y += rowH) {
        const tt = t + (nowY - y) / v;
        ys.push(y); ws.push(halfW * Math.pow(env(tt - rowH / (2 * v), tt + rowH / (2 * v)), 0.75));
      }
      const wsm = ws.map((w, i) => 0.25 * (ws[i - 1] ?? w) + 0.5 * w + 0.25 * (ws[i + 1] ?? w));
      const slab = (a, b) => {
        const p = new Path2D(); let first = true;
        for (let i = 0; i < ys.length; i++) { if (ys[i] < a - rowH || ys[i] > b + rowH) continue; const y = U.clamp(ys[i], a, b); if (first) p.moveTo(cx - wsm[i], y); else p.lineTo(cx - wsm[i], y); first = false; }
        for (let i = ys.length - 1; i >= 0; i--) { if (ys[i] < a - rowH || ys[i] > b + rowH) continue; p.lineTo(cx + wsm[i], U.clamp(ys[i], a, b)); }
        p.closePath(); return p;
      };
      g.fillStyle = P.faint; g.fill(slab(R.y, nowY));
      g.fillStyle = P.ink; g.fill(slab(nowY, R.y + R.h));
      g.fillStyle = P.acc; g.fillRect(R.x, nowY - 1.25 * s, R.w, 2.5 * s);
    },
  });

  /* ------------------------------------------------------------------ KEYS */
  /* Notes only: every pitch the track uses gets a column, low to high; notes rise from the line as they play. */
  C.push({
    id: 'keys', name: 'KEYS', group: 'kept', bottom: 'spectro',
    line: 'The notes rise as they play, each with its name. The 808 is the orange one.',
    draw(g, R, X) {
      const { A, F, P, s, t, cache } = X;
      if (cache.k !== tempoKey(A)) {
        cache.k = tempoKey(A);
        const ns = notes(A);
        const ps = usedPitches(ns.all, 28, n => (n.bass ? 1 : 0)).sort((a, b) => a - b);
        cache.col = new Map(ps.map((p, i) => [p, i]));
        cache.n = Math.max(1, ps.length);
        cache.all = ns.all;
      }
      const n = cache.n, colW = R.w / n, bw = Math.max(6 * s, Math.min(colW * 0.64, 54 * s));
      const lineY = R.y + R.h - 4 * s, span = Math.min(8 * A.spb, 5), v = (lineY - R.y) / span;
      const fs = Math.max(12 * s, Math.min(17 * s, colW * 0.4));
      const all = cache.all;
      for (let i = U.lastAt(all, t, 't0'); i >= 0; i--) {
        const nt = all[i]; if (nt.t0 < t - span - 8) break;
        const ci = cache.col.get(nt.p); if (ci === undefined) continue;
        const yTop = lineY - (t - nt.t0) * v, yBot = t < nt.t1 ? lineY : lineY - (t - nt.t1) * v;
        if (yBot < R.y) continue;
        const x = R.x + (ci + 0.5) * colW, ya = Math.max(R.y, yTop), age = t - nt.t0;
        g.fillStyle = nt.bass ? P.acc : rgba(P.inkRGB, 0.5 + 0.5 * nt.v);
        g.fillRect(x - bw / 2, ya, bw, Math.max(2 * s, yBot - ya - 3 * s));
        if (age < 0.16 && t < nt.t1) {
          g.fillStyle = nt.bass ? P.acc : P.ink;
          const k = 1 - age / 0.16, w = bw * (1 + 0.9 * k);
          g.fillRect(x - w / 2, lineY + 2 * s, w, 4 * s);
        }
        if (yTop > R.y + fs + 4 * s && (nt.bass || (nt.v > 0.3 && nt.t1 - nt.t0 > 0.15))) {
          label(g, U.noteName(nt.p), x, yTop - 9 * s, { size: fs, weight: 500, track: 0.02, color: nt.bass ? P.acc : P.dim, align: 'center' });
        }
      }
      g.fillStyle = rgba(P.inkRGB, 0.2 + 0.6 * F.kick);
      g.fillRect(R.x, lineY + 2 * s - 0.75 * s, R.w, 1.5 * s);
    },
  });

  /* ================================================================== picked from round 2 */

  /* ------------------------------------------------------------------ PADS */
  C.push({
    id: 'pads', name: 'PADS', group: 'new', bottom: 'wave',
    line: 'An MPC: sixteen pads for the kick, snare, hats, 808 and notes. Each pad lights when it is hit.',
    draw(g, R, X) {
      const { A, P, s, t, cache } = X, hold = X.st.hold || 1;   // METHOD: Hold knob
      if (cache.k !== tempoKey(A)) {
        cache.k = tempoKey(A);
        const ns = notes(A), perc = A.perc || [];
        const drum = list => looped(A, list, false).map(e => ({ t0: e.t, t1: e.t + 0.1, v: e.s }));
        const pads = [{ name: 'KICK', evs: drum(A.kicks) }, { name: 'SNARE', evs: drum(A.snares) }, { name: 'HAT', evs: drum(A.hats) }];
        pads.push({ name: 'PERC', evs: drum(perc) });
        for (const p of usedPitches(ns.bass, 4).sort((a, b) => a - b)) pads.push({ name: '808 ' + U.noteName(p), evs: looped(A, ns.bass.filter(n => n.p === p), true) });
        for (const p of usedPitches(ns.mel, 16 - pads.length).sort((a, b) => a - b)) pads.push({ name: U.noteName(p), evs: looped(A, ns.mel.filter(n => n.p === p), true) });
        while (pads.length < 16) pads.push({ name: '', evs: [] });
        cache.pads = pads;
      }
      const lcdH = 64 * s, gap = 16 * s, room = R.h - lcdH - 34 * s;
      const cell = Math.min((R.w - 3 * gap) / 4, (room - 3 * gap) / 4), gw = 4 * cell + 3 * gap;
      const gx = R.x + (R.w - gw) / 2, gy = R.y + lcdH + 34 * s + (room - gw) / 2;
      let last = null, lastI = -1;
      for (let i = 0; i < 16; i++) {
        const pad = cache.pads[i], row = 3 - Math.floor(i / 4), col = i % 4;
        const x = gx + col * (cell + gap), y = gy + row * (cell + gap);
        const j = U.lastAt(pad.evs, t, 't0'), e = j >= 0 ? pad.evs[j] : null;
        let level = 0, age = 9;
        if (e) {
          age = t - e.t0;
          level = t < e.t1 ? 0.55 + 0.45 * e.v : e.v * Math.exp(-(t - e.t1) / (0.22 * hold));
          if (!last || e.t0 > last.t0) { last = e; lastI = i; }
        }
        const press = age < 0.1 ? 6 * s * (1 - age / 0.1) : 0;
        const xx = x + press, yy = y + press, cc = cell - 2 * press, rr = 12 * s;
        rrect(g, xx, yy, cc, cc, rr); g.fillStyle = P.ghost; g.fill();
        if (level > 0.02) { rrect(g, xx, yy, cc, cc, rr); g.fillStyle = rgba(P.inkRGB, 0.1 + 0.88 * Math.min(1, level)); g.fill(); }
        if (age < 0.09 * hold) { rrect(g, xx, yy, cc, cc, rr); g.fillStyle = P.acc; g.fill(); }
        const lit = age < 0.09 * hold || level > 0.5;
        label(g, pad.name || '–', xx + 14 * s, yy + 30 * s, { size: 16 * s, weight: 600, track: 0.1, color: lit ? P.bg : pad.name ? P.dim : P.faint });
        label(g, 'A' + String(i + 1).padStart(2, '0'), xx + cc - 12 * s, yy + cc - 14 * s, { size: 13 * s, weight: 500, track: 0.08, color: lit ? P.bg : P.faint, align: 'right' });
      }
      const lx = gx, lw = gw;   // METHOD: the screen is as wide as the pads under it (16:9: the pads are narrower than the frame)
      g.strokeStyle = P.faint; g.lineWidth = 1.5 * s; g.strokeRect(lx + 0.75 * s, R.y + 0.75 * s, lw - 1.5 * s, lcdH - 1.5 * s);
      const ly = R.y + lcdH / 2 + 7 * s;
      label(g, 'BANK A', lx + 20 * s, ly, { size: 18 * s, weight: 500, track: 0.14, color: P.dim });
      if (last) {
        label(g, 'PAD ' + String(lastI + 1).padStart(2, '0') + '  ' + cache.pads[lastI].name, lx + lw * 0.3, ly, { size: 18 * s, weight: 600, track: 0.12, color: P.ink });
        label(g, 'VEL ' + Math.max(1, Math.round(last.v * 127)), lx + lw - 20 * s, ly, { size: 18 * s, weight: 500, track: 0.12, color: P.ink, align: 'right' });
      }
    },
  });

  /* ------------------------------------------------------------------ CHOP */
  C.push({
    id: 'chop', name: 'CHOP', group: 'new', bottom: 'spectro',
    line: 'Every bar sliced at its hits like a sampler chop. The slice that is playing flips.',
    draw(g, R, X) {
      const { A, F, P, s, t, cache } = X;
      const barDur = 4 * A.spb, tb = F.barT0, te = tb + barDur, key = tempoKey(A) + '|' + F.bar;
      if (cache.k !== key) {
        cache.k = key;
        const evs = [];
        const add = (list, type) => { for (const e of eventsIn(list, tb - 0.02, te - 0.03)) evs.push({ t: e.t, type }); };
        add(A.kicks, 'K'); add(A.snares, 'S'); add(A.hats, 'H');
        evs.sort((a, b) => a.t - b.t);
        const cuts = [];
        for (const e of evs) {
          const l = cuts[cuts.length - 1];
          if (l && e.t - l.t < 0.05) { if ('KSH'.indexOf(e.type) < 'KSH'.indexOf(l.type)) l.type = e.type; continue; }
          cuts.push({ t: Math.max(tb, e.t), type: e.type });
        }
        if (!cuts.length || cuts[0].t > tb + 0.05) cuts.unshift({ t: tb, type: '·' });
        cache.cuts = cuts;
      }
      const cuts = cache.cuts, nC = cuts.length, NAME = { K: 'KICK', S: 'SNARE', H: 'HAT', '·': 'LOOP' };
      const sy = R.y + R.h * 0.16, sh = R.h * 0.44, mid = sy + sh / 2, amp = sh * 0.46;
      const XX = tt => R.x + (tt - tb) / barDur * R.w, cEnd = i => (i + 1 < nC ? cuts[i + 1].t : te);
      let ci = -1; for (let i = 0; i < nC; i++) if (cuts[i].t <= t) ci = i;
      if (ci >= 0) { g.fillStyle = P.ink; g.fillRect(XX(cuts[ci].t), sy, XX(cEnd(ci)) - XX(cuts[ci].t), sh); }
      /* the bar's waveform as three filled outlines: before, inside and after the slice that plays */
      const w = Math.round(R.w), wf = A.wfps, n = A.wmin.length, his = new Float32Array(w), los = new Float32Array(w);
      for (let i = 0; i < w; i++) {
        const ta = tb + i / w * barDur, tz = ta + barDur / w;
        let lo = 0, hi = 0;
        for (let k = Math.floor(ta * wf), kb = Math.max(k + 1, Math.floor(tz * wf)); k < kb; k++) {
          let kk = k; if (kk < 0 || kk >= n) { if (!A.loopy) continue; kk = U.mod(kk, n); }
          if (A.wmin[kk] < lo) lo = A.wmin[kk]; if (A.wmax[kk] > hi) hi = A.wmax[kk];
        }
        his[i] = mid - hi * amp - 0.75; los[i] = mid - lo * amp + 0.75;
      }
      const iC0 = ci >= 0 ? U.clamp(Math.round(XX(cuts[ci].t) - R.x), 0, w) : w, iC1 = ci >= 0 ? U.clamp(Math.round(XX(cEnd(ci)) - R.x), 0, w) : w;
      const outline = (a, b, col) => {
        if (b - a < 1) return;
        g.beginPath(); g.moveTo(R.x + a, his[a]);
        for (let i = a + 1; i < b; i++) g.lineTo(R.x + i + 0.5, his[i]);
        g.lineTo(R.x + b, his[b - 1]); g.lineTo(R.x + b, los[b - 1]);
        for (let i = b - 1; i > a; i--) g.lineTo(R.x + i + 0.5, los[i]);
        g.lineTo(R.x + a, los[a]); g.closePath();
        g.fillStyle = col; g.fill();
      };
      outline(0, iC0, P.ink);
      outline(iC0, iC1, P.bg);
      outline(iC1, w, P.faint);
      for (let i = 0; i < nC; i++) {
        const x = XX(cuts[i].t);
        g.fillStyle = i === ci ? P.acc : P.faint; g.fillRect(x - 1 * s, sy - 36 * s, 2 * s, sh + 36 * s);
        if (i + 1 < nC && XX(cuts[i + 1].t) - x < 30 * s) continue;
        label(g, String(i + 1).padStart(2, '0'), x + 6 * s, sy - 14 * s, { size: 16 * s, weight: 600, track: 0.04, color: i === ci ? P.acc : i < ci ? P.dim : P.faint });
      }
      const py = sy + sh + 44 * s, phh = Math.min(70 * s, R.h * 0.07);
      for (let i = 0; i < nC; i++) {
        const xa = XX(cuts[i].t) + 2 * s, xb = XX(cEnd(i)) - 2 * s; if (xb - xa < 2) continue;
        const cur = i === ci, past = i < ci;
        if (cur) { g.fillStyle = P.acc; g.fillRect(xa, py, xb - xa, phh); }
        else { g.strokeStyle = past ? P.faint : P.ghost; g.lineWidth = 1.5 * s; g.strokeRect(xa + 0.75 * s, py + 0.75 * s, xb - xa - 1.5 * s, phh - 1.5 * s); }
        if (xb - xa > 18 * s) label(g, cuts[i].type, (xa + xb) / 2, py + phh / 2 + 6 * s, { size: 16 * s, weight: 600, track: 0, color: cur ? P.bg : past ? P.dim : P.faint, align: 'center' });
      }
      for (let b = 0; b <= 4; b++) {
        const x = XX(tb + b * A.spb);
        g.fillStyle = P.faint; g.fillRect(x - 0.75 * s, py + phh + 10 * s, 1.5 * s, 10 * s);
        if (b < 4) label(g, String(b + 1), x + 6 * s, py + phh + 22 * s, { size: 15 * s, weight: 500, track: 0, color: b === F.bib ? P.acc : P.dim });
      }
      label(g, 'BAR ' + barLabel(A, F.bar) + '  ·  ' + nC + ' SLICES', R.x, R.y + 18 * s, { size: 17 * s, weight: 500, track: 0.12, color: P.dim });
      if (ci >= 0) label(g, 'SLICE ' + String(ci + 1).padStart(2, '0') + '  ' + NAME[cuts[ci].type], R.x + R.w, R.y + 18 * s, { size: 17 * s, weight: 600, track: 0.12, color: P.ink, align: 'right' });
    },
  });

  C.forEach((c, i) => { c.num = String(i + 1).padStart(2, '0'); });
  G.PULSE.concepts = C;
})(typeof window !== 'undefined' ? window : globalThis);

