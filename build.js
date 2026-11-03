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

// globals: 0 = bird position as a pixel byte address (y*512 + 40), 1 = velocity,
//          2 = distance flown (8 per tick; score = distance >> 9)
// locals:  0 = flap key, 1 = pixel byte address i, 2 = mountain phase, 3 = i - bird,
//          4 = pipe?, 5 = bird?
// The host calls f(DOT) once for the start screen: a non-zero key flaps, and
// the pixel at byte address DOT turns into the "press a key" dot.
const DOT = 64 * 512 + 64 * 4;                  // centre of the screen
const SKY = 0xFFF0C870 | 0, PIPE = 0xFF2EBF73 | 0, BIRD = 0xFF30E0F8 | 0;
const OR = 0x72, XOR = 0x73, LEU = 0x4d, SHRS = 0x75, EXT8S = 0xc0;

const body = [
  1, 5, 0x7f,                                   // 5 more i32 locals

  // vy = key ? -5 rows : vy + 1 row ;  bird += vy ;  distance += 8
  c(-5 * 512), gget(1), c(512), ADD, get(0), SELECT, gset(1),
  gget(0), gget(1), ADD, gset(0),
  gget(2), c(8), ADD, gset(2),

  0x03, 0x40,                                   // loop over all 16384 pixels, 4 bytes each
    // pipe: ((distance + i) & 511) > 463, i.e. 12 columns that slide left and wrap
    //   && (y - gap) > 44 (unsigned, so above the gap wraps too)
    //   gap top = (score*29)&63, which changes as the pipe wraps
    gget(2), get(1), ADD, c(511), AND, c(463), GTU,
    get(1), c(9), SHRU, gget(2), c(9), SHRU, c(29), MUL, c(63), AND, SUB, c(44), GTU, AND, tee(4),
    // bird: 8x8 box. r = i - bird has dy in bits 9-11 and dx*4 in bits 0-4,
    // so it is the bird exactly when every other bit is clear
    get(1), gget(0), SUB, tee(3), c(~0xE1F), AND, EQZ, tee(5),
    // dead if the bird touches a pipe or leaves the screen: bird >> 16 is
    // non-zero above the top (negative) and below the bottom (past 64 KiB)
    AND, gget(0), c(16), SHRU, OR, DIE,
    // mem[i] = eye|score|dot ? 0 : bird ? BIRD : pipe ? PIPE : mountain ? sky>>1 : sky
    // (0 has alpha 0, so those pixels show the dark page behind)
    get(1),
    c(0), c(BIRD), c(PIPE),
    //   sky gets redder towards the horizon: red += y
    c(SKY), get(1), c(9), SHRU, ADD,
    //   mountains: s = signed low byte of (distance/4 + i), scrolling at 1/4 pipe
    //   speed; |s| ~ s ^ (s >> 31) is a triangle wave. mountain if i - |s|*128
    //   is below row 88. sky>>1 halves alpha and colour: a dark blue
    get(1), gget(2), c(2), SHRU, get(1), ADD, EXT8S, tee(2), get(2), c(31), SHRS, XOR,
    c(7), SHL, SUB, c(88 * 512), 0x4a, SHRU,  // 0x4a: signed >, or the top rows wrap
    get(4), SELECT, get(5), SELECT,
    get(3), c(2 * 512 + 5 * 4), EQ,             //   eye
    get(1), gget(2), c(4), SHRU, LEU, OR,       //   distance bar along the top, 8px a pipe
    get(1), get(0), EQ, OR,                     //   start screen dot
    SELECT,
    0x36, 2, 0,
    // while ((i += 4) << 16): only zero once i reaches 65536
    get(1), c(4), ADD, tee(1), c(16), SHL, 0x0d, 0,
  0x0b,
  0x0b,                                         // end of function
].flat();

const wasm = [
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  sec(1, 1, 0x60, 1, 0x7f, 0),                  // type: (i32) -> ()
  sec(3, 1, 0),                                 // one function
  sec(5, 1, 0, 1),                              // 1 page of memory = 128x128 RGBA
  sec(6, 3,                                     // globals (all mutable i32)
      0x7f, 1, c(30 * 512 + 40), 0x0b,          //   bird (starts inside the first gap)
      0x7f, 1, c(0), 0x0b,                      //   vy
      0x7f, 1, c(0), 0x0b),                     //   distance (first pipe at the right edge)
  sec(7, 2, 0, 2, 0, 1, 0x66, 0, 0),            // memory as "", f
  sec(10, 1, u(body.length), body),
].flat();

if (wasm.length > 256) throw new Error(`${wasm.length} bytes, over budget`);
const buf = Buffer.from(wasm);
fs.writeFileSync('flappy.wasm', buf);
console.log(`flappy.wasm: ${buf.length} bytes (${256 - buf.length} to spare)`);

fs.writeFileSync('index.html', `<!doctype html>
<title>flappy 256</title>
<body style="margin:0;background:#222">
<canvas id=c width=128 height=128 style="width:512px;image-rendering:pixelated">
<script>
// the 256-byte part is flappy.wasm; this is only the keyboard + canvas glue
let k = 0, run = 0, e, img, ctx = c.getContext('2d');
const wasm = Uint8Array.from(atob('${buf.toString('base64')}'), c => c.charCodeAt());
const draw = () => ctx.putImageData(img, 0, 0);
const boot = async () => {
  run = 0;   // wait on the start screen
  e = (await WebAssembly.instantiate(wasm)).instance.exports;
  img = new ImageData(new Uint8ClampedArray(e[''].buffer, 0, 65536), 128, 128);
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
