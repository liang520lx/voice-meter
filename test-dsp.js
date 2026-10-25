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
    // 只考 F2：高音时谐波稀，F1 本来就测不准，仪表也只用 F2
    const okF = f && Math.abs(f[1] - fm[1]) / fm[1] < 0.06;
    if (!okP || !okF) bad++;
    console.log(`${sr} 音高 ${f0}→${p.toFixed(1)} ${okP ? "✓" : "✗"}  F1/F2 ${fm[0]}/${fm[1]}→${f ? f.map(Math.round).join("/") : "无"} ${okF ? "✓" : "✗"}`);
  }
}
// 静音不该报音高
console.log("静音 →", pitch(new Float32Array(2048), 48000));
process.exit(bad ? 1 : 0);
