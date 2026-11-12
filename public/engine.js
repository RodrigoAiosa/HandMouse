// Motor de gestos do HandMouse (porta fiel de desktop/gestures.py).
// Recebe 21 pontos [x, y] da mão e devolve ações de mouse em coordenadas
// normalizadas (0..1) da viewport.

export const DEFAULTS = {
  mirror: true,
  roi: [0.15, 0.10, 0.85, 0.70],
  pinch_on: 0.30,
  pinch_off: 0.45,
  ext_ratio: 1.15,
  fold_ratio: 1.0,
  fist_hold: 1.0,
  drag_move: 0.04,
  history: 0.15,
  dbl_window: 0.45,
  scroll_gain: 1800,      // px por unidade de deslocamento da mão
  scroll_dead: 0.004,
  mincutoff: 1.5,
  beta: 8.0,
  dcutoff: 1.0,
};

export class OneEuro {
  constructor(mincutoff, beta, dcutoff) {
    this.mincutoff = mincutoff; this.beta = beta; this.dcutoff = dcutoff;
    this.reset();
  }
  reset() { this.t = null; this.x = null; this.dx = 0; }
  static alpha(cutoff, dt) { return 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt); }
  filter(x, t) {
    if (this.t === null) { this.t = t; this.x = x; this.dx = 0; return x; }
    const dt = Math.max(t - this.t, 1e-3);
    const dx = (x - this.x) / dt;
    const ad = OneEuro.alpha(this.dcutoff, dt);
    this.dx = ad * dx + (1 - ad) * this.dx;
    const cutoff = this.mincutoff + this.beta * Math.abs(this.dx);
    const a = OneEuro.alpha(cutoff, dt);
    this.x = a * x + (1 - a) * this.x;
    this.t = t;
    return this.x;
  }
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function analyze(p, c) {
  const w = p[0];
  const palm = Math.max(dist(w, p[9]), 1e-6);
  const ratio = (tip, pip) => dist(p[tip], w) / Math.max(dist(p[pip], w), 1e-6);
  const r = [ratio(8, 6), ratio(12, 10), ratio(16, 14), ratio(20, 18)];
  const ext = r.map((v) => v > c.ext_ratio);
  return {
    idx: ext[0], mid: ext[1], ring: ext[2], pinky: ext[3],
    fist: r.every((v) => v < c.fold_ratio),
    pinch_i: dist(p[4], p[8]) / palm,
    pinch_m: dist(p[4], p[12]) / palm,
  };
}

export class Engine {
  constructor(cfg = {}) {
    this.c = { ...DEFAULTS, ...cfg };
    this.paused = false;
    this._reset();
  }

  _reset() {
    const c = this.c;
    const mk = () => new OneEuro(c.mincutoff, c.beta, c.dcutoff);
    this.fx = mk(); this.fy = mk(); this.fs = mk();
    this.fistSince = null; this.fistFired = false;
    this.pinchI = false; this.pinchM = false; this.dragging = false;
    this.frozen = [0.5, 0.5]; this.cursor = [0.5, 0.5];
    this.startRaw = [0, 0]; this.origin = [0, 0];
    this.hist = [];
    this.lastRelease = -9; this.lastClickPos = null; this.dbl = false;
    this.scrollPrev = null;
  }

  _posAt(t) {
    let best = null;
    for (const [ts, pos] of this.hist) { if (ts <= t) best = pos; else break; }
    return best || (this.hist.length ? this.hist[0][1] : this.cursor);
  }

  _cancel(a) {
    if (this.dragging) a.push(["up", this.cursor]);
    this.dragging = false; this.pinchI = false; this.pinchM = false;
    this.scrollPrev = null;
    this.fx.reset(); this.fy.reset(); this.fs.reset();
  }

  setPaused(v) {
    const a = [];
    this.paused = !!v;
    this._cancel(a);
    return a;
  }

  info(mode, fist) { return { mode, paused: this.paused, fist, cursor: this.cursor }; }

