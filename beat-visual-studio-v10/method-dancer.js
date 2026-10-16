
/* ===== DANCER ENGINE — photo → low-poly PS2-era character that dances to the beat =====
   Self-contained (raw WebGL2, no libraries). Public object: window.DancerEngine */
(function () {
'use strict';

// ---------------------------------------------------------------- small utils
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const mod = (x, m) => ((x % m) + m) % m;
const DEG = Math.PI / 180;

// deterministic hash noise (for texture painting / micro motion)
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u) * 2 - 1; }
function mulberry(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- vec3
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

// ---------------------------------------------------------------- quaternions [x,y,z,w]
const q4 = {
  id: () => [0, 0, 0, 1],
  mul: (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ],
  axis: (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; },
  rx: (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)],
  ry: (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)],
  rz: (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)],
  // yaw (Y) * pitch (X) * roll (Z), degrees
  ypr: (yaw, pitch, roll) => q4.mul(q4.mul(q4.ry(yaw * DEG), q4.rx(pitch * DEG)), q4.rz(roll * DEG)),
  rot: (q, v) => {
    const x = v[0], y = v[1], z = v[2], qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
  },
  conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  norm: (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
  slerp: (a, b, t) => {
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b;
    if (cos < 0) { cos = -cos; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (cos > 0.9995) return q4.norm([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    const th = Math.acos(cos), s = Math.sin(th), w1 = Math.sin((1 - t) * th) / s, w2 = Math.sin(t * th) / s;
    return [a[0] * w1 + bb[0] * w2, a[1] * w1 + bb[1] * w2, a[2] * w1 + bb[2] * w2, a[3] * w1 + bb[3] * w2];
  },
  // rotation from orthonormal basis columns X,Y,Z
  basis: (X, Y, Z) => {
    const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
    const tr = m00 + m11 + m22; let x, y, z, w;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
    return q4.norm([x, y, z, w]);
  },
};

// ---------------------------------------------------------------- mat4 (column-major Float32Array)
const m4 = {
  ident: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  mul: (a, b, out) => {
    out = out || new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return out;
  },
  persp: (fovy, asp, n, f) => {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f); return m;
  },
  lookAt: (e, c, up) => {
    const z = v3.norm(v3.sub(e, c)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x), m = new Float32Array(16);
    m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
    m[12] = -v3.dot(x, e); m[13] = -v3.dot(y, e); m[14] = -v3.dot(z, e); m[15] = 1; return m;
  },
  // T(p) * R(q) * T(-o)
  skin: (p, q, o, out) => {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    out[0] = r00; out[1] = r10; out[2] = r20; out[3] = 0;
    out[4] = r01; out[5] = r11; out[6] = r21; out[7] = 0;
    out[8] = r02; out[9] = r12; out[10] = r22; out[11] = 0;
    out[12] = p[0] - (r00 * o[0] + r01 * o[1] + r02 * o[2]);
    out[13] = p[1] - (r10 * o[0] + r11 * o[1] + r12 * o[2]);
    out[14] = p[2] - (r20 * o[0] + r21 * o[1] + r22 * o[2]);
    out[15] = 1; return out;
  },
};

// ---------------------------------------------------------------- skeleton (bind pose: every bone frame axis-aligned)
// character faces +Z, character's left = +X, Y up, metres
const BONES = [
  ['hips', -1, [0, 0.98, 0]],
  ['spine', 0, [0, 1.08, 0]],
  ['chest', 1, [0, 1.26, 0]],
  ['neck', 2, [0, 1.46, 0]],
  ['head', 3, [0, 1.535, 0]],
  ['clavL', 2, [0.02, 1.42, 0]],
  ['uarmL', 5, [0.172, 1.43, 0]],
  ['farmL', 6, [0.172, 1.145, 0]],
  ['handL', 7, [0.172, 0.89, 0]],
  ['clavR', 2, [-0.02, 1.42, 0]],
  ['uarmR', 9, [-0.172, 1.43, 0]],
  ['farmR', 10, [-0.172, 1.145, 0]],
  ['handR', 11, [-0.172, 0.89, 0]],
  ['thighL', 0, [0.092, 0.93, 0]],
  ['shinL', 13, [0.092, 0.505, 0]],
  ['footL', 14, [0.092, 0.085, 0]],
  ['thighR', 0, [-0.092, 0.93, 0]],
  ['shinR', 16, [-0.092, 0.505, 0]],
  ['footR', 17, [-0.092, 0.085, 0]],
  ['wingL', 2, [0.07, 1.37, -0.115]],
  ['wingR', 2, [-0.07, 1.37, -0.115]],
  ['prop', -1, [0, 0, 0]],          // static props (the chair): stays put in the world, parked far away when unused
];
const NB = BONES.length;
const B = {}; BONES.forEach((b, i) => { B[b[0]] = i; });
const REST = BONES.map((b) => b[2]);
const L_UPPER = 0.285, L_FORE = 0.255, L_THIGH = 0.425, L_SHIN = 0.42, ANKLE_H = 0.085;

// ---------------------------------------------------------------- pose parameters
// angles in degrees, distances in metres. Conventions:
//  pitch + = lean/nod forward · yaw + = turn toward character's left (screen right in front view)
//  roll (spine/chest/head) + = bend toward character's left · hips roll + = left hip up
//  arms: f = swing forward, o = raise out to the side, t = external twist, e = elbow bend, sh = shoulder shrug
//  feet: x/z ground position, y lift, yaw + = toes out, p + = toes pointed down, ko = knee out
const POSE0 = {
  bx: 0, bz: 0, byaw: 0,
  hx: 0, hy: -0.025, hz: 0, hyaw: 0, hpit: 0, hrol: 0,
  spP: 2, spY: 0, spR: 0, chP: 2, chY: 0, chR: 0, wF: 0, chair: 0,
  nkP: 0, hdP: 0, hdY: 0, hdR: 0,
  aL_sh: 0, aL_f: 4, aL_o: 9, aL_t: 0, aL_e: 14, aL_w: 0, aL_knee: 0, aL_hip: 0, aL_ik: 0, aL_ikx: 0.2, aL_iky: 0, aL_ikz: 0.3,
  aR_sh: 0, aR_f: 4, aR_o: 9, aR_t: 0, aR_e: 14, aR_w: 0, aR_knee: 0, aR_hip: 0, aR_ik: 0, aR_ikx: -0.2, aR_iky: 0, aR_ikz: 0.3,
  fL_x: 0.105, fL_z: 0, fL_y: 0, fL_yaw: 9, fL_p: 0, fL_ko: 4,
  fR_x: -0.105, fR_z: 0, fR_y: 0, fR_yaw: 9, fR_p: 0, fR_ko: 4,
};
const PKEYS = Object.keys(POSE0);
function poseCopy(p) { const o = {}; for (const k of PKEYS) o[k] = p[k]; return o; }
function poseLerp(a, b, t, out) { out = out || {}; for (const k of PKEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; }

// two-bone IK: returns mid-joint position. pole = preferred bend direction for the mid joint
function ik2(A, T, l1, l2, pole) {
  let d = v3.sub(T, A); let dist = v3.len(d);
  const maxd = l1 + l2 - 1e-4, mind = Math.abs(l1 - l2) + 1e-3;
  const dir = dist > 1e-6 ? v3.scale(d, 1 / dist) : [0, -1, 0];
  dist = clamp(dist, mind, maxd);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let pp = v3.sub(pole, v3.scale(dir, v3.dot(pole, dir)));
  if (v3.len(pp) < 1e-5) pp = Math.abs(dir[2]) < 0.9 ? v3.cross(dir, [0, 0, 1]) : v3.cross(dir, [1, 0, 0]);
  pp = v3.norm(pp);
  return { mid: v3.add(A, v3.add(v3.scale(dir, a), v3.scale(pp, h))), end: v3.add(A, v3.scale(dir, dist)) };
}
// world rotation for a bone whose rest axis is -Y and rest "front" is +Z: aim -Y along dir, +Z toward front
function aimDown(dir, front) {
  const Y = v3.scale(v3.norm(dir), -1);
  let Z = v3.sub(front, v3.scale(Y, v3.dot(front, Y)));
  if (v3.len(Z) < 1e-5) Z = Math.abs(Y[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  Z = v3.norm(Z);
  const X = v3.cross(Y, Z);
  return q4.basis(X, Y, Z);
}

// pose → world transforms (pos/quat per bone) + skin matrices
function solvePose(P, out) {
  const wp = out.wp, wq = out.wq;
  const base = q4.ry(P.byaw * DEG);
  const bpos = [P.bx, 0, P.bz];
  const toW = (local) => v3.add(bpos, q4.rot(base, local));
  // hips
  wq[0] = q4.mul(base, q4.mul(q4.mul(q4.ry(P.hyaw * DEG), q4.rx(P.hpit * DEG)), q4.rz(P.hrol * DEG)));
  wp[0] = toW([REST[0][0] + P.hx, REST[0][1] + P.hy, REST[0][2] + P.hz]);
  const child = (i, parent, lq) => {
    wq[i] = q4.mul(wq[parent], lq);
    wp[i] = v3.add(wp[parent], q4.rot(wq[parent], v3.sub(REST[i], REST[parent])));
  };
  child(B.spine, 0, q4.ypr(P.spY, P.spP, -P.spR));
  child(B.chest, B.spine, q4.ypr(P.chY, P.chP, -P.chR));
  child(B.neck, B.chest, q4.ypr(P.hdY * 0.35, P.nkP + P.hdP * 0.4, -P.hdR * 0.3));
  child(B.head, B.neck, q4.ypr(P.hdY * 0.65, P.hdP * 0.6, -P.hdR * 0.7));
  // wings: flap = sweep forward/back + lift
  child(B.wingL, B.chest, q4.mul(q4.ry((-P.wF * 0.55) * DEG), q4.rz((P.wF * 0.45) * DEG)));
  child(B.wingR, B.chest, q4.mul(q4.ry((P.wF * 0.55) * DEG), q4.rz((-P.wF * 0.45) * DEG)));

  // legs (IK)
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1, pre = s === 0 ? 'fL_' : 'fR_';
    const iT = s === 0 ? B.thighL : B.thighR, iS = iT + 1, iF = iT + 2;
    wp[iT] = v3.add(wp[0], q4.rot(wq[0], v3.sub(REST[iT], REST[0])));
    const fyaw = side * P[pre + 'yaw'] * DEG;
    const ankle = toW([P[pre + 'x'], ANKLE_H + P[pre + 'y'], P[pre + 'z']]);
    const fwd = q4.rot(base, [Math.sin(fyaw + side * P[pre + 'ko'] * DEG), 0, Math.cos(fyaw + side * P[pre + 'ko'] * DEG)]);
    const r = ik2(wp[iT], ankle, L_THIGH, L_SHIN, v3.add(fwd, [0, 0.05, 0]));
    const knee = r.mid;
    wq[iT] = aimDown(v3.sub(knee, wp[iT]), fwd);
    wp[iS] = knee;
    wq[iS] = aimDown(v3.sub(r.end, knee), fwd);
    wp[iF] = r.end;
    wq[iF] = q4.mul(base, q4.mul(q4.ry(fyaw), q4.rx(P[pre + 'p'] * DEG)));
    out.knees[s] = knee;
  }

  // arms (FK, optional IK blend)
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1, pre = s === 0 ? 'aL_' : 'aR_';
    const iC = s === 0 ? B.clavL : B.clavR, iU = iC + 1, iFo = iC + 2, iH = iC + 3;
    child(iC, B.chest, q4.rz(side * P[pre + 'sh'] * DEG));
    child(iU, iC, q4.mul(q4.mul(q4.rx(-P[pre + 'f'] * DEG), q4.rz(side * P[pre + 'o'] * DEG)), q4.ry(side * P[pre + 't'] * DEG)));
    child(iFo, iU, q4.rx(-P[pre + 'e'] * DEG));
    child(iH, iFo, q4.rx(-P[pre + 'w'] * DEG));
    const wk = P[pre + 'knee'], wh = P[pre + 'hip'], wi = P[pre + 'ik'];
    const wmax = Math.max(wk, wh, wi);
    if (wmax > 0.001) {
      const sh = wp[iU];
      let target = wp[iH];
      let pole = v3.norm(v3.sub(wp[iFo], v3.lerp(sh, wp[iH], 0.5)));
      if (wk > 0) {
        const kn = out.knees[s];
        const kt = v3.add(kn, q4.rot(base, [side * 0.015, 0.075, 0.075]));
        target = v3.lerp(target, kt, wk);
        pole = v3.norm(v3.lerp(pole, q4.rot(base, [side * 0.9, 0.1, -0.45]), wk));
      }
      if (wh > 0) {
        const ht = v3.add(wp[0], q4.rot(wq[0], [side * 0.165, 0.08, 0.035]));
        target = v3.lerp(target, ht, wh);
        pole = v3.norm(v3.lerp(pole, q4.rot(wq[0], [side * 1.0, 0.05, -0.35]), wh));
      }
      if (wi > 0) {
        const it = v3.add(wp[0], q4.rot(wq[0], [P[pre + 'ikx'], P[pre + 'iky'], P[pre + 'ikz']]));
        target = v3.lerp(target, it, wi);
      }
      const r = ik2(sh, target, L_UPPER, L_FORE, pole);
      // forearm bends toward local +Z, i.e. away from where the elbow points
      const bendU = v3.scale(pole, -1);
      const qU = aimDown(v3.sub(r.mid, sh), bendU);
      const qF = aimDown(v3.sub(r.end, r.mid), bendU);
      wq[iU] = q4.slerp(wq[iU], qU, wmax);
      wp[iFo] = v3.add(sh, q4.rot(wq[iU], [0, -L_UPPER, 0]));
      wq[iFo] = q4.slerp(wq[iFo], qF, wmax);
      wp[iH] = v3.add(wp[iFo], q4.rot(wq[iFo], [0, -L_FORE, 0]));
      wq[iH] = q4.mul(wq[iFo], q4.rx(-P[pre + 'w'] * DEG));
    }
  }
  wq[B.prop] = base; wp[B.prop] = toW([P.chair > 0.5 ? 0 : 400, 0, 0]);
  for (let i = 0; i < NB; i++) m4.skin(wp[i], wq[i], REST[i], out.mats.subarray(i * 16, i * 16 + 16));
  return out;
}
function makePoseState() {
  return { wp: new Array(NB), wq: new Array(NB), knees: [[0, 0, 0], [0, 0, 0]], mats: new Float32Array(NB * 16) };
}

// ---------------------------------------------------------------- geometry builder (Y2K low-poly)
// atlas regions (u0, v0, u1, v1)
const AT = {
  FACE: [0, 0, 0.25, 0.25],
  TOP: [0.25, 0, 0.75, 0.25],
  ARM: [0.75, 0, 1.0, 0.25],
  LEG: [0, 0.25, 0.25, 0.75],
  PELVIS: [0.25, 0.25, 0.5, 0.375],
  SHOE: [0.25, 0.375, 0.5, 0.5],
  SOLE: [0.25, 0.5, 0.5, 0.5625],
  HAIR: [0.5, 0.25, 0.75, 0.5],
  SKIN: [0.75, 0.25, 0.875, 0.375],
  ACC: [0.875, 0.25, 1.0, 0.375],
  SLEEVE: [0.5, 0.5, 0.75, 0.625],
  HOOD: [0.75, 0.375, 1.0, 0.5],
  COLLAR: [0.75, 0.5, 1.0, 0.5625],
  BELT: [0.5, 0.625, 1.0, 0.6875],
  SHIN: [0.25, 0.5625, 0.5, 0.75],
  POCKET: [0.75, 0.5625, 0.875, 0.625],
  WING: [0, 0.75, 0.5, 1.0],
  HAT: [0.5, 0.6875, 0.75, 0.875],
  BRIM: [0.75, 0.6875, 1.0, 0.78],
  BAG: [0.75, 0.78, 1.0, 0.875],
};
// accessory swatches inside ACC (2×2): black plastic, metal, lens, accent
const ACC_UV = { black: [0.25, 0.25], metal: [0.75, 0.25], lens: [0.25, 0.75], accent: [0.75, 0.75] };
const MAT = { SKIN: 0, CLOTH: 1, HAIR: 2, SHOE: 3, FACE: 4, METAL: 5, GLOSS: 6, SOFT: 7 };
const HEAD_C = [0, 1.632, 0.014], HEAD_R = [0.074, 0.108, 0.095], EYE_Y = 1.637, FACE_SPAN = 0.24;

function Geo() {
  this.pos = []; this.nrm = []; this.uv = []; this.uv2 = []; this.face = []; this.bi = []; this.bw = []; this.mat = []; this.idx = [];
}
Geo.prototype.vert = function (p, n, uv, w, mat, uv2, face) {
  this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
  this.uv2.push(uv2 ? uv2[0] : uv[0], uv2 ? uv2[1] : uv[1]); this.face.push(face || 0);
  const a = w[0] || [0, 1], b = w[1] || [a[0], 0];
  this.bi.push(a[0], b[0]); this.bw.push(a[1], b[1]); this.mat.push(mat);
  return this.pos.length / 3 - 1;
};
Geo.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };

const sgnpow = (x, p) => Math.sign(x) * Math.pow(Math.abs(x), p);
const TEX_E = 1.25 / 1024;
const regUV = (r, u, v) => [r[0] + TEX_E + (r[2] - r[0] - 2 * TEX_E) * u, r[1] + TEX_E + (r[3] - r[1] - 2 * TEX_E) * v];
const accUV = (k) => regUV(AT.ACC, ACC_UV[k][0], ACC_UV[k][1]);

// grid surface wrapping in k; normals by finite differences
function gridSurface(G, NK, NS, posFn, uvFn, wFn, mat, opts) {
  opts = opts || {};
  const open = !!opts.open, NC = open ? NK + 1 : NK;
  const P = [];
  for (let s = 0; s < NS; s++) { const row = []; for (let k = 0; k < NC; k++) row.push(posFn(k, s)); P.push(row); }
  const base = [];
  for (let s = 0; s < NS; s++) {
    const row = [];
    for (let k = 0; k <= NK; k++) {
      const kk = open ? k : k % NK;
      const tu = open ? v3.sub(P[s][Math.min(NK, k + 1)], P[s][Math.max(0, k - 1)]) : v3.sub(P[s][(kk + 1) % NK], P[s][(kk - 1 + NK) % NK]);
      const tv = v3.sub(P[Math.min(NS - 1, s + 1)][kk], P[Math.max(0, s - 1)][kk]);
      let n = v3.cross(tu, tv);
      if (v3.len(n) < 1e-9) n = [0, 1, 0];
      n = v3.norm(n);
      if (opts.center) { const c = opts.center(s); if (v3.dot(n, v3.sub(P[s][kk], c)) < 0) n = v3.scale(n, -1); }
      const extra = opts.extra ? opts.extra(kk, s, P[s][kk], n) : null;
      row.push(G.vert(P[s][kk], n, uvFn(k, s), wFn(k, s), mat, extra ? extra.uv2 : null, extra ? extra.face : 0));
    }
    base.push(row);
  }
  for (let s = 0; s < NS - 1; s++) for (let k = 0; k < NK; k++) {
    const a = base[s][k], b = base[s][k + 1], c = base[s + 1][k + 1], d = base[s + 1][k];
    G.tri(a, b, c); G.tri(a, c, d);
  }
  return { P, base };
}

// loft along a straight axis; sec: {t, rx, rz, ox, oz, e, w, v}; o.disp(k, s, theta) → radial scale
function loft(G, o) {
  const N = o.n || 10, S = o.secs, side = o.side || [1, 0, 0], front = o.front || [0, 0, 1], dir = o.dir, org = o.origin;
  const t0 = S[0].t, t1 = S[S.length - 1].t, reg = o.reg, vflip = !!o.vflip;
  const ctr = (s) => v3.add(org, v3.add(v3.scale(dir, S[s].t), v3.add(v3.scale(side, S[s].ox || 0), v3.scale(front, S[s].oz || 0))));
  const vOf = (s) => { let v = (S[s].t - t0) / ((t1 - t0) || 1); if (S[s].v != null) v = S[s].v; return vflip ? 1 - v : v; };
  const posFn = (k, s) => {
    const th = Math.PI + (2 * Math.PI * k) / N + (o.rot || 0), sc = S[s], e = 2 / (sc.e || 2);
    let rs = 1; if (o.disp) rs = o.disp(k, s, th);
    const cx = sgnpow(Math.sin(th), e), cz = sgnpow(Math.cos(th), e);
    return v3.add(ctr(s), v3.add(v3.scale(side, sc.rx * cx * rs), v3.scale(front, sc.rz * cz * rs)));
  };
  const uvFn = o.uvFn || ((k, s) => (o.uvFix ? o.uvFix : regUV(reg, o.mirrorU ? 1 - k / N : k / N, vOf(s))));
  const wFn = (k, s) => S[s].w;
  const g = gridSurface(G, N, S.length, posFn, uvFn, wFn, o.mat, { center: ctr });
  const cap = (s, nd) => {
    const c = ctr(s), ci = G.vert(c, nd, o.uvFix ? o.uvFix : regUV(reg, 0.5, vOf(s)), S[s].w, o.mat);
    for (let k = 0; k < N; k++) G.tri(ci, g.base[s][k], g.base[s][k + 1]);
  };
  if (o.capStart) cap(0, v3.scale(dir, -1));
  if (o.capEnd) cap(S.length - 1, dir);
  return g;
}

// tube swept along a polyline (closed or open); per point: [x,y,z], r:{rx, rz}, w
function sweep(G, o) {
  const pts = o.pts, n = o.n || 6, closed = !!o.closed, M = pts.length, ref = o.ref || [0, 1, 0];
  const frames = [];
  for (let i = 0; i < M; i++) {
    const a = pts[closed ? (i - 1 + M) % M : Math.max(0, i - 1)].p, b = pts[closed ? (i + 1) % M : Math.min(M - 1, i + 1)].p;
    const T = v3.norm(v3.sub(b, a));
    let S = v3.cross(T, ref); if (v3.len(S) < 1e-5) S = v3.cross(T, [0, 0, 1]); S = v3.norm(S);
    const F = v3.cross(S, T);
    frames.push({ T, S, F });
  }
  const rows = [];
  const NS = closed ? M + 1 : M;
  for (let s = 0; s < NS; s++) {
    const i = s % M, P = pts[i], fr = frames[i], row = [];
    for (let k = 0; k <= n; k++) {
      const th = (2 * Math.PI * k) / n + (o.rot || 0);
      const d = v3.add(v3.scale(fr.S, Math.cos(th) * P.rx), v3.scale(fr.F, Math.sin(th) * P.rz));
      const nn = v3.norm(v3.add(v3.scale(fr.S, Math.cos(th) / (P.rx || 1e-3)), v3.scale(fr.F, Math.sin(th) / (P.rz || 1e-3))));
      row.push(G.vert(v3.add(P.p, d), nn, o.uvFix || regUV(o.reg, k / n, s / (NS - 1)), P.w, o.mat));
    }
    rows.push(row);
  }
  for (let s = 0; s < NS - 1; s++) for (let k = 0; k < n; k++) {
    const a = rows[s][k], b = rows[s][k + 1], c = rows[s + 1][k + 1], d = rows[s + 1][k];
    G.tri(a, b, c); G.tri(a, c, d);
  }
  if (!closed && o.caps) {
    for (const [s, sgn] of [[0, -1], [NS - 1, 1]]) {
      const P = pts[s], ci = G.vert(P.p, v3.scale(frames[s].T, sgn), o.uvFix || regUV(o.reg, 0.5, s / (NS - 1)), P.w, o.mat);
      for (let k = 0; k < n; k++) G.tri(ci, rows[s][k], rows[s][k + 1]);
    }
  }
}

// a faceted spike (hair chunk / feather): base ring → mid ring → tip
function spike(G, o) {
  const D = v3.norm(o.dir), sides = o.sides || 4;
  let A = o.wax ? v3.sub(o.wax, v3.scale(D, v3.dot(o.wax, D))) : Math.abs(D[1]) < 0.9 ? v3.cross(D, [0, 1, 0]) : v3.cross(D, [1, 0, 0]);
  if (v3.len(A) < 1e-5) A = v3.cross(D, [1, 0, 0]);
  A = v3.norm(A);
  const Bv = v3.cross(D, A);
  const flat = o.flat || 1; // >1 makes the blade wider than thick
  const ring = (c, r, rot) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const th = (2 * Math.PI * i) / sides + rot;
      out.push(v3.add(c, v3.add(v3.scale(A, Math.cos(th) * r * flat), v3.scale(Bv, Math.sin(th) * r))));
    }
    return out;
  };
  const bend = o.bend || [0, 0, 0];
  const c0 = v3.sub(o.base, v3.scale(D, o.rad * 0.6));
  const c1 = v3.add(v3.add(o.base, v3.scale(D, o.len * 0.45)), v3.scale(bend, 0.3));
  const tip = v3.add(v3.add(o.base, v3.scale(D, o.len)), bend);
  const r0 = ring(c0, o.rad, o.rot || 0), r1 = ring(c1, o.rad * (o.mid || 0.62), (o.rot || 0) + (o.twist || 0));
  const reg = o.reg, w = o.w;
  const vi = (p, u, v) => G.vert(p, v3.norm(v3.sub(p, o.base)), regUV(reg, u, v), w, o.mat);
  const R0 = r0.map((p, i) => vi(p, i / sides, 0.05)), R1 = r1.map((p, i) => vi(p, i / sides, 0.5)), T = vi(tip, 0.5, 0.97);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    G.tri(R0[i], R0[j], R1[j]); G.tri(R0[i], R1[j], R1[i]);
    G.tri(R1[i], R1[j], T);
  }
}

// ---------------------------------------------------------------- head (angular, anime proportions)
function headShape(sx, sy, sz) {
  let x = HEAD_R[0] * sx, y = HEAD_R[1] * sy, z = HEAD_R[2] * sz;
  if (sy < 0.1) {
    const f = (0.1 - sy) / 1.1;
    x *= 1 - 0.4 * Math.pow(f, 1.3);           // tapered jaw
    if (sz < 0) z *= 1 - 0.6 * f; else z *= 1 - 0.05 * f;
  }
  if (sy > 0 && sz < 0) z *= 1 + 0.08 * sy;     // round skull at the back
  if (sz > 0) z *= 1 - 0.12 * sz * sz * sz;      // flatter face plane
  return [x, y, z];
}
function gauss2(x, y, cx, cy, sx, sy) { const dx = (x - cx) / sx, dy = (y - cy) / sy; return Math.exp(-(dx * dx + dy * dy)); }
function faceFeatures(p) {
  const x = p[0], y = p[1] + HEAD_C[1] - EYE_Y;
  let d = 0;
  d += 0.016 * gauss2(x, y, 0, -0.03, 0.009, 0.02);    // nose ridge
  d += 0.004 * gauss2(x, y, 0, -0.105, 0.016, 0.012);  // chin point
  d -= 0.005 * (gauss2(x, y, 0.03, 0.0, 0.014, 0.01) + gauss2(x, y, -0.03, 0.0, 0.014, 0.01));
  return d;
}
function buildHead(G, look) {
  const NK = 16, NS = 12;
  const W = [[B.head, 1]];
  const posFn = (k, s) => {
    const th = Math.PI + (2 * Math.PI * k) / NK, ph = (Math.PI * s) / (NS - 1);
    const sy = Math.cos(ph), r = Math.sin(ph), sx = r * Math.sin(th), sz = r * Math.cos(th);
    const p = headShape(sx, sy, sz);
    if (sz > 0.2) p[2] += faceFeatures(p) * smooth(0.2, 0.6, sz);
    return v3.add(HEAD_C, p);
  };
  const faceUV = (p) => regUV(AT.FACE, 0.5 + p[0] / FACE_SPAN, 0.5 - (p[1] - EYE_Y) / FACE_SPAN);
  const skinUV = regUV(AT.SKIN, 0.5, 0.5);
  gridSurface(G, NK, NS, posFn, () => skinUV, (k, s) => (s > NS - 3 ? [[B.head, 0.75], [B.neck, 0.25]] : W), MAT.FACE, {
    center: () => HEAD_C,
    extra: (k, s, p, n) => ({ uv2: faceUV(p), face: smooth(-0.05, 0.35, n[2]) * (1 - smooth(0.95, 1.05, (EYE_Y - p[1]) / 0.12)) }),
  });
  const earsHidden = look && (look.hat === 'beanie' || look.hat === 'hood');
  if (!earsHidden) for (const side of [1, -1]) {
    loft(G, {
      origin: [side * 0.071, 1.655, -0.004], dir: [0, -1, 0], n: 5, mat: MAT.SKIN, reg: AT.SKIN, capStart: true, capEnd: true,
      secs: [
        { t: -0.004, rx: 0.004, rz: 0.008, w: W },
        { t: 0.008, rx: 0.011, rz: 0.017, ox: side * 0.004, w: W },
        { t: 0.03, rx: 0.011, rz: 0.017, ox: side * 0.005, w: W },
        { t: 0.048, rx: 0.006, rz: 0.01, ox: side * 0.001, oz: 0.003, w: W },
      ],
    });
  }
}

// ---------------------------------------------------------------- hair
function hairline(th) {
  const a = Math.abs(th) / Math.PI;
  const pts = [[0, 0.62], [0.16, 0.56], [0.3, 0.42], [0.42, 0.3], [0.5, 0.26], [0.62, 0.08], [0.78, -0.18], [1, -0.3]];
  for (let i = 1; i < pts.length; i++) if (a <= pts[i][0]) { const t = (a - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); return lerp(pts[i - 1][1], pts[i][1], smooth(0, 1, t)); }
  return -0.3;
}
// point on the scalp at (theta, unit-sphere y) pushed out by t; returns {p, n}
function scalp(th, sy, t) {
  const r = Math.sqrt(Math.max(0, 1 - sy * sy));
  const p = headShape(r * Math.sin(th), sy, r * Math.cos(th));
  const n = v3.norm([p[0] / (HEAD_R[0] * HEAD_R[0]), p[1] / (HEAD_R[1] * HEAD_R[1]), p[2] / (HEAD_R[2] * HEAD_R[2])]);
  return { p: v3.add(HEAD_C, v3.add(p, v3.scale(n, t))), n };
}
function hairCap(G, thick, edgeDrop, NK, NJ, jag, prof) {
  const W = [[B.head, 1]];
  const rnd = mulberry(91);
  const jit = []; for (let k = 0; k < NK; k++) jit.push(rnd());
  gridSurface(G, NK, NJ + 1, (k, j) => {
    const th = Math.PI + (2 * Math.PI * k) / NK, thc = Math.atan2(Math.sin(th), Math.cos(th));
    let edge = hairline(thc) - edgeDrop - (jag ? (k % 2 ? jag : 0) + jit[k] * jag * 0.5 : 0);
    const sy = lerp(0.999, edge, Math.pow(j / NJ, 0.9));
    let tj = thick * (1 - Math.pow(j / NJ, 2) * 0.8) * (j === NJ ? 0.35 : 1) + 0.002;
    if (prof) tj = prof(sy, j / NJ);
    return scalp(th, sy, tj).p;
  }, (k, j) => regUV(AT.HAIR, k / NK, 0.15 + 0.6 * (j / NJ)), () => W, MAT.HAIR, { center: () => HEAD_C });
}
function buildHair(G, style, seed, hat) {
  if (style === 'none') return;
  const rnd = mulberry(seed || 7);
  const W = [[B.head, 1]];
  const R = (a, b) => a + (b - a) * rnd();
  const reg = AT.HAIR;
  const addSpike = (th, sy, dir, len, rad, opt) => {
    const s = scalp(th, sy, 0.006);
    spike(G, Object.assign({ base: s.p, dir, len, rad, sides: 4, rot: R(0, 1.6), twist: R(-0.4, 0.4), reg, w: W, mat: MAT.HAIR }, opt || {}));
  };
  const dirFrom = (n, add, jitter) => v3.norm(v3.add(v3.add(n, add), [R(-jitter, jitter), R(-jitter, jitter), R(-jitter, jitter)]));
  // under a hat only what hangs below its edge shows
  if (hat && hat !== 'none') {
    if (hat === 'hood') { hairCap(G, 0.014, 0.0, 16, 6, 0.02); return; }
    const edge = HAT_EDGE[hat];
    const NK = 20;
    gridSurface(G, NK, 2, (k, j) => {
      const th = Math.PI + (2 * Math.PI * k) / NK, thc = Math.atan2(Math.sin(th), Math.cos(th)), e = hatEdgeAt(edge, Math.abs(thc) / Math.PI);
      const sy = j === 0 ? e + 0.06 : Math.min(e, hairline(thc) - 0.02);
      return scalp(thc, sy, j === 0 ? 0.004 : 0.007).p;
    }, (k, j) => regUV(reg, k / NK, 0.3 + 0.4 * j), () => W, MAT.HAIR, { center: () => HEAD_C });
    if (style === 'long' || style === 'locs') {
      for (let i = 0; i < 26; i++) {
        const th = Math.PI * (0.38 + 0.62 * ((i % 13) / 12)) * (i < 13 ? 1 : -1), a = Math.abs(th) / Math.PI;
        const sy = Math.min(hatEdgeAt(edge, a) - 0.04, R(0.0, 0.25));
        const s0 = scalp(th, sy, 0);
        addSpike(th, sy, v3.norm(v3.add(s0.n, [0, -2.6, -0.3])), R(0.2, 0.28), style === 'locs' ? 0.014 : R(0.028, 0.036), { flat: style === 'locs' ? 1 : 1.9, sides: style === 'locs' ? 5 : 4, bend: [s0.n[0] * 0.04, 0, -0.02] });
      }
    } else if (style === 'messy' || style === 'curtains' || style === 'spiky') {
      // a few fringe strands escaping from under the front edge
      for (let i = 0; i < 5; i++) {
        const th = (i - 2) * 0.16 + R(-0.04, 0.04), sy = hatEdgeAt(edge, Math.abs(th) / Math.PI) + 0.04;
        const s0 = scalp(th, sy, 0.008);
        addSpike(th, sy, v3.norm(v3.add(s0.n, [R(-0.3, 0.3), -1.6, 0.35])), R(0.045, 0.065), R(0.017, 0.022), { flat: 1.5 });
      }
    }
    return;
  }
  if (style === 'fade') {
    hairCap(G, 0.016, 0.02, 16, 6, 0, (sy) => (sy > 0.62 ? 0.017 : sy > 0.38 ? lerp(0.0025, 0.017, (sy - 0.38) / 0.24) : 0.0025));
    for (let i = 0; i < 18; i++) {
      const sy = 1 - (i + 0.5) / 18 * 0.4, th = i * 2.39996, thc = Math.atan2(Math.sin(th), Math.cos(th));
      const s0 = scalp(thc, sy, 0);
      addSpike(thc, sy, dirFrom(s0.n, [0, 0.2, 0.9], 0.15), R(0.035, 0.05), R(0.022, 0.028), { flat: 1.5, wax: v3.cross([0, 0, 1], s0.n) });
    }
    return;
  }
  if (style === 'buzz') { hairCap(G, 0.003, 0.0, 16, 5, 0); return; }
  if (style === 'spiky' || style === 'messy') {
    hairCap(G, 0.012, 0.02, 16, 6, 0.025);
    // golden-angle points over the scalp
    const N = style === 'spiky' ? 64 : 52;
    for (let i = 0; i < N; i++) {
      const sy = 1 - (i + 0.5) / N * 1.25;
      const th = i * 2.39996 + 0.3;
      const thc = Math.atan2(Math.sin(th), Math.cos(th)), a = Math.abs(thc);
      if (sy < hairline(thc) - 0.02) continue;
      const s = scalp(thc, sy, 0);
      const front = a < 0.95, back = a > 2.2;
      let add, len, rad;
      if (front && sy < 0.82) {                 // fringe: down & forward over the forehead
        add = [0, -1.5, 0.45];
        len = R(0.062, 0.088); rad = R(0.02, 0.027);
      } else if (sy > 0.72) {                   // crown: up & back
        add = [0, 0.32, -0.8]; len = R(0.068, 0.108); rad = R(0.026, 0.033);
      } else if (back) {                        // back: down & back
        add = [0, -0.6, -0.45]; len = R(0.06, 0.092); rad = R(0.024, 0.031);
      } else {                                  // sides: out & down
        add = [0, -0.45, -0.3]; len = R(0.05, 0.078); rad = R(0.022, 0.029);
      }
      if (style === 'messy') { len *= 0.85; if (front && sy < 0.82) { add = [-0.9, -1.1, 0.45]; len = R(0.09, 0.13); } }
      const d = dirFrom(s.n, add, 0.17);
      addSpike(thc, sy, d, len, rad, { bend: [0, -len * 0.16, 0], flat: 1.6, wax: v3.cross(d, s.n), rot: Math.PI / 4, sides: 4 });
    }
    return;
  }
  if (style === 'curtains') {
    hairCap(G, 0.016, 0.05, 16, 6, 0.0);
    for (const side of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const th = side * (0.12 + i * 0.16), sy = 0.78 - i * 0.03;
        const s = scalp(th, sy, 0);
        addSpike(th, sy, v3.norm(v3.add(s.n, [side * 0.35, -1.4, 0.35])), R(0.1, 0.13), R(0.024, 0.03), { bend: [side * 0.02, -0.02, 0.01], flat: 1.8, sides: 4 });
      }
    }
    for (let i = 0; i < 14; i++) { const th = Math.PI * (0.45 + 0.55 * (i / 13)) * (i % 2 ? 1 : -1), sy = R(-0.1, 0.4); const s = scalp(th, sy, 0); addSpike(th, sy, v3.norm(v3.add(s.n, [0, -1.2, -0.2])), R(0.06, 0.09), R(0.026, 0.034), { flat: 1.6 }); }
    return;
  }
  if (style === 'shoulder') {
    // centre-parted, chin-to-shoulder length: curtain pieces in front, longer strands at the sides and back
    hairCap(G, 0.016, 0.04, 16, 6, 0.0);
    for (const side of [1, -1]) {
      for (let i = 0; i < 4; i++) {
        const th = side * (0.2 + i * 0.17), sy = 0.86 - i * 0.05, s0 = scalp(th, sy, 0);
        addSpike(th, sy, v3.norm(v3.add(s0.n, [side * 0.45, -2.1, 0.0])), R(0.13, 0.17), R(0.024, 0.03), { bend: [side * 0.025, -0.02, 0.01], flat: 1.8, sides: 4 });
      }
    }
    for (let i = 0; i < 24; i++) {
      const th = Math.PI * (0.4 + 0.6 * ((i % 12) / 11)) * (i < 12 ? 1 : -1), sy = R(0.15, 0.5), s0 = scalp(th, sy, 0);
      addSpike(th, sy, v3.norm(v3.add(s0.n, [0, -2.4, -0.2])), R(0.16, 0.22), R(0.03, 0.038), { flat: 1.8, sides: 4, bend: [s0.n[0] * 0.035, 0, -0.015] });
    }
    return;
  }
  if (style === 'long') {
    hairCap(G, 0.016, 0.04, 16, 6, 0.0);
    for (let i = 0; i < 26; i++) {
      const th = Math.PI * (0.32 + 0.68 * ((i % 13) / 12)) * (i < 13 ? 1 : -1), sy = R(0.15, 0.45);
      const s = scalp(th, sy, 0);
      addSpike(th, sy, v3.norm(v3.add(s.n, [0, -2.6, -0.3])), R(0.24, 0.32), R(0.03, 0.04), { flat: 1.9, sides: 4, bend: [s.n[0] * 0.04, 0, -0.02] });
    }
    for (let i = 0; i < 6; i++) { const th = (i - 2.5) * 0.15, sy = 0.8; const s = scalp(th, sy, 0); addSpike(th, sy, v3.norm(v3.add(s.n, [0, -1.3, 0.5])), R(0.06, 0.08), R(0.02, 0.026), { flat: 1.4 }); }
    return;
  }
  if (style === 'afro') {
    hairCap(G, 0.01, 0.02, 16, 6, 0);
    const N = 70;
    for (let i = 0; i < N; i++) {
      const sy = 1 - (i + 0.5) / N * 1.15, th = i * 2.39996;
      const thc = Math.atan2(Math.sin(th), Math.cos(th)); if (sy < hairline(thc) - 0.03) continue;
      const s = scalp(thc, sy, 0.035);
      spike(G, { base: s.p, dir: s.n, len: R(0.035, 0.055), rad: R(0.03, 0.04), sides: 5, mid: 0.85, rot: R(0, 2), reg, w: W, mat: MAT.HAIR });
    }
    return;
  }
  if (style === 'locs') {
    hairCap(G, 0.012, 0.02, 16, 6, 0);
    for (let i = 0; i < 34; i++) {
      const sy = 1 - (i + 0.5) / 34 * 1.1, th = i * 2.39996;
      const thc = Math.atan2(Math.sin(th), Math.cos(th)), a = Math.abs(thc); if (sy < hairline(thc) - 0.02 || (a < 0.7 && sy < 0.75)) continue;
      const s = scalp(thc, sy, 0);
      const len = a < 1.2 ? R(0.12, 0.18) : R(0.2, 0.3);
      const d = v3.norm(v3.add(v3.scale(s.n, 0.5), [0, -1.6, a > 2 ? -0.25 : 0]));
      spike(G, { base: s.p, dir: d, len, rad: 0.011, sides: 5, mid: 0.95, rot: R(0, 2), reg, w: len > 0.22 ? [[B.head, 0.8], [B.neck, 0.2]] : W, mat: MAT.HAIR });
    }
    return;
  }
  if (style === 'bun') {
    hairCap(G, 0.014, 0.02, 16, 6, 0.0);
    loft(G, {
      origin: [0, 1.69, -0.06], dir: v3.norm([0, 0.5, -0.86]), n: 7, mat: MAT.HAIR, reg, capEnd: true,
      secs: [{ t: -0.01, rx: 0.03, rz: 0.03, w: W }, { t: 0.02, rx: 0.046, rz: 0.043, w: W }, { t: 0.056, rx: 0.042, rz: 0.04, w: W }, { t: 0.078, rx: 0.018, rz: 0.018, w: W }],
    });
    for (let i = 0; i < 5; i++) { const th = (i - 2) * 0.2, sy = 0.78; const s = scalp(th, sy, 0); addSpike(th, sy, v3.norm(v3.add(s.n, [0, -1.2, 0.5])), R(0.05, 0.07), R(0.018, 0.024), { flat: 1.4 }); }
    return;
  }
  hairCap(G, 0.016, 0.0, 16, 6, 0.02); // 'short'
}

