// ΚΟΣΜΟΣ Q-Law Orbital Transfer - AssemblyScript WASM Module
// Classical-element Petropoulos Q-law controller following the formulation used by
// Yuricst/pyqlaw symbolic_qlaw_keplerian. Units are km, s, kg, N and radians.

const MU: f64 = 398600.4418;
const RE: f64 = 6378.137;
const G0: f64 = 9.80665e-3; // km/s^2
const PI: f64 = 3.141592653589793;
const TWO_PI: f64 = 6.283185307179586;
const PETRO_M: f64 = 3.0;
const PETRO_N: f64 = 4.0;
const PETRO_R: f64 = 2.0;
const PETRO_B: f64 = 0.01;
const PETRO_K: f64 = 1.0;
const PETRO_WP: f64 = 1.0;
const EFFECTIVITY_THRESHOLD: f64 = 0.1;
const EFFECTIVITY_SAMPLES: i32 = 8;
const EPS: f64 = 1e-12;

// Trajectory point storage (flat arrays for WASM efficiency)
// Max 50000 points, each with: t, a, e, i, W, w, f, rx, ry, rz, m, dv (12 values)
const MAX_POINTS: i32 = 50000;
const POINT_SIZE: i32 = 12;
const trajData = new Float64Array(MAX_POINTS * POINT_SIZE);
let trajCount: i32 = 0;

// Q-Law state
let qlawMu: f64 = MU;
let qlawThrust: f64 = 0;
let qlawMass: f64 = 0;
let qlawIsp: f64 = 0;
let qlawMdot: f64 = 0;
let qlawDt: f64 = 60;
let qlawTMax: f64 = 0;

// Target orbital elements
let oeTa: f64 = 0, oeTe: f64 = 0, oeTi: f64 = 0, oeTW: f64 = 0, oeTw: f64 = 0;

// Weights
let w0: f64 = 1, w1: f64 = 1, w2: f64 = 1, w3: f64 = 1, w4: f64 = 0;

// Tolerances
const tol0: f64 = 10, tol1: f64 = 0.001, tol2: f64 = 0.001, tol3: f64 = 0.01, tol4: f64 = 0.01;

// Result storage
let resultT: f64 = 0;
let resultDv: f64 = 0;
let resultFuel: f64 = 0;
let resultRevs: i32 = 0;
let resultOk: i32 = 0;

// Initialize Q-Law parameters. The public WASM API is intentionally unchanged.
export function init(
    thrust: f64, mass: f64, isp: f64,
    targetA: f64, targetE: f64, targetI: f64, targetW: f64, targetw: f64,
    weightA: f64, weightE: f64, weightI: f64, weightW: f64, weightw: f64,
    dt: f64, tMax: f64
): void {
    qlawThrust = thrust;
    qlawMass = mass;
    qlawIsp = isp;
    // N/(s * m/s^2) = kg/s. G0 is stored in km/s^2, hence the 1000.
    qlawMdot = isp > 0 && thrust > 0 ? thrust / (isp * G0 * 1000) : 0;
    qlawDt = dt;
    qlawTMax = tMax;

    oeTa = targetA;
    oeTe = targetE;
    oeTi = targetI;
    oeTW = targetW;
    oeTw = targetw;

    w0 = weightA;
    w1 = weightE;
    w2 = weightI;
    w3 = weightW;
    w4 = weightw;

    trajCount = 0;
}

function finite(x: f64): bool {
    return x == x && Math.abs(x) < 1.7976931348623157e308;
}

function angleDiff(a: f64, b: f64): f64 {
    let d = a - b;
    while (d > PI) d -= TWO_PI;
    while (d < -PI) d += TWO_PI;
    return d;
}

function wrap(x: f64): f64 {
    while (x >= TWO_PI) x -= TWO_PI;
    while (x < 0) x += TWO_PI;
    return x;
}

