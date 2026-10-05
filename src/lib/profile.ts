import { moveAccuracy } from './eval';
import { MOTIF_LABEL } from './motifs';
import type { Classification, Color, GameReview, Motif, Phase, PlyAnalysis } from './types';

export interface PhaseStats {
  moves: number;
  accuracy: number;
  errorsPer10: number;
}

export interface OpeningStats {
  name: string;
  games: number;
  score: number; // points from user's POV
  avgAccuracy: number;
  color: Color;
}

export interface Insight {
  kind: 'strength' | 'weakness';
  title: string;
  detail: string;
  /** Motif to train with puzzles, if any. */
  motif?: Motif;
  /** Lichess puzzle theme or opening to drill, if any. */
  drill?: string;
}

export interface Profile {
  games: number;
  record: { wins: number; draws: number; losses: number };
  avgAccuracy: number;
  byColor: Record<Color, { games: number; accuracy: number; score: number }>;
  byPhase: Record<Phase, PhaseStats>;
  /** How often each theme shows up in moves you got wrong. */
  allowed: [Motif, number][];
  missed: [Motif, number][];
  /** How often each theme shows up in moves you got right (best/great/brilliant). */
  found: [Motif, number][];
  classCounts: Record<Classification, number>;
  timeTrouble: { errors: number; moves: number; errorRate: number; normalErrorRate: number };
  punishRate: { chances: number; punished: number };
  conversion: { winningGames: number; converted: number };
  openings: OpeningStats[];
  insights: Insight[];
}

const BAD: Classification[] = ['mistake', 'blunder', 'miss'];
const GOOD: Classification[] = ['best', 'great', 'brilliant', 'excellent'];

function resultFor(result: string, color: Color): number | null {
  if (result === '1-0') return color === 'w' ? 1 : 0;
  if (result === '0-1') return color === 'b' ? 1 : 0;
  if (result === '1/2-1/2') return 0.5;
  return null;
}

