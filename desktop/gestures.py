"""Motor de gestos do HandMouse (independente de plataforma).

Recebe os 21 pontos da mão (MediaPipe) e devolve *ações* de mouse.
Não depende de OpenCV, MediaPipe nem pyautogui, então é testável.

Coordenadas de saída são normalizadas (0..1) em relação à tela.
"""
from __future__ import annotations

import math
from collections import deque

DEFAULTS = dict(
    mirror=True,                 # espelha o eixo X (webcam é "invertida")
    roi=(0.15, 0.10, 0.85, 0.70),  # região da câmera mapeada para a tela inteira
    pinch_on=0.30,               # distância polegar-dedo / palma para fechar a pinça
    pinch_off=0.45,              # histerese para abrir a pinça
    ext_ratio=1.15,              # dedo esticado: ponta/PIP (distância ao pulso)
    fold_ratio=1.00,             # dedo dobrado
    fist_hold=1.0,               # segundos de punho para pausar/retomar
    drag_move=0.04,              # deslocamento (tela) para virar arraste
    history=0.15,                # s: o cursor "volta" esse tempo ao iniciar a pinça
    dbl_window=0.45,             # s entre duas pinças para duplo clique
    scroll_gain=400.0,           # sensibilidade do scroll
    scroll_dead=0.004,           # zona morta do scroll
    mincutoff=1.5,               # suavização: firme com a mão parada
    beta=8.0,                    # suavização: rápido quando a mão se move
    dcutoff=1.0,
)


class OneEuro:
    """Filtro One Euro: forte suavização parado, baixa latência em movimento."""

    def __init__(self, mincutoff=1.5, beta=8.0, dcutoff=1.0):
        self.mincutoff, self.beta, self.dcutoff = mincutoff, beta, dcutoff
        self.reset()

    def reset(self):
        self.t = self.x = None
        self.dx = 0.0

    @staticmethod
    def _alpha(cutoff, dt):
        tau = 1.0 / (2 * math.pi * cutoff)
        return 1.0 / (1.0 + tau / dt)

    def __call__(self, x, t):
        if self.t is None:
            self.t, self.x, self.dx = t, x, 0.0
            return x
        dt = max(t - self.t, 1e-3)
        dx = (x - self.x) / dt
        ad = self._alpha(self.dcutoff, dt)
        self.dx = ad * dx + (1 - ad) * self.dx
        cutoff = self.mincutoff + self.beta * abs(self.dx)
        a = self._alpha(cutoff, dt)
        self.x = a * x + (1 - a) * self.x
        self.t = t
        return self.x


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def analyze(p, c):
    """Classifica a pose a partir dos 21 pontos (já espelhados)."""
    w = p[0]
    palm = max(_dist(w, p[9]), 1e-6)

    def ratio(tip, pip):
        return _dist(p[tip], w) / max(_dist(p[pip], w), 1e-6)

    r = [ratio(8, 6), ratio(12, 10), ratio(16, 14), ratio(20, 18)]
    ext = [v > c["ext_ratio"] for v in r]
    return dict(
        idx=ext[0], mid=ext[1], ring=ext[2], pinky=ext[3],
        fist=all(v < c["fold_ratio"] for v in r),
        pinch_i=_dist(p[4], p[8]) / palm,
        pinch_m=_dist(p[4], p[12]) / palm,
    )


