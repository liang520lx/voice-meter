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
    // 在 LPC 包络上找峰
    const N = 512, env = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const w = Math.PI * k / N; let re = 0, im = 0;
      for (let j = 0; j < a.length; j++) { re += a[j] * Math.cos(w * j); im -= a[j] * Math.sin(w * j); }
      env[k] = 1 / Math.hypot(re, im);
    }
    const out = [];
    for (let k = 1; k < N - 1 && out.length < 2; k++) {
      const f = fs / 2 * k / N;
      if (f > 200 && f < 4000 && env[k] > env[k - 1] && env[k] >= env[k + 1]) out.push(f);
    }
    return out.length === 2 ? out : null;
  }

  const api = { pitch, formants };
  if (typeof module !== "undefined") module.exports = api; else root.VoiceDSP = api;
})(this);