function cbrtSigned(x: f64): f64 {
    if (x == 0) return 0;
    return x > 0 ? Math.pow(x, 1.0 / 3.0) : -Math.pow(-x, 1.0 / 3.0);
}

function safeDen(x: f64): f64 {
    return Math.max(Math.abs(x), EPS);
}

function validOrbit(a: f64, e: f64, i: f64, W: f64, w: f64, f: f64): bool {
    if (!finite(a) || !finite(e) || !finite(i) || !finite(W) || !finite(w) || !finite(f)) return false;
    if (a <= 0 || e < 0 || e >= 1 || i < 0 || i > PI) return false;
    const p = a * (1 - e * e);
    const rp = a * (1 - e);
    return finite(p) && finite(rp) && p > EPS && rp > EPS;
}

function validTarget(): bool {
    if (!finite(oeTa) || !finite(oeTe) || !finite(oeTi) || !finite(oeTW) || !finite(oeTw)) return false;
    if (!finite(w0) || !finite(w1) || !finite(w2) || !finite(w3) || !finite(w4)) return false;
    if (w0 < 0 || w1 < 0 || w2 < 0 || w3 < 0 || w4 < 0) return false;
    if (w0 > 0 && oeTa <= 0) return false;
    if (w1 > 0 && (oeTe < 0 || oeTe >= 1)) return false;
    if (w2 > 0 && (oeTi < 0 || oeTi > PI)) return false;
    return true;
}

// Published Petropoulos maximum rates for classical Keplerian elements.
function maxRateA(a: f64, e: f64, acc: f64): f64 {
    return 2 * acc * Math.sqrt(a * a * a * (1 + e) / (qlawMu * safeDen(1 - e)));
}

function maxRateE(p: f64, h: f64, acc: f64): f64 {
    return 2 * p * acc / h;
}

function maxRateI(p: f64, h: f64, e: f64, w: f64, acc: f64): f64 {
    const den = Math.sqrt(Math.max(0, 1 - e * e * Math.sin(w) * Math.sin(w))) - e * Math.abs(Math.cos(w));
    return p * acc / (h * safeDen(den));
}

function maxRateRAAN(p: f64, h: f64, e: f64, i: f64, w: f64, acc: f64): f64 {
    const den = Math.sin(i) * (Math.sqrt(Math.max(0, 1 - e * e * Math.cos(w) * Math.cos(w))) - e * Math.abs(Math.sin(w)));
    return p * acc / (h * safeDen(den));
}

function maxRateArgP(p: f64, h: f64, e: f64, i: f64, w: f64, acc: f64): f64 {
    // Petropoulos' in-plane extremum, combined with the out-of-plane maximum
    // using b=0.01. A small eccentricity floor only protects the unavoidable
    // classical-element singularity; it does not remove that limitation.
    const ee = Math.max(e, 1e-7);
    const e3 = ee * ee * ee;
    const z = (1 - ee * ee) / e3;
    const root = Math.sqrt(0.25 * z * z + 1.0 / 27.0);
    let cosF = cbrtSigned(0.5 * z + root) - cbrtSigned(-0.5 * z + root) - 1 / ee;
    cosF = Math.max(-1, Math.min(1, cosF));
    const rx = p / safeDen(1 + ee * cosF);
    const inPlane = acc / (ee * h) * Math.sqrt(Math.max(0,
        p * p * cosF * cosF + (p + rx) * (p + rx) * (1 - cosF * cosF)));
    const outPlane = maxRateRAAN(p, h, e, i, w, acc) * Math.abs(Math.cos(i));
    return (inPlane + PETRO_B * outPlane) / (1 + PETRO_B);
}

