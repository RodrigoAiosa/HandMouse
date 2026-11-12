import { Engine } from "./engine.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const $ = (s) => document.querySelector(s);
const video = $("#video"), overlay = $("#overlay"), octx = overlay.getContext("2d");
const cursorEl = $("#cursor"), panel = $("#panel"), msg = $("#msg"), startBtn = $("#start");
const HAND_CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

let engine, landmarker, stream, running = false, lastVideoTime = -1;
let hotEl = null, dragTarget = null;

// ---------------------------------------------------------------- partida
async function loadConfig() {
  try {
    const r = await fetch("/api/config");
    if (r.ok) return await r.json();
  } catch { /* usa os padrões embutidos */ }
  return {};
}

function explain(e) {
  if (!navigator.mediaDevices?.getUserMedia) return "Este navegador/contexto não permite câmera (é necessário HTTPS).";
  switch (e?.name) {
    case "NotAllowedError": return "Permissão da câmera negada. Clique no ícone de câmera na barra de endereço, permita o acesso e tente de novo.";
    case "NotFoundError": return "Nenhuma câmera encontrada neste dispositivo.";
    case "NotReadableError": return "A câmera está em uso por outro aplicativo.";
    default: return "Não foi possível acessar a câmera: " + (e?.message || e);
  }
}

async function start() {
  startBtn.disabled = true;
  msg.textContent = "Solicitando permissão da câmera…";
  try {
    // Primeira vez: o navegador exibe o pedido de permissão aqui.
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }, audio: false,
    });
  } catch (e) {
    msg.textContent = explain(e);
    startBtn.disabled = false;
    return;
  }
  video.srcObject = stream;
  await video.play();

  msg.textContent = "Carregando o modelo de mãos (MediaPipe)…";
  try {
    const { HandLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
    const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO", numHands: 1,
      minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.6,
    });
    try { landmarker = await make("GPU"); } catch { landmarker = await make("CPU"); }
  } catch (e) {
    msg.textContent = "Falha ao carregar o MediaPipe: " + (e?.message || e);
    stop();
    return;
  }

  engine = new Engine(await loadConfig());
  panel.hidden = false;
  cursorEl.hidden = false;
  startBtn.textContent = "Câmera ativa";
  msg.textContent = "Pronto! Estique o indicador e mova a mão. Dica: mantenha a mão dentro do retângulo amarelo.";
  running = true;
  requestAnimationFrame(loop);
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  landmarker?.close?.();
  landmarker = null;
  panel.hidden = true;
  cursorEl.hidden = true;
  setHot(null);
  startBtn.disabled = false;
  startBtn.textContent = "Ativar câmera";
}

// ---------------------------------------------------------------- laço
function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    const lm = res.landmarks?.[0]?.map((p) => [p.x, p.y]) ?? null;
    const { actions, info } = engine.update(lm, performance.now() / 1000);
    for (const a of actions) apply(a);
    render(lm, info);
  }
  requestAnimationFrame(loop);
}

function render(lm, info) {
  const st = $("#status");
  st.textContent = info.paused ? "PAUSADO" : "ATIVO | " + info.mode;
  st.classList.toggle("paused", info.paused);
  $("#fistbar").style.width = info.fist * 100 + "%";
  $("#pause").textContent = info.paused ? "Retomar" : "Pausar";
  document.querySelectorAll("#legend tr").forEach((tr) =>
    tr.classList.toggle("active", tr.dataset.mode === info.mode));
  cursorEl.classList.toggle("pinch", info.mode === "PINCA" || info.mode === "CLIQUE DIREITO");
  cursorEl.classList.toggle("drag", info.mode === "ARRASTAR");
  cursorEl.classList.toggle("paused", info.paused);

  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (lm) {
    octx.strokeStyle = "#3ddc84"; octx.lineWidth = 2;
    for (const [i, j] of HAND_CONNECTIONS) {
      octx.beginPath();
      octx.moveTo(lm[i][0] * overlay.width, lm[i][1] * overlay.height);
      octx.lineTo(lm[j][0] * overlay.width, lm[j][1] * overlay.height);
      octx.stroke();
    }
    octx.fillStyle = "#ffa500";
    for (const [x, y] of lm) { octx.beginPath(); octx.arc(x * overlay.width, y * overlay.height, 3, 0, 7); octx.fill(); }
  }
}

// ---------------------------------------------------------------- ações → eventos DOM
const px = (pos) => [pos[0] * innerWidth, pos[1] * innerHeight];

function fire(el, type, x, y, extra = {}) {
  el.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, ...extra,
  }));
}

