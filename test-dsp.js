// node test-dsp.js：用已知音高、已知共振峰的合成元音检查 dsp.js 测得准不准
const { pitch, formants } = require("./dsp.js");

function vowel(sr, f0, fm, secs = 1) {
  const n = Math.floor(sr * secs), x = new Float64Array(n), per = sr / f0;
  for (let t = 0; t < n; t += per) x[Math.floor(t)] = 1;
  let y = x;
  for (const [f, bw] of fm.map((f, i) => [f, [80, 90, 120][i]])) {
    const r = Math.exp(-Math.PI * bw / sr), th = 2 * Math.PI * f / sr;
    const b1 = 2 * r * Math.cos(th), b2 = -r * r, z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = (1 - r) * y[i] + b1 * (z[i - 1] || 0) + b2 * (z[i - 2] || 0);
    y = z;
  }
  const m = Math.max(...y.map(Math.abs));
  return Float32Array.from(y, v => v / m);
}

let bad = 0;
for (const sr of [48000, 44100]) {
  for (const [f0, fm] of [[110, [700, 1220, 2600]], [137, [500, 1700, 2500]], [200, [850, 1500, 3000]], [260, [400, 2300, 3000]]]) {
    const x = vowel(sr, f0, fm), frame = x.subarray(sr * 0.3, sr * 0.3 + 2048);
    const p = pitch(frame, sr), f = formants(frame, sr);
    const okP = Math.abs(p - f0) / f0 < 0.02;
    // 只考 F2：高音时谐波稀，F1 本来就测不准，仪表也只用 F2。
    // 200Hz 时 F2 会被吸向最近的谐波（1500→1400 左右），旧的找峰法也一样，所以给 8%
    const okF = f && Math.abs(f[1] - fm[1]) / fm[1] < 0.08;
    if (!okP || !okF) bad++;
    console.log(`${sr} 音高 ${f0}→${p.toFixed(1)} ${okP ? "✓" : "✗"}  F1/F2 ${fm[0]}/${fm[1]}→${f ? f.map(Math.round).join("/") : "无"} ${okF ? "✓" : "✗"}`);
  }
}
// 高音 + 气声 + F1/F2 挨得近（"啊"）：F2 不许跳到 F3 去（2026-10-26 手机上 1200↔2800 来回跳）
let seed = 1; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
function breathy(sr, f0, fm, bws, noise) {
  const n = sr, x = new Float64Array(n);
  for (let t = 0; t < n; t += sr / (f0 * (1 + 0.04 * (rnd() - 0.5)))) x[Math.floor(t)] = 1;
  for (let i = 0; i < n; i++) x[i] += noise * (rnd() - 0.5);
  let y = x;
  fm.forEach((f, k) => {
    const r = Math.exp(-Math.PI * bws[k] / sr), th = 2 * Math.PI * f / sr;
    const b1 = 2 * r * Math.cos(th), b2 = -r * r, z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = (1 - r) * y[i] + b1 * (z[i - 1] || 0) + b2 * (z[i - 2] || 0);
    y = z;
  });
  return Float32Array.from(y);
}
for (const [fm, bws, nz] of [[[850, 1250, 2900], [300, 300, 300], 0.5], [[800, 1300, 3000], [150, 250, 200], 0.2]]) {
  const x = breathy(48000, 240, fm, bws, nz), got = [];
  for (let s = 0; s + 2048 < x.length; s += 1600) { const f = formants(x.subarray(s, s + 2048), 48000); if (f) got.push(f[1]); }
  const jumps = got.filter(v => v > fm[1] * 1.5).length;
  if (jumps || got.length < 20) bad++;
  console.log(`气声 240Hz F2 ${fm[1]}：${got.length} 帧，跳到 F3 ${jumps} 次 ${jumps || got.length < 20 ? "✗" : "✓"}`);
}

// 静音不该报音高
console.log("静音 →", pitch(new Float32Array(2048), 48000));
process.exit(bad ? 1 : 0);
