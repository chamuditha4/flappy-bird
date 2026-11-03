// Hand-assembles flappy.wasm (<= 256 bytes) and wraps it in index.html.
// usage: node build.js
const fs = require('fs');

// signed LEB128
const s = n => { const o = []; for (;;) { const b = n & 127; n >>= 7;
  if ((n == 0 && !(b & 64)) || (n == -1 && (b & 64))) return [...o, b]; o.push(b | 128); } };
const u = n => n < 128 ? [n] : [n & 127 | 128, n >> 7];
const sec = (id, ...b) => { b = b.flat(); return [id, ...u(b.length), ...b]; };

// opcodes
const get = i => [0x20, i], set = i => [0x21, i], tee = i => [0x22, i];
const gget = i => [0x23, i], gset = i => [0x24, i];
const c = n => [0x41, ...s(n)];
const ADD = 0x6a, SUB = 0x6b, MUL = 0x6c, AND = 0x71, SHL = 0x74, SHRU = 0x76,
      EQ = 0x46, EQZ = 0x45, LTU = 0x49, GTU = 0x4b, SELECT = 0x1b;
// if (cond) unreachable  ->  host reboots the instance (our `jmp start`)
const DIE = [0x04, 0x40, 0x00, 0x0b];

// globals: 0 = bird y, 1 = velocity, 2 = pipe x, 3 = score (exported, host shows it)
// locals:  0 = flap key, 1 = pixel, 2 = x, 3 = y, 4 = y - bird y, 5 = pipe?, 6 = bird?
const SKY = 0xFFCEC570 | 0, PIPE = 0xFF2EBF73 | 0, BIRD = 0xFF30E0F8 | 0;

const body = [
  1, 6, 0x7f,                                   // 6 more i32 locals

  // vy = key ? -5 : vy+1 ;  by += vy
  c(-5), gget(1), c(1), ADD, get(0), SELECT, gset(1),
  gget(0), gget(1), ADD, gset(0),
  // px = (px-2)&127 ; score += (px==126) -> pipe wrapped, new one spawned
  gget(2), c(2), SUB, c(127), AND, gset(2),
  gget(3), gget(2), c(126), EQ, ADD, gset(3),
  // off the top or bottom of the screen: dead (negative wraps to huge unsigned)
  gget(0), c(121), GTU, DIE,

  0x03, 0x40,                                   // loop over all 16384 pixels
    get(1), c(127), AND, set(2),                //   x = i & 127
    get(1), c(7), SHRU, set(3),                 //   y = i >> 7
    // pipe: ((x-px)&127) < 12  &&  (y-gap) > 44 (unsigned: above gap wraps)
    // gap top = (score*29)&63
    get(2), gget(2), SUB, c(127), AND, c(12), LTU,
    get(3), gget(3), c(29), MUL, c(63), AND, SUB, c(44), GTU, AND, set(5),
    // bird: 6x6 box at x=30, y=by
    get(2), c(30), SUB, c(6), LTU,
    get(3), gget(0), SUB, tee(4), c(6), LTU, AND, set(6),
    // bird overlapping pipe: dead
    get(5), get(6), AND, DIE,
    // mem[i*4] = eye ? 0 : bird ? BIRD : pipe ? PIPE : SKY
    // (0 has alpha 0, so the eye is see-through to the dark page behind)
    get(1), c(2), SHL,
    c(0), c(BIRD), c(PIPE), c(SKY), get(5), SELECT, get(6), SELECT,
    get(2), c(34), EQ, get(4), c(1), EQ, AND, SELECT,
    0x36, 2, 0,
    // while (++i >> 14 == 0)
    get(1), c(1), ADD, tee(1), c(14), SHRU, EQZ, 0x0d, 0,
  0x0b,
  0x0b,                                         // end of function
].flat();

const wasm = [
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  sec(1, 1, 0x60, 1, 0x7f, 0),                  // type: (i32) -> ()
  sec(3, 1, 0),                                 // one function
  sec(5, 1, 0, 1),                              // 1 page of memory = 128x128 RGBA
  sec(6, 4,                                     // globals (all mutable i32)
      0x7f, 1, c(20), 0x0b,                     //   by (starts inside the first gap)
      0x7f, 1, c(0), 0x0b,                      //   vy
      0x7f, 1, c(60), 0x0b,                     //   px
      0x7f, 1, c(0), 0x0b),                     //   score
  sec(7, 3, 1, 0x6d, 2, 0, 1, 0x66, 0, 0, 1, 0x73, 3, 3), // m, f, s
  sec(10, 1, u(body.length), body),
].flat();

if (wasm.length > 256) throw new Error(`${wasm.length} bytes, over budget`);
const buf = Buffer.from(wasm);
fs.writeFileSync('flappy.wasm', buf);
console.log(`flappy.wasm: ${buf.length} bytes (${256 - buf.length} to spare)`);

fs.writeFileSync('index.html', `<!doctype html>
<title>0</title>
<body style="margin:0;background:#222">
<canvas id=c width=128 height=128 style="width:512px;image-rendering:pixelated">
<script>
// the 256-byte part is flappy.wasm; this is only the keyboard + canvas glue
let k = 0, run = 0, e, img, ctx = c.getContext('2d');
const wasm = Uint8Array.from(atob('${buf.toString('base64')}'), c => c.charCodeAt());
const draw = () => { ctx.putImageData(img, 0, 0); document.title = e.s.value; };
const boot = async () => {
  run = 0;   // wait on the start screen
  e = (await WebAssembly.instantiate(wasm)).instance.exports;
  img = new ImageData(new Uint8ClampedArray(e.m.buffer, 0, 65536), 128, 128);
  e.f(0); draw();
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  for (const [s, y] of [['FLAPPY 256', 90], ['press any key', 110]])
    ctx.strokeText(s, 64, y, 124), ctx.fillText(s, 64, y, 124);
};
onkeydown = onpointerdown = ev => { k = !ev.repeat; run = 1; };
boot();
setInterval(() => {
  if (run) try { e.f(k); draw(); } catch (_) { boot(); }   // trap = dead = reboot
  k = 0;
}, 50);
</script>
`);
