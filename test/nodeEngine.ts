import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { UciEngine } from '../src/lib/engine';

/** Stockfish (WASM build) as a Node child process, for tests and the CLI. */
export function createNodeEngine(): { engine: UciEngine; quit: () => void } {
  const proc = spawn(process.execPath, ['node_modules/stockfish/bin/stockfish-19-lite-single.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const engine = new UciEngine((cmd) => proc.stdin.write(cmd + '\n'));
  createInterface({ input: proc.stdout }).on('line', (l) => engine.onLine(l.trim()));
  return { engine, quit: () => proc.kill() };
}
