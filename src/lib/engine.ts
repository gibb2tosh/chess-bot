import type { AnalyseOptions, EngineLike, EngineLine } from './types';

/** Parse a UCI "info ..." line into an EngineLine (or null if it has no pv/score). */
export function parseInfo(line: string): (EngineLine & { multipv: number }) | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const tokens = line.split(/\s+/);
  let depth = 0;
  let multipv = 1;
  let cp: number | undefined;
  let mate: number | undefined;
  let pv: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = Number(tokens[++i]);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
      // skip optional lowerbound/upperbound markers
      if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i++;
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  if (pv.length === 0 || (cp === undefined && mate === undefined)) return null;
  return { move: pv[0], pv, score: mate !== undefined ? { mate } : { cp }, depth, multipv };
}

/**
 * Minimal transport-agnostic UCI driver. Give it a way to send commands and
 * feed it every line the engine prints; it serialises analyse() requests.
 */
export class UciEngine implements EngineLike {
  private send: (cmd: string) => void;
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  private ready: Promise<void>;
  private currentMultiPv = 1;
  private dead: Error | null = null;
  private rejectWaiter: ((e: Error) => void) | null = null;

  constructor(send: (cmd: string) => void) {
    this.send = send;
    this.ready = this.waitFor('uciok', () => send('uci')).then(() => this.isReady());
    // A crash during start-up surfaces through analyse(); don't also report it as unhandled.
    this.ready.catch(() => undefined);
  }

  /** Feed every output line from the engine here. */
  onLine(line: string) {
    this.listener?.(line);
  }

  /** True once the engine has crashed; create a new one. */
  get isDead(): boolean {
    return this.dead !== null;
  }

  /** Mark the engine as crashed: the pending request and all future ones reject. */
  fail(error: Error) {
    this.dead = error;
    this.listener = null;
    const reject = this.rejectWaiter;
    this.rejectWaiter = null;
    reject?.(error);
  }

  private waitFor(token: string, kick: () => void, collect?: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(this.dead);
      this.rejectWaiter = reject;
      this.listener = (line) => {
        collect?.(line);
        if (line.startsWith(token)) {
          this.listener = null;
          this.rejectWaiter = null;
          resolve();
        }
      };
      kick();
    });
  }

  /** Run engine work strictly one request at a time; a failure doesn't block later requests. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private isReady() {
    return this.waitFor('readyok', () => this.send('isready'));
  }

  setOption(name: string, value: string | number) {
    return this.serial(async () => {
      await this.ready;
      this.send(`setoption name ${name} value ${value}`);
      await this.isReady();
    });
  }

  newGame() {
    return this.serial(async () => {
      await this.ready;
      this.send('ucinewgame');
      await this.isReady();
    });
  }

  analyse(fen: string, opts: AnalyseOptions): Promise<EngineLine[]> {
    const run = async () => {
      await this.ready;
      const multipv = opts.multipv ?? 1;
      if (multipv !== this.currentMultiPv) {
        this.send(`setoption name MultiPV value ${multipv}`);
        this.currentMultiPv = multipv;
        await this.isReady();
      }
      const best = new Map<number, EngineLine>();
      const go = opts.movetime ? `go movetime ${opts.movetime}` : `go depth ${opts.depth ?? 14}`;
      await this.waitFor(
        'bestmove',
        () => {
          this.send(`position fen ${fen}`);
          this.send(go);
        },
        (line) => {
          const info = parseInfo(line);
          if (info) best.set(info.multipv, { move: info.move, pv: info.pv, score: info.score, depth: info.depth });
        },
      );
      return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    };
    return this.serial(run);
  }
}

/** Browser engine: Stockfish WASM running in a Web Worker. */
export function createBrowserEngine(): UciEngine {
  const base = import.meta.env.BASE_URL ?? '/';
  const worker = new Worker(`${base}engine/stockfish-19-lite-single.js`);
  const engine = new UciEngine((cmd) => worker.postMessage(cmd));
  worker.onmessage = (e: MessageEvent) => {
    const data = typeof e.data === 'string' ? e.data : String(e.data);
    for (const line of data.split('\n')) engine.onLine(line.trim());
  };
  worker.onerror = (e) => {
    engine.fail(new Error(`Stockfish crashed: ${e.message || 'unknown error'}`));
    worker.terminate();
  };
  return engine;
}

let shared: UciEngine | null = null;
/** One shared analysis engine for the whole app (recreated if it crashes). */
export function getAnalysisEngine(): UciEngine {
  if (!shared || shared.isDead) shared = createBrowserEngine();
  return shared;
}

let botEngine: UciEngine | null = null;
/** A second engine instance for the sparring bot so analysis and play don't block each other. */
export function getBotEngine(): UciEngine {
  if (!botEngine || botEngine.isDead) botEngine = createBrowserEngine();
  return botEngine;
}
