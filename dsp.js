// 伪音仪表的信号处理：音高（McLeod NSDF）+ 共鸣（LPC 包络找 F1/F2）。
// 网页和 node 测试共用这一份。
(function (root) {
  // 音高：x 是一帧采样，sr 是采样率；没把握时返回 0
  function pitch(x, sr, lo = 70, hi = 500) {
    // 先 2 倍降采样，省一半计算
    const n = x.length >> 1, y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = (x[2 * i] + x[2 * i + 1]) / 2;
    const fs = sr / 2, minLag = Math.floor(fs / hi), maxLag = Math.min(Math.ceil(fs / lo), n - 1);
    const nsdf = new Float32Array(maxLag + 2);
    for (let l = 0; l <= maxLag + 1; l++) {
      let ac = 0, m = 0;
      for (let i = 0; i + l < n; i++) { ac += y[i] * y[i + l]; m += y[i] * y[i] + y[i + l] * y[i + l]; }
      nsdf[l] = m > 0 ? 2 * ac / m : 0;
    }
    // 第一次过零之后的各个峰里，取第一个够高（≥ 最高峰 0.85）的，防止跳到低八度
    let l = 1; while (l < maxLag && nsdf[l] > 0) l++;
    const peaks = [];
    for (; l <= maxLag; l++) {
      if (nsdf[l] > 0 && nsdf[l] >= nsdf[l - 1] && nsdf[l] > nsdf[l + 1] && l >= minLag) peaks.push(l);
    }
    if (!peaks.length) return 0;
    const best = Math.max(...peaks.map(p => nsdf[p]));
    if (best < 0.6) return 0;
    const p = peaks.find(q => nsdf[q] >= 0.85 * best);
    const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1], d = a - 2 * b + c;
    const shift = d ? (a - c) / (2 * d) : 0;
    return fs / (p + shift);
  }

  // LPC 系数（Levinson-Durbin），返回 a[0..p]，a[0]=1
  function lpc(x, p) {
    const r = new Float64Array(p + 1);
    for (let k = 0; k <= p; k++) for (let i = 0; i + k < x.length; i++) r[k] += x[i] * x[i + k];
    if (r[0] <= 0) return null;
    r[0] *= 1.0001; // 一点白噪声修正，防止数值炸
    let a = new Float64Array(p + 1); a[0] = 1; let e = r[0];
    for (let i = 1; i <= p; i++) {
      let acc = r[i];
      for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
      const k = -acc / e, na = a.slice();
      for (let j = 1; j < i; j++) na[j] = a[j] + k * a[i - j];
      na[i] = k; a = na; e *= 1 - k * k;
      if (e <= 0) return null;
    }
    return a;
  }

  // 共鸣：返回 [F1, F2]（Hz），找不到返回 null
  function formants(x, sr) {
    const q = Math.max(1, Math.round(sr / 11000)), fs = sr / q, n = Math.floor(x.length / q);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < q; j++) s += x[i * q + j]; y[i] = s / q; }
    for (let i = n - 1; i > 0; i--) y[i] -= 0.97 * y[i - 1];   // 预加重
    for (let i = 0; i < n; i++) y[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    const a = lpc(y, 12); if (!a) return null;
    // 直接解 LPC 的极点，不在包络上找峰：高音/气声时 F1、F2 在包络上会并成一个峰，
    // 找峰会把 F3 当成 F2（仪表上 1200↔2800 来回跳），极点还是分开的两个
    const out = [];
    for (const [re, im] of roots(a)) {
      if (im <= 0) continue;
      const r = Math.hypot(re, im), f = Math.atan2(im, re) * fs / (2 * Math.PI), bw = -Math.log(r) * fs / Math.PI;
      if (f > 200 && f < 4000 && bw < 600) out.push(f);
    }
    out.sort((u, v) => u - v);
    return out.length >= 2 ? out.slice(0, 2) : null;
  }

  // 多项式 a[0] z^p + a[1] z^(p-1) + … + a[p] 的全部复根（Durand–Kerner），返回 [[实部, 虚部], …]
  function roots(a) {
    const p = a.length - 1, z = [];
    for (let i = 0; i < p; i++) { const t = 2 * Math.PI * i / p + 0.4; z.push([0.9 * Math.cos(t), 0.9 * Math.sin(t)]); }
    for (let it = 0; it < 200; it++) {
      let moved = 0;
      for (let i = 0; i < p; i++) {
        const [zr, zi] = z[i];
        let nr = 1, ni = 0;                       // Horner 求 A(z)
        for (let j = 1; j <= p; j++) { const t = nr * zr - ni * zi + a[j]; ni = nr * zi + ni * zr; nr = t; }
        let dr = 1, di = 0;                       // ∏ (z_i − z_j)
        for (let j = 0; j < p; j++) if (j !== i) {
          const ur = zr - z[j][0], ui = zi - z[j][1], t = dr * ur - di * ui; di = dr * ui + di * ur; dr = t;
        }
        const m = dr * dr + di * di; if (!m) continue;
        const qr = (nr * dr + ni * di) / m, qi = (ni * dr - nr * di) / m;
        z[i] = [zr - qr, zi - qi]; moved = Math.max(moved, Math.abs(qr) + Math.abs(qi));
      }
      if (moved < 1e-10) break;
    }
    return z;
  }

  const api = { pitch, formants };
  if (typeof module !== "undefined") module.exports = api; else root.VoiceDSP = api;
})(this);