// ---------------------------------------------------------------- headwear
// bottom edge of each hat on the scalp: [a (0 front … 1 back), unit-sphere y]
const HAT_EDGE = {
  beanie: [[0, 0.34], [0.22, 0.28], [0.5, 0.03], [0.78, -0.13], [1, -0.19]],
  cap: [[0, 0.43], [0.25, 0.37], [0.5, 0.22], [0.75, 0.12], [1, 0.1]],
  bucket: [[0, 0.36], [0.3, 0.32], [0.5, 0.24], [1, 0.2]],
};
function hatEdgeAt(E, a) {
  for (let i = 1; i < E.length; i++) if (a <= E[i][0]) return lerp(E[i - 1][1], E[i][1], smooth(0, 1, (a - E[i - 1][0]) / (E[i][0] - E[i - 1][0])));
  return E[E.length - 1][1];
}
// thin plate (two faces + rim) over a grid p(u, w); closed = wraps in u
function plate(G, NU, NW, posFn, thick, upFn, reg, mat, W, closed) {
  const top = [], bot = [];
  for (let i = 0; i <= NU; i++) {
    const rt = [], rb = [];
    for (let j = 0; j <= NW; j++) {
      const p = posFn(closed ? i % NU : i, j), up = upFn(closed ? i % NU : i, j);
      rt.push(G.vert(v3.add(p, v3.scale(up, thick * 0.5)), up, regUV(reg, i / NU, 0.08 + 0.84 * (j / NW)), W, mat));
      rb.push(G.vert(v3.sub(p, v3.scale(up, thick * 0.5)), v3.scale(up, -1), regUV(reg, i / NU, 0.08 + 0.84 * (j / NW)), W, mat));
    }
    top.push(rt); bot.push(rb);
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NW; j++) {
    G.tri(top[i][j], top[i + 1][j], top[i + 1][j + 1]); G.tri(top[i][j], top[i + 1][j + 1], top[i][j + 1]);
    G.tri(bot[i][j], bot[i + 1][j + 1], bot[i + 1][j]); G.tri(bot[i][j], bot[i][j + 1], bot[i + 1][j + 1]);
  }
  for (let i = 0; i < NU; i++) { const a = top[i][NW], b = top[i + 1][NW], c = bot[i + 1][NW], d = bot[i][NW]; G.tri(a, b, c); G.tri(a, c, d); }
  if (!closed) for (const i of [0, NU]) for (let j = 0; j < NW; j++) { const a = top[i][j], b = top[i][j + 1], c = bot[i][j + 1], d = bot[i][j]; G.tri(a, b, c); G.tri(a, c, d); }
}
function buildHat(G, look) {
  const hat = look.hat;
  if (!hat || hat === 'none') return;
  const W = [[B.head, 1]];
  const NK = 20;
  const thc = (k) => { const th = Math.PI + (2 * Math.PI * k) / NK; return Math.atan2(Math.sin(th), Math.cos(th)); };
  const shell = (rows, reg, mat) => gridSurface(G, NK, rows.length, (k, j) => { const t = thc(k), a = Math.abs(t) / Math.PI; return scalp(t, rows[j].sy(a), rows[j].t(a)).p; },
    (k, j) => regUV(reg, k / NK, rows[j].v), () => W, mat, { center: () => HEAD_C });
  if (hat === 'beanie') {
    // slouch 0 = fitted watch cap with a cuff, 1 = tall slouchy jersey beanie
    const E = HAT_EDGE.beanie, edge = (a) => hatEdgeAt(E, a), NJ = 7, rows = [], sl = clamp(look.hatSlouch || 0, 0, 1);
    for (let j = 0; j <= NJ; j++) {
      const f = j / NJ;
      rows.push({ sy: (a) => lerp(0.999, edge(a) + 0.3, Math.pow(f, 0.9)), t: (a) => 0.016 + (0.012 + (0.03 + 0.03 * sl) * smooth(0.3, 1, a)) * Math.sin(Math.PI * Math.min(1, 0.12 + f * 1.15)) * (1 - f * 0.55) + (0.012 + 0.03 * sl) * Math.pow(1 - f, 1.5), v: 0.04 + 0.7 * f });
    }
    // folded cuff (barely there on a slouchy one)
    const cuff = lerp(0.022, 0.017, sl);
    rows.push({ sy: (a) => edge(a) + 0.28, t: () => cuff, v: 0.8 });
    rows.push({ sy: (a) => edge(a) + 0.03, t: () => cuff, v: 0.97 });
    rows.push({ sy: (a) => edge(a), t: () => 0.013, v: 1 });
    shell(rows, AT.HAT, MAT.SOFT);
    return;
  }
  if (hat === 'cap' || hat === 'bucket') {
    const E = HAT_EDGE[hat], edge = (a) => hatEdgeAt(E, a), NJ = 6, rows = [], cap = hat === 'cap';
    for (let j = 0; j <= NJ; j++) {
      const f = j / NJ;
      rows.push({ sy: (a) => lerp(0.999, edge(a), Math.pow(f, 0.85)), t: (a) => (cap ? 0.01 + 0.014 * smooth(0.45, 0, a) * Math.sin(Math.PI * Math.min(1, f * 1.15)) : 0.014 + 0.02 * Math.sin(Math.PI * Math.min(1, 0.2 + f))) + 0.004 * (1 - f), v: 0.06 + 0.88 * f });
    }
    shell(rows, AT.HAT, MAT.CLOTH);
    // button on top
    loft(G, { origin: v3.add(HEAD_C, [0, HEAD_R[1] + (cap ? 0.012 : 0.018), 0]), dir: [0, 1, 0], n: 6, mat: MAT.CLOTH, reg: AT.HAT, uvFix: regUV(AT.HAT, 0.5, 0.02), capEnd: true, secs: [{ t: -0.004, rx: 0.009, rz: 0.009, w: W }, { t: 0.004, rx: 0.008, rz: 0.008, w: W }] });
    if (cap) {
      // brim: forward, slightly down, curved at the sides
      const NU = 12, NW = 3, span = 0.42 * Math.PI;
      const base = (i) => { const t = -span + (2 * span * i) / NU; return { t, s: scalp(t, edge(Math.abs(t) / Math.PI) + 0.02, 0.012) }; };
      plate(G, NU, NW, (i, j) => {
        const b = base(i), u = b.t / span, L = 0.078 * (1 - 0.55 * u * u), d = v3.norm([Math.sin(b.t) * 0.55, -0.16, Math.cos(b.t)]);
        return v3.add(b.s.p, v3.add(v3.scale(d, L * (j / NW)), [0, -0.016 * u * u * (j / NW), 0]));
      }, 0.006, (i) => { const b = base(i); return v3.norm([Math.sin(b.t) * 0.12, 1, -0.2]); }, AT.BRIM, MAT.CLOTH, W, false);
    } else {
      // bucket brim all around, sloping down
      const NU = 24, NW = 2;
      plate(G, NU, NW, (i, j) => {
        const t = thc(i * (NK / NU)), a = Math.abs(t) / Math.PI, s0 = scalp(t, edge(a), 0.014);
        const out = v3.norm([Math.sin(t), 0, Math.cos(t)]);
        return v3.add(s0.p, v3.add(v3.scale(out, 0.058 * (j / NW)), [0, -0.026 * (j / NW), 0]));
      }, 0.006, (i) => { const t = thc(i * (NK / NU)); return v3.norm([Math.sin(t) * 0.42, 1, Math.cos(t) * 0.42]); }, AT.BRIM, MAT.CLOTH, W, true);
    }
    return;
  }
  if (hat === 'hood') {
    // hood up: an open shell around the back of the head down to the shoulders, framing the face
    const A = 0.73 * Math.PI, NH = 16, NJ = 9;
    const ring = (y, rx, rz, oz, th) => [Math.sin(th) * rx, y, oz + Math.cos(th) * rz];
    const P = (k, j) => {
      const th = Math.PI - A + (2 * A * k) / NH, t = Math.atan2(Math.sin(th), Math.cos(th));
      if (j <= 6) { const f = j / 6, sy = lerp(0.97, -0.35, f); return scalp(t, sy, 0.03 + 0.016 * Math.abs(Math.sin(t)) * Math.sin(Math.PI * Math.min(1, f * 1.3)) + 0.008 * (1 - f)).p; }
      if (j === 7) return v3.lerp(scalp(t, -0.6, 0.04).p, ring(1.505, 0.112, 0.1, -0.012, th), 0.5);
      if (j === 8) return ring(1.47, 0.13, 0.112, -0.018, th);
      return ring(1.43, 0.155, 0.12, -0.022, th);
    };
    const Wj = (j) => (j <= 6 ? W : j === 7 ? [[B.head, 0.55], [B.neck, 0.45]] : j === 8 ? [[B.neck, 0.5], [B.chest, 0.5]] : [[B.chest, 1]]);
    gridSurface(G, NH, NJ + 1, P, (k, j) => regUV(AT.HOOD, k / NH, j / NJ), (k, j) => Wj(j), MAT.SOFT, { open: true, center: (j) => (j <= 6 ? HEAD_C : [0, 1.47, -0.02]) });
    // rolled rim along the opening
    const pts = [];
    for (let j = NJ; j >= 0; j--) pts.push({ p: P(0, j), rx: 0.011, rz: 0.011, w: Wj(j) });
    for (let j = 1; j <= NJ; j++) pts.push({ p: P(NH, j), rx: 0.011, rz: 0.011, w: Wj(j) });
    sweep(G, { pts, n: 5, mat: MAT.SOFT, reg: AT.COLLAR, caps: true });
  }
}

// ---------------------------------------------------------------- body
function buildBody(G, look) {
  const bw = { slim: 0.93, avg: 1.0, broad: 1.08 }[look.build] || 1;
  const curvy = look.frame === 'curvy';
  const shoulderK = curvy ? 0.93 : 1, waistK = curvy ? 0.88 : 1, hipK = curvy ? 1.1 : 1, chestF = curvy ? 0.022 : 0;
  const top = look.top;
  const loose = { tank: 1.0, tee: 1.15, layered: 1.15, hoodie: 1.08, track: 1.06, long: 1.03, fitted: 1.0, jacket: 1.09 }[top] || 1.03;
  const hem = { tank: 0.965, tee: 0.875, layered: 0.875, hoodie: 0.975, track: 0.95, long: 0.95, fitted: 0.985, jacket: 0.92 }[top] || 0.95;
  const boxy = top === 'tee' || top === 'layered' ? 2.9 : 2.4;
  const W = (a, wa, b) => (b == null ? [[a, 1]] : [[a, wa], [b, 1 - wa]]);
  const fold = (seed, amp) => (k, s, th) => 1 + amp * noise1(th * 1.7 + seed + s * 0.37) * (0.5 + 0.5 * noise1(s * 1.3 + seed * 3.1));

  // pelvis / waistband (pants top)
  const pf = (look.bottom === 'baggy' || look.bottom === 'cargo' || look.bottom === 'jorts' || look.bottom === 'shorts') ? 1.05 : 1;
  loft(G, {
    origin: [0, 0.84, 0], dir: [0, 1, 0], n: 10, mat: MAT.CLOTH, reg: AT.PELVIS, vflip: true, capStart: true,
    secs: [
      { t: 0.0, rx: 0.1 * bw * hipK, rz: 0.08, oz: -0.005, e: 2.2, w: W(0) },
      { t: 0.05, rx: 0.153 * bw * pf * hipK, rz: 0.105 * pf, oz: -0.008, e: 2.3, w: W(0) },
      { t: 0.11, rx: 0.162 * bw * pf * hipK, rz: 0.108 * pf, oz: -0.01, e: 2.4, w: W(0) },
      { t: 0.16, rx: 0.15 * bw * waistK, rz: 0.1, oz: -0.006, e: 2.4, w: W(0, 0.6, 1) },
      { t: 0.2, rx: 0.138 * bw * waistK, rz: 0.093, oz: -0.004, e: 2.4, w: W(0, 0.5, 1) },
    ],
  });
  // torso (top garment)
  const tw = bw * loose;
  const tsecs = [
    { t: -0.006, rx: 0.172 * tw * (top === 'tee' || top === 'layered' ? 1.04 : hipK), rz: 0.12 * loose, oz: -0.008, e: boxy, w: W(0) },
    { t: 0.012, rx: 0.168 * tw * (top === 'tee' || top === 'layered' ? 1.03 : hipK), rz: 0.117 * loose, oz: -0.006, e: boxy, w: W(0) },
  ];
  const lerpT = (y, a) => Math.max(0.03, y - hem);
  const rings = [
    [1.04, 0.156, 0.104, -0.002, W(0, 0.45, 1)], [1.1, 0.148 * waistK, 0.099, 0, W(1)], [1.18, 0.154, 0.103, 0.004, W(1, 0.55, 2)],
    [1.27, 0.168, 0.11 + chestF * 0.6, 0.01 + chestF, W(2)], [1.33, 0.177 * shoulderK, 0.113 + chestF, 0.011 + chestF, W(2)],
    [1.395, 0.19 * shoulderK, 0.106, 0.004, W(2)], [1.435, 0.188 * shoulderK, 0.095, -0.002, W(2)], [1.46, 0.158 * shoulderK, 0.083, -0.005, W(2)],
    [1.482, 0.113, 0.074, -0.006, W(2)], [1.5, 0.074, 0.065, -0.006, W(2, 0.6, 3)],
  ];
  for (const [y, rx, rz, oz, w] of rings) {
    if (y <= hem + 0.02) continue;
    const box = top === 'tee' || top === 'layered' ? Math.max(0, 1 - (y - 1.1) / 0.35) : 0;
    tsecs.push({ t: lerpT(y), rx: rx * (y > 1.45 ? 1 : tw) * (1 + 0.06 * box), rz: rz * (y > 1.45 ? 1 : loose), oz, e: y > 1.47 ? 2.0 : lerp(2.5, boxy, box), w });
  }
  loft(G, { origin: [0, hem, 0], dir: [0, 1, 0], n: 12, mat: MAT.SOFT, reg: AT.TOP, vflip: true, secs: tsecs, disp: top === 'tee' || top === 'layered' || top === 'hoodie' || top === 'jacket' ? fold(3.1, 0.035) : null });
  // front / back surface of the top at (x, y), for things lying on it (chains, straps)
  G.torsoZ = (x, y, back) => {
    const ss = tsecs.map((q) => ({ y: hem + q.t, rx: q.rx, rz: q.rz, oz: q.oz || 0, e: q.e || 2 }));
    let i = 1; while (i < ss.length - 1 && ss[i].y < y) i++;
    const a = ss[i - 1], b = ss[i], f = clamp((y - a.y) / ((b.y - a.y) || 1), 0, 1);
    const rx = lerp(a.rx, b.rx, f), rz = lerp(a.rz, b.rz, f), oz = lerp(a.oz, b.oz, f), e = lerp(a.e, b.e, f);
    const u = Math.min(0.999, Math.abs(x) / rx), z = rz * Math.pow(1 - Math.pow(u, e), 1 / e);
    return back ? oz - z : oz + z;
  };
  // neck
  loft(G, {
    origin: [0, 1.42, 0], dir: [0, 1, 0], n: 8, mat: MAT.SKIN, reg: AT.SKIN,
    secs: [
      { t: 0, rx: 0.066, rz: 0.062, w: W(2) }, { t: 0.07, rx: 0.058, rz: 0.057, oz: 0.002, w: W(2, 0.3, 3) },
      { t: 0.12, rx: 0.054, rz: 0.054, oz: 0.004, w: W(3, 0.6, 4) }, { t: 0.18, rx: 0.051, rz: 0.051, w: W(4) },
    ],
  });
  // collars / hood
  if (top === 'hoodie' || top === 'track' || top === 'jacket') {
    const hi = top === 'hoodie' ? 0.03 : 0.055;
    loft(G, {
      origin: [0, 1.445, -0.004], dir: [0, 1, 0], n: 10, mat: MAT.CLOTH, reg: AT.COLLAR,
      secs: [{ t: 0, rx: 0.088, rz: 0.076, w: W(2) }, { t: hi * 0.5, rx: 0.076, rz: 0.067, w: W(2) }, { t: hi, rx: 0.072, rz: 0.064, oz: -0.004, w: W(2, 0.7, 3) }],
    });
  }
  if (top === 'hoodie' && look.hat !== 'hood') {
    loft(G, {
      origin: [0, 1.43, -0.085], dir: v3.norm([0, 0.35, -0.94]), n: 8, mat: MAT.CLOTH, reg: AT.HOOD, capEnd: true,
      secs: [{ t: -0.02, rx: 0.1, rz: 0.035, w: W(2) }, { t: 0.015, rx: 0.118, rz: 0.062, oz: 0.02, w: W(2) }, { t: 0.05, rx: 0.102, rz: 0.056, oz: 0.035, w: W(2) }, { t: 0.078, rx: 0.06, rz: 0.03, oz: 0.04, w: W(2) }],
    });
  }
  // arms (skin or sleeve fabric decided by the texture)
  const longSleeve = top === 'hoodie' || top === 'track' || top === 'long' || top === 'layered' || top === 'jacket';
  for (const s of [0, 1]) {
    const side = s === 0 ? 1 : -1;
    const C = s === 0 ? B.clavL : B.clavR, U = C + 1, F = C + 2, H = C + 3;
    const ab0 = bw * 1.08 * (curvy ? 0.92 : 1), ab = ab0 * (longSleeve ? (top === 'layered' ? 1.04 : loose) : 1);
    const secs = [
      { t: -0.022, rx: 0.02, rz: 0.024, ox: -side * 0.012, w: W(C, 0.5, U) },
      { t: -0.012, rx: 0.045 * ab, rz: 0.05 * ab, ox: -side * 0.004, w: W(C, 0.35, U) },
      { t: 0.02, rx: 0.054 * ab, rz: 0.055 * ab, ox: side * 0.004, w: W(U, 0.8, C) },
      { t: 0.075, rx: 0.051 * ab, rz: 0.05 * ab, ox: side * 0.002, w: W(U) },
      { t: 0.14, rx: 0.046 * ab, rz: 0.047 * ab, w: W(U) },
      { t: 0.205, rx: 0.043 * ab, rz: 0.043 * ab, w: W(U) },
      { t: 0.255, rx: 0.039 * ab, rz: 0.04 * ab, w: W(U, 0.8, F) },
      { t: 0.285, rx: 0.036 * ab, rz: 0.039 * ab, oz: -0.004, w: W(U, 0.5, F) },
      { t: 0.315, rx: 0.039 * ab, rz: 0.04 * ab, w: W(F, 0.82, U) },
      { t: 0.37, rx: 0.041 * ab, rz: 0.04 * ab, w: W(F) },
      { t: 0.46, rx: 0.034 * ab, rz: 0.033 * ab, w: W(F) },
    ];
    if (longSleeve) { secs.push({ t: 0.5, rx: 0.038 * ab, rz: 0.037 * ab, w: W(F, 0.9, H), v: 0.93 }); secs.push({ t: 0.506, rx: 0.028, rz: 0.027, w: W(F, 0.85, H), v: 0.97 }); }
    else secs.push({ t: 0.52, rx: 0.027, rz: 0.026, w: W(F, 0.85, H) });
    secs.push({ t: 0.545, rx: 0.025, rz: 0.024, w: W(F, 0.5, H), v: 1 });
    loft(G, { origin: [side * 0.172, 1.43, 0], dir: [0, -1, 0], n: 7, mat: longSleeve ? MAT.SOFT : MAT.SKIN, reg: AT.ARM, secs, capStart: true, mirrorU: side < 0 });
    // oversized tee sleeves (dropped shoulder, wide opening)
    if (top === 'tee' || top === 'layered') {
      loft(G, {
        origin: [side * 0.176, 1.43, 0], dir: v3.norm([side * 0.12, -1, 0]), n: 8, mat: MAT.SOFT, reg: AT.SLEEVE, capStart: true, mirrorU: side < 0,
        secs: [
          { t: -0.035, rx: 0.03, rz: 0.035, ox: -side * 0.02, w: W(C, 0.6, U) },
          { t: 0.0, rx: 0.071, rz: 0.072, w: W(U, 0.6, C) },
          { t: 0.1, rx: 0.074, rz: 0.074, w: W(U) },
          { t: 0.2, rx: 0.078, rz: 0.077, w: W(U), v: 0.93 },
          { t: 0.205, rx: 0.07, rz: 0.069, w: W(U), v: 1 },
        ],
        disp: fold(5 + side, 0.05),
      });
    }
    // fitted tee: short sleeve hugging the upper arm
    if (top === 'fitted') {
      loft(G, {
        origin: [side * 0.172, 1.43, 0], dir: [0, -1, 0], n: 8, mat: MAT.SOFT, reg: AT.SLEEVE, capStart: true, mirrorU: side < 0,
        secs: [
          { t: -0.036, rx: 0.034, rz: 0.04, ox: -side * 0.018, w: W(C, 0.6, U) },
          { t: -0.01, rx: 0.057 * ab0, rz: 0.061 * ab0, ox: -side * 0.003, w: W(C, 0.3, U) },
          { t: 0.028, rx: 0.061 * ab0, rz: 0.062 * ab0, ox: side * 0.003, w: W(U, 0.85, C) },
          { t: 0.088, rx: 0.058 * ab0, rz: 0.057 * ab0, ox: side * 0.001, w: W(U), v: 0.9 },
          { t: 0.098, rx: 0.055 * ab0, rz: 0.054 * ab0, w: W(U), v: 1 },
        ],
      });
    }
    // hands: palm toward the thigh, thumb forward, fingers curled to the palm
    loft(G, {
      origin: [side * 0.172, 0.89, 0], dir: [0, -1, 0], n: 6, mat: MAT.SKIN, reg: AT.SKIN, capEnd: true,
      secs: [
        { t: -0.012, rx: 0.019, rz: 0.029, w: W(H, 0.6, F) },
        { t: 0.022, rx: 0.02, rz: 0.036, w: W(H) },
        { t: 0.06, rx: 0.019, rz: 0.04, ox: -side * 0.002, e: 2.6, w: W(H) },
        { t: 0.088, rx: 0.017, rz: 0.038, ox: -side * 0.006, oz: -0.002, e: 2.6, w: W(H) },
        { t: 0.112, rx: 0.014, rz: 0.033, ox: -side * 0.014, oz: -0.003, w: W(H) },
        { t: 0.128, rx: 0.01, rz: 0.024, ox: -side * 0.024, oz: -0.003, w: W(H) },
      ],
    });
    loft(G, {
      origin: [side * 0.166, 0.872, 0.024], dir: v3.norm([-side * 0.35, -0.6, 0.72]), n: 5, mat: MAT.SKIN, reg: AT.SKIN, capEnd: true,
      secs: [{ t: 0, rx: 0.011, rz: 0.012, w: W(H) }, { t: 0.03, rx: 0.01, rz: 0.01, w: W(H) }, { t: 0.052, rx: 0.006, rz: 0.006, w: W(H) }],
    });
  }
  // legs
  const bot = look.bottom;
  for (const s of [0, 1]) {
    const side = s === 0 ? 1 : -1;
    const T = s === 0 ? B.thighL : B.thighR, Sh = T + 1, Fo = T + 2;
    const origin = [side * 0.092, 0.93, 0];
    const top3 = [
      { t: -0.075, rx: 0.062 * bw * hipK, rz: 0.076, ox: -side * 0.03, w: W(T, 0.45, 0) },
      { t: -0.02, rx: 0.092 * bw * hipK, rz: 0.098, ox: -side * 0.012, w: W(T, 0.7, 0) },
    ];
    if (bot === 'baggy' || bot === 'cargo') {
      const wide = bot === 'cargo' ? 0.97 : 1.0;
      const prof = [[0.05, 0.102, 0.106], [0.15, 0.1, 0.104], [0.27, 0.097, 0.102], [0.38, 0.096, 0.103], [0.425, 0.096, 0.104], [0.47, 0.097, 0.105],
        [0.56, 0.099, 0.107], [0.66, 0.102, 0.11], [0.74, 0.106, 0.114], [0.8, 0.11, 0.118], [0.84, 0.113, 0.122], [0.866, 0.105, 0.117], [0.888, 0.115, 0.126], [0.905, 0.117, 0.13]];
      const secs = top3.slice();
      for (const [t, rx, rz] of prof) {
        const w = t < 0.38 ? W(T) : t < 0.47 ? W(T, lerp(0.8, 0.2, (t - 0.38) / 0.09), Sh) : t > 0.86 ? W(Sh, 0.85, Fo) : W(Sh);
        secs.push({ t, rx: rx * wide, rz: rz * wide, ox: side * (0.004 + 0.012 * t), oz: t > 0.8 ? 0.008 : 0, w, v: t / 0.905 });
      }
      const amp = (si) => { const t = secs[si].t; return 0.025 + 0.11 * smooth(0.2, 0.75, t) + 0.05 * smooth(0.8, 0.9, t); };
      loft(G, {
        origin, dir: [0, -1, 0], n: 9, mat: MAT.CLOTH, reg: AT.LEG, secs, mirrorU: side < 0,
        disp: (k, si, th) => 1 + amp(si) * 0.5 * (noise1(th * 2.1 + side * 7 + si * 0.9) + 0.6 * noise1(th * 4.3 + si * 1.7 + side)),
      });
      if (bot === 'cargo') {
        loft(G, {
          origin: [side * 0.19, 0.66, 0.0], dir: [0, -1, 0], n: 4, rot: Math.PI / 4, mat: MAT.CLOTH, reg: AT.POCKET, capStart: true, capEnd: true,
          secs: [{ t: 0, rx: 0.03, rz: 0.06, ox: side * 0.0, e: 6, w: W(T) }, { t: 0.13, rx: 0.034, rz: 0.064, e: 6, w: W(T) }, { t: 0.15, rx: 0.026, rz: 0.055, e: 6, w: W(T) }],
        });
      }
    } else if (bot === 'track' || bot === 'flare' || bot === 'straight' || bot === 'skinny') {
      const prof = {
        track: [[0.05, 0.096, 0.1], [0.2, 0.088, 0.092], [0.38, 0.082, 0.086], [0.425, 0.081, 0.085], [0.47, 0.082, 0.086], [0.62, 0.084, 0.088], [0.78, 0.086, 0.09], [0.86, 0.084, 0.088], [0.9, 0.088, 0.094]],
        flare: [[0.05, 0.094 * hipK, 0.098], [0.2, 0.08, 0.084], [0.38, 0.064, 0.068], [0.425, 0.062, 0.066], [0.47, 0.063, 0.067], [0.6, 0.074, 0.078], [0.74, 0.092, 0.096], [0.85, 0.11, 0.116], [0.9, 0.12, 0.128]],
        straight: [[0.05, 0.099 * hipK, 0.103], [0.2, 0.091, 0.095], [0.38, 0.084, 0.088], [0.425, 0.083, 0.087], [0.47, 0.083, 0.087], [0.62, 0.083, 0.087], [0.78, 0.084, 0.088], [0.85, 0.086, 0.091], [0.88, 0.09, 0.095], [0.9, 0.088, 0.094]],
        skinny: [[0.05, 0.092 * hipK, 0.096], [0.2, 0.078, 0.082], [0.38, 0.066, 0.07], [0.425, 0.063, 0.067], [0.47, 0.062, 0.066], [0.55, 0.064, 0.07], [0.68, 0.056, 0.06], [0.8, 0.05, 0.054], [0.86, 0.053, 0.057], [0.9, 0.056, 0.06]],
      }[bot];
      const secs = top3.slice();
      for (const [t, rx, rz] of prof) {
        const w = t < 0.38 ? W(T) : t < 0.47 ? W(T, lerp(0.8, 0.2, (t - 0.38) / 0.09), Sh) : t > 0.85 ? W(Sh, 0.85, Fo) : W(Sh);
        secs.push({ t, rx, rz, w, v: t / 0.9 });
      }
      loft(G, { origin, dir: [0, -1, 0], n: 9, mat: MAT.CLOTH, reg: AT.LEG, secs, mirrorU: side < 0, disp: (k, si, th) => 1 + 0.03 * noise1(th * 2 + si + side * 5) });
    } else if (bot === 'jorts' || bot === 'shorts') {
      const secs = top3.slice();
      for (const [t, rx, rz] of [[0.05, 0.104, 0.108], [0.18, 0.103, 0.107], [0.32, 0.102, 0.106], [0.44, 0.104, 0.108], [0.455, 0.096, 0.1]]) {
        secs.push({ t, rx, rz, ox: side * 0.006, w: t < 0.38 ? W(T) : W(T, 0.6, Sh), v: t / 0.455 });
      }
      loft(G, { origin, dir: [0, -1, 0], n: 9, mat: MAT.CLOTH, reg: AT.LEG, secs, mirrorU: side < 0, disp: (k, si, th) => 1 + 0.05 * noise1(th * 2.3 + si + side * 3) });
      // bare calves with socks
      loft(G, {
        origin, dir: [0, -1, 0], n: 7, mat: MAT.SKIN, reg: AT.SHIN,
        secs: [
          { t: 0.36, rx: 0.056, rz: 0.058, w: W(T) }, { t: 0.425, rx: 0.052, rz: 0.055, w: W(T, 0.5, Sh) }, { t: 0.46, rx: 0.052, rz: 0.055, w: W(Sh, 0.8, T) },
          { t: 0.53, rx: 0.055, rz: 0.06, oz: -0.012, w: W(Sh) }, { t: 0.65, rx: 0.046, rz: 0.048, oz: -0.006, w: W(Sh) },
          { t: 0.72, rx: 0.042, rz: 0.044, w: W(Sh), v: 0.72 }, { t: 0.79, rx: 0.042, rz: 0.044, w: W(Sh) }, { t: 0.85, rx: 0.04, rz: 0.042, w: W(Sh, 0.7, Fo) },
        ],
      });
    }
    // shoes: upper + thick sole, along +Z
    const sh = look.shoes;
    const boots = sh === 'boots', skate = sh === 'skate';
    const upper = boots
      ? [[-0.085, 0.034, 0.03, 0.075, 0], [-0.075, 0.052, 0.05, 0.08, 0.1], [-0.03, 0.058, 0.13, 0.14, 0.3], [0.03, 0.061, 0.06, 0.08, 0.55], [0.1, 0.062, 0.045, 0.068, 0.75], [0.16, 0.057, 0.034, 0.06, 0.9], [0.205, 0.035, 0.02, 0.052, 1.0]]
      : skate
        ? [[-0.082, 0.034, 0.026, 0.07, 0], [-0.072, 0.052, 0.04, 0.074, 0.1], [-0.03, 0.058, 0.05, 0.082, 0.3], [0.02, 0.064, 0.055, 0.084, 0.5], [0.09, 0.062, 0.038, 0.066, 0.75], [0.155, 0.057, 0.03, 0.058, 0.9], [0.2, 0.034, 0.018, 0.05, 1.0]]
        : [[-0.085, 0.034, 0.03, 0.075, 0], [-0.075, 0.051, 0.046, 0.078, 0.1], [-0.03, 0.057, 0.062, 0.09, 0.3], [0.03, 0.061, 0.052, 0.077, 0.55], [0.09, 0.062, 0.041, 0.066, 0.75], [0.15, 0.058, 0.031, 0.059, 0.9], [0.205, 0.032, 0.017, 0.051, 1.0]];
    loft(G, {
      origin: [side * 0.092, 0, 0], dir: [0, 0, 1], front: [0, 1, 0], side: [1, 0, 0], n: 8, mat: MAT.SHOE, reg: AT.SHOE, capStart: true, capEnd: true,
      secs: upper.map(([t, rx, rz, oz, v]) => ({ t, rx: rx * (boots ? 1.04 : 1), rz, oz, e: 3.2, w: t < -0.02 && boots ? W(Fo, 0.7, Sh) : W(Fo), v })),
    });
    const soleH = boots ? 0.03 : skate ? 0.022 : 0.028;
    loft(G, {
      origin: [side * 0.092, 0, 0], dir: [0, 0, 1], front: [0, 1, 0], side: [1, 0, 0], n: 8, mat: MAT.SHOE, reg: AT.SOLE, capStart: true, capEnd: true,
      secs: [[-0.096, 0.04, 0.6], [-0.086, 0.063, 1], [0.0, 0.067, 1], [0.1, 0.069, 1], [0.18, 0.063, 0.95], [0.222, 0.04, 0.8]].map(([t, rx, h], i, a) => ({ t, rx, rz: soleH * h, oz: soleH * h + (t > 0.17 ? 0.006 : 0), e: 5, w: W(Fo), v: i / (a.length - 1) })),
    });
  }
}