// Petropoulos Q = (1 + Wp exp(k(1-rp/rpmin))) sum Wi Si (error/maxRate)^2.
// RE is the minimum periapsis radius because init's preserved API has no rpmin input.
function qValue(a: f64, e: f64, i: f64, W: f64, w: f64, acc: f64): f64 {
    if (!validOrbit(a, e, i, W, w, 0) || !validTarget() || !finite(acc) || acc <= 0) return Infinity;
    const p = a * (1 - e * e);
    const h = Math.sqrt(qlawMu * p);
    if (!finite(h) || h <= EPS) return Infinity;

    const ra = maxRateA(a, e, acc);
    const re = maxRateE(p, h, acc);
    const ri = maxRateI(p, h, e, w, acc);
    const rW = maxRateRAAN(p, h, e, i, w, acc);
    const rw = maxRateArgP(p, h, e, i, w, acc);
    const da = a - oeTa;
    const de = e - oeTe;
    const di = i - oeTi;
    const dW = angleDiff(W, oeTW);
    const dw = angleDiff(w, oeTw);
    const scaleA = Math.pow(1 + Math.pow(da / safeDen(PETRO_M * oeTa), PETRO_N), 1 / PETRO_R);

    let sum: f64 = 0;
    if (w0 > 0 && finite(ra) && ra > EPS) sum += w0 * scaleA * (da / ra) * (da / ra);
    if (w1 > 0 && finite(re) && re > EPS) sum += w1 * (de / re) * (de / re);
    if (w2 > 0 && finite(ri) && ri > EPS) sum += w2 * (di / ri) * (di / ri);
    if (w3 > 0 && finite(rW) && rW > EPS) sum += w3 * (dW / rW) * (dW / rW);
    if (w4 > 0 && finite(rw) && rw > EPS) sum += w4 * (dw / rw) * (dw / rw);

    const penalty = 1 + PETRO_WP * Math.exp(PETRO_K * (1 - a * (1 - e) / RE));
    const q = penalty * sum;
    return finite(q) ? q : Infinity;
}

// Full dQ/doe is evaluated with central finite differences. This is more compact
// and less brittle in WASM than transcribing the very large symbolic derivative.
// Adaptive perturbations retain useful precision; Q itself is independent of true anomaly.
function qDerivative(which: i32, a: f64, e: f64, i: f64, W: f64, w: f64, acc: f64): f64 {
    let x: f64;
    if (which == 0) x = a;
    else if (which == 1) x = e;
    else if (which == 2) x = i;
    else if (which == 3) x = W;
    else x = w;

    let step = which == 0 ? Math.max(1e-3, Math.abs(x) * 1e-6) : Math.max(1e-7, Math.abs(x) * 1e-6);
    if (which == 1) step = Math.min(step, 0.25 * Math.max(e, 1e-7));
    if (which == 2) step = Math.min(step, 0.25 * Math.max(Math.min(i, PI - i), 1e-7));
    if (step <= 0 || !finite(step)) return 0;

    let qp: f64, qm: f64;
    let delta = 2 * step;
    if (which == 0) {
        qp = qValue(a + step, e, i, W, w, acc);
        qm = qValue(a - step, e, i, W, w, acc);
    } else if (which == 1) {
        const ep = Math.min(1 - 1e-10, e + step);
        const em = Math.max(0, e - step);
        qp = qValue(a, ep, i, W, w, acc);
        qm = qValue(a, em, i, W, w, acc);
        delta = ep - em;
    } else if (which == 2) {
        const ip = Math.min(PI, i + step);
        const im = Math.max(0, i - step);
        qp = qValue(a, e, ip, W, w, acc);
        qm = qValue(a, e, im, W, w, acc);
        delta = ip - im;
    } else if (which == 3) {
        qp = qValue(a, e, i, wrap(W + step), w, acc);
        qm = qValue(a, e, i, wrap(W - step), w, acc);
    } else {
        qp = qValue(a, e, i, W, wrap(w + step), acc);
        qm = qValue(a, e, i, W, wrap(w - step), acc);
    }
    if (!finite(qp) || !finite(qm) || delta <= 0) return 0;
    return (qp - qm) / delta;
}

