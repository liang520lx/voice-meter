// 用 Edge 调试接口跑 #selftest：node selftest.js <假麦克风.wav> <截图.png>
// 前 4.5 秒喂"本音"，之后喂共鸣 +12% 的声音，看仪表会不会亮绿灯。
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const [wav, shot] = process.argv.slice(2);
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "vm-"));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${prof}`,
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`,
  "--autoplay-policy=no-user-gesture-required", "--window-size=400,900", "about:blank"]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let tab;
  for (let i = 0; i < 30 && !tab; i++) {
    await sleep(300);
    try { tab = (await (await fetch("http://127.0.0.1:9333/json")).json()).find(t => t.type === "page"); } catch {}
  }
  const ws = new WebSocket(tab.webSocketDebuggerUrl); let id = 0; const wait = {};
  ws.onmessage = m => { const d = JSON.parse(m.data);
    if (d.id && wait[d.id]) wait[d.id](d.result);
    if (d.method === "Runtime.consoleAPICalled") console.log("console:", d.params.args.map(a => a.value).join(" "));
    if (d.method === "Runtime.exceptionThrown") console.log("报错:", d.params.exceptionDetails.exception?.description); };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { wait[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable");
  await send("Page.navigate", { url: "http://127.0.0.1:8765/index.html#selftest" });
  const read = async () => (await send("Runtime.evaluate", { expression:
    `[status.textContent, pv.textContent, fv.textContent, pd.textContent, fd.textContent, info.textContent.slice(0,40), score.textContent].join(" | ")` })).result.value;
  for (const s of [2, 4, 7, 10]) { await sleep(s === 2 ? 2000 : (s === 4 ? 2000 : 3000)); console.log(`${s}s:`, await read()); }
  const img = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(shot, Buffer.from(img.data, "base64"));
  edge.kill(); process.exit(0);
})().catch(e => { console.error(e); edge.kill(); process.exit(1); });