// ---------------------------------------------------------------- accessories
function buildAcc(G, look) {
  const WH = [[B.head, 1]];
  if (look.phones) {
    for (const side of [1, -1]) {
      loft(G, {
        origin: [side * 0.07, EYE_Y - 0.008, -0.01], dir: [side, 0, 0], front: [0, 1, 0], side: [0, 0, 1], n: 8, mat: MAT.GLOSS, uvFix: accUV('black'), capEnd: true,
        secs: [{ t: 0.0, rx: 0.038, rz: 0.042, w: WH }, { t: 0.022, rx: 0.042, rz: 0.046, w: WH }, { t: 0.038, rx: 0.036, rz: 0.04, w: WH }],
      });
      loft(G, {
        origin: [side * 0.106, EYE_Y - 0.008, -0.01], dir: [side, 0, 0], front: [0, 1, 0], side: [0, 0, 1], n: 8, mat: MAT.METAL, uvFix: accUV('metal'), capEnd: true,
        secs: [{ t: 0.0, rx: 0.024, rz: 0.026, w: WH }, { t: 0.006, rx: 0.02, rz: 0.022, w: WH }],
      });
    }
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI * (i / 14);
      pts.push({ p: [Math.cos(a) * 0.098, EYE_Y + 0.02 + Math.sin(a) * 0.142, -0.012 - Math.sin(a) * 0.012], rx: 0.009, rz: 0.017, w: WH });
    }
    sweep(G, { pts, n: 6, mat: MAT.GLOSS, uvFix: accUV('black'), ref: [0, 0, 1], caps: true });
  }
  if (look.shades) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const x = -0.074 + (0.148 * i) / 12;
      const zf = HEAD_C[2] + HEAD_R[2] * 0.9 * Math.sqrt(Math.max(0.05, 1 - Math.pow(x / 0.082, 2))) + 0.016;
      pts.push({ p: [x, EYE_Y + 0.001, zf], rx: 0.004, rz: 0.0135, w: WH });
    }
    sweep(G, { pts, n: 6, mat: MAT.GLOSS, uvFix: accUV('lens'), ref: [0, 1, 0], caps: true });
  }
  const tz = G.torsoZ || ((x, y, back) => (back ? -0.11 : 0.12));
  if (look.chain || look.pendant) {
    // chain lying on the top: behind the neck, then down the chest (deeper with a pendant)
    const WC = [[B.chest, 1]], pts = [], depth = look.pendant ? 0.135 : 0.065, r = look.pendant ? 0.0032 : 0.0045;
    for (let i = 0; i <= 8; i++) { const ph = Math.PI * (i / 8); pts.push({ p: [-0.084 * Math.cos(ph), 1.468 + 0.004 * Math.sin(ph), -0.074 * Math.sin(ph) - 0.006], rx: r, rz: r, w: WC }); }
    pts.reverse();
    for (let i = 1; i < 16; i++) {
      const u = -1 + (2 * i) / 16, x = 0.084 * u * (0.4 + 0.6 * Math.abs(u)), y = 1.468 - depth * (1 - Math.pow(Math.abs(u), 1.5));
      const zNeck = Math.sqrt(Math.max(0, 0.068 * 0.068 - x * x)) + 0.006;
      pts.push({ p: [x, y, Math.max(zNeck, tz(x, y) + 0.006)], rx: r, rz: r, w: WC });
    }
    sweep(G, { pts, n: 5, mat: MAT.METAL, uvFix: accUV('metal'), closed: true });
    if (look.pendant) {
      // dog tag
      const yb = 1.468 - depth, yc = yb - 0.024, zc = tz(0, yc) + 0.007;
      loft(G, {
        origin: [0, yb - 0.004, zc], dir: [0, -1, 0], side: [1, 0, 0], front: [0, 0, 1], n: 8, mat: MAT.METAL, uvFix: accUV('metal'), capStart: true, capEnd: true,
        secs: [{ t: 0, rx: 0.008, rz: 0.0022, e: 4, w: WC }, { t: 0.005, rx: 0.0125, rz: 0.0024, e: 4, w: WC }, { t: 0.035, rx: 0.0125, rz: 0.0024, e: 4, w: WC }, { t: 0.04, rx: 0.008, rz: 0.0022, e: 4, w: WC }],
      });
    }
  }
  if (look.glasses) {
    const zf = (x) => HEAD_C[2] + HEAD_R[2] * 0.9 * Math.sqrt(Math.max(0.05, 1 - Math.pow(x / 0.082, 2))) + 0.013;
    const rim = { rx: 0.0018, rz: 0.0028, w: WH }, at = (p) => Object.assign({ p }, rim);
    for (const sd of [1, -1]) {
      const cx = sd * 0.031, pts = [];
      for (let i = 0; i < 16; i++) {
        const a = (2 * Math.PI * i) / 16, ca = Math.cos(a), sa = Math.sin(a);
        const x = cx + 0.019 * Math.sign(ca) * Math.pow(Math.abs(ca), 0.55), y = EYE_Y - 0.001 + 0.0125 * Math.sign(sa) * Math.pow(Math.abs(sa), 0.55);
        pts.push(at([x, y, zf(x)]));
      }
      sweep(G, { pts, n: 4, mat: MAT.GLOSS, uvFix: accUV('black'), closed: true, ref: [0, 0, 1] });
      const x0 = sd * 0.05;
      sweep(G, { pts: [at([x0, EYE_Y + 0.006, zf(x0) - 0.002]), at([sd * 0.077, EYE_Y + 0.008, 0.045]), at([sd * 0.08, EYE_Y + 0.004, -0.008])], n: 4, mat: MAT.GLOSS, uvFix: accUV('black'), caps: true });
    }
    sweep(G, { pts: [at([-0.012, EYE_Y + 0.004, zf(0.012) + 0.001]), at([0, EYE_Y + 0.006, zf(0) + 0.003]), at([0.012, EYE_Y + 0.004, zf(0.012) + 0.001])], n: 4, mat: MAT.GLOSS, uvFix: accUV('black'), caps: true });
  }
  if (look.bag) {
    // crossbody: strap from the left shoulder across the chest to a pouch on the right hip, back over the shoulder
    const wAt = (y) => (y > 1.34 ? [[B.chest, 1]] : y > 1.16 ? [[B.chest, (y - 1.16) / 0.18], [B.spine, 1 - (y - 1.16) / 0.18]] : y > 1.02 ? [[B.spine, (y - 1.02) / 0.14], [B.hips, 1 - (y - 1.02) / 0.14]] : [[B.hips, 1]]);
    const st = (p) => ({ p, rx: 0.016, rz: 0.0028, w: wAt(p[1]) });
    const pts = [];
    for (let i = 0; i <= 9; i++) { const f = i / 9, x = lerp(-0.075, 0.1, f), y = lerp(1.0, 1.44, f); pts.push(st([x, y, tz(x, y) + 0.007])); }
    pts.push(st([0.118, 1.478, 0.035]), st([0.124, 1.488, -0.015]), st([0.115, 1.47, -0.06]));
    for (let i = 1; i <= 9; i++) { const f = i / 9, x = lerp(0.1, -0.15, f), y = lerp(1.43, 1.0, f); pts.push(st([x, y, tz(x, y, true) - 0.007])); }
    pts.push(st([-0.172, 0.985, -0.02]), st([-0.16, 0.985, 0.06]));
    sweep(G, { pts, n: 4, mat: MAT.CLOTH, reg: AT.BAG, ref: [0, 0, 1], closed: true });
    const zc = Math.max(tz(-0.075, 0.99), 0.112) + 0.028;
    loft(G, {
      origin: [-0.075, 0.985, zc], dir: [-1, 0, 0], side: [0, 1, 0], front: [0, 0, 1], n: 8, mat: MAT.CLOTH, reg: AT.BAG, capStart: true, capEnd: true,
      secs: [{ t: -0.068, rx: 0.036, rz: 0.02, e: 4, w: [[B.hips, 1]] }, { t: -0.062, rx: 0.043, rz: 0.026, e: 4, w: [[B.hips, 1]] }, { t: 0.062, rx: 0.043, rz: 0.026, e: 4, w: [[B.hips, 1]] }, { t: 0.068, rx: 0.036, rz: 0.02, e: 4, w: [[B.hips, 1]] }],
    });
  }
  if (look.wings) {
    const rnd = mulberry(77);
    for (const side of [1, -1]) {
      const bone = side > 0 ? B.wingL : B.wingR, R0 = REST[bone], Ww = [[bone, 1]];
      // leading edge: root → wing shoulder → wrist → tip
      const A = [R0, v3.add(R0, [side * 0.14, 0.13, -0.07]), v3.add(R0, [side * 0.3, 0.33, -0.12]), v3.add(R0, [side * 0.58, 0.48, -0.15])];
      const segL = [0]; for (let i = 1; i < A.length; i++) segL.push(segL[i - 1] + v3.len(v3.sub(A[i], A[i - 1])));
      const at = (u) => { const d = u * segL[segL.length - 1]; for (let i = 1; i < A.length; i++) if (d <= segL[i] || i === A.length - 1) { const f = clamp((d - segL[i - 1]) / (segL[i] - segL[i - 1]), 0, 1); return v3.lerp(A[i - 1], A[i], f); } return A[A.length - 1]; };
      sweep(G, { pts: A.map((p, i) => ({ p, rx: lerp(0.03, 0.012, i / 3), rz: lerp(0.024, 0.01, i / 3), w: Ww })), n: 5, mat: MAT.SOFT, reg: AT.WING, caps: true });
      const feather = (u, len, rad, wid, down, dz) => {
        const base = v3.add(at(u), [0, -0.01, dz]);
        const d = v3.norm(v3.add(v3.scale([side, 0.12, -0.12], lerp(0.45, 1.0, Math.pow(u, 1.1))), v3.scale([0, -1, -0.05], down * lerp(0.9, 0.12, u))));
        spike(G, { base, dir: d, len, rad, sides: 4, flat: wid, mid: 0.72, rot: Math.PI / 4, wax: v3.cross(d, [0, 0, 1]), bend: [side * len * 0.06, len * 0.04, -len * 0.04], reg: AT.WING, w: Ww, mat: MAT.SOFT });
      };
      for (let i = 0; i < 12; i++) { const u = 0.08 + 0.92 * (i / 11); feather(u, lerp(0.26, 0.5, Math.pow(u, 1.2)) * (0.93 + rnd() * 0.14), 0.03, 2.8, 1.0, -0.012); }
      for (let i = 0; i < 9; i++) { const u = 0.04 + 0.72 * (i / 8); feather(u, lerp(0.14, 0.22, u) * (0.9 + rnd() * 0.2), 0.028, 2.6, 1.1, 0.006); }
    }
  }
  if (look.belt) {
    const k = (look.bottom === 'baggy' || look.bottom === 'cargo' || look.bottom === 'jorts') ? 1.05 : 1;
    loft(G, {
      origin: [0, 0.962, 0], dir: [0, 1, 0], n: 12, mat: MAT.CLOTH, reg: AT.BELT,
      secs: [{ t: 0, rx: 0.166 * k, rz: 0.114 * k, oz: -0.009, e: 2.4, w: [[0, 1]], v: 0 }, { t: 0.034, rx: 0.16 * k, rz: 0.11 * k, oz: -0.008, e: 2.4, w: [[0, 1]], v: 1 }],
    });
  }
}

// ---------------------------------------------------------------- folding chair (for the sit-down dance; parked off-stage otherwise)
const CHAIR = { seatY: 0.45, z: -0.2 };
function buildChair(G) {
  const W = [[B.prop, 1]], tube = (pts, r) => sweep(G, { pts: pts.map((p) => ({ p, rx: r || 0.011, rz: r || 0.011, w: W })), n: 6, mat: MAT.METAL, uvFix: accUV('black'), caps: true });
  const y = CHAIR.seatY, z0 = CHAIR.z, hw = 0.235, d = 0.21;
  // crossed legs on each side, seat rails, back posts, a front bar
  for (const sx of [1, -1]) {
    const x = sx * hw;
    tube([[x, 0.01, z0 + d + 0.04], [x, y, z0 - d]]);
    tube([[x, 0.01, z0 - d - 0.05], [x, y, z0 + d]]);
    tube([[x, y, z0 + d + 0.01], [x, y, z0 - d - 0.01]]);
    tube([[x, y - 0.01, z0 - d], [x * 0.98, y + 0.46, z0 - d - 0.09]]);
    tube([[x, 0.012, z0 + d + 0.04], [x, 0.012, z0 + d - 0.02]], 0.016);
    tube([[x, 0.012, z0 - d - 0.05], [x, 0.012, z0 - d + 0.01]], 0.016);
  }
  tube([[-hw, y - 0.12, z0 + d * 0.5], [hw, y - 0.12, z0 + d * 0.5]], 0.009);
  // fabric seat (sags a little) and back
  const cloth = (o) => loft(G, Object.assign({ n: 4, rot: Math.PI / 4, mat: MAT.CLOTH, uvFix: accUV('black'), capStart: true, capEnd: true }, o));
  cloth({ origin: [-hw, y - 0.006, z0], dir: [1, 0, 0], side: [0, 0, 1], front: [0, 1, 0],
    secs: [{ t: 0, rx: d, rz: 0.012, e: 6, w: W }, { t: hw, rx: d, rz: 0.012, oz: -0.02, e: 6, w: W }, { t: hw * 2, rx: d, rz: 0.012, e: 6, w: W }] });
  const bc = [0, y + 0.3, z0 - d - 0.06];
  cloth({ origin: [-hw * 0.98, bc[1], bc[2]], dir: [1, 0, 0], side: [0, 0.97, -0.2], front: [0, 0.2, 0.97],
    secs: [{ t: 0, rx: 0.13, rz: 0.01, e: 6, w: W }, { t: hw * 0.98, rx: 0.13, rz: 0.01, oz: -0.012, e: 6, w: W }, { t: hw * 1.96, rx: 0.13, rz: 0.01, e: 6, w: W }] });
}

const HEAD_SCALE = 1.06;
function buildCharacter(look) {
  const G = new Geo();
  buildBody(G, look);
  const v0 = G.pos.length / 3;
  buildHead(G, look);
  buildHair(G, look.hairStyle, look.seed, look.hat);
  buildHat(G, look);
  buildAcc(G, look);
  buildChair(G);
  const pivot = [0, 1.555, 0.01];
  for (let i = v0; i < G.pos.length / 3; i++) {
    if (G.bi[i * 2] !== B.head) continue;
    for (let k = 0; k < 3; k++) G.pos[i * 3 + k] = pivot[k] + (G.pos[i * 3 + k] - pivot[k]) * HEAD_SCALE;
  }
  return G;
}