// Magnitude of Psi^T grad(Q), where Psi is the classical Gauss sensitivity matrix.
function descentMagnitude(a: f64, e: f64, i: f64, w: f64, f: f64,
    g0: f64, g1: f64, g2: f64, g3: f64, g4: f64): f64 {
    const p = a * (1 - e * e);
    const h = Math.sqrt(qlawMu * p);
    const r = p / (1 + e * Math.cos(f));
    const sf = Math.sin(f), cf = Math.cos(f);
    const su = Math.sin(w + f), cu = Math.cos(w + f);
    const ee = Math.max(e, 1e-7);
    const sini = Math.max(Math.abs(Math.sin(i)), 1e-7);
    const ux = (2 * a * a / h) * e * sf * g0 + (p / h) * sf * g1 - (p / (ee * h)) * cf * g4;
    const uy = (2 * a * a / h) * (p / r) * g0 + (((p + r) * cf + r * e) / h) * g1 + ((p + r) * sf / (ee * h)) * g4;
    const uz = (r * cu / h) * g2 + (r * su / (h * sini)) * g3 - (r * su * Math.cos(i) / (h * sini)) * g4;
    const mag = Math.sqrt(ux * ux + uy * uy + uz * uz);
    return finite(mag) ? mag : 0;
}

function converged(a: f64, e: f64, i: f64, W: f64, w: f64): bool {
    if (w0 > 0 && Math.abs(a - oeTa) > tol0) return false;
    if (w1 > 0 && Math.abs(e - oeTe) > tol1) return false;
    if (w2 > 0 && Math.abs(i - oeTi) > tol2) return false;
    if (w3 > 0 && Math.abs(angleDiff(W, oeTW)) > tol3) return false;
    if (w4 > 0 && Math.abs(angleDiff(w, oeTw)) > tol4) return false;
    return true;
}

function storeTrajPoint(t: f64, a: f64, e: f64, i: f64, W: f64, w: f64, f: f64, m: f64, dv: f64): void {
    if (trajCount >= MAX_POINTS || !validOrbit(a, e, i, W, w, f)) return;
    const p = a * (1 - e * e);
    const r = p / (1 + e * Math.cos(f));
    const xo = r * Math.cos(f);
    const yo = r * Math.sin(f);
    const cW = Math.cos(W), sW = Math.sin(W);
    const cw = Math.cos(w), sw = Math.sin(w);
    const ci = Math.cos(i), si = Math.sin(i);
    const r11 = cW * cw - sW * sw * ci;
    const r12 = -cW * sw - sW * cw * ci;
    const r21 = sW * cw + cW * sw * ci;
    const r22 = -sW * sw + cW * cw * ci;
    const r31 = sw * si;
    const r32 = cw * si;
    const idx = trajCount * POINT_SIZE;
    trajData[idx + 0] = t;
    trajData[idx + 1] = a;
    trajData[idx + 2] = e;
    trajData[idx + 3] = i;
    trajData[idx + 4] = W;
    trajData[idx + 5] = w;
    trajData[idx + 6] = f;
    trajData[idx + 7] = r11 * xo + r12 * yo;
    trajData[idx + 8] = r21 * xo + r22 * yo;
    trajData[idx + 9] = r31 * xo + r32 * yo;
    trajData[idx + 10] = m;
    trajData[idx + 11] = dv;
    trajCount++;
}

