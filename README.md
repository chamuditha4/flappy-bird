# flappy bird in 256 bytes (WebAssembly)

The whole game is `flappy.wasm`, hand-assembled to exactly 256 bytes. It shows a start screen, and any key or click flaps. Dying reboots to the start screen. The score is in the tab title.

    node build.js          # writes flappy.wasm and index.html
    open index.html        # wasm is inlined as base64, so file:// works

`index.html` only holds the glue: key handler, `putImageData`, a 20 Hz timer. The game and renderer are all in the wasm.

Tricks, borrowed from hill-climb-1024:

- **Hand-assembled.** `build.js` emits raw bytes. There is no name section, one type, one function, and constants picked so their LEBs stay short.
- **Memory is the screen.** One 64 KiB page is exactly 128x128 RGBA. The host wraps it in an `ImageData` with no copy.
- **State lives in four globals.** They are bird y, velocity, pipe x and score. Score is exported so the host can show it.
- **Pipe wrap is free.** `(x - px) & 127 < 12` makes the pipe slide in and out of both screen edges with no spawn or despawn logic.
- **The gap is one unsigned compare.** `(y - gap) > 44` is true both above and below the gap.
- **The gap position comes from the score.** `(score * 29) & 63`, so no RNG or extra state.
- **Collision uses the rendering.** The bird pixel and pipe pixel are tested together in the draw loop. There is no separate hit test.
- **Death is `unreachable`.** The trap throws, and the host reboots a fresh instance. That is the wasm version of `jmp start`.
- **Off-screen is one unsigned compare.** `by > 121` catches both top and bottom, because negative values wrap to huge unsigned.
- **The bird's eye is a transparent pixel.** Colour `0` costs 2 bytes and has alpha 0, so the dark page shows through.
- **The start screen is host-side.** The host renders one frame and waits for the first key before ticking. The title text is drawn on the canvas.