class Engine:
    def __init__(self, **cfg):
        self.c = {**DEFAULTS, **cfg}
        self.paused = False
        self._reset()

    # ------------------------------------------------------------ estado
    def _reset(self):
        c = self.c
        mk = lambda: OneEuro(c["mincutoff"], c["beta"], c["dcutoff"])
        self.fx, self.fy, self.fs = mk(), mk(), mk()
        self.fist_since = None
        self.fist_fired = False
        self.pinch_i = self.pinch_m = False
        self.dragging = False
        self.frozen = (0.5, 0.5)
        self.cursor = (0.5, 0.5)
        self.start_raw = (0.0, 0.0)
        self.origin = (0.0, 0.0)
        self.hist = deque()
        self.last_release = -9.0
        self.last_click_pos = None
        self.dbl = False
        self.scroll_prev = None

    def _pos_at(self, t):
        best = None
        for ts, pos in self.hist:
            if ts <= t:
                best = pos
            else:
                break
        return best or (self.hist[0][1] if self.hist else self.cursor)

    def _cancel(self, a):
        """Solta tudo sem gerar clique (mão sumiu, punho, pausa)."""
        if self.dragging:
            a.append(("up", self.cursor))
        self.dragging = False
        self.pinch_i = self.pinch_m = False
        self.scroll_prev = None
        self.fx.reset(); self.fy.reset(); self.fs.reset()

    def set_paused(self, value):
        a = []
        self.paused = bool(value)
        self._cancel(a)
        return a

    # ------------------------------------------------------------ update
    def update(self, lm, now):
        """lm: lista de 21 (x, y) normalizados ou None. Retorna (ações, info)."""
        c, a = self.c, []
        if lm is None:
            self._cancel(a)
            self.fist_since, self.fist_fired = None, False
            return a, self._info("SEM MAO", 0.0)

        p = [((1 - x) if c["mirror"] else x, y) for x, y in lm]
        pose = analyze(p, c)

        # ---- punho por 1 s: pausa / retoma
        prog = 0.0
        if pose["fist"]:
            if self.fist_since is None:
                self.fist_since = now
            prog = min(1.0, (now - self.fist_since) / c["fist_hold"])
            if prog >= 1.0 and not self.fist_fired:
                self.fist_fired = True
                self.paused = not self.paused
                a.append(("pause", self.paused))
            self._cancel(a)
            return a, self._info("PAUSA" if self.paused else "PUNHO", prog)
        self.fist_since, self.fist_fired = None, False
        if self.paused:
            return a, self._info("PAUSADO", 0.0)

        x0, y0, x1, y1 = c["roi"]
        sx = _clamp((p[8][0] - x0) / (x1 - x0))
        sy = _clamp((p[8][1] - y0) / (y1 - y0))

        # ---- pinça (histerese)
        new_i = pose["pinch_i"] < (c["pinch_off"] if self.pinch_i else c["pinch_on"])
        new_m = (not new_i) and not self.dragging and \
            pose["pinch_m"] < (c["pinch_off"] if self.pinch_m else c["pinch_on"])

        if new_i and not self.pinch_i:                      # fechou pinça (indicador)
            self.frozen = self._pos_at(now - c["history"])  # desfaz o "escorregão"
            self.cursor = self.frozen
            a.append(("move", self.frozen))
            self.start_raw = (sx, sy)
            self.dbl = (now - self.last_release < c["dbl_window"]
                        and self.last_click_pos is not None
                        and _dist(self.frozen, self.last_click_pos) < 0.05)
            self.fx.reset(); self.fy.reset()
        if new_m and not self.pinch_m:                      # pinça do dedo médio
            pos = self._pos_at(now - c["history"])
            self.cursor = pos
            a.append(("move", pos))
            a.append(("rclick", pos))
        was_i, was_m = self.pinch_i, self.pinch_m
        self.pinch_i, self.pinch_m = new_i, new_m

        if new_i:                                           # pinça mantida: cursor congelado
            if not self.dragging and _dist((sx, sy), self.start_raw) > c["drag_move"]:
                self.dragging = True
                self.fx.reset(); self.fy.reset()
                self.origin = (self.fx(sx, now), self.fy(sy, now))
                a.append(("down", self.frozen))
            if self.dragging:
                fx, fy = self.fx(sx, now), self.fy(sy, now)
                self.cursor = (_clamp(self.frozen[0] + fx - self.origin[0]),
                               _clamp(self.frozen[1] + fy - self.origin[1]))
                a.append(("drag", self.cursor))
            return a, self._info("ARRASTAR" if self.dragging else "PINCA", 0.0)

        if was_i:                                           # soltou a pinça
            if self.dragging:
                a.append(("up", self.cursor))
                self.dragging = False
            else:
                a.append(("dclick" if self.dbl else "click", self.frozen))
                self.last_release, self.last_click_pos = now, self.frozen
            self.fx.reset(); self.fy.reset()
        if new_m:
            return a, self._info("CLIQUE DIREITO", 0.0)
        if was_m:
            self.fx.reset(); self.fy.reset()

        # ---- "V": rolar a página
        if pose["idx"] and pose["mid"] and not pose["ring"] and not pose["pinky"]:
            y = self.fs((p[8][1] + p[12][1]) / 2, now)
            if self.scroll_prev is not None:
                dy = y - self.scroll_prev
                if abs(dy) > c["scroll_dead"]:
                    a.append(("scroll", -dy * c["scroll_gain"]))
                    self.scroll_prev = y
            else:
                self.scroll_prev = y
            return a, self._info("SCROLL", 0.0)
        self.scroll_prev = None
        self.fs.reset()

        # ---- indicador esticado: mover o cursor
        if pose["idx"] and not pose["mid"]:
            self.cursor = (self.fx(sx, now), self.fy(sy, now))
            self.hist.append((now, self.cursor))
            while self.hist and now - self.hist[0][0] > 1.0:
                self.hist.popleft()
            a.append(("move", self.cursor))
            return a, self._info("CURSOR", 0.0)

        return a, self._info("OCIOSO", 0.0)

    def _info(self, mode, fist_progress):
        return dict(mode=mode, paused=self.paused, fist=fist_progress, cursor=self.cursor)