// Main fixed-step propagation with Petropoulos Q-law guidance.
export function run(a0: f64, e0: f64, i0: f64, W0: f64, w0_: f64, f0: f64): i32 {
    trajCount = 0;
    resultT = 0;
    resultDv = 0;
    resultFuel = 0;
    resultRevs = 0;
    resultOk = 0;

    let a = a0, e = e0, i = i0, W = wrap(W0), w = wrap(w0_), f = wrap(f0);
    let mass = qlawMass;
    let t: f64 = 0;
    let dv: f64 = 0;
    let revs: i32 = 0;
    let lastF = f;

    if (!validOrbit(a, e, i, W, w, f) || !validTarget() || !finite(mass) || mass <= 0 ||
        !finite(qlawDt) || qlawDt <= 0 || !finite(qlawTMax) || qlawTMax < 0 ||
        !finite(qlawThrust) || qlawThrust < 0 || !finite(qlawIsp) || qlawIsp <= 0) return 0;

    const maxN = <i32>Math.ceil(qlawTMax / qlawDt);
    for (let n: i32 = 0; n < maxN; n++) {
        if (n % 10 == 0) storeTrajPoint(t, a, e, i, W, w, f, mass, dv);
        if (converged(a, e, i, W, w)) {
            resultOk = 1;
            break;
        }
        if (mass <= EPS || (qlawMdot > 0 && mass - qlawMdot * qlawDt <= EPS)) break;

        const p = a * (1 - e * e);
        const h = Math.sqrt(qlawMu * p);
        const r = p / (1 + e * Math.cos(f));
        // N/kg is m/s^2; divide by 1000 to retain km/s^2.
        const acc = qlawThrust / (mass * 1000);
        if (!finite(p) || !finite(h) || !finite(r) || !finite(acc) || h <= EPS || r <= EPS || acc <= 0) break;

        const g0 = qDerivative(0, a, e, i, W, w, acc);
        const g1 = qDerivative(1, a, e, i, W, w, acc);
        const g2 = qDerivative(2, a, e, i, W, w, acc);
        const g3 = qDerivative(3, a, e, i, W, w, acc);
        const g4 = qDerivative(4, a, e, i, W, w, acc);

        // Steepest descent is -Psi^T grad(Q).
        const sf = Math.sin(f), cf = Math.cos(f);
        const su = Math.sin(w + f), cu = Math.cos(w + f);
        const ee = Math.max(e, 1e-7);
        const sini = Math.max(Math.abs(Math.sin(i)), 1e-7);
        let ur = (2 * a * a / h) * e * sf * g0 + (p / h) * sf * g1 - (p / (ee * h)) * cf * g4;
        let ut = (2 * a * a / h) * (p / r) * g0 + (((p + r) * cf + r * e) / h) * g1 + ((p + r) * sf / (ee * h)) * g4;
        let un = (r * cu / h) * g2 + (r * su / (h * sini)) * g3 - (r * su * Math.cos(i) / (h * sini)) * g4;
        const controlMag = Math.sqrt(ur * ur + ut * ut + un * un);

        let thrusting = finite(controlMag) && controlMag > EPS;
        if (thrusting) {
            ur = -ur / controlMag;
            ut = -ut / controlMag;
            un = -un / controlMag;

            // Standard relative effectivity: compare the current descent potential
            // with a small true-anomaly grid spanning the osculating orbit.
            let minEffect = Infinity, maxEffect: f64 = 0;
            for (let j: i32 = 0; j < EFFECTIVITY_SAMPLES; j++) {
                const fs = f + TWO_PI * <f64>j / <f64>EFFECTIVITY_SAMPLES;
                const effect = descentMagnitude(a, e, i, w, fs, g0, g1, g2, g3, g4);
                minEffect = Math.min(minEffect, effect);
                maxEffect = Math.max(maxEffect, effect);
            }
            const range = maxEffect - minEffect;
            const eta = range > EPS ? (controlMag - minEffect) / range : 1;
            if (!finite(eta) || eta < EFFECTIVITY_THRESHOLD) thrusting = false;
        }

        let da: f64 = 0, de: f64 = 0, di: f64 = 0, dW: f64 = 0, dw_: f64 = 0;
        let df_ = h / (r * r);
        if (thrusting) {
            da = (2 * a * a / h) * (e * sf * ur + (p / r) * ut) * acc;
            de = (1 / h) * (p * sf * ur + ((p + r) * cf + r * e) * ut) * acc;
            di = (r * cu / h) * un * acc;
            dW = (r * su / (h * sini)) * un * acc;
            dw_ = ((-p * cf * ur + (p + r) * sf * ut) / (h * ee) - r * su * Math.cos(i) * un / (h * sini)) * acc;
            df_ += (p * cf * ur - (p + r) * sf * ut) * acc / (ee * h);
        }

        const nextA = a + da * qlawDt;
        const nextE = e + de * qlawDt;
        const nextI = i + di * qlawDt;
        const nextW = wrap(W + dW * qlawDt);
        const nextw = wrap(w + dw_ * qlawDt);
        const nextF = wrap(f + df_ * qlawDt);
        if (!validOrbit(nextA, nextE, nextI, nextW, nextw, nextF)) break;

        a = nextA;
        e = nextE;
        i = nextI;
        W = nextW;
        w = nextw;
        f = nextF;
        if (thrusting) {
            // Coasting intentionally consumes neither propellant nor delta-v.
            dv += qlawThrust / mass * qlawDt / 1000; // m/s -> km/s
            mass -= qlawMdot * qlawDt;
        }
        t += qlawDt;

        if (f < lastF && lastF - f > PI) revs++;
        lastF = f;
    }

    storeTrajPoint(t, a, e, i, W, w, f, mass, dv);
    resultT = t;
    resultDv = dv;
    resultFuel = Math.max(0, qlawMass - mass);
    resultRevs = revs;
    if (converged(a, e, i, W, w)) resultOk = 1;
    return trajCount;
}