function setHot(el) {
  if (hotEl === el) return;
  hotEl?.classList.remove("hot");
  hotEl = el;
  hotEl?.classList.add("hot");
}

function scrollParent(el) {
  for (; el && el !== document.body; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
  }
  return window;
}

function apply([kind, arg]) {
  if (kind === "pause") return;
  if (kind === "scroll") {
    const el = document.elementFromPoint(...px(engine.cursor));
    const target = scrollParent(el);
    target.scrollBy({ top: arg, behavior: "instant" });
    if (target !== window && target.scrollTop + target.clientHeight >= target.scrollHeight - 1 && arg > 0)
      window.scrollBy({ top: arg, behavior: "instant" });
    return;
  }
  const [x, y] = px(arg);
  cursorEl.style.left = x + "px";
  cursorEl.style.top = y + "px";
  const el = document.elementFromPoint(x, y) || document.body;

  switch (kind) {
    case "move":
      setHot(el.closest("button,a,input,textarea,label,.menu-item,[data-hot]"));
      if (dragTarget) fire(document, "mousemove", x, y);
      break;
    case "click":
      setHot(null);
      for (const t of ["mousedown", "mouseup", "click"]) fire(el, t, x, y, { button: 0 });
      (el.closest("input,textarea,button") || el).focus?.();
      hideMenu(el);
      break;
    case "dclick":
      for (const t of ["mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"])
        fire(el, t, x, y, { button: 0, detail: 2 });
      break;
    case "rclick":
      fire(el, "mousedown", x, y, { button: 2 });
      fire(el, "mouseup", x, y, { button: 2 });
      fire(el, "contextmenu", x, y, { button: 2 });
      break;
    case "down":
      dragTarget = el;
      fire(el, "mousedown", x, y, { button: 0 });
      break;
    case "drag":
      fire(document, "mousemove", x, y, { buttons: 1 });
      break;
    case "up":
      fire(dragTarget ? document : el, "mouseup", x, y, { button: 0 });
      dragTarget = null;
      break;
  }
}

function hideMenu(el) { if (!el.closest("#ctx")) $("#ctx").hidden = true; }

$("#start").addEventListener("click", start);
$("#quit").addEventListener("click", stop);
$("#pause").addEventListener("click", () => { engine?.setPaused(!engine.paused); });
addEventListener("pagehide", stop);

// ---------------------------------------------------------------- demo da página
let n = 0;
$("#counter").addEventListener("click", () => { $("#counter").textContent = `Cliques: ${++n}`; });

$("#dbl").addEventListener("dblclick", (e) => {
  const z = e.currentTarget; z.classList.add("flash"); z.textContent = "Duplo clique detectado ✔";
  setTimeout(() => { z.classList.remove("flash"); z.textContent = "Duplo clique aqui (duas pinças rápidas)"; }, 1200);
});

const ctx = $("#ctx");
$("#rz").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  ctx.style.left = Math.min(e.clientX, innerWidth - 160) + "px";
  ctx.style.top = Math.min(e.clientY, innerHeight - 130) + "px";
  ctx.hidden = false;
});
ctx.addEventListener("click", (e) => {
  if (e.target.classList.contains("menu-item")) {
    $("#rz").textContent = `Você escolheu: ${e.target.textContent}`;
    ctx.hidden = true;
  }
});

const sbox = $("#sbox");
for (let i = 1; i <= 40; i++) sbox.insertAdjacentHTML("beforeend", `<div>Item ${i}</div>`);

{ // bolinha arrastável (funciona com mouse real e com a mão)
  const ball = $("#ball"), arena = $("#arena"), target = $("#target");
  let grab = null;
  ball.addEventListener("mousedown", (e) => {
    grab = { dx: e.clientX - ball.offsetLeft - arena.getBoundingClientRect().left,
             dy: e.clientY - ball.offsetTop - arena.getBoundingClientRect().top };
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!grab) return;
    const r = arena.getBoundingClientRect();
    ball.style.left = Math.max(0, Math.min(r.width - 44, e.clientX - r.left - grab.dx)) + "px";
    ball.style.top = Math.max(0, Math.min(r.height - 44, e.clientY - r.top - grab.dy)) + "px";
    const b = ball.getBoundingClientRect(), t = target.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    target.classList.toggle("over", cx > t.left && cx < t.right && cy > t.top && cy < t.bottom);
  });
  document.addEventListener("mouseup", () => {
    if (!grab) return;
    grab = null;
    $("#dropmsg").textContent = target.classList.contains("over") ? "Boa! Solto no alvo ✔" : "";
  });
}
