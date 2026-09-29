/**
 * Deterministic exp and log built only from IEEE 754 basic operations (+ − × ÷, exactly rounded everywhere)
 * and exact bit manipulation. Math.exp and Math.log may differ in the last bit between JavaScript engines
 * (for example Node's V8 and Chrome's V8), which would make the mock's output bits depend on where it runs.
 * With these, the CLI, the Web Worker and the tests produce the same bits and the same run hash.
 * Accuracy: relative error below 1e-15 on the ranges the mock uses. This is not a general-purpose libm.
 */
const LN2_HI = 0.6931471803691238; // high part of ln 2 (exactly representable, low bits zero)
const LN2_LO = 1.9082149292705877e-10; // ln 2 − LN2_HI
const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;

const buf = new DataView(new ArrayBuffer(8));

/** 2^k for integer k in [−1022, 1023], built from the exponent bits (exact). */
function pow2(k: number): number {
  buf.setUint32(0, (k + 1023) << 20);
  buf.setUint32(4, 0);
  return buf.getFloat64(0);
}

export function detExp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709) return Infinity;
  if (x < -708) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| ≤ ~0.347
  // Taylor series of e^r to degree 16 (Horner form)
  let p = 1;
  for (let n = 16; n >= 1; n--) p = 1 + (r * p) / n;
  return p * pow2(k);
}

export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m · 2^e with m in [1, 2): read the exponent bits (normal numbers only; the mock never sees subnormals)
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0);
  let e = ((hi >>> 20) & 0x7ff) - 1023;
  buf.setUint32(0, (hi & 0x800fffff) | (1023 << 20));
  let m = buf.getFloat64(0);
  if (m > SQRT2) {
    m /= 2;
    e += 1;
  }
  // ln m = 2·atanh(s), s = (m − 1)/(m + 1), |s| ≤ 0.1716
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = 0;
  for (let n = 1; n <= 41; n += 2) {
    sum += term / n;
    term *= s2;
  }
  return e * LN2 + 2 * sum;
}