// Getters for results
export function getResultT(): f64 { return resultT; }
export function getResultDv(): f64 { return resultDv; }
export function getResultFuel(): f64 { return resultFuel; }
export function getResultRevs(): i32 { return resultRevs; }
export function getResultOk(): i32 { return resultOk; }
export function getTrajCount(): i32 { return trajCount; }

// Get trajectory data point
export function getTrajT(idx: i32): f64 { return trajData[idx * POINT_SIZE + 0]; }
export function getTrajA(idx: i32): f64 { return trajData[idx * POINT_SIZE + 1]; }
export function getTrajE(idx: i32): f64 { return trajData[idx * POINT_SIZE + 2]; }
export function getTrajI(idx: i32): f64 { return trajData[idx * POINT_SIZE + 3]; }
export function getTrajW(idx: i32): f64 { return trajData[idx * POINT_SIZE + 4]; }
export function getTrajw(idx: i32): f64 { return trajData[idx * POINT_SIZE + 5]; }
export function getTrajF(idx: i32): f64 { return trajData[idx * POINT_SIZE + 6]; }
export function getTrajRx(idx: i32): f64 { return trajData[idx * POINT_SIZE + 7]; }
export function getTrajRy(idx: i32): f64 { return trajData[idx * POINT_SIZE + 8]; }
export function getTrajRz(idx: i32): f64 { return trajData[idx * POINT_SIZE + 9]; }
export function getTrajM(idx: i32): f64 { return trajData[idx * POINT_SIZE + 10]; }
export function getTrajDv(idx: i32): f64 { return trajData[idx * POINT_SIZE + 11]; }

// Impulsive delta-v calculation (Hohmann + plane change)
export function calcImpulsiveDv(a1: f64, a2: f64, i1: f64, i2: f64): f64 {
    const r1 = a1;
    const r2 = a2;
    const aTrans = (r1 + r2) / 2;
    const vPeri = Math.sqrt(qlawMu * (2 / r1 - 1 / aTrans));
    const vCirc1 = Math.sqrt(qlawMu / r1);
    const dv1 = Math.abs(vPeri - vCirc1);
    const vApo = Math.sqrt(qlawMu * (2 / r2 - 1 / aTrans));
    const vCirc2 = Math.sqrt(qlawMu / r2);
    const dv2 = Math.abs(vCirc2 - vApo);
    const dSig = Math.abs(i2 - i1);
    const dvPlane = 2 * vApo * Math.sin(dSig / 2);
    return dv1 + Math.sqrt(dv2 * dv2 + dvPlane * dvPlane);
}