// ---------------------------------------------------------------- atlas painting (hand-painted, Y2K)
const ATLAS = 1024, KS = ATLAS / 512;
const css = (c, k, a) => { k = k == null ? 1 : k; return `rgba(${clamp(Math.round(c[0] * k), 0, 255)},${clamp(Math.round(c[1] * k), 0, 255)},${clamp(Math.round(c[2] * k), 0, 255)},${a == null ? 1 : a})`; };
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
// which bottoms are painted as denim: explicit flag, else by type
function isDenim(look) {
  if (look.bottom === 'cargo' || look.bottom === 'track') return false;
  if (look.denim != null) return !!look.denim;
  return look.bottom === 'baggy' || look.bottom === 'jorts' || look.bottom === 'flare' || look.bottom === 'skinny' || look.bottom === 'straight';
}
function rr(reg) { return [reg[0] * ATLAS, reg[1] * ATLAS, (reg[2] - reg[0]) * ATLAS, (reg[3] - reg[1]) * ATLAS]; }
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function clipReg(g, x, y, w, h) { g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); }
function strokes(g, x, y, w, h, color, n, rnd, opt) {
  opt = opt || {};
  for (let i = 0; i < n; i++) {
    const cx = x + (opt.u0 != null ? lerp(opt.u0, opt.u1, rnd()) : rnd()) * w;
    const cy = y + (opt.v0 != null ? lerp(opt.v0, opt.v1, rnd()) : rnd()) * h;
    const len = (opt.len || 0.25) * w * (0.6 + rnd() * 0.8);
    const ang = (opt.ang || 0) + (rnd() - 0.5) * (opt.spread == null ? 0.8 : opt.spread);
    const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2;
    const dark = opt.dark != null ? rnd() < opt.dark : rnd() < 0.55;
    g.strokeStyle = css(color, dark ? opt.kd || 0.7 : opt.kl || 1.18, (opt.a || 0.4) * (0.6 + rnd() * 0.6));
    g.lineWidth = (opt.lw || 2) * KS * (0.6 + rnd() * 0.9);
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - dx, cy - dy);
    g.quadraticCurveTo(cx + (rnd() - 0.5) * len * 0.35, cy + (rnd() - 0.5) * len * 0.35, cx + dx, cy + dy); g.stroke();
  }
}
function vgrad(g, x, y, w, h, stops) { const gr = g.createLinearGradient(x, y, x, y + h); for (const s of stops) gr.addColorStop(s[0], s[1]); g.fillStyle = gr; g.fillRect(x, y, w, h); }
function sideShade(g, x, y, w, h, a) {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, `rgba(0,0,0,${a * 0.7})`); gr.addColorStop(0.25, `rgba(0,0,0,${a})`); gr.addColorStop(0.5, 'rgba(0,0,0,0)');
  gr.addColorStop(0.75, `rgba(0,0,0,${a})`); gr.addColorStop(1, `rgba(0,0,0,${a * 0.7})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}
function stitch(g, x0, y0, x1, y1, color) {
  g.save(); g.setLineDash([3 * KS, 2.5 * KS]); g.strokeStyle = color; g.lineWidth = 1.1 * KS;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
}

// face, drawn in face-space metres (x right = character's left, y up from the eye line).
// Game-realistic: sculpted with warm shadow (no blush), sharp almond eyes with a heavy upper lid, defined brows.
function paintFaceAnime(g, look) {
  const [X, Y, Wd, Ht] = rr(AT.FACE);
  const P = (x, y) => [X + (0.5 + x / FACE_SPAN) * Wd, Y + (0.5 - y / FACE_SPAN) * Ht];
  const m = Wd / FACE_SPAN; // px per metre
  const skin = look.skin, hairC = look.hairC, eyeC = look.eyeC || [62, 40, 30];
  const shade = [skin[0] * 0.66, skin[1] * 0.55, skin[2] * 0.5], light = mixc(skin, [255, 248, 240], 0.22);
  const ink = [24, 16, 14];
  g.fillStyle = css(skin); g.fillRect(X, Y, Wd, Ht);
  clipReg(g, X, Y, Wd, Ht);
  // soft painted blob in face space
  const blob = (x, y, rx, ry, col, a, rot) => {
    const [cx, cy] = P(x, y); g.save(); g.translate(cx, cy); g.rotate(rot || 0); g.scale(rx * m, ry * m);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, css(col, 1, a)); rg.addColorStop(1, css(col, 1, 0));
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
  };
  const path = (pts) => { g.beginPath(); let p = P(pts[0][0], pts[0][1]); g.moveTo(p[0], p[1]); for (let i = 1; i < pts.length; i++) { if (pts[i].length === 4) { const c = P(pts[i][0], pts[i][1]), e = P(pts[i][2], pts[i][3]); g.quadraticCurveTo(c[0], c[1], e[0], e[1]); } else { p = P(pts[i][0], pts[i][1]); g.lineTo(p[0], p[1]); } } };
  const line = (pts, col, wd) => { path(pts); g.strokeStyle = col; g.lineWidth = wd * m; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); };

  // ---- sculpt: sides, temples, eye sockets, cheekbones, nose, mouth, chin, jaw
  const side = g.createLinearGradient(X, 0, X + Wd, 0);
  side.addColorStop(0.1, css(shade, 1, 0.55)); side.addColorStop(0.3, css(shade, 1, 0)); side.addColorStop(0.7, css(shade, 1, 0)); side.addColorStop(0.9, css(shade, 1, 0.55));
  g.fillStyle = side; g.fillRect(X, Y, Wd, Ht);
  blob(0, 0.045, 0.045, 0.022, light, 0.35);                         // forehead plane
  for (const s of [1, -1]) {
    blob(s * 0.03, 0.002, 0.027, 0.017, shade, 0.42);                // eye socket
    blob(s * 0.012, -0.002, 0.008, 0.012, shade, 0.4);               // inner socket by the bridge
    blob(s * 0.031, 0.026, 0.022, 0.006, light, 0.45, s * -0.12);    // brow ridge
    blob(s * 0.043, -0.014, 0.017, 0.007, light, 0.42, s * 0.38);    // cheekbone
    blob(s * 0.054, -0.046, 0.01, 0.024, shade, 0.14, s * 0.28);     // hollow under the cheekbone
    blob(s * 0.0085, -0.021, 0.005, 0.014, shade, 0.38);             // nose sides
  }
  blob(0, -0.008, 0.0035, 0.022, light, 0.55);                       // nose bridge
  blob(0, -0.031, 0.0058, 0.0042, light, 0.55);                      // nose tip
  blob(0, -0.0395, 0.011, 0.0042, shade, 0.5);                       // under the nose
  for (const s of [1, -1]) blob(s * 0.0058, -0.0362, 0.0029, 0.0015, [70, 40, 34], 0.75, s * 0.3);   // nostrils
  blob(0, -0.048, 0.0042, 0.0058, shade, 0.22);                      // philtrum
  blob(0, -0.068, 0.0105, 0.0034, shade, 0.48);                      // under the lower lip
  blob(0, -0.084, 0.013, 0.008, light, 0.42);                        // chin
  // under the jaw
  vgrad(g, X, P(0, -0.094)[1], Wd, Ht, [[0, css(shade, 1, 0)], [0.12, css(shade, 1, 0.38)], [1, css(shade, 0.85, 0.7)]]);
  // hairline shadow
  vgrad(g, X, Y, Wd, P(0, 0.058)[1] - Y, [[0, css(mixc(hairC, shade, 0.5), 0.8, 0.85)], [0.6, css(shade, 1, 0.4)], [1, css(shade, 1, 0)]]);

  // ---- mouth: neutral, slightly firm; lips only a shade darker than the skin
  const lip = mixc(skin, [150, 86, 74], 0.24), lipD = mixc(lip, ink, 0.18);
  path([[-0.0125, -0.0575], [-0.006, -0.0545], [0, -0.0552], [0.006, -0.0545], [0.0125, -0.0575], [0, -0.0582, -0.0125, -0.0575]]);
  g.fillStyle = css(lipD, 1, 0.75); g.fill();                         // upper lip
  path([[-0.0115, -0.0578], [0, -0.0655, 0.0115, -0.0578], [0, -0.0592, -0.0115, -0.0578]]);
  g.fillStyle = css(lip, 1, 0.55); g.fill();                          // lower lip
  blob(0, -0.0612, 0.0055, 0.0016, light, 0.35);                      // lower lip light
  line([[-0.0135, -0.0572], [-0.005, -0.0584], [0, -0.0581], [0.005, -0.0584], [0.0135, -0.0572]], css([64, 34, 30], 1, 0.9), 0.0013);
  for (const s of [1, -1]) blob(s * 0.0138, -0.0575, 0.0022, 0.002, shade, 0.6);   // mouth corners

  // ---- facial hair: one shape (moustache + chin + jaw up to the sideburns), filled soft, then strands
  if (look.beard === 'stubble' || look.beard === 'beard') {
    const full = look.beard === 'beard', bc = mixc(hairC, [20, 16, 14], 0.3), rnd = mulberry(23);
    const shape = () => {
      g.beginPath();
      const pts = [[-0.072, -0.015], [-0.064, -0.036], [-0.05, -0.05], [-0.034, -0.054], [-0.019, -0.0505], [-0.008, -0.0458], [0, -0.0462], [0.008, -0.0458], [0.019, -0.0505],
        [0.034, -0.054], [0.05, -0.05], [0.064, -0.036], [0.072, -0.015], [0.078, -0.06], [0.06, -0.1], [0.03, -0.122], [0, -0.126], [-0.03, -0.122], [-0.06, -0.1], [-0.078, -0.06]];
      pts.forEach((q, i) => { const p2 = P(q[0], q[1]); if (i) g.lineTo(p2[0], p2[1]); else g.moveTo(p2[0], p2[1]); });
      g.closePath();
      // the lips stay clear
      const l0 = P(-0.0155, -0.0538), l1 = P(0.0155, -0.0538), lc = P(0, -0.072), lt = P(0, -0.0525);
      g.moveTo(l0[0], l0[1]); g.quadraticCurveTo(lt[0], lt[1], l1[0], l1[1]); g.quadraticCurveTo(lc[0], lc[1], l0[0], l0[1]); g.closePath();
    };
    g.save(); g.filter = 'blur(' + (full ? 1.6 : 2.2) * KS + 'px)';
    shape(); g.fillStyle = css(bc, 1, full ? 0.82 : 0.26); g.fill('evenodd');
    g.restore();
    g.save(); shape(); g.clip('evenodd');
    for (let i = 0; i < (full ? 2600 : 3200); i++) {
      const x = (rnd() - 0.5) * 0.16, y = -0.012 - rnd() * 0.116, [px, py] = P(x, y);
      if (full) { const L = (1.5 + rnd() * 2.5) * KS, an = Math.PI / 2 + (x > 0 ? -0.35 : 0.35) * (Math.abs(x) / 0.07) + (rnd() - 0.5) * 0.6; g.strokeStyle = css(bc, rnd() < 0.5 ? 0.6 : 1.5, 0.35); g.lineWidth = 0.8 * KS; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(an) * L, py + Math.sin(an) * L); g.stroke(); }
      else { g.fillStyle = css(bc, 0.7 + rnd() * 0.5, 0.14 + rnd() * 0.12); g.fillRect(px, py, KS * 0.5, KS * 0.5); }
    }
    g.restore();
  }

  // ---- eyes
  for (const s of [1, -1]) {
    const ex = s * 0.031;
    const pin = [ex - s * 0.0152, -0.0012], pout = [ex + s * 0.0168, 0.0028];
    const top = [ex + s * 0.0005, 0.0112], bot = [ex - s * 0.0012, -0.0088];
    // lid crease and the shaded lid above the lash line
    path([[ex - s * 0.0128, 0.0068], [ex - s * 0.002, 0.0142, ex + s * 0.0172, 0.0086], [ex + s * 0.0005, 0.0105, pin[0], pin[1]]]);
    g.fillStyle = css(shade, 0.92, 0.32); g.fill();
    line([[ex - s * 0.0128, 0.0069], [ex - s * 0.002, 0.0143, ex + s * 0.0176, 0.0088]], css(shade, 0.72, 0.7), 0.0011);
    // eyeball
    g.save();
    path([pin, [top[0], top[1], pout[0], pout[1]], [bot[0], bot[1], pin[0], pin[1]]]); g.closePath();
    g.fillStyle = 'rgb(226,222,216)'; g.fill(); g.clip();
    const ic = [ex + s * 0.0012, -0.0004], ir = 0.0059;
    let [cx, cy] = P(ic[0], ic[1]);
    let rg = g.createRadialGradient(cx, cy - ir * m * 0.25, ir * m * 0.15, cx, cy, ir * m);
    rg.addColorStop(0, css(eyeC, 1.45)); rg.addColorStop(0.55, css(eyeC, 1.0)); rg.addColorStop(1, css(eyeC, 0.5));
    g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, ir * m, 0, Math.PI * 2); g.fill();
    g.strokeStyle = css(eyeC, 0.35, 0.9); g.lineWidth = 0.0009 * m; g.stroke();
    g.fillStyle = 'rgba(10,7,6,0.95)'; g.beginPath(); g.arc(cx, cy, ir * m * 0.42, 0, Math.PI * 2); g.fill();
    // the upper lid shades the top of the eye
    const [, ty] = P(0, 0.0112), [, my] = P(0, 0.0005);
    const lg = g.createLinearGradient(0, ty, 0, my); lg.addColorStop(0, 'rgba(40,24,20,0.7)'); lg.addColorStop(1, 'rgba(40,24,20,0)');
    g.fillStyle = lg; g.fillRect(X, ty, Wd, my - ty);
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(cx - ir * m * 0.32, cy - ir * m * 0.38, ir * m * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(cx + ir * m * 0.35, cy + ir * m * 0.32, ir * m * 0.1, 0, Math.PI * 2); g.fill();
    g.restore();
    // lash lines: heavy upper with a short flick, light lower on the outer half
    line([pin, [top[0], top[1] + 0.0004, pout[0], pout[1]], [ex + s * 0.0196, 0.0016]], css(ink, 1, 0.97), 0.0022);
    line([[ex + s * 0.0168, 0.0029], [ex + s * 0.0188, 0.0052]], css(ink, 1, 0.75), 0.0011);
    line([[ex + s * 0.0158, 0.0018], [ex + s * 0.004, -0.0052, ex - s * 0.008, -0.0048]], css(mixc(shade, ink, 0.4), 1, 0.6), 0.0008);
    blob(pin[0] + s * 0.0012, pin[1], 0.0016, 0.0014, mixc(skin, [170, 96, 88], 0.35), 0.7);   // inner corner
    // brow: thick at the head, gentle arch, tapered tail
    const bcol = mixc(hairC, ink, 0.5);
    path([[s * 0.0088, 0.0178], [s * 0.022, 0.0262, s * 0.036, 0.0266], [s * 0.046, 0.0262, s * 0.0545, 0.0205],
      [s * 0.044, 0.0234, s * 0.035, 0.023], [s * 0.022, 0.0224, s * 0.0092, 0.0142]]);
    g.closePath(); g.fillStyle = css(bcol, 1, 0.94); g.fill();
    const rnd = mulberry(s > 0 ? 5 : 9);
    for (let i = 0; i < 26; i++) {
      const f = i / 25, x0 = s * lerp(0.0095, 0.052, f), y0 = lerp(0.0165, 0.0215, f) + (f < 0.6 ? f * 0.007 : (1 - f) * 0.0105) - 0.001;
      line([[x0, y0 - 0.0014], [x0 + s * 0.004, y0 + 0.0016]], css(bcol, rnd() < 0.5 ? 0.7 : 1.35, 0.45), 0.0007);
    }
  }
  g.restore();
}

// generic Y2K tee graphic (no text, no logos): star / flame / tribal / heart-wings / barbed band
function teeGraphic(g, cx, cy, sz, col, out, kind, rnd) {
  g.save(); g.translate(cx, cy); g.lineJoin = 'round';
  const fillOut = () => { g.lineWidth = sz * 0.06; g.strokeStyle = out; g.stroke(); g.fillStyle = col; g.fill(); };
  if (kind === 0) { // star
    g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? sz * 0.22 : sz * 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); fillOut();
    g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? sz * 0.1 : sz * 0.22, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fillStyle = out; g.fill();
  } else if (kind === 1) { // flame
    g.beginPath(); g.moveTo(-sz * 0.4, sz * 0.4);
    for (let i = 0; i < 5; i++) { const x = -sz * 0.4 + i * sz * 0.2; g.quadraticCurveTo(x - sz * 0.05, -sz * (0.1 + 0.35 * rnd()), x + sz * 0.1, -sz * (0.45 + 0.2 * rnd())); g.quadraticCurveTo(x + sz * 0.05, -sz * 0.05, x + sz * 0.2, sz * 0.05); }
    g.lineTo(sz * 0.4, sz * 0.4); g.closePath(); fillOut();
  } else if (kind === 2) { // tribal swoosh pair
    for (const s of [1, -1]) {
      g.beginPath(); g.moveTo(0, -sz * 0.05);
      g.bezierCurveTo(s * sz * 0.3, -sz * 0.5, s * sz * 0.65, -sz * 0.1, s * sz * 0.5, sz * 0.25);
      g.bezierCurveTo(s * sz * 0.45, 0, s * sz * 0.25, -sz * 0.15, 0, sz * 0.12); g.closePath(); fillOut();
    }
  } else if (kind === 3) { // heart with wings
    g.beginPath(); g.moveTo(0, sz * 0.3); g.bezierCurveTo(-sz * 0.4, 0, -sz * 0.25, -sz * 0.3, 0, -sz * 0.12); g.bezierCurveTo(sz * 0.25, -sz * 0.3, sz * 0.4, 0, 0, sz * 0.3); fillOut();
    for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
      g.beginPath(); g.moveTo(s * sz * 0.2, -sz * 0.05 + i * sz * 0.08);
      g.quadraticCurveTo(s * sz * (0.5 + i * 0.05), -sz * (0.35 - i * 0.12), s * sz * (0.62 - i * 0.08), -sz * (0.1 - i * 0.12)); g.closePath(); fillOut();
    }
  } else { // barbed band
    g.lineWidth = sz * 0.05; g.strokeStyle = col;
    for (const o of [-0.06, 0.06]) { g.beginPath(); for (let i = 0; i <= 24; i++) { const x = -sz * 0.6 + (i * sz * 1.2) / 24; g.lineTo(x, Math.sin(i * 1.1) * sz * 0.04 + o * sz); } g.stroke(); }
    for (let i = 0; i < 6; i++) { const x = -sz * 0.5 + i * sz * 0.2; g.beginPath(); g.moveTo(x - sz * 0.05, -sz * 0.1); g.lineTo(x + sz * 0.05, sz * 0.1); g.moveTo(x + sz * 0.05, -sz * 0.1); g.lineTo(x - sz * 0.05, sz * 0.1); g.stroke(); }
  }
  g.restore();
}

function paintDenim(g, x, y, w, h, base, rnd, opt) {
  opt = opt || {};
  g.fillStyle = css(base); g.fillRect(x, y, w, h);
  // twill
  clipReg(g, x, y, w, h);
  g.strokeStyle = css(base, 0.86, 0.35); g.lineWidth = 1 * KS;
  for (let i = -h; i < w; i += 3 * KS) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i + h * 0.6, y + h); g.stroke(); }
  // fading: lighter on the front of thighs and knees
  for (const [v0, v1, a] of [[0.08, 0.38, 0.32], [0.38, 0.56, 0.22], [0.6, 0.85, 0.12]]) {
    const gx = x + w * 0.5, gy = y + h * (v0 + v1) / 2;
    const rg = g.createRadialGradient(gx, gy, 0, gx, gy, w * 0.22 * (1 + (v1 - v0)));
    rg.addColorStop(0, css(mixc(base, [235, 238, 240], 0.55), 1, a)); rg.addColorStop(1, css(base, 1, 0));
    g.save(); g.translate(gx, gy); g.scale(1, (h * (v1 - v0)) / (w * 0.44)); g.translate(-gx, -gy); g.fillStyle = rg; g.fillRect(x, y - h, w, h * 3); g.restore();
  }
  // whiskers near the crotch (inner front)
  if (opt.whiskers !== false) for (let i = 0; i < 7; i++) {
    const vy = y + h * (0.03 + i * 0.022 + rnd() * 0.01), ux = x + w * (0.36 + rnd() * 0.05);
    g.strokeStyle = css(mixc(base, [240, 240, 240], 0.35), 1, 0.22); g.lineWidth = 1.3 * KS;
    g.beginPath(); g.moveTo(ux, vy); g.quadraticCurveTo(ux + w * 0.05, vy - h * 0.004, ux + w * 0.11, vy + h * 0.008); g.stroke();
  }
  // folds and creases (heavier toward the stacked hem)
  strokes(g, x, y, w, h, base, 30, rnd, { v0: 0.12, v1: 0.78, len: 0.14, ang: 0.4, spread: 2.6, lw: 2.2, a: 0.5, kd: 0.55, kl: 1.3 });
  strokes(g, x, y, w, h, base, 16, rnd, { v0: 0.1, v1: 0.85, len: 0.45, ang: 1.5708, spread: 0.35, lw: 1.6, a: 0.45, kd: 0.6, kl: 1.25 });
  strokes(g, x, y, w, h, base, opt.stack || 34, rnd, { v0: 0.74, v1: 0.99, len: 0.22, ang: 0.0, spread: 0.9, lw: 3.0, a: 0.6, kd: 0.5, kl: 1.3 });
  vgrad(g, x, y + h * 0.6, w, h * 0.4, [[0, 'rgba(20,18,16,0)'], [1, 'rgba(20,18,16,0.32)']]);
  // grime
  for (let i = 0; i < 70; i++) { g.fillStyle = css(base, rnd() < 0.6 ? 0.62 : 1.2, 0.16); const rx = rnd() * w, ry = rnd() * h; g.beginPath(); g.ellipse(x + rx, y + ry, 8 * KS * (0.5 + rnd()), 5 * KS * (0.5 + rnd()), rnd() * 3, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

function paintAtlas(look) {
  const cv = mkCanvas(ATLAS, ATLAS), g = cv.getContext('2d');
  const rnd = mulberry(look.seed || 11);
  const top = look.topC, top2 = look.top2C, bot = look.bottomC, shoe = look.shoesC, sole = look.soleC || [236, 232, 222], skin = look.skin, hair = look.hairC;
  const skinD = mixc(skin, [0, 0, 0], 0.06);
  g.fillStyle = css(skin); g.fillRect(0, 0, ATLAS, ATLAS);
  paintFaceAnime(g, look);

  // ---- skin (hands, neck, ears)
  { const [x, y, w, h] = rr(AT.SKIN); g.fillStyle = css(skinD); g.fillRect(x, y, w, h); }

  // ---- torso
  {
    const [x, y, w, h] = rr(AT.TOP);
    const T = look.top;
    const fab = T === 'tank' ? top : top;
    g.fillStyle = css(fab); g.fillRect(x, y, w, h);
    clipReg(g, x, y, w, h);
    vgrad(g, x, y, w, h, [[0, 'rgba(0,0,0,0.12)'], [0.25, 'rgba(255,255,255,0.06)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.22)']]);
    sideShade(g, x, y, w, h, 0.18);
    if (T === 'tank') {
      // ribbing
      for (let i = 0; i < w; i += 3 * KS) { g.fillStyle = css(fab, 0.9, 0.5); g.fillRect(x + i, y, 1.2 * KS, h); }
      strokes(g, x, y, w, h, fab, 20, rnd, { v0: 0.55, v1: 0.95, len: 0.1, ang: 0.2, lw: 1.8 });
      // skin where the tank doesn't cover: front scoop, back neck, deep armholes
      g.fillStyle = css(skinD);
      const vOf = (yy) => (1.5 - yy) / (1.5 - 0.965);
      const scoop = (uc, wd, depth) => { g.beginPath(); g.moveTo(x + w * (uc - wd), y - 2); g.quadraticCurveTo(x + w * uc, y + h * depth * 2.0, x + w * (uc + wd), y - 2); g.closePath(); g.fill(); };
      scoop(0.5, 0.11, vOf(1.39));
      scoop(0.0, 0.07, vOf(1.45)); scoop(1.0, 0.07, vOf(1.45));
      scoop(0.25, 0.085, vOf(1.315)); scoop(0.75, 0.085, vOf(1.315));
      // collarbone + chest shading inside the scoop
      g.strokeStyle = css(skin, 0.8, 0.6); g.lineWidth = 1.6 * KS;
      for (const s of [1, -1]) { g.beginPath(); g.moveTo(x + w * (0.5 + s * 0.015), y + h * vOf(1.465)); g.quadraticCurveTo(x + w * (0.5 + s * 0.05), y + h * vOf(1.475), x + w * (0.5 + s * 0.09), y + h * vOf(1.47)); g.stroke(); }
      // neckline / armhole binding
      g.strokeStyle = css(fab, 0.85, 0.9); g.lineWidth = 2.2 * KS;
      g.beginPath(); g.moveTo(x + w * 0.39, y); g.quadraticCurveTo(x + w * 0.5, y + h * vOf(1.39) * 2.0, x + w * 0.61, y); g.stroke();
    } else {
      // oversized drape folds + side seams + hem
      strokes(g, x, y, w, h, fab, 34, rnd, { v0: 0.35, v1: 0.95, len: 0.14, ang: 1.45, spread: 0.5, lw: 2.4, a: 0.42 });
      strokes(g, x, y, w, h, fab, 14, rnd, { u0: 0.18, u1: 0.32, v0: 0.12, v1: 0.4, len: 0.08, ang: 1.0, lw: 2 });
      strokes(g, x, y, w, h, fab, 14, rnd, { u0: 0.68, u1: 0.82, v0: 0.12, v1: 0.4, len: 0.08, ang: -1.0, lw: 2 });
      g.fillStyle = css(fab, 0.68, 0.9); g.fillRect(x + w * 0.249, y, 1.4 * KS, h); g.fillRect(x + w * 0.749, y, 1.4 * KS, h);
      g.fillStyle = css(fab, 0.8); g.fillRect(x, y + h * 0.93, w, h * 0.07);
      if (T === 'tee' || T === 'layered' || T === 'long' || T === 'fitted') {
        g.fillStyle = css(fab, 0.78); g.fillRect(x, y, w, h * 0.045);
        if (T !== 'long' && look.print !== false) teeGraphic(g, x + w * 0.5, y + h * (T === 'fitted' ? 0.32 : 0.36), w * (T === 'fitted' ? 0.14 : 0.17), css(top2), css(mixc(fab, [0, 0, 0], 0.55)), (look.seed || 0) % 5, mulberry((look.seed || 3) + 5));
      }
      if (T === 'jacket') {
        // open front: the tee underneath between the two front edges, welt pockets, hem band
        const inner = top2 || [236, 234, 228];
        g.fillStyle = css(inner); g.fillRect(x + w * 0.445, y, w * 0.11, h * 0.94);
        g.fillStyle = css(inner, 0.82); g.fillRect(x + w * 0.445, y, w * 0.11, h * 0.05);
        for (const u of [0.445, 0.555]) { g.fillStyle = css(fab, 0.55); g.fillRect(x + w * u - 1.5 * KS, y, 3 * KS, h); g.fillStyle = css(fab, 1.25, 0.6); g.fillRect(x + w * u + (u < 0.5 ? -4 : 2) * KS, y, 1.2 * KS, h); }
        g.strokeStyle = css(fab, 0.6, 0.9); g.lineWidth = 1.8 * KS;
        for (const s2 of [1, -1]) { g.beginPath(); g.moveTo(x + w * (0.5 + s2 * 0.1), y + h * 0.62); g.lineTo(x + w * (0.5 + s2 * 0.16), y + h * 0.56); g.stroke(); }
        g.fillStyle = css(fab, 0.8); g.fillRect(x, y + h * 0.9, w, h * 0.1);
      }
      if (T === 'hoodie' || T === 'track') {
        // zipper
        g.fillStyle = css(fab, 0.55); g.fillRect(x + w * 0.495, y, w * 0.01, h * 0.93);
        g.fillStyle = 'rgba(205,205,210,0.95)';
        for (let i = 0; i < 40; i++) g.fillRect(x + w * 0.4965, y + h * (0.01 + i * 0.023), w * 0.007, 1.4 * KS);
        if (T === 'hoodie') {
          g.strokeStyle = css(fab, 0.6, 0.9); g.lineWidth = 1.8 * KS;
          for (const s of [1, -1]) { g.beginPath(); g.moveTo(x + w * (0.5 + s * 0.012), y + h * 0.62); g.lineTo(x + w * (0.5 + s * 0.1), y + h * 0.6); g.lineTo(x + w * (0.5 + s * 0.12), y + h * 0.9); g.stroke(); }
          g.strokeStyle = css(top2, 1, 0.95); g.lineWidth = 2 * KS;
          for (const s of [1, -1]) { g.beginPath(); g.moveTo(x + w * (0.5 + s * 0.022), y + h * 0.02); g.lineTo(x + w * (0.5 + s * 0.026), y + h * 0.3); g.stroke(); }
          g.fillStyle = css(fab, 0.82); g.fillRect(x, y + h * 0.9, w, h * 0.1);
          for (let i = 0; i < w; i += 3 * KS) { g.fillStyle = css(fab, 0.72, 0.6); g.fillRect(x + i, y + h * 0.9, 1 * KS, h * 0.1); }
        } else {
          // track jacket: side panels + shoulder piping in the detail colour
          for (const u of [0.25, 0.75]) { g.fillStyle = css(top2); g.fillRect(x + w * (u - 0.035), y + h * 0.18, w * 0.07, h * 0.82); }
          g.fillStyle = css(top2); g.fillRect(x, y + h * 0.03, w, h * 0.025);
        }
      }
    }
    g.restore();
  }
  // ---- arms (skin, or sleeves for long tops)
  {
    const [x, y, w, h] = rr(AT.ARM);
    const T = look.top;
    const long = T === 'hoodie' || T === 'track' || T === 'long' || T === 'layered' || T === 'jacket';
    const fab = T === 'layered' ? top2 : top;
    clipReg(g, x, y, w, h);
    if (long) {
      g.fillStyle = css(fab); g.fillRect(x, y, w, h);
      sideShade(g, x, y, w, h, 0.12);
      vgrad(g, x, y, w, h, [[0, 'rgba(0,0,0,0.18)'], [0.2, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.08)']]);
      strokes(g, x, y, w, h, fab, 18, rnd, { v0: 0.45, v1: 0.62, len: 0.35, ang: 0.0, spread: 0.5, lw: 2.2 });
      strokes(g, x, y, w, h, fab, 12, rnd, { v0: 0.75, v1: 0.9, len: 0.3, ang: 0.0, spread: 0.4, lw: 1.8 });
      g.fillStyle = css(fab, 0.78); g.fillRect(x, y + h * 0.9, w, h * 0.07);
      if (T === 'track') for (const du of [-0.03, 0.03]) { g.fillStyle = css(top2); g.fillRect(x + w * (0.75 + du - 0.012), y, w * 0.024, h * 0.9); }
      if (T === 'layered') { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 7; i++) g.fillRect(x, y + h * (0.32 + i * 0.07), w, 2 * KS); }
    } else {
      g.fillStyle = css(skinD); g.fillRect(x, y, w, h);
      sideShade(g, x, y, w, h, 0.1);
      // deltoid / bicep / elbow / forearm definition
      vgrad(g, x, y, w, h, [[0, css(skin, 1.1, 0.55)], [0.18, css(skin, 1, 0)], [0.23, css(skin, 0.78, 0.5)], [0.3, css(skin, 1, 0)], [0.48, css(skin, 0.8, 0.45)], [0.56, css(skin, 1, 0)], [0.7, css(skin, 1.06, 0.3)], [1, css(skin, 0.85, 0.4)]]);
      sideShade(g, x, y, w, h, 0.12);
    }
    g.restore();
  }
  // ---- tee sleeves
  {
    const [x, y, w, h] = rr(AT.SLEEVE);
    g.fillStyle = css(top); g.fillRect(x, y, w, h);
    clipReg(g, x, y, w, h);
    sideShade(g, x, y, w, h, 0.12);
    strokes(g, x, y, w, h, top, 16, rnd, { len: 0.3, ang: 1.2, spread: 0.6, lw: 2.2 });
    g.fillStyle = css(top, 0.8); g.fillRect(x, y + h * 0.88, w, h * 0.12);
    g.restore();
  }
  // ---- collar / hood
  {
    let [x, y, w, h] = rr(AT.COLLAR);
    g.fillStyle = css(look.top === 'track' ? top2 : top, 0.88); g.fillRect(x, y, w, h);
    for (let i = 0; i < w; i += 3 * KS) { g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(x + i, y, 1 * KS, h); }
    [x, y, w, h] = rr(AT.HOOD);
    g.fillStyle = css(top, 0.92); g.fillRect(x, y, w, h);
    clipReg(g, x, y, w, h); vgrad(g, x, y, w, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.32)']]); strokes(g, x, y, w, h, top, 12, rnd, { len: 0.3, ang: 0.3, lw: 2 }); g.restore();
  }
  // ---- pants
  {
    const [x, y, w, h] = rr(AT.LEG);
    const B2 = look.bottom;
    const denim = isDenim(look);
    clipReg(g, x, y, w, h);
    if (denim) {
      paintDenim(g, x, y, w, h, bot, rnd, { stack: B2 === 'baggy' ? 40 : B2 === 'skinny' ? 26 : 18 });
      // outer side seam (u .75 on both legs: right leg UVs are mirrored)
      g.fillStyle = css(bot, 0.6, 0.9); g.fillRect(x + w * 0.748, y, 1.6 * KS, h);
      stitch(g, x + w * 0.758, y, x + w * 0.758, y + h, 'rgba(214,170,90,0.85)');
      // back pockets
      g.strokeStyle = 'rgba(214,170,90,0.85)'; g.lineWidth = 1.1 * KS;
      for (const u of [0.06, 0.94]) { g.strokeRect(x + w * (u - 0.06), y + h * 0.015, w * 0.12, h * 0.07); }
      // frayed hem
      g.fillStyle = css(mixc(bot, [240, 240, 240], 0.45)); g.fillRect(x, y + h * 0.975, w, h * 0.025);
      if (B2 === 'jorts' || B2 === 'shorts') { g.fillStyle = css(mixc(bot, [240, 240, 240], 0.5)); for (let i = 0; i < w; i += 2 * KS) g.fillRect(x + i, y + h * (0.955 + rnd() * 0.03), 1 * KS, h * 0.03); }
    } else {
      g.fillStyle = css(bot); g.fillRect(x, y, w, h);
      sideShade(g, x, y, w, h, 0.14);
      strokes(g, x, y, w, h, bot, 26, rnd, { v0: 0.3, v1: 0.95, len: 0.3, ang: 0.0, spread: 0.6, lw: 2.4, a: 0.45 });
      if (B2 === 'track') for (const du of [-0.025, 0.025]) { g.fillStyle = css(top2); g.fillRect(x + w * (0.75 + du - 0.01), y, w * 0.02, h); }
      if (B2 !== 'track' && B2 !== 'cargo') { g.fillStyle = css(bot, 0.66, 0.9); g.fillRect(x + w * 0.748, y, 1.4 * KS, h); g.fillStyle = css(bot, 0.75); g.fillRect(x, y + h * 0.965, w, h * 0.035); }
      if (B2 === 'cargo') {
        stitch(g, x + w * 0.75, y, x + w * 0.75, y + h, css(bot, 0.6, 0.9));
        g.strokeStyle = css(bot, 0.62, 0.9); g.lineWidth = 1.4 * KS; g.strokeRect(x + w * 0.4, y + h * 0.5, w * 0.2, h * 0.06);
        g.fillStyle = css(bot, 0.7); g.fillRect(x, y + h * 0.96, w, h * 0.04);
      }
    }
    g.restore();
  }
  // ---- pelvis: boxer band peeking above a low waistband + belt loops
  {
    const [x, y, w, h] = rr(AT.PELVIS);
    const denim = isDenim(look);
    if (denim) paintDenim(g, x, y, w, h, bot, rnd, { whiskers: false, stack: 0 }); else { g.fillStyle = css(bot); g.fillRect(x, y, w, h); }
    clipReg(g, x, y, w, h);
    const box = look.boxerC || [236, 236, 236];
    g.fillStyle = css(box); g.fillRect(x, y, w, h * 0.3);
    g.fillStyle = css(top2 && lum(top2) < 160 ? top2 : [40, 40, 46]); g.fillRect(x, y + h * 0.05, w, h * 0.09);
    g.fillStyle = css(bot, 0.85); g.fillRect(x, y + h * 0.3, w, h * 0.1);
    stitch(g, x, y + h * 0.31, x + w, y + h * 0.31, 'rgba(214,170,90,0.8)');
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) { g.fillStyle = css(bot, 0.75); g.fillRect(x + w * u - 2 * KS, y + h * 0.28, 4 * KS, h * 0.14); }
    if (denim) {
      g.fillStyle = 'rgba(200,190,160,1)'; g.beginPath(); g.arc(x + w * 0.5, y + h * 0.35, 3 * KS, 0, Math.PI * 2); g.fill();
      g.fillStyle = css(bot, 0.6); g.fillRect(x + w * 0.497, y + h * 0.42, 1.6 * KS, h * 0.58);
    } else {
      // drawstring waist
      g.strokeStyle = css(mixc(bot, [235, 235, 235], 0.35), 1, 0.9); g.lineWidth = 1.3 * KS; g.lineCap = 'round';
      for (const s2 of [-1, 1]) { g.beginPath(); g.moveTo(x + w * (0.5 + s2 * 0.012), y + h * 0.36); g.quadraticCurveTo(x + w * (0.5 + s2 * 0.02), y + h * 0.5, x + w * (0.5 + s2 * 0.014), y + h * 0.66); g.stroke(); }
      g.fillStyle = css(bot, 0.6); g.fillRect(x + w * 0.497, y + h * 0.5, 1.6 * KS, h * 0.5);
    }
    g.restore();
  }
  // ---- shoes
  {
    let [x, y, w, h] = rr(AT.SHOE);
    g.fillStyle = css(shoe); g.fillRect(x, y, w, h);
    clipReg(g, x, y, w, h);
    sideShade(g, x, y, w, h, 0.08);
    const pan = mixc(shoe, lum(shoe) > 140 ? [60, 60, 66] : [235, 235, 235], lum(shoe) < 60 ? 0.14 : 0.35);
    if (look.shoes !== 'boots') {
      // overlay panels (generic, no brand marks)
      for (const u of [0.25, 0.75]) { g.fillStyle = css(pan); g.beginPath(); g.moveTo(x + w * (u - 0.12), y + h * 0.95); g.quadraticCurveTo(x + w * u, y + h * 0.45, x + w * (u + 0.12), y + h * 0.15); g.lineTo(x + w * (u + 0.12), y + h * 0.95); g.closePath(); g.fill(); }
      g.fillStyle = css(shoe, 1.25); g.fillRect(x + w * 0.42, y + h * 0.3, w * 0.16, h * 0.32);
      g.fillStyle = 'rgba(245,245,245,0.95)';
      for (let i = 0; i < 6; i++) g.fillRect(x + w * 0.43, y + h * (0.33 + i * 0.048), w * 0.14, 1.6 * KS);
      g.fillStyle = css(pan, 0.95); g.fillRect(x + w * 0.2, y + h * 0.85, w * 0.6, h * 0.15);
      g.fillStyle = css(shoe, 0.7); g.fillRect(x + w * 0.2, y, w * 0.6, h * 0.12);
    } else {
      g.fillStyle = css(shoe, 0.8); for (let i = 0; i < 7; i++) g.fillRect(x + w * 0.44, y + h * (0.15 + i * 0.07), w * 0.12, 1.8 * KS);
      strokes(g, x, y, w, h, shoe, 20, rnd, { len: 0.2, lw: 1.6 });
    }
    g.restore();
    [x, y, w, h] = rr(AT.SOLE);
    g.fillStyle = css(sole); g.fillRect(x, y, w, h);
    g.fillStyle = css(sole, 0.82); g.fillRect(x, y, w, h * 0.12); g.fillRect(x, y, w * 0.12, h); g.fillRect(x + w * 0.88, y, w * 0.12, h);
    g.fillStyle = css(sole, 0.7); for (let i = 0; i < 20; i++) g.fillRect(x + w * (0.2 + i * 0.03), y + h * 0.3, 1 * KS, h * 0.5);
  }
  // ---- hair: dark roots → lighter tips with a band of sheen, soft painted strands
  {
    const [x, y, w, h] = rr(AT.HAIR);
    vgrad(g, x, y, w, h, [[0, css(hair, 0.62)], [0.35, css(hair, 0.95)], [0.6, css(hair, 1.2)], [0.72, css(hair, 1.02)], [1, css(hair, 1.1)]]);
    clipReg(g, x, y, w, h);
    for (let i = 0; i < 70; i++) { const xx = x + rnd() * w; g.strokeStyle = css(hair, rnd() < 0.5 ? 0.78 : 1.18, 0.3); g.lineWidth = (1.5 + rnd() * 3) * KS; g.beginPath(); g.moveTo(xx, y); g.lineTo(xx + (rnd() - 0.5) * 10 * KS, y + h); g.stroke(); }
    g.restore();
  }
  // ---- wings: white feathers, grey vanes
  {
    const [x, y, w, h] = rr(AT.WING);
    vgrad(g, x, y, w, h, [[0, 'rgb(196,200,210)'], [0.4, 'rgb(236,238,242)'], [1, 'rgb(252,252,254)']]);
    clipReg(g, x, y, w, h);
    g.fillStyle = 'rgba(120,124,138,0.6)'; g.fillRect(x + w * 0.495, y, w * 0.01, h);
    for (let i = 0; i < 60; i++) { const yy = y + rnd() * h; g.strokeStyle = 'rgba(140,144,158,0.35)'; g.lineWidth = 1.2 * KS; g.beginPath(); g.moveTo(x + w * 0.5, yy); g.lineTo(x + w * (rnd() < 0.5 ? 0.05 : 0.95), yy + h * 0.05); g.stroke(); }
    g.restore();
  }
  // ---- calves + socks (jorts)
  {
    const [x, y, w, h] = rr(AT.SHIN);
    g.fillStyle = css(skinD); g.fillRect(x, y, w, h);
    vgrad(g, x, y, w, h, [[0, css(skin, 0.88, 0.4)], [0.2, css(skin, 1, 0)], [0.6, css(skin, 1, 0)]]);
    g.fillStyle = css(look.sockC || [240, 240, 236]); g.fillRect(x, y + h * 0.7, w, h * 0.3);
    for (let i = 0; i < w; i += 3 * KS) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + i, y + h * 0.7, 1 * KS, h * 0.3); }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + h * 0.7, w, 2 * KS);
  }
  // ---- cargo pocket
  {
    const [x, y, w, h] = rr(AT.POCKET);
    g.fillStyle = css(bot, 0.96); g.fillRect(x, y, w, h);
    g.fillStyle = css(bot, 0.8); g.fillRect(x, y, w, h * 0.3);
    stitch(g, x, y + h * 0.32, x + w, y + h * 0.32, css(bot, 0.6, 0.9));
  }
  // ---- belt (studded)
  {
    const [x, y, w, h] = rr(AT.BELT);
    g.fillStyle = 'rgb(26,24,26)'; g.fillRect(x, y, w, h);
    for (let i = 0; i < 26; i++) { const cx = x + w * (i + 0.5) / 26; if (Math.abs(i + 0.5 - 13) < 1.5) continue; g.fillStyle = 'rgb(205,208,214)'; g.beginPath(); g.arc(cx, y + h * 0.5, h * 0.22, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(cx - 1, y + h * 0.35, 2, 2); }
    g.strokeStyle = 'rgb(200,202,208)'; g.lineWidth = 3 * KS; g.strokeRect(x + w * 0.47, y + h * 0.12, w * 0.06, h * 0.76);
  }
  // ---- headwear: knit beanie / cap panels / bucket stitching, brim
  {
    const hc = look.hatC || [28, 28, 32], H2 = look.hat;
    let [x, y, w, h] = rr(AT.HAT);
    g.fillStyle = css(hc); g.fillRect(x, y, w, h);
    clipReg(g, x, y, w, h);
    if (H2 === 'cap') {
      vgrad(g, x, y, w, h, [[0, css(hc, 1.12)], [0.6, css(hc, 1)], [1, css(hc, 0.86)]]);
      g.strokeStyle = css(hc, 0.62, 0.9); g.lineWidth = 1.6 * KS;
      for (let i = 0; i < 6; i++) { const u = x + (w * (i + 0.5)) / 6; g.beginPath(); g.moveTo(u, y); g.lineTo(u, y + h); g.stroke(); stitch(g, u + 3 * KS, y, u + 3 * KS, y + h, css(hc, 1.35, 0.6)); }
      for (let i = 0; i < 8; i++) { g.fillStyle = css(hc, 0.5); g.beginPath(); g.arc(x + w * ((i + 0.25) / 8), y + h * 0.2, 1.6 * KS, 0, 7); g.fill(); }
    } else if (H2 === 'bucket') {
      vgrad(g, x, y, w, h, [[0, css(hc, 1.1)], [1, css(hc, 0.88)]]);
      for (let i = 1; i < 6; i++) stitch(g, x, y + h * (0.55 + i * 0.07), x + w, y + h * (0.55 + i * 0.07), css(hc, 0.7, 0.8));
    } else {
      // rib knit + folded cuff
      for (let i = 0; i < w; i += 4 * KS) { g.fillStyle = css(hc, 0.78, 0.55); g.fillRect(x + i, y, 1.6 * KS, h); g.fillStyle = css(hc, 1.18, 0.35); g.fillRect(x + i + 2 * KS, y, 1 * KS, h); }
      vgrad(g, x, y, w, h * 0.78, [[0, css(hc, 1.12, 0.5)], [0.7, css(hc, 1, 0)], [1, css(hc, 0.7, 0.5)]]);
      g.fillStyle = css(hc, 0.6, 0.85); g.fillRect(x, y + h * 0.775, w, h * 0.02);
      g.fillStyle = css(hc, 1.15, 0.35); g.fillRect(x, y + h * 0.8, w, h * 0.03);
      strokes(g, x, y, w, h * 0.75, hc, 14, rnd, { len: 0.3, ang: 1.4, spread: 0.5, lw: 2, a: 0.3 });
    }
    g.restore();
    [x, y, w, h] = rr(AT.BRIM);
    g.fillStyle = css(hc, 0.95); g.fillRect(x, y, w, h);
    for (let i = 1; i < 5; i++) stitch(g, x, y + h * (i * 0.16), x + w, y + h * (i * 0.16), css(hc, 0.68, 0.8));
    g.fillStyle = css(hc, 0.7); g.fillRect(x, y + h * 0.88, w, h * 0.12);
    // crossbody bag
    const bc = look.bagC || [30, 30, 34];
    [x, y, w, h] = rr(AT.BAG);
    g.fillStyle = css(bc); g.fillRect(x, y, w, h);
    sideShade(g, x, y, w, h, 0.15);
    stitch(g, x, y + h * 0.12, x + w, y + h * 0.12, css(bc, 1.6, 0.6)); stitch(g, x, y + h * 0.88, x + w, y + h * 0.88, css(bc, 1.6, 0.6));
    g.fillStyle = 'rgba(205,208,214,0.9)'; g.fillRect(x, y + h * 0.48, w, 2 * KS);
  }
  // ---- accessory swatches
  {
    const [x, y, w, h] = rr(AT.ACC);
    const sw = [['black', [30, 30, 34]], ['metal', look.metal === 'gold' ? [214, 176, 92] : [196, 200, 208]], ['lens', look.lensC || [40, 46, 64]], ['accent', look.accC || [220, 60, 60]]];
    for (const [k, c] of sw) { const u = ACC_UV[k]; g.fillStyle = css(c); g.fillRect(x + w * (u[0] - 0.25), y + h * (u[1] - 0.25), w * 0.5, h * 0.5); }
  }
  // global grain (outside the face)
  const id = g.getImageData(0, 0, ATLAS, ATLAS), p = id.data;
  const fx1 = AT.FACE[2] * ATLAS, fy1 = AT.FACE[3] * ATLAS;
  for (let yy = 0; yy < ATLAS; yy++) for (let xx = 0; xx < ATLAS; xx++) {
    if (xx < fx1 && yy < fy1) continue;
    const i = (yy * ATLAS + xx) * 4, n = (hash1(xx * 0.37 + yy * 1.91) - 0.5) * 9;
    p[i] = clamp(p[i] + n, 0, 255); p[i + 1] = clamp(p[i + 1] + n, 0, 255); p[i + 2] = clamp(p[i + 2] + n, 0, 255);
  }
  g.putImageData(id, 0, 0);
  return cv;
}

// ---------------------------------------------------------------- face finder
// pico.js — Copyright (c) 2013 Nenad Markus, MIT License (https://github.com/nenadmarkus/picojs)
// facefinder cascade from https://github.com/nenadmarkus/pico (MIT). Adapted: namespaced, no globals.
const PICO = (function () {
  function unpack(bytes) {
    const dv = new DataView(new ArrayBuffer(4));
    const i32 = (p) => { dv.setUint8(0, bytes[p]); dv.setUint8(1, bytes[p + 1]); dv.setUint8(2, bytes[p + 2]); dv.setUint8(3, bytes[p + 3]); return dv.getInt32(0, true); };
    const f32 = (p) => { dv.setUint8(0, bytes[p]); dv.setUint8(1, bytes[p + 1]); dv.setUint8(2, bytes[p + 2]); dv.setUint8(3, bytes[p + 3]); return dv.getFloat32(0, true); };
    let p = 8;
    const tdepth = i32(p); p += 4;
    const ntrees = i32(p); p += 4;
    const P2 = Math.pow(2, tdepth);
    const tcodes = new Int8Array(ntrees * 4 * P2), tpreds = new Float32Array(ntrees * P2), thresh = new Float32Array(ntrees);
    for (let t = 0; t < ntrees; t++) {
      const base = t * 4 * P2;
      for (let k = 0; k < 4 * P2 - 4; k++) tcodes[base + 4 + k] = bytes[p + k];
      p += 4 * P2 - 4;
      for (let i = 0; i < P2; i++) { tpreds[t * P2 + i] = f32(p); p += 4; }
      thresh[t] = f32(p); p += 4;
    }
    return function classify(r, c, s, px, ldim) {
      r = 256 * r; c = 256 * c; let root = 0, o = 0;
      for (let i = 0; i < ntrees; i++) {
        let idx = 1;
        for (let j = 0; j < tdepth; j++) idx = 2 * idx + (px[((r + tcodes[root + 4 * idx] * s) >> 8) * ldim + ((c + tcodes[root + 4 * idx + 1] * s) >> 8)] <= px[((r + tcodes[root + 4 * idx + 2] * s) >> 8) * ldim + ((c + tcodes[root + 4 * idx + 3] * s) >> 8)]);
        o += tpreds[P2 * i + idx - P2];
        if (o <= thresh[i]) return -1;
        root += 4 * P2;
      }
      return o - thresh[ntrees - 1];
    };
  }
  function run(px, nrows, ncols, classify, prm) {
    let scale = prm.minsize; const dets = [];
    while (scale <= prm.maxsize) {
      const step = Math.max(prm.shiftfactor * scale, 1) >> 0, off = (scale / 2 + 1) >> 0;
      for (let r = off; r <= nrows - off; r += step) for (let c = off; c <= ncols - off; c += step) {
        const q = classify(r, c, scale, px, ncols); if (q > 0) dets.push([r, c, scale, q]);
      }
      scale *= prm.scalefactor;
    }
    return dets;
  }
  function cluster(dets, thr) {
    dets = dets.sort((a, b) => b[3] - a[3]);
    const iou = (a, b) => {
      const or = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
      const oc = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
      return (or * oc) / (a[2] * a[2] + b[2] * b[2] - or * oc);
    };
    const used = new Array(dets.length).fill(0), out = [];
    for (let i = 0; i < dets.length; i++) {
      if (used[i]) continue; let r = 0, c = 0, s = 0, q = 0, n = 0;
      for (let j = i; j < dets.length; j++) if (iou(dets[i], dets[j]) > thr) { used[j] = 1; r += dets[j][0]; c += dets[j][1]; s += dets[j][2]; q += dets[j][3]; n++; }
      out.push([r / n, c / n, s / n, q]);
    }
    return out;
  }
  let classify = null;
  return {
    detect(px, w, h) {
      if (!classify) {
        const bin = atob(FACEFINDER_B64), bytes = new Int8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) << 24) >> 24;
        classify = unpack(bytes);
      }
      const dets = cluster(run(px, h, w, classify, { shiftfactor: 0.1, minsize: Math.max(20, Math.round(Math.min(w, h) * 0.06)), maxsize: Math.min(w, h) * 1.1, scalefactor: 1.1 }), 0.2);
      return dets;
    },
  };
})();

const FACEFINDER_B64 = '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';

// ---------------------------------------------------------------- photo analysis (no ML: skin model + darkness search)
function kmeans(px, k, iters) {
  if (!px.length) return [];
  const s = px.slice().sort((a, b) => lum(a) - lum(b));
  let C = []; for (let i = 0; i < k; i++) C.push(s[Math.floor(((i + 0.5) / k) * s.length)].slice());
  let A = new Array(px.length).fill(0);
  for (let it = 0; it < (iters || 8); it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      const p = px[i]; let bi = 0, bd = 1e18;
      for (let c = 0; c < C.length; c++) { const d = (p[0] - C[c][0]) ** 2 + (p[1] - C[c][1]) ** 2 + (p[2] - C[c][2]) ** 2; if (d < bd) { bd = d; bi = c; } }
      A[i] = bi; const sm = sum[bi]; sm[0] += p[0]; sm[1] += p[1]; sm[2] += p[2]; sm[3]++;
    }
    C = C.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const cnt = C.map(() => 0); A.forEach((a) => cnt[a]++);
  return C.map((c, i) => ({ c: c.map(Math.round), n: cnt[i], f: cnt[i] / px.length })).sort((a, b) => b.n - a.n);
}
function median3(px) {
  if (!px.length) return null;
  const m = [0, 1, 2].map((ch) => { const a = px.map((p) => p[ch]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; });
  return m;
}
function isSkinRGB(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return y > 38 && cr >= 136 && cr <= 180 && cb >= 77 && cb <= 128 && r > g && r > b && r - b >= 18 && (mx - mn) / (mx + 1e-6) >= 0.1;
}
// refine an eye estimate: darkness-weighted centroid in a small window
function refineEye(L, w, h, x, y, rx, ry) {
  let mn = 1e9, sum = 0, n = 0;
  for (let yy = Math.round(y - ry); yy <= Math.round(y + ry); yy++) for (let xx = Math.round(x - rx); xx <= Math.round(x + rx); xx++) {
    if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
    const v = (L[yy * w + xx] * 4 + L[yy * w + xx - 1] + L[yy * w + xx + 1] + L[(yy - 1) * w + xx] + L[(yy + 1) * w + xx]) / 8;
    if (v < mn) mn = v; sum += v; n++;
  }
  if (!n) return [x, y];
  const mean = sum / n, T = mn + 0.4 * (mean - mn);
  let sw = 0, sx = 0, sy = 0;
  for (let yy = Math.round(y - ry); yy <= Math.round(y + ry); yy++) for (let xx = Math.round(x - rx); xx <= Math.round(x + rx); xx++) {
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const v = L[yy * w + xx]; if (v < T) { const wt = (T - v) * (1 - 0.5 * Math.hypot((xx - x) / rx, (yy - y) / ry)); if (wt > 0) { sw += wt; sx += xx * wt; sy += yy * wt; } }
  }
  return sw > 0 ? [sx / sw, sy / sw] : [x, y];
}
function analyzePhoto(img, forceEyes) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = Math.min(1, 480 / Math.max(iw, ih));
  const w = Math.max(8, Math.round(iw * sc)), h = Math.max(8, Math.round(ih * sc));
  const cv = mkCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const L = new Float32Array(w * h), S = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; L[i] = 0.299 * r + 0.587 * gg + 0.114 * b; S[i] = isSkinRGB(r, gg, b) ? 1 : 0; }
  let eyeL, eyeR, faceW;
  const res = { w: iw, h: ih, found: false };
  if (forceEyes) { eyeL = [forceEyes.l[0] * sc, forceEyes.l[1] * sc]; eyeR = [forceEyes.r[0] * sc, forceEyes.r[1] * sc]; faceW = Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]) * 2.4; res.found = true; res.method = 'manual'; }
  if (!forceEyes) {
    // detector pass at a higher resolution so small faces (full-body shots) are found too
    const scP = Math.min(1, 760 / Math.max(iw, ih)), wp = Math.max(8, Math.round(iw * scP)), hp = Math.max(8, Math.round(ih * scP));
    const cvP = mkCanvas(wp, hp), gP = cvP.getContext('2d', { willReadFrequently: true }); gP.drawImage(img, 0, 0, wp, hp);
    const dP = gP.getImageData(0, 0, wp, hp).data, gray = new Uint8Array(wp * hp);
    for (let i = 0; i < wp * hp; i++) gray[i] = 0.299 * dP[i * 4] + 0.587 * dP[i * 4 + 1] + 0.114 * dP[i * 4 + 2];
    let dets = [];
    try { dets = PICO.detect(gray, wp, hp).map((q) => [q[0] * sc / scP, q[1] * sc / scP, q[2] * sc / scP, q[3]]); } catch (e) { dets = []; }
    let best = null, bs = 0;
    const maxS = dets.reduce((m, d) => Math.max(m, d[2]), 1);
    for (const d of dets) { const sc2 = d[3] * Math.sqrt(d[2] / maxS); if (d[3] >= 1.5 && sc2 > bs) { bs = sc2; best = d; } }
    if (best) {
      const [r, c, sz] = best;
      let a = [c - 0.175 * sz, r - 0.075 * sz], b = [c + 0.175 * sz, r - 0.075 * sz];
      const ra = refineEye(L, w, h, a[0], a[1], 0.085 * sz, 0.06 * sz), rb = refineEye(L, w, h, b[0], b[1], 0.085 * sz, 0.06 * sz);
      const ok = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.07 * sz;
      if (ok(ra, a) && ok(rb, b) && Math.abs(ra[1] - rb[1]) < 0.08 * sz && rb[0] - ra[0] > 0.24 * sz) { a = ra; b = rb; }
      eyeL = a; eyeR = b; faceW = sz * 0.85; res.found = true; res.method = 'finder';
      res.debug = { det: best.map((v) => Math.round(v * 10) / 10), scale: sc };
    }
  }
  if (!res.found) {
  // connected components (8-conn)
  const lab = new Int32Array(w * h).fill(-1); const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (!S[i] || lab[i] >= 0) continue;
    const id = comps.length; let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sx = 0, sy = 0;
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j / w) | 0; n++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx; if (S[k] && lab[k] < 0) { lab[k] = id; stack.push(k); }
      }
    }
    comps.push({ id, n, x0, y0, x1, y1, cx: sx / n, cy: sy / n });
  }
  let best = null, bestScore = 0;
  for (const c of comps) {
    if (c.n < w * h * 0.004) continue;
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1, fill = c.n / (cw * ch), asp = ch / cw;
    const aspS = asp < 0.7 ? asp / 0.7 : asp > 2.6 ? 2.6 / asp : 1;
    const posS = 1 - 0.6 * Math.abs(c.cx / w - 0.5) - 0.35 * clamp(c.cy / h - 0.45, 0, 1);
    const sc2 = Math.sqrt(c.n) * Math.pow(fill, 0.8) * aspS * posS;
    if (sc2 > bestScore) { bestScore = sc2; best = c; }
  }
  if (best) {
    // face width = widest skin row in the upper part of the component
    const rowsW = [];
    for (let y = best.y0; y <= best.y1; y++) {
      let mn = w, mx = -1; for (let x = best.x0; x <= best.x1; x++) if (lab[y * w + x] === best.id) { if (x < mn) mn = x; if (x > mx) mx = x; }
      rowsW.push({ y, mn, mx, wd: mx >= mn ? mx - mn + 1 : 0 });
    }
    const upper = rowsW.slice(0, Math.max(3, Math.round(rowsW.length * 0.6)));
    const widest = upper.reduce((a, b) => (b.wd > a.wd ? b : a), upper[0]);
    faceW = Math.max(6, widest.wd);
    const cxF = (widest.mn + widest.mx) / 2;
    const top = best.y0, Hf = faceW * 1.35;
    // eye line: darkness profile across rows in the band
    const ya = Math.round(top + 0.18 * Hf), yb = Math.round(Math.min(h - 2, top + 0.6 * Hf));
    const xa = Math.round(cxF - faceW * 0.36), xb = Math.round(cxF + faceW * 0.36);
    const prof = [];
    for (let y = ya; y <= yb; y++) {
      let s = 0, n = 0;
      for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) { if (Math.abs(x - cxF) < faceW * 0.07) continue; s += 255 - L[y * w + x]; n++; }
      prof.push(n ? s / n : 0);
    }
    const sm = prof.map((v, i) => (prof[i - 1] ?? v) * 0.25 + v * 0.5 + (prof[i + 1] ?? v) * 0.25);
    const peaks = [];
    for (let i = 1; i < sm.length - 1; i++) if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) peaks.push({ y: ya + i, v: sm[i] });
    peaks.sort((a, b) => b.v - a.v);
    let eyeY = top + 0.42 * Hf;
    if (peaks.length) {
      let pick = peaks[0];
      // a brow sits ~.08 Hf above the eye: prefer the lower of two close strong peaks
      for (const p of peaks.slice(1, 4)) if (p.y > pick.y && p.y - pick.y < 0.16 * Hf && p.v > 0.72 * pick.v) pick = p;
      eyeY = pick.y;
    }
    // eye x per side: darkness-weighted centroid around the eye line
    const side = (sgn) => {
      let bx = 0, bv = -1;
      const x0 = sgn < 0 ? cxF - faceW * 0.42 : cxF + faceW * 0.08, x1 = sgn < 0 ? cxF - faceW * 0.08 : cxF + faceW * 0.42;
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        if (x < 1 || x >= w - 1) continue; let s = 0;
        for (let y = Math.round(eyeY - 1); y <= Math.round(eyeY + 1); y++) if (y > 0 && y < h) s += 255 - L[y * w + x];
        if (s > bv) { bv = s; bx = x; }
      }
      let sw = 0, sx = 0, sy = 0;
      for (let y = Math.round(eyeY - faceW * 0.06); y <= Math.round(eyeY + faceW * 0.06); y++) for (let x = Math.round(bx - faceW * 0.08); x <= Math.round(bx + faceW * 0.08); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue; const v = Math.max(0, 255 - L[y * w + x] - 120); sw += v; sx += x * v; sy += y * v;
      }
      return sw > 0 ? [sx / sw, sy / sw] : [bx, eyeY];
    };
    let a = side(-1), b = side(1);
    const dd = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(dd > faceW * 0.28 && dd < faceW * 0.62 && Math.abs(a[1] - b[1]) < faceW * 0.15)) {
      a = [cxF - faceW * 0.22, eyeY]; b = [cxF + faceW * 0.22, eyeY];
    }
    eyeL = a; eyeR = b; res.found = true;
    res.method = 'skin'; res.debug = { comp: [best.x0, best.y0, best.x1, best.y1, best.n], faceW, cxF, top, eyeY, scale: sc, nComps: comps.length };
  } else {
    eyeL = [w * 0.42, h * 0.36]; eyeR = [w * 0.58, h * 0.36]; faceW = w * 0.3;
  }
  }
  // ---------- body frame from the face: eye distance ≈ 62 mm, head ≈ 3.55 eye distances tall
  const ed = Math.max(3, Math.hypot(eyeR[0] - eyeL[0], eyeR[1] - eyeL[1]));
  const cx = (eyeL[0] + eyeR[0]) / 2, ey = (eyeL[1] + eyeR[1]) / 2;
  const Hh = 3.55 * ed, chin = ey + 1.85 * ed;
  const gather = (x0, y0, x1, y1, keep) => {
    const out = [];
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(w - 1, Math.round(x1)); y1 = Math.min(h - 1, Math.round(y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const p = px(x, y); if (!keep || keep(p, x, y)) out.push(p); }
    return out;
  };
  const faceSkin = median3(gather(cx - ed * 0.75, ey + ed * 0.25, cx + ed * 0.75, ey + ed * 1.05, (p) => isSkinRGB(p[0], p[1], p[2]))) || [205, 160, 130];
  res.faceSkin = faceSkin; res.skin = faceSkin.slice();
  const dS = (p) => Math.abs(p[0] - faceSkin[0]) + Math.abs(p[1] - faceSkin[1]) + Math.abs(p[2] - faceSkin[2]);
  const skinLike = (p) => dS(p) < 75 && isSkinRGB(p[0], p[1], p[2]) || dS(p) < 45;
  const notSkin = (p) => !skinLike(p);
  // person mask: anything unlike the frame border (bottom middle excluded, feet may touch it)
  const border = [];
  const bwid = Math.max(2, Math.round(Math.min(w, h) * 0.025));
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const edge = x < bwid || y < bwid || x >= w - bwid || (y >= h - bwid && (x < w * 0.25 || x > w * 0.75));
    if (edge) border.push(px(x, y));
  }
  const bg = kmeans(border, 6, 8).filter((c) => c.f > 0.03).map((c) => c.c);
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(x, y); let near = false;
    for (const c of bg) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < 1900) { near = true; break; } }
    M[y * w + x] = near ? 0 : 1;
  }
  const isP = (x, y) => M[y * w + x] === 1;
  // feet: last row (below the hips) that still has person pixels near the body axis
  let yFeet = null, cut = false;
  {
    const xs0 = Math.max(0, Math.round(cx - 1.5 * Hh)), xs1 = Math.min(w - 1, Math.round(cx + 1.5 * Hh));
    let last = -1;
    for (let y = Math.round(chin + 3 * Hh); y < h; y++) { let n = 0; for (let x = xs0; x <= xs1; x++) n += M[y * w + x]; if (n > (xs1 - xs0) * 0.02) last = y; }
    if (last > 0) { yFeet = last; cut = last >= h - 2; }
  }
  const span = yFeet ? (yFeet - chin) / Hh : 0;
  // feet touching the bottom edge still count when the body proportions say "whole person"
  res.fullBody = !!(yFeet && span > 4.8 && (!cut || span > 5.4) && span < 8.5);
  const D = res.fullBody ? yFeet - chin : 6.4 * Hh;
  const band = (f0, f1) => [chin + f0 * D, chin + f1 * D];
  const axis = (y0, y1) => {
    let sx = 0, n = 0;
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(h - 1, Math.round(y1)); y += 2) for (let x = Math.max(0, Math.round(cx - 1.4 * Hh)); x <= Math.min(w - 1, Math.round(cx + 1.4 * Hh)); x += 2) if (isP(x, y)) { sx += x; n++; }
    return n ? sx / n : cx;
  };
  const inImg = (y0, y1) => y1 > 0 && y0 < h - 1 && (Math.min(h - 1, y1) - Math.max(0, y0)) > 2;
  const frac = (pts, f) => (pts.length ? pts.filter(f).length / pts.length : 0);
  const regions = {};
  const take = (name, x0, y0, x1, y1) => { regions[name] = [x0 / sc, y0 / sc, x1 / sc, y1 / sc]; return gather(x0, y0, x1, y1, (p, x, y) => isP(x, y)); };
  // torso / top
  const [ty0, ty1] = band(0.09, 0.34), tx = axis(ty0, ty1);
  if (inImg(ty0, ty1)) {
    const pts = take('top', tx - 0.7 * Hh, ty0, tx + 0.7 * Hh, ty1).filter(notSkin);
    if (pts.length > 30) {
      const cl = kmeans(pts, 3, 8); res.top = cl[0].c;
      const c2 = cl.slice(1).find((c) => c.f > 0.16 && Math.abs(c.c[0] - cl[0].c[0]) + Math.abs(c.c[1] - cl[0].c[1]) + Math.abs(c.c[2] - cl[0].c[2]) > 70);
      if (c2) res.top2 = c2.c;
    }
    // sleeves: skin on the shoulders / upper arms / forearms beside the torso
    const [sy0, sy1] = band(0.0, 0.08), [ay0, ay1] = band(0.09, 0.25), [fy0, fy1] = band(0.26, 0.42);
    const sides = (x0, x1, y0, y1, nm) => take(nm + 'L', tx - x1 * Hh, y0, tx - x0 * Hh, y1).concat(take(nm + 'R', tx + x0 * Hh, y0, tx + x1 * Hh, y1));
    const shoulder = frac(sides(0.5, 0.95, sy0, sy1, 'sh'), skinLike), upper = frac(sides(0.72, 1.25, ay0, ay1, 'arm'), skinLike), fore = frac(sides(0.75, 1.35, fy0, fy1, 'fore'), skinLike);
    res.sleeves = { shoulder, upper, fore };
    res.topStyle = shoulder > 0.28 && upper > 0.3 ? 'tank' : upper > 0.28 ? 'tee' : fore > 0.35 ? 'tee' : 'long';
  }
  // pants
  const [py0, py1] = band(0.44, 0.62), [ky0, ky1] = band(0.66, 0.9);
  if (inImg(py0, py1)) {
    const px2 = axis(py0, py1);
    const pts = take('pants', px2 - 0.62 * Hh, py0, px2 + 0.62 * Hh, py1);
    const cloth = pts.filter(notSkin);
    if (cloth.length > 30) res.bottom = kmeans(cloth, 3, 8)[0].c;
    let shin = [];
    if (inImg(ky0, ky1)) shin = take('shins', px2 - 0.8 * Hh, ky0, px2 + 0.8 * Hh, ky1);
    const bare = frac(shin, skinLike);
    // silhouette width across the shins (both legs), in head heights
    let wsum = 0, wn = 0;
    for (let y = Math.max(0, Math.round(ky0)); y <= Math.min(h - 1, Math.round(ky1)); y += 2) {
      let mn = 1e9, mx = -1; for (let x = Math.max(0, Math.round(px2 - 1.4 * Hh)); x <= Math.min(w - 1, Math.round(px2 + 1.4 * Hh)); x++) if (isP(x, y)) { if (x < mn) mn = x; if (x > mx) mx = x; }
      if (mx > mn) { wsum += (mx - mn) / Hh; wn++; }
    }
    const width = wn ? wsum / wn : 1;
    const b = res.bottom || [60, 70, 90], mxc = Math.max(...b), mnc = Math.min(...b), sat = (mxc - mnc) / (mxc + 1e-6);
    const hue = (() => { const [r, g2, bb] = b; if (mxc === mnc) return 0; let hh = mxc === r ? (g2 - bb) / (mxc - mnc) : mxc === g2 ? 2 + (bb - r) / (mxc - mnc) : 4 + (r - g2) / (mxc - mnc); hh *= 60; return hh < 0 ? hh + 360 : hh; })();
    const denim = (hue > 190 && hue < 235 && sat > 0.1 && sat < 0.65) || (sat < 0.12 && lum(b) > 60 && lum(b) < 190);
    const khaki = hue > 25 && hue < 110 && sat > 0.14;
    res.pantsWidth = width;
    res.bottomStyle = bare > 0.35 && shin.length ? 'jorts' : width > 1.12 ? (khaki ? 'cargo' : 'baggy') : denim ? 'flare' : 'track';
    if (res.bottomStyle === 'jorts') { const [qy0, qy1] = band(0.88, 0.93); const so = take('socks', px2 - 0.7 * Hh, qy0, px2 + 0.7 * Hh, qy1).filter((p) => lum(p) > 170); if (so.length > 10) res.sock = median3(so); }
  }
  // shoes + sole
  if (res.fullBody) {
    const [fy0, fy1] = band(0.93, 1.0), fx = axis(fy0 - 0.05 * D, fy1);
    const pts = take('shoes', fx - 0.85 * Hh, fy0, fx + 0.85 * Hh, fy1 + 2).filter(notSkin);
    if (pts.length > 20) {
      const cl = kmeans(pts, 3, 8); res.shoes = cl[0].c;
      const light = cl.filter((c) => lum(c.c) > 165 && c.f > 0.1).sort((a2, b2) => lum(b2.c) - lum(a2.c))[0];
      if (light && light !== cl[0]) res.sole = light.c;
    }
  }
  // hair colour: what dominates just above the forehead
  const hp = gather(cx - ed * 1.1, ey - ed * 2.6, cx + ed * 1.1, ey - ed * 1.1, notSkin)
    .concat(gather(cx - ed * 1.55, ey - ed * 1.2, cx - ed * 1.2, ey - ed * 0.2, notSkin), gather(cx + ed * 1.2, ey - ed * 1.2, cx + ed * 1.55, ey - ed * 0.2, notSkin));
  const near = gather(cx - ed * 0.9, ey - ed * 1.9, cx + ed * 0.9, ey - ed * 1.15, notSkin);
  let hair = [52, 38, 30];
  if (hp.length > 20) {
    const cl = kmeans(hp, 3, 8), ref = kmeans(near.length > 8 ? near : hp, 2, 6)[0].c;
    hair = cl.reduce((a2, b2) => { const da = (a2.c[0] - ref[0]) ** 2 + (a2.c[1] - ref[1]) ** 2 + (a2.c[2] - ref[2]) ** 2, db = (b2.c[0] - ref[0]) ** 2 + (b2.c[1] - ref[1]) ** 2 + (b2.c[2] - ref[2]) ** 2; return db < da ? b2 : a2; }).c;
  }
  res.hair = hair;
  const hd = (p) => Math.abs(p[0] - hair[0]) + Math.abs(p[1] - hair[1]) + Math.abs(p[2] - hair[2]) < 70;
  const sideP = gather(cx - ed * 1.9, ey + ed * 1.2, cx - ed * 1.25, ey + ed * 3.2).concat(gather(cx + ed * 1.25, ey + ed * 1.2, cx + ed * 1.9, ey + ed * 3.2));
  res.hairStyle = frac(sideP, hd) > 0.4 ? 'long' : 'spiky';
  // sunglasses: eye boxes far darker than the cheeks
  {
    const eyeL2 = gather(eyeL[0] - ed * 0.25, eyeL[1] - ed * 0.12, eyeL[0] + ed * 0.25, eyeL[1] + ed * 0.12).map(lum), eyeR2 = gather(eyeR[0] - ed * 0.25, eyeR[1] - ed * 0.12, eyeR[0] + ed * 0.25, eyeR[1] + ed * 0.12).map(lum);
    const cheek = gather(cx - ed * 0.7, ey + ed * 0.45, cx + ed * 0.7, ey + ed * 0.8).map(lum);
    const avg = (a2) => (a2.length ? a2.reduce((q, v) => q + v, 0) / a2.length : 0);
    res.shades = avg(eyeL2.concat(eyeR2)) < 0.45 * avg(cheek);
  }
  res.regions = regions; res.scale = sc;
  const inv = 1 / sc;
  res.eyes = { l: [eyeL[0] * inv, eyeL[1] * inv], r: [eyeR[0] * inv, eyeR[1] * inv] };
  res.body = { chin: chin * inv, feet: yFeet == null ? null : yFeet * inv, head: Hh * inv, cx: cx * inv };
  return res;
}

// ---------------------------------------------------------------- body reader: MediaPipe Pose (landmarks + person mask), loaded on demand
// MediaPipe Pose © Google, Apache-2.0 — fetched from a CDN only when a photo is analysed.
const POSE_CFG = { base: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/', complexity: 1 };
let posePromise = null;
function loadPose() {
  if (posePromise) return posePromise;
  posePromise = new Promise((resolve, reject) => {
    const ready = () => {
      try {
        const p = new window.Pose({ locateFile: (f) => POSE_CFG.base + f });
        p.setOptions({ staticImageMode: true, modelComplexity: POSE_CFG.complexity, enableSegmentation: true, smoothSegmentation: false, minDetectionConfidence: 0.3 });
        resolve(p);
      } catch (e) { reject(e); }
    };
    if (window.Pose) return ready();
    const s = document.createElement('script');
    s.src = POSE_CFG.base + 'pose.js'; s.crossOrigin = 'anonymous';
    s.onload = ready; s.onerror = () => { posePromise = null; reject(new Error('pose model unavailable')); };
    document.head.appendChild(s);
  });
  return posePromise;
}
// one image at a time through the model
let poseQueue = Promise.resolve();
function detectPose(canvas) {
  const run = poseQueue.then(() => detectPoseNow(canvas));
  poseQueue = run.catch(() => {});
  return run;
}
async function detectPoseNow(canvas) {
  const pose = await loadPose();
  // the model keeps state between images (a new size after another photo can come back empty): reset, and retry once
  const once = () => new Promise((resolve, reject) => { pose.onResults(resolve); pose.send({ image: canvas }).catch(reject); });
  if (typeof pose.reset === 'function') pose.reset();
  let res = await once();
  if (!res || !res.poseLandmarks) res = await once();
  if (!res || !res.poseLandmarks) return null;
  const W = canvas.width, H = canvas.height;
  const lm = res.poseLandmarks.map((p) => [p.x * W, p.y * H, p.visibility == null ? 1 : p.visibility]);
  let mask = null;
  if (res.segmentationMask) {
    const c = mkCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(res.segmentationMask, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data; mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = d[i * 4] > 127 ? 1 : 0;
  }
  return { lm, mask, W, H };
}

// ---------------------------------------------------------------- colour helpers
const rgbHsv = (c) => {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d > 1e-6) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx > 0 ? d / mx : 0, mx];
};
const cdist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
const avgc = (px) => { if (!px.length) return null; const s = [0, 0, 0]; for (const p of px) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map((v) => Math.round(v / px.length)); };
function colorName(c) {
  const [h, s, v] = rgbHsv(c);
  if (v < 0.09 || (v < 0.2 && s < 0.45) || (v < 0.27 && s < 0.18)) return 'black';
  if (v < 0.3 && s >= 0.45) return h >= 195 && h < 260 ? 'navy' : h < 20 || h >= 330 ? 'maroon' : h < 45 ? 'brown' : h < 170 ? 'dark green' : h < 195 ? 'dark teal' : 'dark purple';
  if (s < 0.14) return v > 0.82 ? 'white' : v > 0.55 ? 'light grey' : v > 0.32 ? 'grey' : 'charcoal';
  if (h < 15 || h >= 345) return v < 0.45 ? 'maroon' : 'red';
  if (h < 40) return s < 0.45 && v < 0.6 ? 'brown' : v > 0.75 && s < 0.5 ? 'beige' : 'orange';
  if (h < 65) return s < 0.4 ? 'khaki' : 'yellow';
  if (h < 160) return s < 0.35 ? 'olive' : 'green';
  if (h < 200) return 'teal';
  if (h < 250) return s < 0.35 ? 'denim' : 'blue';
  if (h < 290) return 'purple';
  return 'pink';
}

// ---------------------------------------------------------------- the reader
// img: analysis canvas (<=1600px); P: {lm: 33 × [x, y, visibility] in pixels, mask: Uint8Array person mask}
function readPerson(img, P) {
  const W = img.width, H = img.height, g = img.getContext('2d', { willReadFrequently: true });
  const D = g.getImageData(0, 0, W, H).data, M = P.mask;
  const px = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return [D[i], D[i + 1], D[i + 2], x | 0, y | 0]; };
  const inImg = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const inP = (x, y) => inImg(x, y) && (M ? M[(y | 0) * W + (x | 0)] === 1 : true);
  const LM = P.lm, pt = (i) => [LM[i][0], LM[i][1]], vis = (i) => LM[i][2];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
  const frac = (a, f) => (a.length ? a.filter(f).length / a.length : 0);
  // base colour of a garment: per-channel median of the pixels around its main cluster (highlights and shade cancel out)
  // dark achromatic fabric in daylight reads lighter than it is (sheen): pull it back toward black
  const albedo = (c) => { const [, sat] = rgbHsv(c), l = lum(c); if (sat > 0.22 || l > 140) return c; const k = Math.max(22 / Math.max(1, l), lerp(0.62, 1, smooth(30, 140, l))); return c.map((v) => Math.round(v * Math.min(1, k))); };
  // base colour of a garment: clusters that differ only by light (linked within ~80, same chroma) are one fabric;
  // per-channel median over that group, then the dark-fabric correction
  const chromD = (a, b) => { const sa = a[0] + a[1] + a[2] + 1, sb = b[0] + b[1] + b[2] + 1; return Math.hypot(a[0] / sa - b[0] / sb, a[1] / sa - b[1] / sb); };
  // two colours of one fabric under different light: same hue (saturated), or close greys
  const link = (a, b) => {
    const [ha, sa, va] = rgbHsv(a), [hb, sb, vb] = rgbHsv(b), dh = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb));
    if (sa > 0.25 && sb > 0.25 && va > 0.08 && vb > 0.08) return dh < 26;
    return cdist(a, b) < 110 && (lum(a) < 45 || lum(b) < 45 || chromD(a, b) < 0.04);
  };
  const baseFrom = (pxs, cl) => {
    if (!cl.length) return { c: [30, 30, 32], f: 0 };
    const grp = [cl[0]]; let grew = true;
    while (grew) { grew = false; for (const c of cl) { if (grp.includes(c)) continue; if (grp.some((q) => link(q.c, c.c))) { grp.push(c); grew = true; } } }
    const mine = pxs.filter((p) => { let bi = null, bd = 1e18; for (const c of cl) { const d = cdist(p, c.c); if (d < bd) { bd = d; bi = c; } } return grp.includes(bi); });
    let m = median3(mine) || cl[0].c;
    if (mine.length > 10 && rgbHsv(m)[1] < 0.22 && lum(m) < 110) { const srt = mine.slice().sort((a, b) => lum(a) - lum(b)); m = avgc(srt.slice(Math.floor(srt.length * 0.28), Math.floor(srt.length * 0.42) + 1)); }
    return { c: albedo(m), f: grp.reduce((a, c) => a + c.f, 0) };
  };
  const garment = (pxs, k) => baseFrom(pxs, kmeans(pxs, k || 3, 8));
  const out = { method: 'pose', regions: {}, read: [] };
  const reg = (name, poly) => { out.regions[name] = poly.map((p) => [Math.round(p[0]), Math.round(p[1])]); };
  const polyPx = (poly, name, keep) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0; for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const res = [];
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, x1); x++) {
      if (!inside(x + 0.5, y + 0.5) || !inP(x, y)) continue; const p = px(x, y); if (!keep || keep(p, x, y)) res.push(p);
    }
    if (name) reg(name, poly);
    return res;
  };
  // quad around the segment a→b between fractions t0..t1 with half-width hw
  const band = (a, b, t0, t1, hw) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * hw, ny = (dx / len) * hw;
    const p0 = lerp2(a, b, t0), p1 = lerp2(a, b, t1);
    return [[p0[0] + nx, p0[1] + ny], [p1[0] + nx, p1[1] + ny], [p1[0] - nx, p1[1] - ny], [p0[0] - nx, p0[1] - ny]];
  };
  const bandPx = (a, b, t0, t1, hw, name, keep) => polyPx(band(a, b, t0, t1, hw), name, keep);

  // ---- frame
  const eA = pt(2), eB = pt(5), eyeC = mid(eA, eB), mouthC = mid(pt(9), pt(10));
  // eye distance foreshortens when the head turns, eye→mouth when it nods: take the larger
  const ed = Math.max(4, dist(eA, eB), dist(eyeC, mouthC) / 1.1);
  const shL = pt(11), shR = pt(12), hipL = pt(23), hipR = pt(24);
  const sw = Math.max(ed * 2, dist(shL, shR)), shC = mid(shL, shR), hipC = mid(hipL, hipR), torsoLen = Math.max(ed * 3, dist(shC, hipC));
  out.eyes = { l: eB[0] < eA[0] ? eB : eA, r: eB[0] < eA[0] ? eA : eB };
  // head space: a across the face, b down it (eyes → mouth), both in eye distances; tilted heads read the same
  let U = [mouthC[0] - eyeC[0], mouthC[1] - eyeC[1]];
  { const l = Math.hypot(U[0], U[1]); U = l > 1 ? [U[0] / l, U[1] / l] : [0, 1]; if (U[1] < 0.64) U = [0, 1]; }
  const Rv = [U[1], -U[0]];
  const hp = (a, b) => [eyeC[0] + (Rv[0] * a + U[0] * b) * ed, eyeC[1] + (Rv[1] * a + U[1] * b) * ed];
  const hbox = (a0, a1, b0, b1) => [hp(a0, b0), hp(a1, b0), hp(a1, b1), hp(a0, b1)];
  const mouthB = Math.max(0.8, Math.min(1.4, dist(eyeC, mouthC) / ed));
  const shB = ((shC[0] - eyeC[0]) * U[0] + (shC[1] - eyeC[1]) * U[1]) / ed;
  // hands and forearms get in the way (hands on the head, in pockets…): keep them out of the samples
  const limbs = [];
  for (const [wr, pk, ix, th, el] of [[15, 17, 19, 21, 13], [16, 18, 20, 22, 14]]) {
    if (vis(wr) < 0.3) continue;
    const W0 = pt(wr), K = mid(pt(pk), pt(ix)), dK = dist(W0, K) || 1;
    const tip = lerp2(W0, K, 1 + Math.max(0.9 * ed, dK * 0.85) / dK);
    limbs.push([W0, tip, ed * 0.75], [W0, lerp2(W0, pt(th), 1.3), ed * 0.45], [pt(el), W0, ed * 0.7]);
  }
  const nearLimb = (x, y) => { for (const [a, b, r] of limbs) if (segD([x, y], a, b) < r) return true; return false; };
  const body = (p, x, y) => !nearLimb(x, y);
  const hIn = (a, b) => { const q = hp(a, b); return inP(q[0], q[1]) && !nearLimb(q[0], q[1]); };
  const hPx = (a, b) => { const q = hp(a, b); return px(q[0], q[1]); };
  const st = Math.min(0.25, 1 / ed);

  // ---- skin reference from the cheeks; the test is chromatic so lit and shaded skin both count
  const chrom = (p) => { const s = p[0] + p[1] + p[2] + 1; return [p[0] / s, p[1] / s]; };
  const face = polyPx([hp(-0.8, 0.25), hp(0.8, 0.25), hp(0.6, 0.95), hp(-0.6, 0.95)], 'face', body);
  let skinRef = null;
  if (face.length > 12) {
    const cl = kmeans(face, 3, 8).filter((c) => c.f > 0.12);
    const sk = cl.filter((c) => isSkinRGB(c.c[0], c.c[1], c.c[2]));
    skinRef = (sk.length ? sk : cl).sort((a, b) => b.n - a.n)[0].c;
  }
  if (!skinRef) skinRef = [205, 160, 130];
  const refCh = chrom(skinRef), refL = lum(skinRef);
  const isSk0 = (p) => { const l = lum(p); if (l < Math.max(22, refL * 0.42)) return false; const c = chrom(p), d = Math.hypot(c[0] - refCh[0], c[1] - refCh[1]); return d < 0.03 || (d < 0.065 && isSkinRGB(p[0], p[1], p[2])); };
  let clothSkinLike = [];   // garment colours that look like skin (beige, tan): pixels near them aren't skin
  const isSk = (p) => { if (!isSk0(p)) return false; for (const c of clothSkinLike) if (cdist(p, c) < 34 && cdist(p, c) < cdist(p, skinRef)) return false; return true; };
  const notSk = (p, x, y) => !isSk(p) && !nearLimb(x, y);
  // the hairline is judged against the cheeks (same light as the forehead; blond and light-brown hair still differ)
  const cheekPx = face.filter(isSk), fC = cheekPx.length > 10 ? median3(cheekPx) : null;
  const isSkHead = (p) => (fC ? cdist(p, fC) < 46 && lum(p) > lum(fC) * 0.68 && lum(p) < lum(fC) * 1.35 + 10 : isSk(p));

  // ---- head: top of the silhouette, where the forehead ends, what covers it (all in head space)
  let topB = -1.8;
  for (let b = -4; b < 0; b += st) { let n = 0, m = 0; for (let a = -0.7; a <= 0.7; a += st) { m++; if (hIn(a, b)) n++; } if (n > m * 0.3) { topB = b; break; } }
  // the scan starts above brows and glasses: forehead = brow line up to where skin stops
  const browB = -0.32, scan0 = -0.75;
  let coverB = topB;
  for (let b = scan0; b > topB; b -= st) {
    let sk = 0, n = 0; for (let a = -0.45; a <= 0.45; a += st) { if (!hIn(a, b)) continue; n++; if (isSkHead(hPx(a, b))) sk++; }
    if (n && sk / n < 0.35) { coverB = b; break; }
  }
  const forehead = browB - coverB, capH = coverB - topB;
  const extra = -1.85 - topB;   // silhouette above where the skull should end
  const capPx = polyPx(hbox(-1.05, 1.05, topB, coverB + 0.05), 'head', notSk);
  let capC = null, capStd = 99, capF = 0;
  if (capPx.length > 20) {
    const gc = garment(capPx, 3); capC = gc.c; capF = gc.f;
    const ls = capPx.filter((p) => cdist(p, capC) < 70).map(lum), m = ls.reduce((a, b) => a + b, 0) / Math.max(1, ls.length);
    capStd = Math.sqrt(ls.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ls.length));
  }
  let edgeVar = 1;
  { const bs = [], b0 = scan0;
    for (let a = -0.6; a <= 0.6; a += st) { for (let b = b0; b > topB; b -= st) { if (!hIn(a, b)) continue; if (!isSkHead(hPx(a, b))) { bs.push(b); break; } } }
    if (bs.length > 4) { bs.sort((x, y) => x - y); const m = bs[bs.length >> 1], dev = bs.map((v) => Math.abs(v - m)).sort((x, y) => x - y); edgeVar = dev[dev.length >> 1] * 1.4826 + 0.5 / ed; } }
  const widthAt = (b) => { let mn = 1e9, mx = -1e9; for (let a = -2.6; a <= 2.6; a += st) { if (!hIn(a, b)) continue; if (a < mn) mn = a; if (a > mx) mx = a; } return mx > mn ? mx - mn : 0; };
  const brimW = widthAt(coverB - 0.08), crownW = widthAt(coverB - 0.85), headW = widthAt(-0.9);
  // the top's colour (needed for the hood test): middle of the torso, all pixels
  const tq = (f0, f1, inset) => { const a = lerp2(shL, hipL, f0), b = lerp2(shR, hipR, f0), c = lerp2(shR, hipR, f1), d = lerp2(shL, hipL, f1); return [lerp2(a, b, inset), lerp2(b, a, inset), lerp2(c, d, inset), lerp2(d, c, inset)]; };
  const torso = polyPx(tq(0.22, 0.9, 0.08), 'top', body);
  const torsoCl = torso.length > 30 ? kmeans(torso, 4, 10) : [];
  let topC = torsoCl.length ? baseFrom(torso, torsoCl).c : [30, 30, 32];
  if (isSk0(topC) && cdist(topC, skinRef) > 18) clothSkinLike.push(topC);
  const capHS = capC ? rgbHsv(capC) : [0, 0, 0];
  const hairish = !!capC && ((capHS[0] > 6 && capHS[0] < 52 && capHS[1] < 0.85) || capHS[2] < 0.36 || (capHS[1] < 0.15 && capHS[2] < 0.75));
  const sidePx = polyPx(hbox(-1.6, -1.05, 0, 1.6), 'sideL', body).concat(polyPx(hbox(1.05, 1.6, 0, 1.6), 'sideR', body));
  const hoodLike = !!capC && cdist(capC, topC) < 45 && sidePx.length > 20 && frac(sidePx, (p) => cdist(p, topC) < 50) > 0.45;
  let hwScore = 0;
  hwScore += forehead < 0.45 ? 1 : forehead < 0.7 ? 0.4 : 0;
  hwScore += edgeVar < 0.09 ? 1 : edgeVar < 0.12 ? 0.5 : 0;
  hwScore += extra > 1.0 ? 1.5 : extra > 0.85 ? 1 : extra > 0.6 ? 0.5 : 0;
  hwScore += hairish ? 0 : 1.6;
  hwScore += capStd < 30 ? 0.4 : 0;
  if (ed < 14 && hairish) hwScore -= 1.5;
  let headwear = 'none';
  if (hoodLike && capH > 0.5) headwear = 'hood';
  else if (capC && capPx.length > 40 && hwScore >= 2.8 && (forehead < 0.6 || extra > 0.6) && !isSk0(capC)) {
    const brim = crownW > 0 ? brimW / crownW : 1;
    headwear = brim > 1.32 && extra < 1.1 ? 'bucket' : brim > 1.2 && extra < 0.9 ? 'cap' : 'beanie';
  }
  out.headwear = headwear; out.headwearC = headwear !== 'none' ? capC : null;
  out.hatSlouch = headwear === 'beanie' ? +clamp((extra - 0.7) / 0.6, 0, 1).toFixed(2) : 0;
  out.headDbg = { forehead: +forehead.toFixed(2), capH: +capH.toFixed(2), edgeVar: +edgeVar.toFixed(3), capStd: Math.round(capStd), capF: +capF.toFixed(2), brimW: +brimW.toFixed(2), crownW: +crownW.toFixed(2), headW: +headW.toFixed(2), hairish, extra: +extra.toFixed(2), score: +hwScore.toFixed(1), tilt: Math.round((Math.atan2(-U[0], U[1]) * 180) / Math.PI) };

  // ---- hair
  let hairC = null, hairStyle = 'short';
  {
    const hatC = out.headwearC;
    const notHat = (p) => !hatC || cdist(p, hatC) > 42;
    const sideBox = (a0, a1, b0, b1) => polyPx(hbox(a0, a1, b0, b1), null, (p, x, y) => notSk(p, x, y) && notHat(p) && cdist(p, topC) > 30);
    const sides = sideBox(-1.7, -1.0, -0.6, 1.2).concat(sideBox(1.0, 1.7, -0.6, 1.2));
    const pool = headwear === 'none' ? capPx.concat(sides) : sides;
    if (pool.length > ed * ed * 0.5) hairC = garment(pool, 3).c;
    if (!hairC && headwear === 'none' && capC) hairC = capC;
    // length: hair colour continuing below the jaw toward the shoulders
    const b1 = Math.max(1.8, shB - 0.2);
    const low = sideBox(-1.8, -0.9, 1.6, b1).concat(sideBox(0.9, 1.8, 1.6, b1));
    const lowAll = polyPx(hbox(-1.8, 1.8, 1.6, b1), null, body);
    const longF = hairC && lowAll.length ? low.filter((p) => cdist(p, hairC) < 40).length / lowAll.length : 0;
    if (headwear === 'none') {
      const vol = headW / 2.9;
      if (capH < 0.3) hairStyle = 'none';
      else if (longF > 0.3) hairStyle = 'long';
      else if (vol > 1.5 && extra > 0.9) hairStyle = 'afro';
      else if (forehead < 0.45) hairStyle = edgeVar > 0.14 ? 'messy' : 'curtains';
      else if (extra < 0.15) hairStyle = 'buzz';
      else if (extra > 0.5) hairStyle = edgeVar > 0.2 ? 'messy' : 'spiky';
      else hairStyle = 'short';
    } else hairStyle = longF > 0.3 ? 'long' : 'short';
    out.hairLong = +longF.toFixed(2);
  }
  out.hairC = hairC || [44, 34, 30]; out.hairStyle = hairStyle;

  // ---- shades
  {
    const eyePx = polyPx(hbox(-0.85, 0.85, -0.18, 0.18), null, body);
    const lm2 = (a) => (a.length ? a.reduce((s, p) => s + lum(p), 0) / a.length : 0);
    out.shades = eyePx.length > 10 && lm2(eyePx) < lm2(face) * 0.45;
  }

  // ---- beard: the chin and upper lip clearly darker than the cheeks, in hair-like colours
  {
    const cheek = face.filter(isSk), cls = cheek.map(lum).sort((a, b) => a - b), cl = cls.length ? cls[cls.length >> 1] : lum(skinRef);
    const chin = polyPx(hbox(-0.45, 0.45, mouthB + 0.28, mouthB + 0.62), 'chin', body), lip = polyPx(hbox(-0.32, 0.32, mouthB - 0.2, mouthB - 0.07), null, body);
    const dark = (a) => frac(a, (p) => lum(p) < cl * 0.62 && rgbHsv(p)[1] < 0.55);
    const dc = dark(chin), dl = dark(lip);
    const c70 = frac(chin, (p) => lum(p) < cl * 0.7 && rgbHsv(p)[1] < 0.6), l70 = frac(lip, (p) => lum(p) < cl * 0.7 && rgbHsv(p)[1] < 0.6);
    const okF = cheek.length > 10 && chin.length > 8 && lip.length > 4;
    out.beard = okF && l70 > 0.5 && c70 > 0.35 ? 'beard' : okF && l70 > 0.3 && c70 > 0.2 ? 'stubble' : 'none';
    const dk = (a, k) => +frac(a, (p) => lum(p) < cl * k && rgbHsv(p)[1] < 0.6).toFixed(2);
    out.beardDbg = { chin: +dc.toFixed(2), lip: +dl.toFixed(2), c70: dk(chin, 0.7), l70: dk(lip, 0.7), c78: dk(chin, 0.78), l78: dk(lip, 0.78), cheekL: Math.round(cl) };
  }

  // ---- top: colour, print, sleeves, fit, jacket / hoodie
  let top2C = null, print = false;
  if (torsoCl.length) {
    const axisX = (y) => { const f = clamp((y - shC[1]) / ((hipC[1] - shC[1]) || 1), 0, 1); return lerp(shC[0], hipC[0], f); };
    const inCentre = (p) => Math.abs(p[3] - axisX(p[4])) < sw * 0.22 && p[4] < shC[1] + (hipC[1] - shC[1]) * 0.68;
    const fa = frac(torso, inCentre);
    for (const c of torsoCl.slice(1)) {
      if (c.f < 0.04 || c.f > 0.55 || cdist(c.c, topC) < 85 || cdist(c.c, torsoCl[0].c) < 85) continue;
      const mine = torso.filter((p) => cdist(p, c.c) < cdist(p, torsoCl[0].c));
      const fc = frac(mine, inCentre);
      if (fc > 0.55 && fc > fa * 1.35) { top2C = c.c; print = true; break; }
    }
  }
  const armHW = Math.max(2, Math.round(ed * 0.42));
  const isSkArm = (p, x, y) => isSk(p) && cdist(p, topC) > 38;
  const sleeve = (iS, iE, iW, nm) => {
    const S = pt(iS), E = pt(iE), Wr = pt(iW);
    const f = (a, b, t0, t1, n) => frac(polyPx(band(a, b, t0, t1, armHW), n, (p, x, y) => !limbs.some(([la, lb, r], k) => k % 3 !== 2 && segD([x, y], la, lb) < r)), isSkArm);
    return { cap: f(S, E, 0.0, 0.2, nm + 'Cap'), upper: f(S, E, 0.3, 0.92, nm + 'Up'), fore: f(E, Wr, 0.12, 0.75, nm + 'Fore'), ok: Math.min(vis(iS), vis(iE), vis(iW)) > 0.5 };
  };
  const aL = sleeve(11, 13, 15, 'armL'), aR = sleeve(12, 14, 16, 'armR');
  const both = [aL, aR].filter((a) => a.ok), arms = both.length ? both : [aL, aR];
  const av = (k) => arms.reduce((s, a) => s + a[k], 0) / arms.length;
  const capS = av('cap'), upS = av('upper'), foS = av('fore');
  // torso silhouette width (arms excluded) at a fraction of the shoulder→hip line
  const armCaps = [[lerp2(shL, pt(13), 0.3), pt(13)], [pt(13), pt(15)], [lerp2(shR, pt(14), 0.3), pt(14)], [pt(14), pt(16)]];
  const armR = Math.max(ed * 0.75, sw * 0.13);
  const inArm = (x, y) => armCaps.some(([a, b]) => segD([x, y], a, b) < armR);
  const torsoW = (f) => {
    const c = lerp2(shC, hipC, f), ax = hipC[0] - shC[0], ay = hipC[1] - shC[1], l = Math.hypot(ax, ay) || 1, nx = -ay / l, ny = ax / l;
    let w = 0;
    for (const s of [1, -1]) { let o = 0; for (let k = 1; k < sw * 1.2; k++) { const x = c[0] + nx * k * s, y = c[1] + ny * k * s; if (!inP(x, y) || inArm(x, y)) break; o = k; } w += o; }
    return w;
  };
  const chestW = torsoW(0.3), waistW = torsoW(0.72), hipW = torsoW(1.0);
  // sleeve opening width (oversized tees have wide sleeves)
  const sleeveW = (S, E) => {
    const c = lerp2(S, E, 0.3), dx = E[0] - S[0], dy = E[1] - S[1], l = Math.hypot(dx, dy) || 1; let nx = -dy / l, ny = dx / l;
    if ((c[0] - shC[0]) * nx + (c[1] - (shC[1] + hipC[1]) / 2) * ny < 0) { nx = -nx; ny = -ny; }   // point away from the torso
    let o = 0; for (let k = 1; k < ed * 2; k++) { const x = c[0] + nx * k, y = c[1] + ny * k; if (!inP(x, y)) break; o = k; }
    return (2 * o) / ed;
  };
  const slW = Math.min(sleeveW(shL, pt(13)), sleeveW(shR, pt(14)));
  let topType;
  if (capS > 0.5 && upS > 0.55) topType = 'tank';
  else if (foS > 0.45) topType = upS > 0.45 && chestW / sw < 1.3 ? 'fitted' : 'tee';
  else topType = 'long';
  // open jacket / layers: under the neckline the centre shows another colour than both shoulder panels,
  // and further down the centre is either hidden (arms) or still different
  let jacket = null;
  if (topType === 'long') {
    const at = (u0, u1, f0, f1) => { const q = [lerp2(lerp2(shL, shR, u0), lerp2(hipL, hipR, u0), f0), lerp2(lerp2(shL, shR, u1), lerp2(hipL, hipR, u1), f0), lerp2(lerp2(shL, shR, u1), lerp2(hipL, hipR, u1), f1), lerp2(lerp2(shL, shR, u0), lerp2(hipL, hipR, u0), f1)]; return polyPx(q, null, (p, x, y) => body(p, x, y) && !inArm(x, y) && !isSk(p)); };
    const cU = at(0.28, 0.72, 0.04, 0.34), pA = at(0.02, 0.22, 0.06, 0.4), pB = at(0.78, 0.98, 0.06, 0.4), cD = at(0.3, 0.7, 0.45, 0.85);
    const mc = (a) => (a.length > 8 ? garment(a, 2).c : null);
    const a2 = mc(pA), b2 = mc(pB);
    const outer = a2 && b2 ? (cdist(a2, b2) < 55 || link(a2, b2) ? avgc([a2, b2]) : cdist(a2, topC) < cdist(b2, topC) ? a2 : b2) : a2 || b2;
    let cu = null;
    if (outer && cU.length > 12) {
      // the inner layer: the biggest cluster of the centre that isn't the outer fabric
      const all = kmeans(cU, 3, 8), cl = all.filter((c) => c.f > 0.12 && cdist(c.c, outer) > 70 && !link(c.c, outer));
      if (cl.length) {
        const low = at(0.28, 0.72, 0.24, 0.34), inn = cl[0].c;
        if (frac(low, (p) => cdist(p, inn) < cdist(p, outer)) > 0.08) cu = baseFrom(cU, [cl[0]].concat(all.filter((c) => c !== cl[0]))).c;
      }
    }
    const cd = mc(cD);
    if (cu && outer) jacket = { outer, inner: cu };
    out.jackDbg = [cu, a2, b2, cd].map((c) => (c ? colorName(c) : '-')).join(' / ');
  }
  if (jacket) { topType = 'jacket'; topC = jacket.outer; top2C = jacket.inner; print = false; }
  else if (topType === 'long') {
    // a hood lying on the back shows as fabric beside the neck, above the shoulder line
    const ring = polyPx([[eyeC[0] - ed * 1.5, shC[1] - ed * 0.7], [eyeC[0] - ed * 0.6, shC[1] - ed * 0.7], [eyeC[0] - ed * 0.6, shC[1] - ed * 0.25], [eyeC[0] - ed * 1.5, shC[1] - ed * 0.25]], 'hoodL', body)
      .concat(polyPx([[eyeC[0] + ed * 0.6, shC[1] - ed * 0.7], [eyeC[0] + ed * 1.5, shC[1] - ed * 0.7], [eyeC[0] + ed * 1.5, shC[1] - ed * 0.25], [eyeC[0] + ed * 0.6, shC[1] - ed * 0.25]], 'hoodR', body));
    const area = 2 * 0.9 * 0.45 * ed * ed;
    if (ring.length > area * 0.5 && frac(ring, (p) => cdist(p, topC) < 45) > 0.6) topType = 'hoodie';
  }
  out.top = topType; out.topC = topC; out.top2C = top2C; out.print = print;
  out.topDbg = { cap: +capS.toFixed(2), upper: +upS.toFixed(2), fore: +foS.toFixed(2), chest: +(chestW / sw).toFixed(2), sleeveW: +slW.toFixed(2) };

  // ---- chain / pendant: thin bright lines and a bright plate on the chest, against a darker top
  {
    const V = [[shC[0] - sw * 0.26, shC[1] - ed * 0.25], [shC[0] + sw * 0.26, shC[1] - ed * 0.25], [shC[0] + sw * 0.07, shC[1] + torsoLen * 0.48], [shC[0] - sw * 0.07, shC[1] + torsoLen * 0.48]];
    const all = polyPx(V, 'neck', body).filter((p) => !isSk(p));
    const ls = all.map(lum).sort((a, b) => a - b), med = ls.length ? ls[Math.floor(ls.length * 0.5)] : 255;
    const topSat = rgbHsv(topC)[1];
    const isMetal = (p) => { const [h, s] = rgbHsv(p); return lum(p) > med + 42 && (s < 0.16 || (h > 32 && h < 58 && s > 0.35 && s < 0.8 && Math.abs(rgbHsv(topC)[0] - h) > 20)); };
    const metal = all.filter(isMetal);
    // pendant: the largest solid patch of candidates (eroded once so the thin chain drops out)
    const key = (x, y) => y * W + x, set = new Set(metal.map((p) => key(p[3], p[4])));
    const core = new Set(); for (const k of set) if (set.has(k - 1) && set.has(k + 1) && set.has(k - W) && set.has(k + W)) core.add(k);
    const seen = new Set(); let blob = [];
    for (const k0 of core) {
      if (seen.has(k0)) continue; const comp = [], st = [k0]; seen.add(k0);
      while (st.length) { const k = st.pop(); comp.push(k); for (const kk of [k - 1, k + 1, k - W, k + W, k - W - 1, k - W + 1, k + W - 1, k + W + 1]) if (core.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } }
      if (comp.length > blob.length) blob = comp;
    }
    let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1; for (const k of blob) { const x = k % W, y = (k / W) | 0; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const bFill = blob.length / Math.max(1, (bx1 - bx0 + 1) * (by1 - by0 + 1));
    const uniform = torsoCl.length ? baseFrom(torso, torsoCl).f > 0.6 : false;
    const lc = metal.filter((p) => p[3] < shC[0] - ed * 0.15).length, rc = metal.filter((p) => p[3] > shC[0] + ed * 0.15).length;
    const sym = Math.min(lc, rc) > ed * 0.5 && Math.max(lc, rc) / Math.max(1, Math.min(lc, rc)) < 3.5;
    const chainOk = uniform && !print && (med < 100 || (topSat > 0.35 && med < 170));
    const pendant = chainOk && blob.length > ed * ed * 0.05 && bFill > 0.3 && (by1 - by0) < ed * 1.6 && Math.abs((bx0 + bx1) / 2 - shC[0]) < sw * 0.22 && (by0 + by1) / 2 > shC[1] + ed * 0.3;
    const blobPx = blob.map((k) => px(k % W, (k / W) | 0));
    const lineN = metal.length - (pendant ? Math.round(blob.length * 1.6) : 0);
    const thin = core.size / Math.max(1, metal.length) < 0.35;
    out.chain = chainOk && (pendant || (lineN > ed * 2.2 && sym && thin));
    out.pendant = pendant;
    if (out.chain) { const mc = avgc(pendant ? blobPx : metal); const [h, s] = rgbHsv(mc); out.metal = h > 30 && h < 60 && s > 0.3 ? 'gold' : 'silver'; }
    out.metalDbg = { med: Math.round(med), n: metal.length, blob: blob.length, fill: +bFill.toFixed(2), line: lineN, lc, rc, uniform };
  }

  // ---- legs / bottoms
  const kL = pt(25), kR = pt(26), anL = pt(27), anR = pt(28);
  const legsSeen = Math.min(vis(25), vis(26)) > 0.5 && Math.min(vis(27), vis(28)) > 0.4 && inImg(anL[0], anL[1]) && inImg(anR[0], anR[1]);
  out.fullBody = legsSeen;
  const legHW = Math.max(2, Math.round(ed * 0.55));
  const thighTop = bandPx(hipL, kL, 0.1, 0.45, legHW, 'thighL', body).concat(bandPx(hipR, kR, 0.1, 0.45, legHW, 'thighR', body));
  const kneeReg = bandPx(hipL, kL, 0.62, 0.95, legHW, 'kneeL', body).concat(bandPx(hipR, kR, 0.62, 0.95, legHW, 'kneeR', body), bandPx(kL, anL, 0.04, 0.35, legHW, null, body), bandPx(kR, anR, 0.04, 0.35, legHW, null, body));
  const kneeCloth = kneeReg.filter((p) => !isSk0(p));
  const upCloth = thighTop.filter((p) => !isSk0(p) && cdist(p, topC) > 40);
  let botC = [40, 44, 52];
  if (kneeCloth.length > Math.max(20, kneeReg.length * 0.45)) { const kc = kmeans(kneeCloth, 3, 8); botC = baseFrom(kneeCloth, kc).c; out.kneeDbg = kc.map((c) => [c.c, +c.f.toFixed(2)]); }
  else if (upCloth.length > 20) botC = garment(upCloth, 3).c;
  else if (thighTop.length > 20) botC = garment(thighTop, 3).c;
  if (isSk0(botC) && cdist(botC, skinRef) > 18) clothSkinLike.push(botC);
  const isSkLeg = (p) => isSk(p) && cdist(p, botC) > 38;
  const thighLow = bandPx(hipL, kL, 0.55, 0.9, legHW, null, body).concat(bandPx(hipR, kR, 0.55, 0.9, legHW, null, body));
  const shin = bandPx(kL, anL, 0.15, 0.85, legHW, 'shinL', body).concat(bandPx(kR, anR, 0.15, 0.85, legHW, 'shinR', body));
  const thighSkin = frac(thighLow, isSkLeg), shinSkin = frac(shin, isSkLeg);
  // leg width across the limb from the silhouette; the inner side stops halfway to the other leg
  const legWidth = (a, b, t, oa, ob) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    const c = lerp2(a, b, t), o = lerp2(oa, ob, t), toO = (o[0] - c[0]) * nx + (o[1] - c[1]) * ny, lim = Math.abs(toO) / 2;
    let w = 0;
    for (const s of [1, -1]) { const inner = Math.sign(toO) === s; let r = 0; for (let k = 1; k < sw * 1.2; k++) { if (inner && k > lim) break; const x = c[0] + nx * k * s, y = c[1] + ny * k * s; if (!inP(x, y) || nearLimb(x, y)) break; r = k; } w += r; }
    return w / sw;
  };
  const wKnee = (legWidth(kL, anL, 0.08, kR, anR) + legWidth(kR, anR, 0.08, kL, anL)) / 2;
  const wShin = (legWidth(kL, anL, 0.5, kR, anR) + legWidth(kR, anR, 0.5, kL, anL)) / 2;
  const wHem = (legWidth(kL, anL, 0.86, kR, anR) + legWidth(kR, anR, 0.86, kL, anL)) / 2;
  const [bh, bs, bv] = rgbHsv(botC);
  const denim = (bh > 188 && bh < 240 && bs > 0.12 && bs < 0.98 && bv > 0.08) || (bs < 0.1 && bv > 0.3 && bv < 0.75 && bh > 180 && bh < 240);
  // cargo pockets: extra horizontal edges on the outer thighs
  const edgeE = (a, b, oa, outer) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1; let nx = -dy / len, ny = dx / len;
    const toO = (oa[0] - a[0]) * nx + (oa[1] - a[1]) * ny; const sgn = (toO > 0 ? -1 : 1) * (outer ? 1 : -1);
    let e = 0, n = 0;
    for (let s = Math.round(len * 0.3); s <= Math.round(len * 0.9); s++) for (let o = 2; o < legHW * 1.8; o++) {
      const x = a[0] + (dx * s) / len + nx * o * sgn, y = a[1] + (dy * s) / len + ny * o * sgn;
      if (x < 1 || y < 2 || x >= W - 1 || y >= H - 2 || !inP(x, y) || !inP(x, y - 2) || !inP(x, y + 2)) continue;
      e += Math.abs(lum(px(x, y + 1)) - lum(px(x, y - 1))); n++;
    }
    return n ? e / n : 0;
  };
  const pocket = (edgeE(hipL, kL, hipR, true) + edgeE(hipR, kR, hipL, true)) / 2;
  const inner = (edgeE(hipL, kL, hipR, false) + edgeE(hipR, kR, hipL, false)) / 2;
  let botType;
  const k2t = sw / torsoLen, sT = wShin * k2t, kT = wKnee * k2t, hT = wHem * k2t;   // widths in torso lengths
  if (shinSkin > 0.45 || thighSkin > 0.4) botType = 'shorts';
  else if (hT > kT * 1.3 && hT > 0.22) botType = 'flare';
  else if (sT >= 0.3) botType = !denim && pocket > inner * 1.12 ? 'cargo' : 'baggy';
  else if (sT < 0.19) botType = 'skinny';
  else botType = !denim && pocket > inner * 1.2 ? 'cargo' : 'straight';
  if (legsSeen) { out.bottom = botType; out.bottomC = botC; out.denim = denim; }
  else { out.bottom = null; out.bottomC = botC; out.denim = denim; }
  out.legDbg = { botC, sT: +((wShin * sw) / torsoLen).toFixed(3), thighSkin: +thighSkin.toFixed(2), shinSkin: +shinSkin.toFixed(2), wKnee: +wKnee.toFixed(2), wShin: +wShin.toFixed(2), wHem: +wHem.toFixed(2), pocket: +pocket.toFixed(1), inner: +inner.toFixed(1), seen: legsSeen };

  // ---- shoes
  if (legsSeen) {
    const foot = (iA, iH, iT, nm) => { const A = pt(iA), Hh = pt(iH), T = pt(iT), r = ed * 0.7; return polyPx([[Math.min(A[0], Hh[0], T[0]) - r, Math.min(A[1], Hh[1], T[1]) - r * 0.3], [Math.max(A[0], Hh[0], T[0]) + r, Math.min(A[1], Hh[1], T[1]) - r * 0.3], [Math.max(A[0], Hh[0], T[0]) + r, Math.max(A[1], Hh[1], T[1]) + r * 0.8], [Math.min(A[0], Hh[0], T[0]) - r, Math.max(A[1], Hh[1], T[1]) + r * 0.8]], nm, body); };
    const keepF = (p) => (cdist(p, botC) > 30 || lum(botC) < 60) && !isSkLeg(p);
    // ground around the feet: the mask edge often takes a bit of floor and shadow with the shoes
    const fb = [];
    { const fi = [27, 28, 29, 30, 31, 32], xs = fi.map((i) => pt(i)[0]), ys = fi.map((i) => pt(i)[1]);
      const x0 = Math.min(...xs) - ed * 2, x1 = Math.max(...xs) + ed * 2, y0 = Math.min(...ys) - ed * 0.5, y1 = Math.max(...ys) + ed * 1.5;
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, y1); y += 2) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, x1); x += 2) if (!inP(x, y)) fb.push(px(x, y)); }
    const floorC = fb.length > 20 ? kmeans(fb, 4, 8).filter((c) => c.f > 0.05).map((c) => c.c) : [];
    const notFloor = (p) => !floorC.some((c) => cdist(p, c) < 45);
    const fL0 = foot(27, 29, 31, 'shoeL').filter(keepF), fR0 = foot(28, 30, 32, 'shoeR').filter(keepF);
    let fL = fL0.filter(notFloor), fR = fR0.filter(notFloor);
    if (fL.length + fR.length < 15) { fL = fL0; fR = fR0; }
    let fp = fL.concat(fR);
    if (fp.length > 15) {
      const c0 = garment(fp, 3).c;
      if (cdist(c0, botC) < 50) {
        const hem = bandPx(kL, anL, 0.55, 0.9, legHW, null, body).concat(bandPx(kR, anR, 0.55, 0.9, legHW, null, body)).filter((p) => !isSkLeg(p));
        const pc = hem.length > 20 ? kmeans(hem, 3, 6).filter((c) => c.f > 0.1).map((c) => c.c) : [botC];
        const notPants = (p) => pc.every((c) => cdist(p, c) > 42);
        const fL2 = fL.filter(notPants), fR2 = fR.filter(notPants);
        if (fL2.length + fR2.length > fp.length * 0.22 && fL2.length + fR2.length > 15) { fL = fL2; fR = fR2; fp = fL.concat(fR); }
      }
    }
    if (fp.length > 15) {
      const soles = [];
      for (const f of [fL, fR]) { if (!f.length) continue; let yb = 0; for (const p of f) yb = Math.max(yb, p[4]); for (const p of f) if (p[4] > yb - ed * 0.3) soles.push(p); }
      const sset = new Set(soles), up = fp.filter((p) => !sset.has(p));
      out.shoesC = garment(up.length > 10 ? up : fp, 3).c;
      let sole = soles.length > 8 ? garment(soles, 2).c : null;
      if (!sole || cdist(sole, out.shoesC) < 30) sole = lum(out.shoesC) < 110 ? out.shoesC.map((v) => Math.min(255, v + 26)) : out.shoesC.map((v) => Math.round(v * 0.86));
      out.soleC = sole;
    }
    const above = bandPx(kL, anL, 0.72, 0.92, legHW, null, body).concat(bandPx(kR, anR, 0.72, 0.92, legHW, null, body));
    out.shoes = out.shoesC && above.length && frac(above, (p) => cdist(p, out.shoesC) < 30) > 0.6 && cdist(out.shoesC, botC) > 40 ? 'boots' : 'chunky';
  }

  // ---- build: torso widths against the torso length
  {
    const c = chestW / torsoLen, wst = waistW / torsoLen, hp = hipW / torsoLen;
    out.build = c > 0.84 || wst > 0.8 ? 'broad' : c < 0.7 && wst < 0.68 ? 'slim' : 'avg';
    out.frame = hp > wst * 1.22 && wst / c < 0.86 ? 'curvy' : 'straight';
    out.buildDbg = { chest: +c.toFixed(2), waist: +wst.toFixed(2), hips: +hp.toFixed(2), sw: +(sw / torsoLen).toFixed(2) };
  }

  // ---- skin tone: cheeks + bare forearms + hands, mid-bright pixels, brought into a printable range
  {
    const foreSk = bandPx(pt(13), pt(15), 0.2, 0.8, armHW, null, isSkArm).concat(bandPx(pt(14), pt(16), 0.2, 0.8, armHW, null, isSkArm));
    const all = face.filter(isSk).concat(foreSk).sort((a, b) => lum(a) - lum(b));
    let c = skinRef;
    if (all.length > 20) c = avgc(all.slice(Math.floor(all.length * 0.35), Math.max(Math.floor(all.length * 0.8), Math.floor(all.length * 0.35) + 1)));
    const l = lum(c), tl = clamp(l, 62, 196);
    out.skin = c.map((v) => clamp(Math.round((v * tl) / Math.max(1, l)), 0, 255));
  }
  readSummary(out);
  return out;
}

// human-readable list of what was read: [[label, text], ...]
function readSummary(r) {
  const nm = (c) => (c ? colorName(c) : '');
  const T = { tank: 'tank top', tee: 'oversized tee', fitted: 'fitted tee', long: 'long sleeve', hoodie: 'hoodie', jacket: 'open jacket', layered: 'layered tee', track: 'track jacket' };
  const dn = r.denim !== false && (r.denim || r.bottom === 'jorts');
  const Bt = { baggy: dn ? 'baggy jeans' : 'wide pants', cargo: 'cargo pants', track: 'track pants', straight: dn ? 'straight jeans' : 'straight pants', skinny: dn ? 'skinny jeans' : 'slim pants', flare: dn ? 'flared jeans' : 'flares', jorts: 'jorts', shorts: dn ? 'jorts' : 'shorts' };
  const H = { beanie: 'beanie', cap: 'cap', bucket: 'bucket hat', hood: 'hood up' };
  const out = (r.read = []);
  if (r.headwear && r.headwear !== 'none') out.push(['Head', `${nm(r.headwearC)} ${H[r.headwear] || r.headwear}`]);
  out.push(['Hair', `${nm(r.hairC)} · ${r.hairStyle}${r.headwear && r.headwear !== 'none' ? ' (under the hat)' : ''}`]);
  if (r.beard && r.beard !== 'none') out.push(['Face', r.beard]);
  if (r.skin) { const l = lum(r.skin); out.push(['Skin', l > 185 ? 'fair' : l > 160 ? 'light' : l > 132 ? 'medium' : l > 104 ? 'tan' : l > 76 ? 'brown' : 'deep']); }
  if (r.build) out.push(['Build', (r.build === 'avg' ? 'average' : r.build) + (r.frame === 'curvy' ? ', curvy' : '')]);
  if (r.top) out.push(['Top', `${nm(r.topC)} ${T[r.top] || r.top}${r.top === 'jacket' && r.top2C ? ' over ' + nm(r.top2C) : r.print && r.top2C ? ' with ' + nm(r.top2C) + ' print' : ''}`]);
  if (r.chain) out.push(['Neck', `${r.metal || 'silver'} chain${r.pendant ? ' + pendant' : ''}`]);
  if (r.bottom) out.push(['Bottom', `${nm(r.bottomC)} ${Bt[r.bottom] || r.bottom}`]);
  if (r.shoesC) out.push(['Shoes', `${nm(r.shoesC)} ${r.shoes === 'boots' ? 'boots' : 'sneakers'}${r.soleC ? ', ' + nm(r.soleC) + ' sole' : ''}`]);
  if (r.shades) out.push(['Eyes', 'sunglasses']);
  return out;
}

// ---------------------------------------------------------------- dance authoring helpers
// cyclic monotone-limited cubic through [beat, value] keys over loop length L
function cycSpline(keys, L) {
  const n = keys.length;
  if (n === 1) { const v = keys[0][1]; return () => v; }
  const T = keys.map((k) => k[0]), V = keys.map((k) => k[1]);
  const tAt = (i) => T[mod(i, n)] + Math.floor(i / n) * L;
  const vAt = (i) => V[mod(i, n)];
  const M = [];
  for (let i = 0; i < n; i++) {
    const h0 = tAt(i) - tAt(i - 1) || 1e-3, h1 = tAt(i + 1) - tAt(i) || 1e-3;
    const d0 = (vAt(i) - vAt(i - 1)) / h0, d1 = (vAt(i + 1) - vAt(i)) / h1;
    let m = d0 * d1 <= 0 ? 0 : (vAt(i + 1) - vAt(i - 1)) / (tAt(i + 1) - tAt(i - 1));
    const lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
    if (Math.abs(m) > lim) m = Math.sign(m) * lim;
    M.push(m);
  }
  return (b) => {
    b = mod(b, L);
    let i = -1;
    for (let j = 0; j < n; j++) { if (T[j] <= b) i = j; else break; }
    const t0 = tAt(i), t1 = tAt(i + 1), h = t1 - t0 || 1e-3;
    const s = clamp((b - t0) / h, 0, 1), s2 = s * s, s3 = s2 * s;
    const v0 = vAt(i), v1 = vAt(i + 1), m0 = M[mod(i, n)] * h, m1 = M[mod(i + 1, n)] * h;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
  };
}
function mkTrack(L, keys) {
  const ch = {};
  for (const k of keys) for (const name in k) { if (name === 'b') continue; (ch[name] = ch[name] || []).push([k.b, k[name]]); }
  const fns = [];
  for (const name in ch) fns.push([name, cycSpline(ch[name].sort((a, b) => a[0] - b[0]), L)]);
  return (b, out) => { for (const [nm, f] of fns) out[nm] = f(b); return out; };
}
// body dips on the beat: 1 at the beat, 0 half-way between beats (fast drop, slower rise)
function dip(b, lag) { const f = fract(b - (lag || 0)); return smooth(0.66, 1.0, f) + 1 - smooth(0.0, 0.42, f); }
function mixIn(P, o, w) { if (w <= 0) return; for (const k in o) P[k] = lerp(P[k], o[k], w); }

// ---------------------------------------------------------------- dance 1: VIBE (8 beats) — standing bounce → hunched crouch with head-bob → rise, hands on hips
const VIBE_T = mkTrack(8, [
  { b: 0, c: 0, hh: 1 }, { b: 0.55, hh: 1 }, { b: 1.4, hh: 0 }, { b: 4.0, c: 0 }, { b: 5.0, c: 1 }, { b: 7.0, c: 1 }, { b: 7.25, hh: 0 }, { b: 7.85, c: 0, hh: 1 },
]);
function danceVibe(b, E, P) {
  const x = mod(b, 8), tr = VIBE_T(x, {}), c = tr.c, A = 0.45 + 0.55 * E;
  const d = dip(x, 0.03), n = dip(x, 0.12), s2 = Math.sin(Math.PI * x);
  P.hy = -0.03 - 0.05 * d * A; P.hx = 0.032 * s2 * A; P.hrol = 3.5 * s2 * A; P.hpit = 3 * d * A;
  P.spP = 3 + 3 * d * A; P.chP = 3 + 5 * dip(x, 0.07) * A; P.chR = -2.5 * s2 * A; P.chY = 5 * Math.sin(Math.PI * x + 0.6) * A;
  P.hdP = -2 + 13 * n * A; P.hdR = 4 * Math.sin(Math.PI * (x - 0.3)) * A; P.hdY = -4 * s2 * A;
  const sw = Math.sin(Math.PI * (x - 0.35)) * A;
  P.aL_f = 6 + 9 * sw; P.aR_f = 6 - 9 * sw; P.aL_e = P.aR_e = 22 + 16 * dip(x, 0.1) * A; P.aL_o = P.aR_o = 10;
  P.aL_sh = P.aR_sh = 3 * (1 - d) * A;
  P.fL_yaw = P.fR_yaw = 12;
  if (c > 0.001) {
    mixIn(P, {
      hy: -0.25 - 0.045 * d * A, hpit: 14 + 3 * d, spP: 15 + 4 * d * A, chP: 15 + 6 * dip(x, 0.07) * A,
      hdP: -27 + 24 * n * A, hdR: 7 * Math.sin(Math.PI * (x - 0.4)) * A, fL_x: 0.16, fR_x: -0.16, fL_ko: 14, fR_ko: 14,
      aL_e: 40, aR_e: 40,
    }, c);
    P.hx *= 1 - 0.6 * c; P.hrol *= 1 - 0.6 * c;
    P.aL_knee = P.aR_knee = smooth(0.2, 0.8, c);
  }
  P.aL_hip = P.aR_hip = tr.hh * (1 - c);
  return P;
}

// ---------------------------------------------------------------- dance 2: STEP (8 beats) — step-touch groove, bent elbows, point on bar 2
const STEP_T = mkTrack(8, (() => {
  const k = [];
  for (const o of [0, 4]) {
    k.push(
      { b: o + 0.3, fL_x: 0.21, fL_y: 0, fL_p: 0 }, { b: o + 0.65, fL_y: 0.05, fL_p: 14 }, { b: o + 1.0, fL_x: -0.07, fL_y: 0, fL_p: 24 },
      { b: o + 1.3, fL_x: -0.07, fL_y: 0, fL_p: 24 }, { b: o + 1.65, fL_y: 0.07, fL_p: 12 }, { b: o + 2.0, fL_x: 0.21, fL_y: 0, fL_p: 0 },
      { b: o + 2.3, fR_x: -0.21, fR_y: 0, fR_p: 0 }, { b: o + 2.65, fR_y: 0.05, fR_p: 14 }, { b: o + 3.0, fR_x: 0.07, fR_y: 0, fR_p: 24 },
      { b: o + 3.3, fR_x: 0.07, fR_y: 0, fR_p: 24 }, { b: o + 3.65, fR_y: 0.07, fR_p: 12 }, { b: o + 4.0 - 0.001, fR_x: -0.21, fR_y: 0, fR_p: 0 },
      { b: o + 0, hx: -0.12, hrol: -5, chY: -11, hdR: -5 }, { b: o + 1, hx: -0.14, hrol: -6, chY: -6, hdR: -6 }, { b: o + 1.55, hx: -0.04 },
      { b: o + 2, hx: 0.12, hrol: 5, chY: 11, hdR: 5 }, { b: o + 3, hx: 0.14, hrol: 6, chY: 6, hdR: 6 }, { b: o + 3.55, hx: 0.04 },
    );
  }
  k.push({ b: 0, pw: 0 }, { b: 4.45, pw: 0 }, { b: 4.95, pw: 1 }, { b: 6.25, pw: 1 }, { b: 6.95, pw: 0 });
  return k;
})());
function danceStep(b, E, P) {
  const x = mod(b, 8), A = 0.45 + 0.55 * E;
  STEP_T(x, P);
  const d = dip(x, 0.03), n = dip(x, 0.1);
  P.hx *= 0.55 + 0.45 * A; P.hrol *= A;
  P.hy = -0.045 - 0.045 * d * A; P.hpit = 4 + 3 * d * A;
  P.spR = -P.hrol * 0.75; P.spP = 4; P.chP = 4 + 4 * dip(x, 0.06) * A; P.chY *= A;
  P.hdP = -1 + 11 * n * A; P.hdR *= A; P.hdY = -0.45 * P.chY;
  const swing = Math.sin(Math.PI * (x + 0.5) - 0.35) * A;
  // loose two-step arms: elbows bent, forearms pumping on the beat, alternating sides
  const pumpL = dip(x, 0.08), pumpR = dip(x + 0.5, 0.08);
  P.aL_f = 18 + 16 * swing; P.aR_f = 18 - 16 * swing;
  P.aL_e = 62 + 26 * pumpL * A; P.aR_e = 62 + 26 * pumpR * A;
  P.aL_o = 13 + 6 * d * A; P.aR_o = 13 + 6 * d * A; P.aL_t = -8 - 10 * pumpL; P.aR_t = -8 - 10 * pumpR;
  P.aL_w = 10 * pumpL - 5; P.aR_w = 10 * pumpR - 5;
  const acc = dip(x - 1, 0.05) * (0.7 - 0.3 * Math.cos(Math.PI * x));
  P.aL_sh = 5 * acc * A + 3 * pumpL * A; P.aR_sh = 5 * acc * A + 3 * pumpR * A;
  P.fL_yaw = P.fR_yaw = 14;
  // bar 2: point forward-up with the right hand, left hand to the hip
  const pw = P.pw || 0;
  if (pw > 0.001) {
    mixIn(P, { aR_f: 84 + 6 * d, aR_o: 8, aR_e: 8, aR_t: 0, aR_sh: 5, chY: 6, hdY: 4, hdP: -6 + 6 * n }, pw);
    P.aL_hip = pw;
  }
  return P;
}

// ---------------------------------------------------------------- dance 3: FREESTYLE (16 beats) — airplane rock, arm up + knee lift, wide squat bounce, arm sweeps
const FREE_T = mkTrack(16, [
  { b: 0, air: 1, up: 0, knee: 0, sq: 0, sw: 0, lh: 0 },
  { b: 3.35, air: 1 }, { b: 4.1, air: 0 }, { b: 15.35, air: 0 },
  { b: 4.0, up: 0 }, { b: 4.6, up: 1 }, { b: 5.9, up: 1 }, { b: 6.75, up: 0 },
  { b: 4.2, lh: 0 }, { b: 4.7, lh: 1 }, { b: 6.1, lh: 1 }, { b: 6.6, lh: 0 },
  { b: 6.2, knee: 0 }, { b: 6.75, knee: 1 }, { b: 7.45, knee: 1 }, { b: 7.95, knee: 0 },
  { b: 7.8, sq: 0 }, { b: 8.5, sq: 1 }, { b: 11.45, sq: 1 }, { b: 12.2, sq: 0 },
  { b: 12.0, sw: 0 }, { b: 12.3, sw: 1 }, { b: 15.2, sw: 1 }, { b: 15.75, sw: 0 },
  { b: 11.9, p1: 0 }, { b: 12.3, p1: 0 }, { b: 13.9, p1: 1 }, { b: 15.8, p1: 1 }, { b: 13.8, p2: 0 }, { b: 14.0, p2: 0 }, { b: 15.3, p2: 1 }, { b: 15.6, p2: 1 },
]);
function danceFree(b, E, P) {
  const x = mod(b, 16), tr = FREE_T(x, {}), A = 0.45 + 0.55 * E;
  const d = dip(x, 0.03), n = dip(x, 0.11), s2 = Math.sin(Math.PI * x);
  // base groove
  P.hy = -0.04 - 0.045 * d * A; P.hx = -0.03 * s2 * A; P.hrol = -3 * s2 * A; P.hpit = 3 * d * A;
  P.chP = 3 + 4 * dip(x, 0.06) * A; P.hdP = 9 * n * A; P.fL_yaw = P.fR_yaw = 13; P.fL_x = 0.12; P.fR_x = -0.12;
  P.aL_e = P.aR_e = 30; P.aL_o = P.aR_o = 12; P.aL_f = P.aR_f = 10;
  // airplane rock
  if (tr.air > 0.001) mixIn(P, {
    aL_o: 76 + 6 * Math.sin(Math.PI * (x - 0.2)), aR_o: 76 - 6 * Math.sin(Math.PI * (x - 0.2)), aL_e: 26, aR_e: 26, aL_f: 8, aR_f: 8, aL_t: 25, aR_t: 25,
    aL_w: 18 * Math.sin(2 * Math.PI * x), aR_w: 18 * Math.sin(2 * Math.PI * x + 1),
    chR: 14 * s2 * A, spR: 4 * s2 * A, hdR: 8 * Math.sin(Math.PI * (x - 0.25)) * A, hx: -0.045 * s2 * A, hrol: -4 * s2 * A,
  }, tr.air);
  // right arm up, left hand on hip
  if (tr.up > 0.001) mixIn(P, { aR_f: 150 + 8 * d * A, aR_o: 32, aR_e: 12, aR_t: 15, aR_sh: 10, chR: 6, hdP: -10 + 8 * n * A, hdY: -8 }, tr.up);
  P.aL_hip = tr.lh;
  // left knee lift
  if (tr.knee > 0.001) mixIn(P, { fL_y: 0.32, fL_z: 0.2, fL_p: 32, fL_x: 0.09, fL_ko: 10, hx: -0.075, hy: -0.02, hrol: 7, spP: -6, chP: -2, aL_o: 42, aR_o: 42, aL_e: 55, aR_e: 55, aL_f: 25, aR_f: 25, hdP: 6 + 6 * n }, tr.knee);
  // wide squat bounce
  if (tr.sq > 0.001) {
    mixIn(P, {
      fL_x: 0.24, fR_x: -0.24, fL_yaw: 26, fR_yaw: 26, fL_ko: 22, fR_ko: 22, hy: -0.15 - 0.05 * d * A, hx: 0.02 * s2, hrol: 3 * s2,
      spP: 12, chP: 8 + 5 * dip(x, 0.06) * A, hdP: -10 + 18 * n * A, aL_e: 60, aR_e: 60, aL_o: 30, aR_o: 30,
      aL_sh: 9 * Math.max(0, s2), aR_sh: 9 * Math.max(0, -s2), chR: -5 * s2,
    }, tr.sq);
    P.aL_knee = P.aR_knee = 0.55 * tr.sq;
  }
  // arm sweeps across the body
  if (tr.sw > 0.001) {
    const p1 = smooth(0, 1, tr.p1 || 0), p2 = smooth(0, 1, tr.p2 || 0);
    mixIn(P, {
      aR_f: 62 - 30 * p2, aR_o: lerp(-38, 84, p1) - 20 * p2, aR_e: 18, aL_f: lerp(12, 62, Math.min(1, p2 * 1.5)) - 20 * smooth(0.7, 1, p2),
      aL_o: lerp(30, lerp(-38, 84, p2), smooth(0, 0.35, p2)), aL_e: lerp(40, 18, p2),
      chY: lerp(24, -26, p1) + 46 * p2, hdY: -0.4 * (lerp(24, -26, p1) + 46 * p2), hx: lerp(0.05, -0.05, p1) + 0.1 * p2,
    }, tr.sw);
  }
  return P;
}

// snappy swing: holds near the extremes on the beat, crosses fast in between
const snap = (c, k) => Math.sign(c) * Math.pow(Math.abs(c), k || 0.55);

// ---------------------------------------------------------------- dance 4: FLOSS (4 beats) — straight arms swing side to side, one in front, one behind; hips go the other way
function danceFloss(b, E, P) {
  const x = mod(b, 4), A = 0.5 + 0.5 * E;
  const s = snap(Math.cos(Math.PI * x), 0.5);                 // +1 arms to the left on even beats, −1 right on odd
  const d = dip(x, 0.02);
  P.aL_f = -42 * s; P.aR_f = 42 * s;                          // left side: left arm behind, right arm across in front
  P.aL_o = 2 + 17 * s; P.aR_o = 2 - 17 * s;
  P.aL_e = P.aR_e = 6; P.aL_t = P.aR_t = 10; P.aL_w = P.aR_w = 0;
  P.hx = -0.075 * s * A; P.hrol = 9 * s * A; P.hyaw = 6 * s * A;
  P.spR = -5 * s * A; P.chR = -6 * s * A; P.chY = -8 * s * A; P.hdR = 4 * s * A; P.hdY = 6 * s * A;
  P.hy = -0.05 - 0.035 * d * A; P.hpit = 3; P.chP = 3 + 3 * d * A; P.hdP = 5 * dip(x, 0.08) * A;
  P.fL_x = 0.13; P.fR_x = -0.13; P.fL_yaw = P.fR_yaw = 8; P.fL_ko = P.fR_ko = 8;
  return P;
}

// ---------------------------------------------------------------- dance 5: GROOVE (8 beats) — alternating arm pumps with a kick-step, then raise-the-roof bounce
const GROOVE_T = mkTrack(8, [{ b: 0, r: 0 }, { b: 3.55, r: 0 }, { b: 4.0, r: 1 }, { b: 7.5, r: 1 }, { b: 7.95, r: 0 }]);
function danceGroove(b, E, P) {
  const x = mod(b, 8), A = 0.5 + 0.5 * E, r = smooth(0, 1, GROOVE_T(x, {}).r);
  const side = snap(Math.cos(Math.PI * x), 0.7);              // +1: right arm pumps (even beats), −1: left
  const d = dip(x, 0.03), pu = dip(x, 0.05);
  const R = Math.max(0, side), L = Math.max(0, -side);
  P.aR_f = 14 + 38 * R * (0.6 + 0.4 * pu) - 22 * L; P.aL_f = 14 + 38 * L * (0.6 + 0.4 * pu) - 22 * R;
  P.aR_e = 40 + 45 * R * (1 - 0.35 * pu); P.aL_e = 40 + 45 * L * (1 - 0.35 * pu); P.aL_o = P.aR_o = 16; P.aR_sh = 8 * R * pu; P.aL_sh = 8 * L * pu;
  P.aL_t = P.aR_t = -10;
  P.chY = 14 * side * A; P.hdY = -6 * side; P.spR = 3 * side; P.hy = -0.06 - 0.05 * d * A; P.hpit = 4 + 3 * d;
  P.chP = 5 + 5 * pu * A; P.hdP = 2 + 10 * dip(x, 0.1) * A;
  // kick-step: the foot opposite the pumping arm flicks forward
  P.fL_x = 0.12; P.fR_x = -0.12; P.fL_yaw = P.fR_yaw = 12;
  const kick = (ph) => { const f = fract(ph); return f < 0.5 ? Math.sin(Math.PI * f * 2) : 0; };
  P.fL_y = 0.07 * kick(x) * (1 - r) * A; P.fL_z = 0.12 * kick(x) * (1 - r) * A; P.fL_p = 18 * kick(x) * (1 - r);
  P.fR_y = 0.07 * kick(x + 1) * (1 - r) * A; P.fR_z = 0.12 * kick(x + 1) * (1 - r) * A; P.fR_p = 18 * kick(x + 1) * (1 - r);
  P.fL_y *= x % 2 < 1 ? 1 : 0; P.fL_z *= x % 2 < 1 ? 1 : 0; P.fR_y *= x % 2 >= 1 ? 1 : 0; P.fR_z *= x % 2 >= 1 ? 1 : 0;
  if (r > 0.001) {
    const up = dip(x, 0.04), sw = Math.sin(Math.PI * x);
    mixIn(P, {
      aL_f: 140 + 18 * up, aR_f: 140 + 18 * up, aL_o: 38, aR_o: 38, aL_e: 78 - 20 * up, aR_e: 78 - 20 * up, aL_t: 30, aR_t: 30, aL_sh: 10 * up, aR_sh: 10 * up,
      chY: 6 * sw, hdY: 0, hx: 0.06 * sw * A, hrol: -6 * sw * A, hy: -0.09 - 0.06 * d * A, hdP: -6 + 14 * dip(x, 0.08) * A, fL_x: 0.17, fR_x: -0.17, fL_ko: 14, fR_ko: 14,
    }, r);
  }
  return P;
}

// ---------------------------------------------------------------- dance 6: SHUFFLE (4 beats) — running man: knee up on the beat while the other foot slides back, fists pumping
function danceShuffle(b, E, P) {
  const x = mod(b, 4), A = 0.5 + 0.5 * E;
  const lift = (ph) => { const f = fract(ph + 0.12); return Math.pow(Math.sin(Math.PI * Math.min(1, f / 0.8)), 1.4); };
  const slide = (ph) => { const f = fract(ph + 0.12); return f < 0.5 ? -Math.sin(Math.PI * f * 2) : 0; };
  const left = Math.floor(x) % 2 === 0, lL = left ? lift(x) : 0, lR = left ? 0 : lift(x);
  P.fL_x = 0.1; P.fR_x = -0.1; P.fL_yaw = P.fR_yaw = 6;
  P.fL_y = 0.27 * lL * A; P.fL_z = 0.14 * lL + (left ? 0 : 0.13 * slide(x)) * A; P.fL_p = 25 * lL; P.fL_ko = 6;
  P.fR_y = 0.27 * lR * A; P.fR_z = 0.14 * lR + (left ? 0.13 * slide(x) : 0) * A; P.fR_p = 25 * lR; P.fR_ko = 6;
  const d = dip(x, 0.02);
  P.hy = -0.07 - 0.05 * d * A; P.hz = 0.02; P.hpit = 6; P.spP = 6; P.chP = 6 + 4 * d * A; P.hdP = 4 + 10 * dip(x, 0.08) * A;
  P.hx = 0.025 * (left ? -1 : 1) * lL + 0.025 * lR; P.hrol = 4 * (lR - lL); P.chY = 8 * (lL - lR) * A; P.hdY = -3 * (lL - lR);
  const pL = dip(x + 1, 0.04), pR = dip(x, 0.04);                     // fists pump down, opposite to the knee
  const sw = Math.sin(Math.PI * (x + 0.12));                         // running arms, opposite to the knee
  P.aL_f = 25 - 35 * sw * A + 8 * pL; P.aR_f = 25 + 35 * sw * A + 8 * pR;
  P.aL_e = 88 + 10 * sw; P.aR_e = 88 - 10 * sw; P.aL_o = P.aR_o = 14; P.aL_t = P.aR_t = -25; P.aL_sh = 6 * pL * A; P.aR_sh = 6 * pR * A;
  return P;
}

// ---------------------------------------------------------------- dance 7: CHAIR (20 beats) — sits arms crossed, stands up with a knee lift,
// wide-stance bounce with arms swinging out and in, knee lift, sits back down (the PSP reference, 78 bpm)
const CHAIR_T = mkTrack(20, [
  { b: 0, sit: 1, cross: 1, lean: 0, kR: 0, kL: 0, wide: 0 },
  { b: 1.2, cross: 1, lean: 0 }, { b: 1.4, sit: 1 }, { b: 1.8, cross: 0 }, { b: 1.95, lean: 1 }, { b: 2.45, sit: 0 }, { b: 2.7, lean: 0 },
  { b: 2.45, kR: 0 }, { b: 2.85, kR: 1 }, { b: 3.35, kR: 0 }, { b: 2.95, wide: 0 }, { b: 3.6, wide: 1 },
  { b: 16.4, wide: 1 }, { b: 16.95, wide: 0 }, { b: 16.6, kL: 0 }, { b: 17.1, kL: 1 }, { b: 17.65, kL: 0 },
  { b: 18.4, lean: 0, sit: 0 }, { b: 19.0, lean: 1 }, { b: 19.55, sit: 1 }, { b: 19.85, lean: 0 }, { b: 19.3, cross: 0 }, { b: 19.95, cross: 1 },
]);
function danceChair(b, E, P) {
  const x = mod(b, 20), tr = CHAIR_T(x, {}), A = 0.5 + 0.5 * E;
  const sit = clamp(tr.sit, 0, 1), cross = clamp(tr.cross, 0, 1), lean = clamp(tr.lean, 0, 1), wide = clamp(tr.wide, 0, 1);
  const d = dip(x, 0.03), sw = Math.sin(Math.PI * (x - 0.25)), s = snap(sw, 0.7);
  P.chair = 1;
  // standing groove: wide bent stance, rocking, fists swinging out and in
  P.fL_x = lerp(0.13, 0.25, wide); P.fR_x = -P.fL_x; P.fL_yaw = P.fR_yaw = lerp(10, 22, wide); P.fL_ko = P.fR_ko = lerp(6, 16, wide);
  P.hy = lerp(-0.05, -0.13, wide) - 0.05 * d * A * wide; P.hx = 0.05 * sw * A * wide; P.hrol = -5 * sw * A * wide; P.hpit = 5 + 3 * d;
  P.spP = 6; P.chP = 6 + 4 * d * A; P.chY = 14 * sw * A; P.chR = 3 * sw; P.hdP = 2 + 10 * dip(x, 0.1) * A; P.hdY = -5 * sw; P.hdR = 4 * sw;
  const L = Math.max(0, s), R = Math.max(0, -s);
  P.aL_o = 12 + 44 * L * A; P.aL_f = 24 - 4 * L; P.aL_e = 82 - 14 * L; P.aL_t = -28 + 38 * L;
  P.aR_o = 12 + 44 * R * A; P.aR_f = 24 - 4 * R; P.aR_e = 82 - 14 * R; P.aR_t = -28 + 38 * R;
  P.aL_sh = 6 * d * A; P.aR_sh = 6 * d * A; P.aL_w = P.aR_w = 10;
  // knee lifts on the way up and down
  if (tr.kR > 0.001) mixIn(P, { fR_y: 0.26, fR_z: 0.16, fR_p: 25, hx: 0.05, hrol: -6, aL_o: 30, aR_o: 30 }, clamp(tr.kR, 0, 1));
  if (tr.kL > 0.001) mixIn(P, { fL_y: 0.26, fL_z: 0.16, fL_p: 25, hx: -0.05, hrol: 6, aL_o: 30, aR_o: 30 }, clamp(tr.kL, 0, 1));
  // bending forward to stand up / sit down
  if (lean > 0.001) mixIn(P, { spP: 26, chP: 16, hdP: -12, hpit: 18, aL_f: 30, aR_f: 30, aL_e: 40, aR_e: 40, aL_o: 18, aR_o: 18 }, lean);
  // seated on the chair, head nodding to the beat
  if (sit > 0.001) {
    mixIn(P, { hy: -0.425 + 0.004 * d, hz: CHAIR.z + 0.02, hx: 0, hrol: 0, hpit: -6 + lean * 22, spP: 2 + lean * 24, chP: 2 + 3 * d + lean * 14, chY: 0, chR: 0,
      fL_x: 0.14, fR_x: -0.14, fL_z: 0.17, fR_z: 0.17, fL_yaw: 10, fR_yaw: 10, fL_ko: 10, fR_ko: 10, hdP: 3 + 9 * dip(x, 0.1) * A, hdY: 0, hdR: 3 * sw }, sit);
  }
  if (cross > 0.001) {
    mixIn(P, { aL_f: 40, aR_f: 40, aL_o: 10, aR_o: 10, aL_e: 115, aR_e: 115, aL_t: -30, aR_t: -30 }, cross);
    P.aL_ik = P.aR_ik = cross; P.aL_ikx = -0.075; P.aL_iky = 0.34; P.aL_ikz = 0.17; P.aR_ikx = 0.085; P.aR_iky = 0.31; P.aR_ikz = 0.19;
  }
  return P;
}

const DANCES = { vibe: danceVibe, step: danceStep, free: danceFree, floss: danceFloss, groove: danceGroove, shuffle: danceShuffle, chair: danceChair };
const DANCE_ORDER = ['vibe', 'step', 'free', 'groove', 'floss', 'shuffle'];

function idlePose(t, P) {
  const br = Math.sin(t * 2 * Math.PI / 4.2);
  P.chP = 2 + 1.2 * br; P.spP = 2; P.hy = -0.02 + 0.004 * br;
  P.hx = 0.018 * Math.sin(t * 0.37 + 1.0); P.hrol = 2.0 * Math.sin(t * 0.37 + 1.0);
  P.hdY = 8 * noise1(t * 0.18 + 3.1); P.hdP = 3 * noise1(t * 0.23 + 7.7); P.hdR = 2 * noise1(t * 0.2);
  P.aL_e = P.aR_e = 12 + 3 * br; P.aL_o = P.aR_o = 8; P.aL_f = P.aR_f = 3;
  return P;
}

// full pose for time t
function dancePose(t, cfg, out) {
  const P = out || {};
  for (const k of PKEYS) P[k] = POSE0[k];
  const bpm = cfg.bpm || 100, beat = 60 / bpm;
  const bp = (t - (cfg.phase || 0)) / beat;
  const E = cfg.energy == null ? 0.8 : cfg.energy;
  let name = cfg.dance || 'vibe';
  if (name === 'auto') {
    const seg = 32, idx = Math.floor(bp / seg), w = smooth(-0.6, 0.6, bp - (idx + 1) * seg);
    const ND = DANCE_ORDER.length, a = DANCE_ORDER[mod(idx, ND)], c = DANCE_ORDER[mod(idx + 1, ND)];
    DANCES[a](bp, E, P);
    if (w > 0) { const Q = {}; for (const k of PKEYS) Q[k] = POSE0[k]; DANCES[c](bp, E, Q); poseLerp(P, Q, w, P); }
    // ease out of the previous segment's transition too
    const w0 = 1 - smooth(-0.6, 0.6, bp - idx * seg);
    if (w0 > 0) { const Q = {}; for (const k of PKEYS) Q[k] = POSE0[k]; DANCES[DANCE_ORDER[mod(idx - 1, ND)]](bp, E, Q); poseLerp(P, Q, w0, P); }
  } else (DANCES[name] || danceVibe)(bp, E, P);
  // wings (if worn): slow flap, one beat down / one beat up, deeper with energy
  { const f = Math.sin(Math.PI * (bp - 0.25)); P.wF = (8 + 14 * E) * f * f * Math.sign(f) - 4; }
  // life: tiny noise so loops never look mechanical
  P.hdY += 2.2 * noise1(t * 0.5 + 11) ; P.hdP += 1.2 * noise1(t * 0.6 + 5); P.chY += 1.5 * noise1(t * 0.4 + 2);
  const idleW = cfg.idle || 0;
  if (idleW > 0.001) { const Q = {}; for (const k of PKEYS) Q[k] = POSE0[k]; idlePose(t, Q); poseLerp(P, Q, idleW, P); }
  return P;
}

// ---------------------------------------------------------------- audio analysis: tempo, beat phase, downbeat, energy
function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

async function analyzeAudio(buffer, onProgress) {
  const sr0 = buffer.sampleRate, n0 = buffer.length, chs = buffer.numberOfChannels;
  const dec = Math.max(1, Math.round(sr0 / 11025)), sr = sr0 / dec;
  const n = Math.floor(n0 / dec);
  const x = new Float32Array(n);
  const data = []; for (let c = 0; c < chs; c++) data.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let s = 0; const o = i * dec;
    for (let c = 0; c < chs; c++) { const d = data[c]; for (let k = 0; k < dec; k++) s += d[o + k] || 0; }
    x[i] = s / (dec * chs);
  }
  const N = 512, hop = 128, hopS = hop / sr;
  const frames = Math.max(1, Math.floor((n - N) / hop));
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const bins = N / 2, lowBin = Math.max(2, Math.round((160 / sr) * N));
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const flux = new Float32Array(frames), lowFlux = new Float32Array(frames), rms = new Float32Array(frames);
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const o = f * hop; let e = 0;
    for (let i = 0; i < N; i++) { const v = x[o + i]; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rms[f] = Math.sqrt(e / N);
    fftMag(re, im);
    let fl = 0, lf = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.log(1 + 120 * Math.hypot(re[k], im[k]));
      cur[k] = m; const d = m - prev[k];
      if (d > 0) { fl += d; if (k <= lowBin) lf += d; }
    }
    flux[f] = fl; lowFlux[f] = lf;
    const t = prev; prev = cur; cur = t;
    if ((f & 2047) === 2047) { if (onProgress) onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  // detrended onset envelope
  const detrend = (a, W) => {
    const out = new Float32Array(a.length); let s = 0; const q = [];
    for (let i = 0; i < a.length; i++) { s += a[i]; q.push(a[i]); if (q.length > W) s -= q.shift(); out[i] = Math.max(0, a[i] - s / q.length); }
    let mx = 1e-9; for (const v of out) if (v > mx) mx = v; for (let i = 0; i < out.length; i++) out[i] /= mx;
    return out;
  };
  const W = Math.round(0.4 / hopS);
  const on = detrend(flux, W), onL = detrend(lowFlux, W);
  const onc = new Float32Array(frames); for (let i = 0; i < frames; i++) onc[i] = on[i] + 0.8 * onL[i];
  // tempo by autocorrelation with a broad prior around 115 bpm
  const minLag = Math.floor(60 / 200 / hopS), maxLag = Math.ceil(60 / 50 / hopS);
  const acN = Math.min(maxLag * 4 + 2, frames - 1);
  const ac = new Float32Array(acN + 2);
  for (let lag = minLag; lag <= acN; lag++) { let s = 0; for (let i = lag; i < frames; i++) s += onc[i] * onc[i - lag]; ac[lag] = s / (frames - lag); }
  // comb: a beat period is supported by its multiples (bar-level repetition included)
  const acAt = (l) => { const i = Math.floor(l), f = l - i; return i + 1 <= acN ? ac[i] * (1 - f) + ac[i + 1] * f : 0; };
  let bestLag = 0, bestS = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopS), prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 1.1, 2));
    let sc = 0; const W = [1, 0.85, 0.7, 0.85];
    for (let m = 1; m <= 4; m++) sc += W[m - 1] * acAt(lag * m);
    const s = sc * prior;
    if (s > bestS) { bestS = s; bestLag = lag; }
  }
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1], den = a - 2 * b + c;
    if (Math.abs(den) > 1e-12) lagF = bestLag + clamp(0.5 * (a - c) / den, -0.5, 0.5);
  }
  let bpm = frames > 50 ? 60 / (lagF * hopS) : 100;
  // refine period by maximising comb alignment over the whole track
  const combScore = (per, ph) => { let s = 0, k = 0; for (let t = ph; t < frames - 1; t += per, k++) { const i = Math.floor(t), fr = t - i; s += onc[i] * (1 - fr) + onc[i + 1] * fr; } return k ? s / k : 0; };
  const bestPhase = (per) => { let bp = 0, bs = -1; const steps = 48; for (let j = 0; j < steps; j++) { const ph = (per * j) / steps, s = combScore(per, ph); if (s > bs) { bs = s; bp = ph; } } return [bp, bs]; };
  let per = 60 / bpm / hopS, [ph, sc] = bestPhase(per);
  for (const f of [0.996, 0.998, 1.002, 1.004]) { const p2 = per * f, r = bestPhase(p2); if (r[1] > sc * 1.01) { per = p2; ph = r[0]; sc = r[1]; } }
  bpm = 60 / (per * hopS);
  // dance-friendly range: fold into [70, 140)
  let fold = 1; while (bpm * fold >= 132) fold /= 2; while (bpm * fold < 66) fold *= 2;
  // downbeat: which of the 4 beats carries most low-end
  const beatS = per * hopS;
  const phaseS = ph * hopS + (N / 2) / sr + 0.015;
  const sums = [0, 0, 0, 0], cnts = [0, 0, 0, 0];
  for (let k = 0, t = ph; t < frames - 1; t += per, k++) { const i = Math.round(t); sums[k % 4] += onL[i] + 0.3 * on[i]; cnts[k % 4]++; }
  let db = 0; for (let k = 1; k < 4; k++) if (sums[k] / (cnts[k] || 1) > sums[db] / (cnts[db] || 1)) db = k;
  // energy envelope (0..1) at hop rate, plus a slow version for silence detection
  const db10 = (v) => 20 * Math.log10(v + 1e-6);
  const dbs = Array.from(rms, db10).sort((a, b) => a - b);
  const lo = dbs[Math.floor(dbs.length * 0.08)], hi = dbs[Math.floor(dbs.length * 0.95)];
  const en = new Float32Array(frames), slow = new Float32Array(frames);
  let e = 0, s2 = 0;
  const aUp = 1 - Math.exp(-hopS / 0.05), aDn = 1 - Math.exp(-hopS / 0.35), aS = 1 - Math.exp(-hopS / 0.9);
  for (let i = 0; i < frames; i++) {
    const v = clamp((db10(rms[i]) - lo) / Math.max(6, hi - lo), 0, 1);
    e += (v - e) * (v > e ? aUp : aDn); en[i] = e;
    const loud = db10(rms[i]) > -52 ? 1 : 0; s2 += (loud - s2) * aS; slow[i] = s2;
  }
  return {
    bpmRaw: bpm, bpm: bpm * fold, beat: beatS, phase: phaseS + db * beatS, hop: hopS, energy: en, presence: slow, duration: n0 / sr0,
  };
}
function sampleEnv(arr, hop, t) {
  if (!arr || !arr.length) return 0;
  const f = t / hop, i = Math.floor(f);
  if (i < 0) return arr[0]; if (i >= arr.length - 1) return arr[arr.length - 1];
  return lerp(arr[i], arr[i + 1], f - i);
}

// ---------------------------------------------------------------- WebGL2 renderer
const VS_CHAR = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUV; layout(location=3) in vec2 aUV2;
layout(location=4) in float aFace; layout(location=5) in vec2 aBI; layout(location=6) in vec2 aBW; layout(location=7) in float aMat;
uniform mat4 uVP; uniform mat4 uBones[${NB}]; uniform vec3 uEye;
uniform vec2 uFog; uniform float uShadow; uniform vec3 uShadowDir;
out vec2 vUV; out vec2 vUV2; out float vFace; out vec3 vW; out vec3 vN; flat out int vMat; out float vFog;
void main(){
  mat4 M = uBones[int(aBI.x + 0.5)] * aBW.x + uBones[int(aBI.y + 0.5)] * aBW.y;
  vec4 wp = M * vec4(aPos, 1.0);
  vN = normalize(mat3(M) * aNrm);
  if (uShadow > 0.5) {
    float t = max(wp.y - 0.003, 0.0) / max(0.15, -uShadowDir.y);
    wp.xyz += uShadowDir * t; wp.y = 0.003;
  }
  vW = wp.xyz; vUV = aUV; vUV2 = aUV2; vFace = aFace; vMat = int(aMat + 0.5);
  vFog = smoothstep(uFog.x, uFog.y, distance(wp.xyz, uEye));
  gl_Position = uVP * wp;
}`;
const FS_CHAR = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vUV2; in float vFace; in vec3 vW; in vec3 vN; flat in int vMat; in float vFog;
uniform sampler2D uAtlas; uniform vec3 uFogCol; uniform float uShadow; uniform float uShadowA; uniform float uFaceFlat, uFacet;
uniform vec3 uEye, uKeyDir, uKeyCol, uFillDir, uFillCol, uRimCol, uSky, uGround;
out vec4 o;
void main(){
  if (uShadow > 0.5) { o = vec4(0.0, 0.0, 0.0, uShadowA); return; }
  // material table: spec, shininess, wrap, facet
  vec4 m = vec4(0.04, 6.0, 0.3, 0.95);
  if (vMat == 0) m = vec4(0.08, 12.0, 0.3, 0.72);         // skin
  else if (vMat == 2) m = vec4(0.22, 18.0, 0.25, 1.0);    // hair
  else if (vMat == 3) m = vec4(0.22, 24.0, 0.25, 0.9);    // shoes
  else if (vMat == 4) m = vec4(0.05, 10.0, 0.45, 0.25);   // face
  else if (vMat == 5) m = vec4(0.95, 42.0, 0.1, 0.7);     // metal
  else if (vMat == 6) m = vec4(0.75, 60.0, 0.15, 0.6);    // gloss (lenses, plastic)
  else if (vMat == 7) m = vec4(0.04, 6.0, 0.32, 0.4);     // soft cloth (tops)
  vec3 nS = normalize(vN);
  vec3 nF = normalize(cross(dFdx(vW), dFdy(vW)));
  float inside = 0.0;
  if (dot(nF, nS) < 0.0) { nS = -nS; inside = 1.0; }
  vec3 n = normalize(mix(nS, nF, m.w * uFacet));
  vec3 V = normalize(uEye - vW);
  float k = clamp((dot(n, -uKeyDir) + m.z) / (1.0 + m.z), 0.0, 1.0);
  float f = clamp((dot(n, -uFillDir) + 0.3) / 1.3, 0.0, 1.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  float rim = pow(1.0 - clamp(abs(dot(n, V)), 0.0, 1.0), 2.6);
  vec3 L = amb + uKeyCol * k + uFillCol * f + uRimCol * rim;
  float avg = dot(L, vec3(0.3333));
  L = mix(L, vec3(avg) * 0.85 + 0.2, vFace * uFaceFlat);
  vec3 H = normalize(-uKeyDir + V);
  vec3 spec = uKeyCol * m.x * pow(max(dot(n, H), 0.0), m.y);
  vec3 a = mix(texture(uAtlas, vUV).rgb, texture(uAtlas, vUV2).rgb, vFace);
  if (vMat == 5) { vec3 R = reflect(-V, n); a *= 0.55 + 0.45 * mix(uGround, uSky, R.y * 0.5 + 0.5) / max(0.2, dot(uSky, vec3(0.333))); }
  vec3 c = (a * L + spec) * (1.0 - 0.42 * inside);
  c = mix(c, uFogCol, vFog);
  o = vec4(c, 1.0);
}`;
const VS_FLOOR = `#version 300 es
precision highp float;
layout(location=0) in vec2 aXZ; uniform mat4 uVP; out vec3 vW;
void main(){ vW = vec3(aXZ.x, 0.0, aXZ.y); gl_Position = uVP * vec4(vW, 1.0); }`;
const FS_FLOOR = `#version 300 es
precision highp float;
in vec3 vW; out vec4 o;
uniform vec3 uFloorA, uFloorB, uAmb, uSpotCol, uFogCol, uEye; uniform vec2 uFog; uniform vec4 uSpot; uniform float uTile, uAO, uPattern; uniform vec2 uChar;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i+vec2(1,0)), u.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), u.x), u.y); }
void main(){
  vec2 p = vW.xz;
  float grain = n2(p * 7.0) * 0.5 + n2(p * 23.0) * 0.3 + n2(p * 61.0) * 0.2;
  vec3 col = mix(uFloorA, uFloorB, grain);
  if (uPattern > 1.5) {
    vec2 gq = abs(fract(p / uTile + 0.5) - 0.5) * uTile;
    float px = fwidth(p.x) + fwidth(p.y);
    float ln = 1.0 - smoothstep(0.0, px * 1.2, min(gq.x, gq.y));
    col = uFloorA + vec3(0.07) * ln;
    float ax = 1.0 - smoothstep(0.0, px * 1.5, abs(p.y)), az = 1.0 - smoothstep(0.0, px * 1.5, abs(p.x));
    col = mix(col, vec3(0.62, 0.2, 0.22), ax * 0.8); col = mix(col, vec3(0.38, 0.55, 0.2), az * 0.6);
  } else if (uPattern > 0.5) {
    vec2 g = p / uTile; vec2 cell = floor(g + vec2(0.0, step(1.0, mod(floor(g.x), 2.0)) * 0.5));
    vec2 gg = g + vec2(0.0, step(1.0, mod(floor(g.x), 2.0)) * 0.5); vec2 f = fract(gg);
    float e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float grout = smoothstep(0.0, 0.035, e);
    float tr = h2(cell);
    col = mix(uFloorA, uFloorB, clamp(tr * 0.8 + grain * 0.4, 0.0, 1.0)) * (0.62 + 0.38 * grout);
    col *= 0.9 + 0.2 * n2(p * 3.0 + tr * 9.0);
  }
  float d = length(p - uSpot.xy);
  float sp = exp(-d * d / (uSpot.z * uSpot.z));
  vec3 c = col * (uAmb + uSpotCol * sp);
  vec2 q = p - uChar;
  c *= 1.0 - uAO * exp(-dot(q, q) / 0.06);
  float fg = smoothstep(uFog.x, uFog.y, distance(vW, uEye));
  o = vec4(mix(c, uFogCol, fg), 1.0);
}`;
const VS_FS = `#version 300 es
precision highp float; out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FS_SKY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform vec3 uTop, uBot, uGlow; uniform float uHorizon, uUseImg; uniform sampler2D uImg; uniform vec4 uImgUV;
void main(){
  if (uUseImg > 0.5) { o = vec4(texture(uImg, uImgUV.xy + vUV * uImgUV.zw).rgb, 1.0); return; }
  float t = smoothstep(uHorizon - 0.01, uHorizon + 0.62, vUV.y);
  vec3 c = mix(uBot, uTop, pow(t, 0.75));
  vec2 q = (vUV - vec2(0.5, uHorizon + 0.08)) * vec2(1.4, 1.6);
  c += uGlow * exp(-dot(q, q) * 4.0);
  o = vec4(c, 1.0);
}`;
const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir;
void main(){
  vec3 c = texture(uSrc, vUV).rgb * 0.227;
  c += (texture(uSrc, vUV + uDir * 1.385).rgb + texture(uSrc, vUV - uDir * 1.385).rgb) * 0.316;
  c += (texture(uSrc, vUV + uDir * 3.231).rgb + texture(uSrc, vUV - uDir * 3.231).rgb) * 0.070;
  o = vec4(c, 1.0);
}`;
const FS_POST = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc, uGlow; uniform vec2 uIn; uniform float uDither, uGlowAmt, uScan, uVig, uGrain, uTime, uSat, uLevels;
float bayer4(vec2 p){ ivec2 i = ivec2(mod(p, 4.0)); int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return (float(m[i.y*4+i.x]) + 0.5) / 16.0; }
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
void main(){
  vec3 c = texture(uSrc, vUV).rgb;
  vec3 g = texture(uGlow, vUV).rgb;
  c = c + max(g - 0.6, 0.0) * uGlowAmt * 1.7 + g * uGlowAmt * 0.1;
  float l = dot(c, vec3(0.299, 0.587, 0.114)); c = mix(vec3(l), c, uSat);
  vec2 q = vUV - 0.5; c *= 1.0 - uVig * dot(q, q) * 1.6;
  vec2 ip = floor(vUV * uIn);
  float lev = uLevels - 1.0;
  vec3 dq = floor(c * lev + bayer4(ip)) / lev;
  c = mix(c, dq, uDither);
  c *= 1.0 - uScan * step(0.5, fract(vUV.y * uIn.y * 0.5));
  c += (h(gl_FragCoord.xy) - 0.5) * uGrain;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const SCENES = {
  grid: {
    top: [0.24, 0.24, 0.25], bot: [0.22, 0.22, 0.23], glow: [0.0, 0.0, 0.0], horizon: 0.4,
    floorA: [0.215, 0.215, 0.225], floorB: [0.215, 0.215, 0.225], pattern: 2, tile: 0.5,
    amb: [0.58, 0.58, 0.6], floorAmb: [1, 1, 1], spot: [0, 0, 0], spotR: 2, fogCol: [0.235, 0.235, 0.245], fog: [6.0, 22.0],
    key: [0.82, 0.8, 0.76], keyDir: [-0.35, -0.8, -0.48], fill: [0.28, 0.29, 0.33], fillDir: [0.7, -0.2, -0.6],
    rim: [0.24, 0.25, 0.28], sky: [0.38, 0.38, 0.4], ground: [0.17, 0.17, 0.17], shadowA: 0.22, ao: 0.22, bloom: 0.12,
  },
  void: {
    top: [0.0, 0.0, 0.0], bot: [0.02, 0.02, 0.025], glow: [0.025, 0.025, 0.03], horizon: 0.42,
    floorA: [0.11, 0.11, 0.115], floorB: [0.16, 0.16, 0.165], pattern: 0, tile: 1,
    amb: [0.16, 0.16, 0.17], spot: [1.25, 1.2, 1.1], spotR: 1.45, fogCol: [0, 0, 0], fog: [5.5, 13.0],
    key: [1.0, 0.96, 0.9], keyDir: [-0.38, -0.82, -0.42], fill: [0.16, 0.18, 0.24], fillDir: [0.7, -0.2, -0.6],
    rim: [0.42, 0.46, 0.55], sky: [0.2, 0.2, 0.24], ground: [0.08, 0.075, 0.07], shadowA: 0.55, ao: 0.45, bloom: 0.35,
  },
  haze: {
    top: [0.66, 0.72, 0.74], bot: [0.84, 0.86, 0.84], glow: [0.025, 0.025, 0.02], horizon: 0.38,
    floorA: [0.42, 0.44, 0.41], floorB: [0.62, 0.63, 0.59], pattern: 1, tile: 0.62,
    amb: [0.6, 0.62, 0.62], floorAmb: [0.8, 0.82, 0.82], spot: [0.14, 0.13, 0.12], spotR: 2.4, fogCol: [0.84, 0.86, 0.84], fog: [4.0, 24.0],
    key: [0.72, 0.7, 0.66], keyDir: [-0.3, -0.9, -0.3], fill: [0.28, 0.3, 0.32], fillDir: [0.6, -0.3, -0.7],
    rim: [0.3, 0.32, 0.34], sky: [0.5, 0.53, 0.55], ground: [0.3, 0.3, 0.28], shadowA: 0.28, ao: 0.3, bloom: 0.4,
  },
  studio: {
    top: [0.86, 0.85, 0.83], bot: [0.76, 0.75, 0.73], glow: [0.05, 0.05, 0.05], horizon: 0.36,
    floorA: [0.7, 0.69, 0.67], floorB: [0.74, 0.73, 0.71], pattern: 0, tile: 1,
    amb: [0.6, 0.6, 0.6], floorAmb: [0.95, 0.94, 0.93], spot: [0.12, 0.12, 0.12], spotR: 2.0, fogCol: [0.77, 0.76, 0.74], fog: [4.0, 16.0],
    key: [0.86, 0.83, 0.78], keyDir: [-0.45, -0.75, -0.48], fill: [0.24, 0.25, 0.28], fillDir: [0.7, -0.2, -0.6],
    rim: [0.26, 0.26, 0.28], sky: [0.34, 0.34, 0.36], ground: [0.18, 0.17, 0.16], shadowA: 0.32, ao: 0.32, bloom: 0.3,
  },
  night: {
    top: [0.02, 0.025, 0.07], bot: [0.07, 0.05, 0.12], glow: [0.1, 0.04, 0.12], horizon: 0.4,
    floorA: [0.08, 0.08, 0.1], floorB: [0.13, 0.12, 0.16], pattern: 1, tile: 0.9,
    amb: [0.18, 0.16, 0.26], spot: [0.9, 0.55, 1.1], spotR: 1.6, fogCol: [0.05, 0.04, 0.09], fog: [5.0, 15.0],
    key: [0.95, 0.55, 0.85], keyDir: [-0.5, -0.7, -0.5], fill: [0.15, 0.45, 0.6], fillDir: [0.75, -0.25, -0.6],
    rim: [0.35, 0.75, 0.95], sky: [0.16, 0.14, 0.3], ground: [0.06, 0.05, 0.08], shadowA: 0.5, ao: 0.4, bloom: 0.6,
  },
};

function Renderer() {
  const cv = (this.canvas = document.createElement('canvas'));
  cv.width = 1080; cv.height = 1920;
  const gl = (this.gl = cv.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: true, premultipliedAlpha: false }));
  if (!gl) throw new Error('WebGL2 unavailable');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').slice(0, 3).join('\n')); return s; };
  const prog = (vs, fs) => {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const inf = gl.getActiveUniform(p, i); const nm = inf.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, inf.name); }
    return { p, u };
  };
  this.pChar = prog(VS_CHAR, FS_CHAR);
  this.pFloor = prog(VS_FLOOR, FS_FLOOR);
  this.pSky = prog(VS_FS, FS_SKY);
  this.pBlur = prog(VS_FS, FS_BLUR);
  this.pPost = prog(VS_FS, FS_POST);
  this.vaoEmpty = gl.createVertexArray();
  // floor quad
  this.vaoFloor = gl.createVertexArray(); gl.bindVertexArray(this.vaoFloor);
  const fb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-40, -40, 40, -40, 40, 40, -40, -40, 40, 40, -40, 40]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  this.atlasTex = gl.createTexture();
  this.bgTex = gl.createTexture();
  this.bgInfo = null;
  this.iw = 0; this.ih = 0;
  this.pose = makePoseState();
}
Renderer.prototype.setMesh = function (G) {
  const gl = this.gl;
  if (this.vaoChar) { gl.deleteVertexArray(this.vaoChar); (this.bufs || []).forEach((b) => gl.deleteBuffer(b)); }
  const vao = (this.vaoChar = gl.createVertexArray()); gl.bindVertexArray(vao); this.bufs = [];
  const add = (loc, arr, size) => { const b = gl.createBuffer(); this.bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
  add(0, G.pos, 3); add(1, G.nrm, 3); add(2, G.uv, 2); add(3, G.uv2, 2); add(4, G.face, 1); add(5, G.bi, 2); add(6, G.bw, 2); add(7, G.mat, 1);
  const ib = gl.createBuffer(); this.bufs.push(ib); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  const big = G.pos.length / 3 > 65535;
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(G.idx) : new Uint16Array(G.idx), gl.STATIC_DRAW);
  this.idxType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  this.nIdx = G.idx.length;
  gl.bindVertexArray(null);
};
Renderer.prototype.setAtlas = function (canvas) {
  const gl = this.gl;
  gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};
