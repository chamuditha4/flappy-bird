# flappy bird in 256 bytes (WebAssembly)

**[▶ Play it here](https://chamuditha4.github.io/flappy-bird/)**

<a href="https://chamuditha4.github.io/flappy-bird/"><img src="screenshot-start.png" width="320" alt="start screen"> <img src="screenshot.png" width="320" alt="gameplay"></a>

GitHub strips scripts from READMEs, so the game can't run inline. The link above opens the same `index.html` on GitHub Pages.

The whole game is `flappy.wasm`, hand-assembled to exactly 256 bytes. It starts paused with a dot in the middle of the screen. Press any key or click to flap. The dark bar along the top is your score, 8 pixels per pipe. Dying reboots to the start screen.

    node build.js          # writes flappy.wasm and index.html
    open index.html        # wasm is inlined as base64, so file:// works

`index.html` only holds the glue: key handler, `putImageData`, a 20 Hz timer. Everything you see, including the start dot and the score, is drawn by the wasm.

Tricks, borrowed from hill-climb-1024:

- **Hand-assembled.** `build.js` emits raw bytes. There is no name section, one type, one function, and constants picked so their LEBs stay short.
- **Memory is the screen.** One 64 KiB page is exactly 128x128 RGBA. The host wraps it in an `ImageData` with no copy.
- **State lives in four globals.** They are bird y, velocity, pipe x and score.
- **The loop walks byte addresses.** It steps `i += 4`, so `i & 511` is x*4 and `i >> 9` is y, and the store needs no shift.
- **Pipe wrap is free.** `(px - x) & 511 < 48` makes the pipe slide in and out of both screen edges with no spawn or despawn logic.
- **The gap is one unsigned compare.** `(y - gap) > 44` is true both above and below the gap.
- **The gap position comes from the score.** `(score * 29) & 63`, so no RNG or extra state.
- **Collision uses the rendering.** The bird and pipe flags are `tee`d straight into an `and` in the draw loop. There is no separate hit test.
- **Off-screen is one unsigned compare.** `by > 121` catches both top and bottom, because negative values wrap to huge unsigned. It is OR'd into the collision test, so one trap serves both.
- **Death is `unreachable`.** The trap throws, and the host reboots a fresh instance. That is the wasm version of `jmp start`.
- **Scoring is `eqz`.** A point is added when the pipe x hits 0, just as the pipe clears the bird. The gap moves at that moment, so it visibly jumps on the right edge, where the pipe is wrapping back in, but never near the bird.
- **Dark pixels are transparent.** Colour `0` costs 2 bytes and has alpha 0, so the dark page shows through. The eye, the score bar and the start dot all share that one `select`.
- **The score bar is one compare.** `i <= score << 5`. Past 16 points it wraps onto the next row.
- **The start dot is the key.** The host calls `f(DOT)` once, where `DOT` is the byte address of the screen centre. Any non-zero key flaps, so physics still runs, and `i == key` lights that one pixel. In play the key is 0 or 1, and those addresses are already covered by the score bar. That costs 6 bytes.
- **Colours that encode short.** The sky has blue ≥ 0xF0, which saves a byte of LEB.
