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

// globals: 0 = bird y, 1 = velocity, 2 = pipe x*4, 3 = score
// locals:  0 = flap key, 1 = pixel byte address, 2 = x*4, 3 = y - bird y, 4 = pipe?, 5 = bird?
// The host calls f(DOT) once for the start screen: a non-zero key flaps, and
// the pixel at byte address DOT turns into the "press a key" dot.
const DOT = 64 * 512 + 64 * 4;                  // centre of the screen
const SKY = 0xFFF0C870 | 0, PIPE = 0xFF2EBF73 | 0, BIRD = 0xFF30E0F8 | 0;
const OR = 0x72, LEU = 0x4d;

const body = [
  1, 5, 0x7f,                                   // 5 more i32 locals

  // vy = key ? -5 : vy+1 ;  by += vy
  c(-5), gget(1), c(1), ADD, get(0), SELECT, gset(1),
  gget(0), gget(1), ADD, gset(0),
  // px = (px-8)&511 ; score += (px==0) -> pipe left the screen, a new one enters
  gget(2), c(8), SUB, c(511), AND, gset(2),
  gget(3), gget(2), EQZ, ADD, gset(3),

  0x03, 0x40,                                   // loop over all 16384 pixels, 4 bytes each
    get(1), c(511), AND, set(2),                //   x*4 = i & 511, y = i >> 9
    // pipe: ((px-x)&511) < 48  &&  (y-gap) > 44 (unsigned: above gap wraps)
    // gap top = (score*29)&63
    gget(2), get(2), SUB, c(511), AND, c(48), LTU,
    get(1), c(9), SHRU, gget(3), c(29), MUL, c(63), AND, SUB, c(44), GTU, AND, tee(4),
    // bird: 6x6 box at x=10, y=by
    get(2), c(40), SUB, c(24), LTU,
    get(1), c(9), SHRU, gget(0), SUB, tee(3), c(6), LTU, AND, tee(5),
    // dead if the bird touches a pipe or leaves the screen (negative is huge unsigned)
    AND, gget(0), c(121), GTU, OR, DIE,
    // mem[i] = eye|score|dot ? 0 : bird ? BIRD : pipe ? PIPE : SKY
    // (0 has alpha 0, so those pixels show the dark page behind)
    get(1),
    c(0), c(BIRD), c(PIPE), c(SKY), get(4), SELECT, get(5), SELECT,
    get(2), c(56), EQ, get(3), c(1), EQ, AND,   //   eye
    get(1), gget(3), c(5), SHL, LEU, OR,        //   score bar along the top, 8px a point
    get(1), get(0), EQ, OR,                     //   start screen dot
    SELECT,
    0x36, 2, 0,
    // while ((i += 4) >> 16 == 0)
    get(1), c(4), ADD, tee(1), c(16), SHRU, EQZ, 0x0d, 0,
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
      0x7f, 1, c(0), 0x0b,                      //   px (just off the right edge)
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
  e.f(${DOT}); draw();   // start screen: frozen frame with a dot
};
onkeydown = onpointerdown = ev => { k = !ev.repeat; run = 1; };
boot();
setInterval(() => {
  if (run) try { e.f(k); draw(); } catch (_) { boot(); }   // trap = dead = reboot
  k = 0;
}, 50);
</script>
`);