Renderer.prototype.setBackground = function (img) {
  const gl = this.gl;
  if (!img) { this.bgInfo = null; return; }
  gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  this.bgInfo = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
};
Renderer.prototype.ensureTargets = function (ow, oh, ih) {
  const gl = this.gl;
  if (this.canvas.width !== ow || this.canvas.height !== oh) { this.canvas.width = ow; this.canvas.height = oh; }
  ih = Math.max(120, Math.round(ih)); const iw = Math.max(68, Math.round((ih * ow) / oh));
  if (iw === this.iw && ih === this.ih) return;
  this.iw = iw; this.ih = ih;
  const del = (o, f) => { if (o) gl[f](o); };
  del(this.fbMS, 'deleteFramebuffer'); del(this.rbC, 'deleteRenderbuffer'); del(this.rbD, 'deleteRenderbuffer');
  del(this.fbRes, 'deleteFramebuffer'); del(this.texRes, 'deleteTexture');
  (this.blur || []).forEach((b) => { gl.deleteFramebuffer(b.fb); gl.deleteTexture(b.tex); });
  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
  this.fbMS = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbMS);
  this.rbC = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbC);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, iw, ih);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.rbC);
  this.rbD = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbD);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, iw, ih);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.rbD);
  const mkTex = (w, h) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  this.texRes = mkTex(iw, ih);
  this.fbRes = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbRes);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texRes, 0);
  const bw = Math.max(16, Math.round(iw / 4)), bh = Math.max(16, Math.round(ih / 4));
  this.blur = [0, 1].map(() => { const tex = mkTex(bw, bh), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return { tex, fb, w: bw, h: bh }; });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

