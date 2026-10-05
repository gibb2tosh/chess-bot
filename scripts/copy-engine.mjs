// Copies the Stockfish WASM build into public/ so Vite serves it as a static worker.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];
mkdirSync('public/engine', { recursive: true });
for (const f of files) copyFileSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`);
console.log('Stockfish copied to public/engine');