function inc<K>(m: Map<K, number>, k: K, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function sorted<K>(m: Map<K, number>): [K, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function baseSeconds(tc?: string): number | undefined {
  if (!tc) return undefined;
  const n = Number(tc.split('+')[0]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function buildProfile(reviews: GameReview[]): Profile {
  const mine = reviews.filter((r) => r.userColor);
  const byPhaseRaw: Record<Phase, { accs: number[]; errors: number }> = {
    opening: { accs: [], errors: 0 },
    middlegame: { accs: [], errors: 0 },
    endgame: { accs: [], errors: 0 },
  };
  const allowed = new Map<Motif, number>();
  const missed = new Map<Motif, number>();
  const found = new Map<Motif, number>();
  const classCounts = Object.fromEntries(
    ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder', 'forced'].map((c) => [c, 0]),
  ) as Record<Classification, number>;
  const record = { wins: 0, draws: 0, losses: 0 };
  const byColor: Profile['byColor'] = {
    w: { games: 0, accuracy: 0, score: 0 },
    b: { games: 0, accuracy: 0, score: 0 },
  };
  const tt = { errors: 0, moves: 0, normalErrors: 0, normalMoves: 0 };
  const punish = { chances: 0, punished: 0 };
  const conversion = { winningGames: 0, converted: 0 };
  const openings = new Map<string, { games: number; score: number; acc: number; color: Color }>();
  let accSum = 0;

  for (const r of mine) {
    const color = r.userColor!;
    const res = resultFor(r.meta.result, color);
    if (res === 1) record.wins++;
    else if (res === 0) record.losses++;
    else if (res === 0.5) record.draws++;
    const acc = r.accuracy[color];
    accSum += acc;
    byColor[color].games++;
    byColor[color].accuracy += acc;
    byColor[color].score += res ?? 0;

    const base = baseSeconds(r.meta.timeControl);
    let wasWinning = false;
    let prev: PlyAnalysis | undefined;
    for (const p of r.plies) {
      if (p.color !== color) {
        prev = p;
        continue;
      }
      classCounts[p.classification]++;
      const ph = byPhaseRaw[p.phase];
      ph.accs.push(moveAccuracy(p.winBefore * 100, p.winAfter * 100));
      const bad = BAD.includes(p.classification);
      if (bad) {
        ph.errors++;
        for (const m of p.explanation.allowed) inc(allowed, m);
        for (const m of p.explanation.missed) inc(missed, m);
      } else if (GOOD.includes(p.classification)) {
        for (const m of p.explanation.played) inc(found, m);
      }
      // Time trouble: under 10% of base time or under 20 seconds.
      if (p.clock !== undefined && base) {
        const low = p.clock < Math.max(20, base * 0.1);
        if (low) {
          tt.moves++;
          if (bad) tt.errors++;
        } else {
          tt.normalMoves++;
          if (bad) tt.normalErrors++;
        }
      }
      // Punishing opponent errors.
      if (prev && (prev.classification === 'blunder' || prev.classification === 'mistake') && p.winBefore >= 0.6) {
        punish.chances++;
        if (!BAD.includes(p.classification) && p.classification !== 'inaccuracy') punish.punished++;
      }
      if (p.winBefore >= 0.85) wasWinning = true;
      prev = p;
    }
    if (wasWinning) {
      conversion.winningGames++;
      if (res === 1) conversion.converted++;
    }

    const name = r.meta.opening ?? r.meta.eco ?? 'Unknown opening';
    const key = `${name}|${color}`;
    const o = openings.get(key) ?? { games: 0, score: 0, acc: 0, color };
    o.games++;
    o.score += res ?? 0;
    const openingPlies = r.plies.filter((p) => p.color === color && p.phase === 'opening');
    const oAcc = openingPlies.length
      ? openingPlies.reduce((s, p) => s + moveAccuracy(p.winBefore * 100, p.winAfter * 100), 0) / openingPlies.length
      : acc;
    o.acc += oAcc;
    openings.set(key, o);
  }

  const n = mine.length;
  const byPhase = Object.fromEntries(
    (Object.keys(byPhaseRaw) as Phase[]).map((k) => {
      const v = byPhaseRaw[k];
      const moves = v.accs.length;
      return [
        k,
        {
          moves,
          accuracy: moves ? Math.round((v.accs.reduce((a, b) => a + b, 0) / moves) * 10) / 10 : 0,
          errorsPer10: moves ? Math.round((v.errors / moves) * 100) / 10 : 0,
        },
      ];
    }),
  ) as Record<Phase, PhaseStats>;
  for (const c of ['w', 'b'] as Color[]) {
    if (byColor[c].games) byColor[c].accuracy = Math.round((byColor[c].accuracy / byColor[c].games) * 10) / 10;
  }

  const openingStats: OpeningStats[] = [...openings.entries()]
    .map(([k, v]) => ({
      name: k.split('|')[0],
      color: v.color,
      games: v.games,
      score: v.score,
      avgAccuracy: Math.round((v.acc / v.games) * 10) / 10,
    }))
    .sort((a, b) => b.games - a.games);

  const profile: Profile = {
    games: n,
    record,
    avgAccuracy: n ? Math.round((accSum / n) * 10) / 10 : 0,
    byColor,
    byPhase,
    allowed: sorted(allowed),
    missed: sorted(missed),
    found: sorted(found),
    classCounts,
    timeTrouble: {
      errors: tt.errors,
      moves: tt.moves,
      errorRate: tt.moves ? tt.errors / tt.moves : 0,
      normalErrorRate: tt.normalMoves ? tt.normalErrors / tt.normalMoves : 0,
    },
    punishRate: punish,
    conversion,
    openings: openingStats,
    insights: [],
  };
  profile.insights = deriveInsights(profile);
  return profile;
}

/** Lichess puzzle themes that drill each of our motifs. */
export const LICHESS_THEME: Partial<Record<Motif, string>> = {
  'hanging-piece': 'hangingPiece',
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  'discovered-attack': 'discoveredAttack',
  'mate-threat': 'mateIn2',
  mate: 'mateIn2',
  'back-rank': 'backRankMate',
  'material-win': 'advantage',
  'trapped-piece': 'trappedPiece',
  promotion: 'promotion',
  'king-safety': 'kingsideAttack',
  'passed-pawn': 'advancedPawn',
  defence: 'defensiveMove',
};

function deriveInsights(p: Profile): Insight[] {
  const out: Insight[] = [];
  if (p.games === 0) return out;
  const phases = (Object.entries(p.byPhase) as [Phase, PhaseStats][]).filter(([, s]) => s.moves >= 10);
  if (phases.length >= 2) {
    const best = [...phases].sort((a, b) => b[1].accuracy - a[1].accuracy)[0];
    const worst = [...phases].sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
    if (best[1].accuracy - worst[1].accuracy >= 4) {
      out.push({
        kind: 'strength',
        title: `Strong ${best[0]}`,
        detail: `Your ${best[0]} accuracy (${best[1].accuracy}%) is your best phase.`,
      });
      out.push({
        kind: 'weakness',
        title: `${worst[0][0].toUpperCase() + worst[0].slice(1)} needs work`,
        detail: `You average ${worst[1].accuracy}% accuracy and ${worst[1].errorsPer10} errors per 10 moves in the ${worst[0]}.`,
        drill: worst[0] === 'endgame' ? 'endgame' : worst[0] === 'opening' ? 'opening' : 'middlegame',
      });
    }
  }

  const topAllowed = p.allowed.filter(([m]) => m !== 'material-win').slice(0, 2);
  for (const [m, count] of topAllowed) {
    if (count < 2) continue;
    out.push({
      kind: 'weakness',
      title: `Allowing: ${MOTIF_LABEL[m].toLowerCase()}`,
      detail: `${count} of your mistakes let the opponent use a ${MOTIF_LABEL[m].toLowerCase().replace(/s$/, '')}. Before each move, ask: "what are their checks, captures and threats after this?"`,
      motif: m,
      drill: LICHESS_THEME[m],
    });
  }
  const topMissed = p.missed.filter(([m]) => m !== 'material-win').slice(0, 2);
  for (const [m, count] of topMissed) {
    if (count < 2) continue;
    out.push({
      kind: 'weakness',
      title: `Missing: ${MOTIF_LABEL[m].toLowerCase()}`,
      detail: `You missed ${count} chances involving ${MOTIF_LABEL[m].toLowerCase()}. Puzzles on this theme will sharpen your pattern recognition.`,
      motif: m,
      drill: LICHESS_THEME[m],
    });
  }
  const topFound = p.found.filter(([m]) => !['material-win', 'development', 'center-control'].includes(m)).slice(0, 2);
  for (const [m, count] of topFound) {
    if (count < 3) continue;
    out.push({ kind: 'strength', title: `Good eye for ${MOTIF_LABEL[m].toLowerCase()}`, detail: `You found ${count} strong moves involving ${MOTIF_LABEL[m].toLowerCase()}.` });
  }

  const tt = p.timeTrouble;
  if (tt.moves >= 10 && tt.errorRate > tt.normalErrorRate * 1.8 && tt.errorRate > 0.1) {
    out.push({
      kind: 'weakness',
      title: 'Time trouble',
      detail: `Your error rate jumps from ${Math.round(tt.normalErrorRate * 100)}% to ${Math.round(tt.errorRate * 100)}% when low on time. Try spending less time in the opening.`,
    });
  }

  if (p.punishRate.chances >= 4) {
    const rate = p.punishRate.punished / p.punishRate.chances;
    if (rate >= 0.7)
      out.push({ kind: 'strength', title: 'You punish mistakes', detail: `You took advantage of ${Math.round(rate * 100)}% of your opponents' errors.` });
    else if (rate < 0.5)
      out.push({
        kind: 'weakness',
        title: "Not punishing opponents' errors",
        detail: `You only capitalised on ${Math.round(rate * 100)}% of opponent mistakes. After their move, always ask "what did that change?"`,
        drill: 'advantage',
      });
  }

  if (p.conversion.winningGames >= 3) {
    const rate = p.conversion.converted / p.conversion.winningGames;
    if (rate < 0.7)
      out.push({
        kind: 'weakness',
        title: 'Converting winning positions',
        detail: `You reached a winning position in ${p.conversion.winningGames} games but only won ${p.conversion.converted}. When ahead, simplify: trade pieces and remove counterplay.`,
        drill: 'crushing',
      });
    else out.push({ kind: 'strength', title: 'Solid conversion', detail: `You won ${Math.round(rate * 100)}% of games where you got a winning position.` });
  }

  const poorOpening = p.openings.find((o) => o.games >= 3 && o.score / o.games < 0.35);
  if (poorOpening) {
    out.push({
      kind: 'weakness',
      title: `Struggling in the ${poorOpening.name}`,
      detail: `You've scored ${poorOpening.score}/${poorOpening.games} as ${poorOpening.color === 'w' ? 'White' : 'Black'} here. Review the key ideas or switch lines.`,
      drill: poorOpening.name.split(' ').slice(0, 3).join('_'),
    });
  }
  const goodOpening = p.openings.find((o) => o.games >= 3 && o.score / o.games >= 0.65);
  if (goodOpening)
    out.push({ kind: 'strength', title: `Comfortable in the ${goodOpening.name}`, detail: `You've scored ${goodOpening.score}/${goodOpening.games} with it.` });

  return out;
}