  update(lm, now) {
    const c = this.c, a = [];
    if (!lm) {
      this._cancel(a);
      this.fistSince = null; this.fistFired = false;
      return { actions: a, info: this.info("SEM MAO", 0) };
    }
    const p = lm.map(([x, y]) => [c.mirror ? 1 - x : x, y]);
    const pose = analyze(p, c);

    // punho por 1 s: pausa / retoma
    if (pose.fist) {
      if (this.fistSince === null) this.fistSince = now;
      const prog = Math.min(1, (now - this.fistSince) / c.fist_hold);
      if (prog >= 1 && !this.fistFired) {
        this.fistFired = true;
        this.paused = !this.paused;
        a.push(["pause", this.paused]);
      }
      this._cancel(a);
      return { actions: a, info: this.info(this.paused ? "PAUSA" : "PUNHO", prog) };
    }
    this.fistSince = null; this.fistFired = false;
    if (this.paused) return { actions: a, info: this.info("PAUSADO", 0) };

    const [x0, y0, x1, y1] = c.roi;
    const sx = clamp((p[8][0] - x0) / (x1 - x0));
    const sy = clamp((p[8][1] - y0) / (y1 - y0));

    // pinça com histerese
    const newI = pose.pinch_i < (this.pinchI ? c.pinch_off : c.pinch_on);
    const newM = !newI && !this.dragging &&
      pose.pinch_m < (this.pinchM ? c.pinch_off : c.pinch_on);

    if (newI && !this.pinchI) {                       // fechou a pinça: desfaz o "escorregão"
      this.frozen = this._posAt(now - c.history);
      this.cursor = this.frozen;
      a.push(["move", this.frozen]);
      this.startRaw = [sx, sy];
      this.dbl = now - this.lastRelease < c.dbl_window && this.lastClickPos !== null &&
        dist(this.frozen, this.lastClickPos) < 0.05;
      this.fx.reset(); this.fy.reset();
    }
    if (newM && !this.pinchM) {                       // pinça do dedo médio
      const pos = this._posAt(now - c.history);
      this.cursor = pos;
      a.push(["move", pos]);
      a.push(["rclick", pos]);
    }
    const wasI = this.pinchI, wasM = this.pinchM;
    this.pinchI = newI; this.pinchM = newM;

    if (newI) {                                       // pinça mantida: cursor congelado
      if (!this.dragging && dist([sx, sy], this.startRaw) > c.drag_move) {
        this.dragging = true;
        this.fx.reset(); this.fy.reset();
        this.origin = [this.fx.filter(sx, now), this.fy.filter(sy, now)];
        a.push(["down", this.frozen]);
      }
      if (this.dragging) {
        const fx = this.fx.filter(sx, now), fy = this.fy.filter(sy, now);
        this.cursor = [clamp(this.frozen[0] + fx - this.origin[0]),
                       clamp(this.frozen[1] + fy - this.origin[1])];
        a.push(["drag", this.cursor]);
      }
      return { actions: a, info: this.info(this.dragging ? "ARRASTAR" : "PINCA", 0) };
    }
    if (wasI) {                                       // soltou a pinça
      if (this.dragging) { a.push(["up", this.cursor]); this.dragging = false; }
      else {
        a.push([this.dbl ? "dclick" : "click", this.frozen]);
        this.lastRelease = now; this.lastClickPos = this.frozen;
      }
      this.fx.reset(); this.fy.reset();
    }
    if (newM) return { actions: a, info: this.info("CLIQUE DIREITO", 0) };
    if (wasM) { this.fx.reset(); this.fy.reset(); }

    // "V": rolar a página
    if (pose.idx && pose.mid && !pose.ring && !pose.pinky) {
      const y = this.fs.filter((p[8][1] + p[12][1]) / 2, now);
      if (this.scrollPrev !== null) {
        const dy = y - this.scrollPrev;
        if (Math.abs(dy) > c.scroll_dead) {
          a.push(["scroll", -dy * c.scroll_gain]);
          this.scrollPrev = y;
        }
      } else this.scrollPrev = y;
      return { actions: a, info: this.info("SCROLL", 0) };
    }
    this.scrollPrev = null; this.fs.reset();

    // indicador esticado: mover o cursor
    if (pose.idx && !pose.mid) {
      this.cursor = [this.fx.filter(sx, now), this.fy.filter(sy, now)];
      this.hist.push([now, this.cursor]);
      while (this.hist.length && now - this.hist[0][0] > 1) this.hist.shift();
      a.push(["move", this.cursor]);
      return { actions: a, info: this.info("CURSOR", 0) };
    }
    return { actions: a, info: this.info("OCIOSO", 0) };
  }
}
