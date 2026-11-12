import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop"))
from gestures import Engine, OneEuro  # noqa: E402

# x do MCP de cada dedo; índices MediaPipe: polegar 1-4, indicador 5-8, médio 9-12, anelar 13-16, mindinho 17-20
FINGER_X = {"idx": 0.46, "mid": 0.50, "ring": 0.54, "pinky": 0.58}
BASE = {"idx": 5, "mid": 9, "ring": 13, "pinky": 17}


def hand(idx=True, mid=False, ring=False, pinky=False, pinch_i=False, pinch_m=False, dx=0.0, dy=0.0):
    lm = [(0.5, 0.9)] * 21
    lm = list(lm)
    for name, ext in dict(idx=idx, mid=mid, ring=ring, pinky=pinky).items():
        x, b = FINGER_X[name] + dx, BASE[name]
        lm[b] = (x, 0.70 + dy)                       # MCP
        lm[b + 1] = (x, 0.55 + dy)                   # PIP
        lm[b + 2] = (x, 0.45 + dy if ext else 0.60 + dy)
        lm[b + 3] = (x, 0.35 + dy if ext else 0.64 + dy)  # ponta
    tip_i, tip_m = lm[8], lm[12]
    lm[4] = tip_i if pinch_i else (tip_m if pinch_m else (0.35, 0.60))
    return lm


def run(engine, frames, t0=0.0, fps=30):
    out = []
    for k, f in enumerate(frames):
        out.append(engine.update(f, t0 + k / fps))
    return out


def kinds(results):
    return [a[0] for acts, _ in results for a in acts]


class GestureTests(unittest.TestCase):
    def test_pointer_moves(self):
        e = Engine(mirror=False)
        r = run(e, [hand()] * 5)
        self.assertEqual(r[-1][1]["mode"], "CURSOR")
        self.assertIn("move", kinds(r))

    def test_filter_firm_when_still_fast_when_moving(self):
        f = OneEuro(1.5, 8.0, 1.0)
        still = [f(0.5 + (0.0005 if k % 2 else -0.0005), k / 30) for k in range(30)]
        self.assertLess(max(still) - min(still), 0.0006)
        g = OneEuro(1.5, 8.0, 1.0)
        outs = [g(k * 0.02, k / 30) for k in range(30)]   # 0.6 unid/s
        self.assertGreater(outs[-1], 0.5)                  # acompanha o movimento

    def test_pinch_click_and_freeze(self):
        e = Engine(mirror=False)
        frames = [hand()] * 10 + [hand(pinch_i=True, dx=0.03)] * 6 + [hand()] * 3
        r = run(e, frames)
        self.assertEqual(kinds(r).count("click"), 1)
        # durante a pinça o cursor não escorrega: só o "move" inicial (volta no tempo)
        pinch_moves = [a for acts, _ in r[10:16] for a in acts if a[0] == "move"]
        self.assertLessEqual(len(pinch_moves), 1)

    def test_right_click(self):
        e = Engine(mirror=False)
        r = run(e, [hand()] * 5 + [hand(pinch_m=True)] * 5 + [hand()] * 3)
        self.assertEqual(kinds(r).count("rclick"), 1)
        self.assertEqual(kinds(r).count("click"), 0)

    def test_drag(self):
        e = Engine(mirror=False)
        frames = [hand()] * 10 + [hand(pinch_i=True)] * 3
        frames += [hand(pinch_i=True, dx=0.02 * k) for k in range(1, 12)]
        frames += [hand()] * 2
        r = run(e, frames)
        ks = kinds(r)
        self.assertEqual(ks.count("down"), 1)
        self.assertEqual(ks.count("up"), 1)
        self.assertGreater(ks.count("drag"), 3)
        self.assertEqual(ks.count("click"), 0)

    def test_double_click(self):
        e = Engine(mirror=False)
        pinch = [hand(pinch_i=True)] * 3
        r = run(e, [hand()] * 10 + pinch + [hand()] * 3 + pinch + [hand()] * 2)
        ks = kinds(r)
        self.assertEqual(ks.count("click"), 1)
        self.assertEqual(ks.count("dclick"), 1)

    def test_scroll_v(self):
        e = Engine(mirror=False)
        frames = [hand(mid=True)] * 3 + [hand(mid=True, dy=-0.02 * k) for k in range(1, 8)]
        r = run(e, frames)
        sc = [a[1] for acts, _ in r for a in acts if a[0] == "scroll"]
        self.assertTrue(sc and all(v > 0 for v in sc))     # mão sobe -> scroll para cima

    def test_fist_pauses_after_1s_and_resumes(self):
        e = Engine(mirror=False)
        fist = hand(idx=False)
        r = run(e, [fist] * 20)                            # 0,67 s
        self.assertNotIn("pause", kinds(r))
        r = run(e, [fist] * 40, t0=1.0)                    # passa de 1 s
        self.assertEqual(kinds(r).count("pause"), 1)
        self.assertTrue(e.paused)
        r = run(e, [hand()] * 5, t0=5.0)                   # pausado: ignora ponteiro
        self.assertNotIn("move", kinds(r))
        run(e, [fist] * 40, t0=6.0)                        # punho de novo: retoma
        self.assertFalse(e.paused)


if __name__ == "__main__":
    unittest.main()