// camera: azimuth/elevation per preset; distance & height from the (pre-measured) pose framing
// adj: user camera on top of the preset {az, el (degrees), zoom, spin (deg/s)}
function camAngles(preset, t, adj) {
  let az = 0, el = 9;
  if (preset === '34') az = 24;
  else if (preset === '34r') az = -24;
  else if (preset === 'low') el = -1;
  else if (preset === 'close') { az = 14; el = 4; }
  else if (preset === 'face') { az = 10; el = 3; }
  else if (preset === 'orbit') { az = 32 * Math.sin((t * 2 * Math.PI) / 24); el = 9 + 3 * Math.sin((t * 2 * Math.PI) / 17); }
  az += 0.6 * noise1(t * 0.13 + 4); el += 0.4 * noise1(t * 0.11 + 9);
  if (adj) { az += (adj.az || 0) + (adj.spin || 0) * t; el = clamp(el + (adj.el || 0), -12, 70); }
  return { az, el };
}
function cameraFor(aspect, preset, t, fr, adj) {
  const portrait = aspect < 1;
  const fovy = (portrait ? 30 : 26) * DEG;
  const { az, el } = camAngles(preset, t, adj);
  let visH, ty;
  const cx = fr ? fr.cx * 0.7 : 0, cz = fr ? fr.cz * 0.7 : 0;
  if (preset === 'close') { visH = portrait ? 1.05 : 0.8; ty = fr ? fr.head - 0.22 : 1.45; }
  else if (preset === 'face') { visH = portrait ? 0.46 : 0.36; ty = fr ? fr.head - 0.01 : 1.62; }
  else {
    const top = fr ? fr.top + 0.16 : 1.95, bot = -0.14;
    const halfW = fr ? fr.halfW + 0.16 : 0.6;
    const needH = top - bot, needW = (2 * halfW) / aspect;
    const base = portrait ? 2.25 : 2.3;
    visH = Math.max(needH, Math.min(needW, base * 1.22), base);
    ty = bot + visH / 2 + (visH > needH ? -(visH - needH) * 0.18 : 0);
  }
  const zoom = adj && adj.zoom ? clamp(adj.zoom, 0.4, 3) : 1;
  if (zoom !== 1) { visH /= zoom; if (preset !== 'face' && preset !== 'close') ty = lerp(ty, (fr ? fr.head : 1.65) - 0.4, smooth(1, 2.6, zoom)); }
  const dist = visH / 2 / Math.tan(fovy / 2);
  const tgt = [cx, ty, cz];
  const eye = [cx + dist * Math.sin(az * DEG) * Math.cos(el * DEG), ty + dist * Math.sin(el * DEG), cz + dist * Math.cos(az * DEG) * Math.cos(el * DEG)];
  return { eye, tgt, fovy, az };
}
// extents of a solved pose relative to a camera azimuth
function poseExtent(st, az) {
  const R = [Math.cos(az * DEG), 0, -Math.sin(az * DEG)];
  const c = st.wp[0];
  let hw = 0, top = 0;
  const pts = st.wp.filter((p, i) => i !== B.prop);
  pts.push(v3.add(st.wp[B.head], q4.rot(st.wq[B.head], [0, 0.24, 0.02])));
  for (const h of [B.handL, B.handR]) pts.push(v3.add(st.wp[h], q4.rot(st.wq[h], [0, -0.17, 0])));
  for (const f of [B.footL, B.footR]) pts.push(v3.add(st.wp[f], q4.rot(st.wq[f], [0, 0, 0.2])));
  for (const p of pts) { const x = Math.abs((p[0] - c[0]) * R[0] + (p[2] - c[2]) * R[2]); if (x > hw) hw = x; if (p[1] > top) top = p[1]; }
  return { hw, top, cx: c[0], cz: c[2], head: st.wp[B.head][1] + 0.1 };
}

