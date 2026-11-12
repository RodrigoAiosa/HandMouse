"""HandMouse (desktop): controla o mouse REAL do sistema com a mão, via webcam.

    pip install -r requirements.txt
    python handmouse.py

Teclas na janela de preview:  ESC = pausar/retomar   Q = sair
"""
import sys
import time

import cv2
import mediapipe as mp
import pyautogui

from gestures import Engine

pyautogui.PAUSE = 0
pyautogui.FAILSAFE = False

MAC = sys.platform == "darwin"
if MAC:
    # No macOS o arraste exige eventos "LeftMouseDragged"; o mouseDown/moveTo
    # comum do pyautogui não é reconhecido como arraste por muitos apps.
    from Quartz import (CGEventCreateMouseEvent, CGEventPost, kCGEventLeftMouseDown,
                        kCGEventLeftMouseDragged, kCGEventLeftMouseUp,
                        kCGHIDEventTap, kCGMouseButtonLeft)

LEGEND = [
    ("CURSOR", "Indicador esticado", "mover o cursor"),
    ("PINCA", "Pinca indicador+polegar", "clique"),
    ("CLIQUE DIREITO", "Pinca medio+polegar", "clique direito"),
    ("ARRASTAR", "Segurar a pinca e mover", "arrastar e soltar"),
    ("SCROLL", "V (indicador+medio) sobe/desce", "rolar a pagina"),
    ("PUNHO", "Punho por 1 s", "pausar / retomar"),
]


class Mouse:
    def __init__(self):
        self.w, self.h = pyautogui.size()

    def px(self, pos):
        return int(pos[0] * (self.w - 1)), int(pos[1] * (self.h - 1))

    def _q(self, etype, x, y):
        ev = CGEventCreateMouseEvent(None, etype, (x, y), kCGMouseButtonLeft)
        CGEventPost(kCGHIDEventTap, ev)

    def apply(self, act):
        kind, arg = act
        if kind == "move":
            pyautogui.moveTo(*self.px(arg))
        elif kind == "click":
            pyautogui.click(*self.px(arg))
        elif kind == "dclick":
            pyautogui.doubleClick(*self.px(arg))
        elif kind == "rclick":
            pyautogui.rightClick(*self.px(arg))
        elif kind == "down":
            x, y = self.px(arg)
            pyautogui.moveTo(x, y)
            self._q(kCGEventLeftMouseDown, x, y) if MAC else pyautogui.mouseDown()
        elif kind == "drag":
            x, y = self.px(arg)
            self._q(kCGEventLeftMouseDragged, x, y) if MAC else pyautogui.moveTo(x, y)
        elif kind == "up":
            x, y = self.px(arg)
            self._q(kCGEventLeftMouseUp, x, y) if MAC else pyautogui.mouseUp()
        elif kind == "scroll":
            pyautogui.scroll(int(arg))


def draw_overlay(frame, info, hand):
    h, w = frame.shape[:2]
    state = "PAUSADO" if info["paused"] else "ATIVO | " + info["mode"]
    color = (0, 0, 255) if info["paused"] else (0, 220, 0)
    cv2.rectangle(frame, (0, 0), (w, 24), (0, 0, 0), -1)
    cv2.putText(frame, state, (8, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)
    x0, y0, x1, y1 = 0.15, 0.10, 0.85, 0.70
    cv2.rectangle(frame, (int(x0 * w), int(y0 * h)), (int(x1 * w), int(y1 * h)), (200, 180, 60), 1)
    if info["fist"] > 0:
        cv2.rectangle(frame, (0, 26), (int(w * info["fist"]), 32), (0, 165, 255), -1)
    if hand:
        mp.solutions.drawing_utils.draw_landmarks(frame, hand, mp.solutions.hands.HAND_CONNECTIONS)
    y = h - 12 - 18 * len(LEGEND)
    cv2.rectangle(frame, (0, y - 6), (w, h), (20, 20, 20), -1)
    for mode, gesture, action in LEGEND:
        active = mode == info["mode"]
        if active:
            cv2.rectangle(frame, (0, y - 12), (w, y + 5), (150, 90, 20), -1)
        cv2.putText(frame, f"{gesture}  ->  {action}", (8, y), cv2.FONT_HERSHEY_SIMPLEX,
                    0.42, (255, 255, 255) if active else (190, 190, 190), 1, cv2.LINE_AA)
        y += 18


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        sys.exit("Não foi possível abrir a webcam. No macOS, permita a câmera para o Terminal.")
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    engine = Engine(mirror=False)   # o frame já é espelhado abaixo
    mouse = Mouse()
    hands = mp.solutions.hands.Hands(max_num_hands=1, model_complexity=0,
                                     min_detection_confidence=0.6, min_tracking_confidence=0.6)
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)
            res = hands.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            hand = res.multi_hand_landmarks[0] if res.multi_hand_landmarks else None
            lm = [(p.x, p.y) for p in hand.landmark] if hand else None

            actions, info = engine.update(lm, time.monotonic())
            for act in actions:
                if act[0] != "pause":
                    mouse.apply(act)

            draw_overlay(frame, info, hand)
            cv2.imshow("HandMouse", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == 27:   # ESC
                for act in engine.set_paused(not engine.paused):
                    mouse.apply(act)
    finally:
        hands.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
