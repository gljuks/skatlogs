# skatlogs

A real-time video feedback synthesizer running in the browser. Built with TypeScript and Vite using webGL shaders. Essentially a port of Andrei Jay's apps: Waaave pool, Spectral Mesh, Phosphorm. 
Features: 
- webcam or capture card/screen capture (other tabs, like youtube) input 
- audio reactive synth as input 
- multi-layer feedback buffers
- spectral mesh displacement
- custom GLSL shaders
- customs chaining of all above
- MIDI CC mapping
- keyboard shortcuts
- preset save/load

## Known issues

Chrome tab share is limited to 30fps. Future versions will allow RPC streaming video to overcome this limit. 

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- Corepack (bundled with Node.js 18+)

---

## Run locally

```bash
corepack yarn install
corepack yarn dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for production

```bash
corepack yarn build
```

Output goes to `dist/`.

---

## Notes
- Press `?` in the app to open the built-in docs overlay.