Renderer.prototype.draw = function (S) {
  // S: {ow, oh, ih, pose(params), scene, camera, t, dither, glow, scan, useBg}
  const gl = this.gl;
  this.ensureTargets(S.ow, S.oh, S.ih);
  const sc = SCENES[S.scene] || SCENES.void;
  const iw = this.iw, ih = this.ih, aspect = iw / ih;
  solvePose(S.pose, this.pose);
  const cam = cameraFor(aspect, S.camera, S.t, S.frame, S.camAdj);
  const P = m4.persp(cam.fovy, aspect, 0.1, 80), V = m4.lookAt(cam.eye, cam.tgt, [0, 1, 0]);
  const VP = m4.mul(P, V);
  gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbMS);
  gl.viewport(0, 0, iw, ih);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  const useBg = S.useBg && this.bgInfo;
  // sky / background image
  gl.useProgram(this.pSky.p); gl.bindVertexArray(this.vaoEmpty);
  let u = this.pSky.u;
  const fh = v3.norm([cam.tgt[0] - cam.eye[0], 0, cam.tgt[2] - cam.eye[2]]), pf = v3.add(cam.eye, v3.scale(fh, 500));
  const cy = VP[1] * pf[0] + VP[5] * pf[1] + VP[9] * pf[2] + VP[13], cw = VP[3] * pf[0] + VP[7] * pf[1] + VP[11] * pf[2] + VP[15];
  const horizon = cw > 0 ? (cy / cw) * 0.5 + 0.5 : 0.5;
  gl.uniform3fv(u.uTop, sc.top); gl.uniform3fv(u.uBot, sc.fogCol); gl.uniform3fv(u.uGlow, sc.glow); gl.uniform1f(u.uHorizon, horizon);
  gl.uniform1f(u.uUseImg, useBg ? 1 : 0);
  if (useBg) {
    const ia = this.bgInfo.w / this.bgInfo.h; let sx = 1, sy = 1;
    if (ia > aspect) sx = aspect / ia; else sy = ia / aspect;
    gl.uniform4f(u.uImgUV, (1 - sx) / 2, (1 - sy) / 2, sx, sy);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bgTex); gl.uniform1i(u.uImg, 0);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // floor
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
  const charXZ = [this.pose.wp[0][0], this.pose.wp[0][2]];
  if (!useBg) {
    gl.useProgram(this.pFloor.p); gl.bindVertexArray(this.vaoFloor); u = this.pFloor.u;
    gl.uniformMatrix4fv(u.uVP, false, VP);
    gl.uniform3fv(u.uFloorA, sc.floorA); gl.uniform3fv(u.uFloorB, sc.floorB); gl.uniform3fv(u.uAmb, sc.floorAmb || sc.amb); gl.uniform3fv(u.uSpotCol, sc.spot);
    gl.uniform3fv(u.uFogCol, sc.fogCol); gl.uniform3fv(u.uEye, cam.eye); gl.uniform2fv(u.uFog, sc.fog);
    gl.uniform4f(u.uSpot, charXZ[0] * 0.5, charXZ[1] * 0.5, sc.spotR, 0); gl.uniform1f(u.uTile, sc.tile); gl.uniform1f(u.uPattern, sc.pattern);
    gl.uniform1f(u.uAO, sc.ao); gl.uniform2fv(u.uChar, charXZ);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  if (this.vaoChar) {
    gl.useProgram(this.pChar.p); gl.bindVertexArray(this.vaoChar); u = this.pChar.u;
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uBones, false, this.pose.mats); gl.uniform3fv(u.uEye, cam.eye);
    const kd = v3.norm(sc.keyDir), fd = v3.norm(sc.fillDir);
    gl.uniform3fv(u.uKeyDir, kd); gl.uniform3fv(u.uKeyCol, sc.key); gl.uniform3fv(u.uFillDir, fd); gl.uniform3fv(u.uFillCol, sc.fill);
    gl.uniform3fv(u.uRimCol, sc.rim); gl.uniform3fv(u.uSky, sc.sky); gl.uniform3fv(u.uGround, sc.ground);
    gl.uniform2fv(u.uFog, sc.fog); gl.uniform3fv(u.uFogCol, sc.fogCol); gl.uniform1f(u.uFaceFlat, 0.62); gl.uniform1f(u.uFacet, S.facet == null ? 1 : S.facet);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex); gl.uniform1i(u.uAtlas, 0);
    // planar shadow (stencil so overlaps don't double-darken)
    gl.uniform1f(u.uShadow, 1); gl.uniform1f(u.uShadowA, useBg ? 0.38 : sc.shadowA);
    gl.uniform3fv(u.uShadowDir, v3.norm([kd[0] * 0.6, -1, kd[2] * 0.6]));
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
    gl.drawElements(gl.TRIANGLES, this.nIdx, this.idxType, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.depthMask(true);
    gl.uniform1f(u.uShadow, 0);
    gl.drawElements(gl.TRIANGLES, this.nIdx, this.idxType, 0);
  }
  // resolve MSAA
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbMS); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbRes);
  gl.blitFramebuffer(0, 0, iw, ih, 0, 0, iw, ih, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.disable(gl.DEPTH_TEST);
  // glow
  gl.useProgram(this.pBlur.p); gl.bindVertexArray(this.vaoEmpty); u = this.pBlur.u;
  const b0 = this.blur[0], b1 = this.blur[1];
  gl.bindFramebuffer(gl.FRAMEBUFFER, b0.fb); gl.viewport(0, 0, b0.w, b0.h);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texRes); gl.uniform1i(u.uSrc, 0); gl.uniform2f(u.uDir, 1 / iw * 2, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, b1.fb); gl.bindTexture(gl.TEXTURE_2D, b0.tex); gl.uniform2f(u.uDir, 0, 1 / b0.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, b0.fb); gl.bindTexture(gl.TEXTURE_2D, b1.tex); gl.uniform2f(u.uDir, 1 / b0.w, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, b1.fb); gl.bindTexture(gl.TEXTURE_2D, b0.tex); gl.uniform2f(u.uDir, 0, 1 / b0.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  // post to canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, S.ow, S.oh);
  gl.useProgram(this.pPost.p); u = this.pPost.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texRes); gl.uniform1i(u.uSrc, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, b1.tex); gl.uniform1i(u.uGlow, 1);
  gl.uniform2f(u.uIn, iw, ih); gl.uniform1f(u.uDither, S.dither); gl.uniform1f(u.uGlowAmt, sc.bloom * (S.glow == null ? 1 : S.glow));
  gl.uniform1f(u.uScan, S.scan || 0); gl.uniform1f(u.uVig, 0.55); gl.uniform1f(u.uGrain, 0.025); gl.uniform1f(u.uTime, (S.t * 13.7) % 100);
  gl.uniform1f(u.uSat, 1.06); gl.uniform1f(u.uLevels, 32);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(null);
  return this.canvas;
};

