// node tests/engine.test.mjs  — mesmos cenários do teste Python, no motor JS.
import assert from "node:assert/strict";
import { Engine } from "../public/engine.js";

const FX = { idx: 0.46, mid: 0.50, ring: 0.54, pinky: 0.58 }, BASE = { idx: 5, mid: 9, ring: 13, pinky: 17 };
function hand({ idx = true, mid = false, ring = false, pinky = false, pi = false, pm = false, dx = 0, dy = 0 } = {}) {
  const lm = Array.from({ length: 21 }, () => [0.5, 0.9]);
  for (const [n, ext] of Object.entries({ idx, mid, ring, pinky })) {
    const x = FX[n] + dx, b = BASE[n];
    lm[b] = [x, 0.70 + dy]; lm[b + 1] = [x, 0.55 + dy];
    lm[b + 2] = [x, (ext ? 0.45 : 0.60) + dy]; lm[b + 3] = [x, (ext ? 0.35 : 0.64) + dy];
  }
  lm[4] = pi ? lm[8] : pm ? lm[12] : [0.35, 0.60];
  return lm;
}
const run = (e, frames, t0 = 0) => frames.flatMap((f, k) => e.update(f, t0 + k / 30).actions.map((a) => a[0]));
const count = (ks, k) => ks.filter((x) => x === k).length;
const mk = () => new Engine({ mirror: false });

let ks = run(mk(), [...Array(10).fill(hand()), ...Array(6).fill(hand({ pi: true, dx: 0.03 })), ...Array(3).fill(hand())]);
assert.equal(count(ks, "click"), 1);

ks = run(mk(), [...Array(5).fill(hand()), ...Array(5).fill(hand({ pm: true })), ...Array(3).fill(hand())]);
assert.equal(count(ks, "rclick"), 1);

const dragFrames = [...Array(10).fill(hand()), ...Array(3).fill(hand({ pi: true })),
  ...Array.from({ length: 11 }, (_, k) => hand({ pi: true, dx: 0.02 * (k + 1) })), hand(), hand()];
ks = run(mk(), dragFrames);
assert.equal(count(ks, "down"), 1); assert.equal(count(ks, "up"), 1); assert.equal(count(ks, "click"), 0);

const p = Array(3).fill(hand({ pi: true }));
ks = run(mk(), [...Array(10).fill(hand()), ...p, ...Array(3).fill(hand()), ...p, hand(), hand()]);
assert.equal(count(ks, "click"), 1); assert.equal(count(ks, "dclick"), 1);

const e = mk(), fist = hand({ idx: false });
assert.equal(count(run(e, Array(20).fill(fist)), "pause"), 0);
assert.equal(count(run(e, Array(40).fill(fist), 1), "pause"), 1); assert.ok(e.paused);
run(e, Array(5).fill(hand()), 5);
run(e, Array(40).fill(fist), 6); assert.ok(!e.paused);
console.log("engine.js OK");