// ---------------------------------------------------------------- public API
const DEFAULT_LOOK = {
  hairStyle: 'spiky', hat: 'none', hatSlouch: 0, beard: 'none', top: 'tank', print: true, bottom: 'baggy', denim: true, shoes: 'chunky', build: 'avg', frame: 'straight',
  phones: true, shades: false, glasses: false, chain: false, pendant: false, metal: 'silver', belt: false, bag: false, wings: false, seed: 11,
  skin: [228, 186, 158], hairC: [112, 76, 52], eyeC: [62, 40, 30], topC: [236, 234, 228], top2C: [40, 40, 46],
  bottomC: [92, 102, 118], shoesC: [54, 56, 62], soleC: [228, 226, 218], lensC: [42, 48, 70], sockC: [240, 240, 236], boxerC: [236, 236, 236], hatC: [28, 28, 32], bagC: [30, 30, 34],
};
const clone = (o) => JSON.parse(JSON.stringify(o));

function Dancer() {
  this.r = new Renderer();
  this.canvas = this.r.canvas;
  this.look = clone(DEFAULT_LOOK);
  this.photo = null;
  this.analysis = null;
  this.audio = null;
  this.opt = { dance: 'vibe', scene: 'void', camera: '34', res: 960, facet: 1, dither: 0.55, glow: 1, scan: 0, intensity: 1, bpmMul: 1, bpm: 0, phase: null, offset: 0, camAz: 0, camEl: 0, camZoom: 1, camSpin: 0, useBg: false };
  this._P = {};
  this._idle = 1; this._lastWall = 0;
  this._dirty = true;
}
Dancer.prototype._rebuild = function () {
  const G = buildCharacter(this.look);
  this.r.setMesh(G);
  this.r.setAtlas(paintAtlas(this.look));
  this.tris = G.idx.length / 3;
  this._dirty = false;
};
// photo: a decoded image (ideally full body, facing the camera). The photo only styles the character.
// Reads the body with the pose model (landmarks + person mask); falls back to the face-anchored heuristic offline.
Dancer.prototype.setPhoto = async function (img, opts) {
  opts = opts || {};
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, 1600 / Math.max(iw, ih));
  const c = mkCanvas(Math.max(8, Math.round(iw * s)), Math.max(8, Math.round(ih * s)));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const ph = { img: c, pose: null, eyes: opts.eyes || null };
  this.photo = ph;
  if (opts.pose !== false) {
    try { ph.pose = await detectPose(c); if (!ph.pose) ph.poseError = 'no person found'; } catch (e) { ph.poseError = String((e && e.message) || e); }
  }
  if (this.photo !== ph) return null; // replaced while the model was loading
  return this._analyze(opts.applyStyle !== false);
};
Dancer.prototype._analyze = function (apply) {
  const ph = this.photo;
  let a;
  if (ph.pose) { a = readPerson(ph.img, ph.pose); a.found = true; }
  else { a = legacyRead(analyzePhoto(ph.img, ph.eyes)); if (ph.poseError) a.note = ph.poseError; }
  this.analysis = a; ph.eyes = a.eyes;
  if (apply) lookFromRead(this.look, a);
  this._dirty = true;
  return a;
};
// map a read (pose reader or the heuristic) onto the look; extras the photo can't show stay as they were
function lookFromRead(L, a) {
  const d = DEFAULT_LOOK, cp = (c, f) => (c ? c.slice() : f.slice());
  L.skin = cp(a.skin, d.skin); L.hairC = cp(a.hairC, d.hairC);
  L.hairStyle = a.hairStyle || d.hairStyle;
  L.hat = a.headwear || 'none'; if (a.headwearC) L.hatC = a.headwearC.slice(); L.hatSlouch = a.hatSlouch || 0;
  L.beard = a.beard || 'none';
  L.top = a.top || d.top; L.topC = cp(a.topC, d.topC);
  L.top2C = a.top2C ? a.top2C.slice() : mixc(L.topC, lum(L.topC) > 128 ? [20, 20, 24] : [240, 240, 240], 0.8).map(Math.round);
  L.print = !!a.print;
  if (a.bottom) { L.bottom = a.bottom; L.denim = !!a.denim; } L.bottomC = cp(a.bottomC, d.bottomC);
  L.shoes = a.shoes || 'chunky'; L.shoesC = cp(a.shoesC, d.shoesC); L.soleC = cp(a.soleC, d.soleC);
  if (a.sock) L.sockC = a.sock.slice();
  if (a.build) L.build = a.build; if (a.frame) L.frame = a.frame;
  L.shades = !!a.shades; L.chain = !!a.chain; L.pendant = !!a.pendant; L.metal = a.metal || 'silver';
  L.phones = false;
  L.seed = (Math.round(L.skin[0] * 7 + L.hairC[1] * 13 + L.topC[2] * 3) % 997) + 1;
}
// the heuristic analyser's result in the reader's shape
function legacyRead(a) {
  const r = {
    method: a.method || 'face', found: a.found, fullBody: a.fullBody, eyes: a.eyes, regions: a.regions || {}, read: [],
    skin: a.skin, hairC: a.hair, hairStyle: a.hairStyle, headwear: 'none', top: a.topStyle, topC: a.top, top2C: a.top2, print: !!a.top2,
    bottom: a.bottomStyle, bottomC: a.bottom, shoes: 'chunky', shoesC: a.shoes, soleC: a.sole, sock: a.sock, shades: a.shades,
  };
  readSummary(r);
  return r;
}
Dancer.prototype.clearPhoto = function () { this.photo = null; this.analysis = null; this.look = clone(DEFAULT_LOOK); this._dirty = true; };
// hand corrections. Heuristic mode: the two eyes (photo pixels, l = the eye on the image's left).
// Pose mode: any of the 33 landmarks ({index: [x, y]}). Both re-read the style.
Dancer.prototype.setEyes = function (eyes) {
  if (!this.photo) return null;
  if (this.photo.pose) { const lm = this.photo.pose.lm; const a = eyes.l, b = eyes.r; lm[2] = [b[0], b[1], 1]; lm[5] = [a[0], a[1], 1]; }
  else this.photo.eyes = eyes;
  return this._analyze(true);
};
Dancer.prototype.getEyes = function () { return this.photo && this.photo.eyes ? clone(this.photo.eyes) : null; };
Dancer.prototype.getLandmarks = function () { return this.photo && this.photo.pose ? clone(this.photo.pose.lm) : null; };
Dancer.prototype.setLandmarks = function (moves) {
  if (!this.photo || !this.photo.pose) return null;
  const lm = this.photo.pose.lm;
  for (const k of Object.keys(moves)) { const i = +k; if (lm[i]) lm[i] = [moves[k][0], moves[k][1], 1]; }
  return this._analyze(true);
};
Dancer.prototype.setLook = function (partial) { Object.assign(this.look, partial); this._dirty = true; };
Dancer.prototype.getLook = function () { return clone(this.look); };
Dancer.prototype.set = function (o) {
  Object.assign(this.opt, o);
  if (o && 'background' in o) { this.r.setBackground(o.background || null); this.opt.useBg = !!o.background; delete this.opt.background; }
};
Dancer.prototype.setAudioBuffer = async function (buffer, onProgress) {
  if (!buffer) { this.audio = null; return null; }
  this.audio = await analyzeAudio(buffer, onProgress);
  return { bpm: this.audio.bpm, bpmRaw: this.audio.bpmRaw, phase: this.audio.phase };
};
Dancer.prototype.tempo = function () {
  // a typed / tapped BPM is the track's tempo; dance tempo is folded into 66–132 like the detected one
  let base = this.audio ? this.audio.bpm : 100;
  if (this.opt.bpm > 0) { base = this.opt.bpm; while (base > 132) base /= 2; while (base < 66) base *= 2; }
  // manual BPM keeps the detected downbeat unless a tap set its own; offset nudges the whole grid (ms)
  const phase = (this.opt.phase != null ? this.opt.phase : this.audio ? this.audio.phase : 0) + (this.opt.offset || 0) / 1000;
  return { bpm: base * (this.opt.bpmMul || 1), phase };
};
// tap tempo: call on each tap with the song time; after 3+ taps sets bpm and the beat grid
Dancer.prototype.tap = function (t) {
  const T = this._taps = (this._taps || []).filter((x) => t - x < 4 && t > x);
  T.push(t);
  if (T.length < 3) return null;
  const n = T.length, iv = (T[n - 1] - T[0]) / (n - 1);
  if (iv < 0.25 || iv > 1.5) return null;
  let bpm = 60 / iv; while (bpm < 60) bpm *= 2; while (bpm > 200) bpm /= 2;
  this.opt.bpm = Math.round(bpm * 10) / 10; this.opt.bpmMul = 1;
  const beat = 60 / this.opt.bpm; this.opt.phase = T[n - 1] - Math.floor(T[n - 1] / beat) * beat;
  return { bpm: this.opt.bpm };
};
Dancer.prototype.resetTempo = function () { this.opt.bpm = 0; this.opt.phase = null; this.opt.offset = 0; this.opt.bpmMul = 1; this._taps = []; };
Dancer.prototype._camAdj = function () { const o = this.opt; return { az: o.camAz || 0, el: o.camEl || 0, zoom: o.camZoom || 1, spin: o.camSpin || 0 }; };
// beat clock for UI: {beat (float), bar (beats in bar 0..3)}
Dancer.prototype.beatAt = function (t) { const tp = this.tempo(); const b = (t - tp.phase) / (60 / tp.bpm); return { beat: b, inBar: mod(Math.floor(b), 4), frac: b - Math.floor(b), bpm: tp.bpm }; };
Dancer.prototype._cfgAt = function (t, tp, idle) {
  let E = 0.75;
  if (this.audio) E = sampleEnv(this.audio.energy, this.audio.hop, t);
  E = clamp(E * (this.opt.intensity == null ? 1 : this.opt.intensity), 0, 1.4);
  return { bpm: tp.bpm, phase: tp.phase, energy: E, dance: this.opt.dance, idle };
};
// framing: soft-max of pose extents over a ±0.9 s window → smooth, deterministic auto-zoom
Dancer.prototype._framing = function (t, tp, idle) {
  const st = this._fst || (this._fst = makePoseState()), Pk = this._fP || (this._fP = {});
  const az = camAngles(this.opt.camera, t, this._camAdj()).az;
  let sw = 0, sHW = 0, sTop = 0, cur = null;
  for (let k = -6; k <= 6; k++) {
    const tk = t + k * 0.15, g = Math.exp(-(k / 4.2) * (k / 4.2));
    dancePose(tk, this._cfgAt(tk, tp, idle), Pk); solvePose(Pk, st);
    const e = poseExtent(st, az);
    if (k === 0) cur = e;
    sw += g; sHW += g * Math.pow(e.hw, 8); sTop += g * Math.pow(e.top, 8);
  }
  return { halfW: Math.pow(sHW / sw, 1 / 8), top: Math.pow(sTop / sw, 1 / 8), cx: cur.cx, cz: cur.cz, head: cur.head };
};
// t = song time in seconds. o: {width, height, playing, live}
Dancer.prototype.render = function (t, o) {
  o = o || {};
  if (this._dirty) this._rebuild();
  const W = o.width || this.canvas.width, H = o.height || this.canvas.height;
  const tp = this.tempo();
  let presence = 1;
  if (this.audio) presence = sampleEnv(this.audio.presence, this.audio.hop, t);
  let idle = this.audio ? 1 - smooth(0.12, 0.55, presence) : 0;
  if (o.playing === false) idle = 1;
  if (o.live) {
    const now = performance.now(), dt = this._lastWall ? Math.min(0.1, (now - this._lastWall) / 1000) : 0;
    this._lastWall = now;
    this._idle += (idle - this._idle) * (1 - Math.exp(-dt / 0.25));
    idle = this._idle;
  } else { this._idle = idle; this._lastWall = 0; }
  const P = dancePose(t, this._cfgAt(t, tp, idle), this._P);
  const frame = this._framing(t, tp, idle);
  const res = this.opt.res > 0 ? this.opt.res : Math.max(W, H);
  const ih = H >= W ? Math.min(H, res) : Math.min(H, Math.round((res * H) / W));
  return this.r.draw({ ow: W, oh: H, ih, pose: P, frame, scene: this.opt.scene, camera: this.opt.camera, t, dither: this.opt.dither, glow: this.opt.glow, scan: this.opt.scan, useBg: this.opt.useBg, facet: this.opt.facet, camAdj: this._camAdj() });
};
Dancer.prototype.dispose = function () {
  try { const ext = this.r.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* ignore */ }
  this.r = null; this.canvas = null;
};
Dancer.prototype.info = function () {
  const tp = this.tempo();
  return { bpm: tp.bpm, trackBpm: this.opt.bpm > 0 ? this.opt.bpm : this.audio ? this.audio.bpmRaw : null, detectedBpm: this.audio ? this.audio.bpm : null, phase: tp.phase, tris: this.tris || 0, face: this.analysis ? this.analysis.found !== false : null, method: this.analysis ? this.analysis.method : null };
};

window.DancerEngine = {
  create: () => new Dancer(),
  version: '1.1',
  // where the pose model files are served from (default: jsDelivr)
  setPoseBase: (url) => { POSE_CFG.base = url; },
  _internals: { analyzePhoto, readPerson, detectPose, POSE_CFG, analyzeAudio, dancePose, POSE0, SCENES, DANCES, solvePose, makePoseState, B, poseExtent, paintAtlas },
};
})();

