import { Chess, type Square } from 'chess.js';
import { winProb } from './eval';
import {
  NAME,
  VALUE,
  attackedBy,
  balance,
  coords,
  forkTargets,
  hangingPieces,
  isBackRankMate,
  isDeveloped,
  kingShieldSquares,
  lineTactics,
  mateThreat,
  mobility,
  opp,
  pawnFeatures,
  pieces,
  playLine,
  uniq,
} from './motifs';
import { uciLineToSan } from './pgn';
import type { Classification, Color, EngineLine, Explanation, Idea, Motif, Phase, Score } from './types';

export interface ExplainInput {
  fenBefore: string;
  playedUci: string;
  playedSan: string;
  color: Color;
  moveNumber: number;
  phase: Phase;
  classification: Classification;
  epLoss: number;
  winBefore: number;
  winAfter: number;
  /** Engine lines for fenBefore (mover POV). */
  lines: EngineLine[];
  /** Opponent's best line after the played move (opponent POV score). */
  reply?: EngineLine;
  /** The move before this one (to recognise recaptures). */
  prevUci?: string;
  afterScore: Score;
}

interface MoveFacts {
  phrases: string[];
  motifs: Motif[];
  /** Material won outright by the move itself (a capture of an undefended/higher piece). */
  gain: number;
}

export function materialWord(n: number): string {
  const a = Math.abs(n);
  if (a >= 8) return 'the queen';
  if (a >= 5) return 'a rook';
  if (a >= 4) return 'a piece and a pawn';
  if (a >= 3) return 'a piece';
  if (a >= 2) return 'the exchange';
  return a >= 1.5 ? 'two pawns' : 'a pawn';
}

function pieceAt(chess: Chess, s: string) {
  return chess.get(s as Square);
}

function listTargets(ts: { type: keyof typeof NAME; square: string }[]): string {
  const rank = (t: { type: keyof typeof NAME }) => (t.type === 'k' ? 100 : VALUE[t.type]);
  const parts = [...ts].sort((a, b) => rank(b) - rank(a)).map((t) => (t.type === 'k' ? 'the king' : `the ${NAME[t.type]} on ${t.square}`));
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/** What a single move does, tactically and positionally, in plain words. */
export function describeMove(fen: string, uci: string, prevUci?: string): MoveFacts {
  const chess = new Chess(fen);
  const color = chess.turn() as Color;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const piece = pieceAt(chess, from);
  const captured = pieceAt(chess, to);
  const phrases: string[] = [];
  const motifs: Motif[] = [];
  let gain = 0;
  if (!piece) return { phrases, motifs, gain };

  const pinsBefore = new Set(lineTactics(chess, color).map((t) => t.front.square + t.back.square));
  const threatsBefore = new Set(
    pieces(chess, color).flatMap((p) => attackedBy(chess, p.square).map((t) => p.square + t.square)),
  );
  const hangingTheirsBefore = new Set(hangingPieces(chess, opp(color)).map((p) => p.square));

  // Our pieces that were under-defended before the move (for "defends ..." phrasing).
  const weakBefore = new Set(hangingPieces(chess, color).map((p) => p.square));

  let m;
  try {
    m = chess.move({ from, to, promotion: uci[4] });
  } catch {
    return { phrases, motifs, gain };
  }

  if (chess.isCheckmate()) {
    phrases.push(isBackRankMate(chess) ? 'delivers a back-rank checkmate' : 'delivers checkmate');
    motifs.push('mate');
    if (isBackRankMate(chess)) motifs.push('back-rank');
    return { phrases, motifs, gain };
  }

  if (m.isKingsideCastle() || m.isQueensideCastle()) {
    phrases.push('castles, tucking the king away and connecting the rooks');
    motifs.push('castling', 'king-safety');
  }

  if (m.promotion) {
    phrases.push(`promotes to a ${NAME[m.promotion]}`);
    motifs.push('promotion');
  }

  if (captured) {
    const recaptured = chess.attackers(to, opp(color)).length > 0;
    const net = VALUE[captured.type] - (recaptured ? VALUE[piece.type] : 0);
    if (prevUci && prevUci.slice(2, 4) === to) {
      phrases.push(`recaptures on ${to}`);
    } else if (hangingTheirsBefore.has(to) || net > 0) {
      gain = hangingTheirsBefore.has(to) ? VALUE[captured.type] : net;
      phrases.push(`wins the ${NAME[captured.type]} on ${to}`);
      motifs.push('material-win');
      if (hangingTheirsBefore.has(to)) motifs.push('hanging-piece');
    } else {
      phrases.push(`trades on ${to}`);
    }
  }

  if (chess.inCheck()) phrases.push('gives check');

  // Pawns count as fork targets only alongside a real piece (or the king).
  const forked = forkTargets(chess, to);
  const fork = forked.some((t) => t.type !== 'p') ? forked : [];
  if (fork.length >= 2) {
    phrases.push(`forks ${listTargets(fork)}`);
    motifs.push('fork');
  }

  for (const t of lineTactics(chess, color)) {
    if (pinsBefore.has(t.front.square + t.back.square)) continue;
    if (t.kind === 'pin') {
      phrases.push(
        `pins the ${NAME[t.front.type]} on ${t.front.square} to ${t.back.type === 'k' ? 'the king' : `the ${NAME[t.back.type]}`}`,
      );
      motifs.push('pin');
    } else {
      phrases.push(`skewers the ${NAME[t.front.type]} on ${t.front.square}, winning what's behind it`);
      motifs.push('skewer');
    }
    break;
  }

  // Discovered attack: another of our pieces now attacks something valuable it didn't before.
  for (const p of pieces(chess, color)) {
    if (p.square === to) continue;
    for (const t of attackedBy(chess, p.square)) {
      if (threatsBefore.has(p.square + t.square)) continue;
      if (t.type === 'k' || VALUE[t.type] >= 3) {
        phrases.push(
          `uncovers an attack by the ${NAME[p.type]} on ${t.type === 'k' ? 'the king' : `the ${NAME[t.type]} on ${t.square}`}`,
        );
        motifs.push('discovered-attack');
        break;
      }
    }
    if (motifs.includes('discovered-attack')) break;
  }

  // New threats from the moved piece against undefended/valuable targets.
  if (fork.length < 2) {
    const threatened = attackedBy(chess, to).filter(
      (t) =>
        t.type !== 'k' &&
        !threatsBefore.has(from + t.square) &&
        (VALUE[t.type] > VALUE[piece.type] || chess.attackers(t.square, t.color).length === 0),
    );
    if (threatened.length) {
      phrases.push(`attacks ${listTargets(threatened)}`);
    }
  }

  // Defence: a piece that was hanging is now safe (and we didn't just move it away).
  const defended = [...weakBefore].filter((s) => s !== from && chess.get(s as Square) && !isHangingSq(chess, s));
  if (defended.length) {
    const d = chess.get(defended[0] as Square)!;
    phrases.push(`defends the ${NAME[d.type]} on ${defended[0]}`);
    motifs.push('defence');
  } else if (weakBefore.has(from) && !isHangingSq(chess, to)) {
    phrases.push(`moves the ${NAME[piece.type]} out of danger`);
    motifs.push('defence');
  }

  const threat = mateThreat(chess.fen(), color);
  if (threat) {
    phrases.push(`threatens mate with ${threat}`);
    motifs.push('mate-threat');
  }

  // Development / centre.
  if ((piece.type === 'n' || piece.type === 'b') && !isDeveloped(piece.type, from, color) && isDeveloped(piece.type, to, color)) {
    phrases.push(`develops the ${NAME[piece.type]}`);
    motifs.push('development');
  }
  if (piece.type === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(to) && Number(m.before.split(' ')[5]) <= 10) {
    phrases.push('stakes a claim in the centre');
    motifs.push('center-control');
  }
  if (piece.type === 'p') {
    const passed = pawnFeatures(chess, color).passed;
    if (passed.includes(to)) {
      const [, r] = coords(to);
      const rel = color === 'w' ? r : 7 - r;
      if (rel >= 4) {
        phrases.push('pushes a passed pawn closer to promotion');
        motifs.push('passed-pawn');
      }
    }
  }

  // Stopping the opponent's mate threat.
  const before = new Chess(m.before);
  const theirThreat = mateThreat(m.before, opp(color));
  if (theirThreat && !mateThreat(chess.fen(), opp(color)) && !before.inCheck()) {
    phrases.push(`stops the threat of ${theirThreat}`);
    motifs.push('defence');
  }

  // A capture that wins material makes "trades" wording wrong.
  const out = gain > 0 ? phrases.filter((p) => !p.startsWith('trades')) : phrases;
  return { phrases: out, motifs: uniq(motifs), gain };
}

function isHangingSq(chess: Chess, s: string): boolean {
  return hangingPieces(chess, chess.get(s as Square)?.color as Color).some((p) => p.square === s);
}

/** Summarise what an engine line achieves for `pov`. */
export function describeLine(
  fen: string,
  pv: string[],
  pov: Color,
  score?: Score,
): { text: string; motifs: Motif[]; delta?: number } {
  const res = playLine(fen, pv, pov, 8);
  const motifs: Motif[] = [];
  if (score?.mate !== undefined && score.mate > 0) {
    motifs.push('mate');
    return { text: `forces checkmate in ${score.mate}`, motifs };
  }
  if (res.mate && res.matedSide === opp(pov)) {
    motifs.push('mate');
    return { text: 'leads to checkmate', motifs };
  }
  // Lines are cut off mid-sequence sometimes; only claim material the engine's eval backs up.
  const credible = score?.cp === undefined || score.cp >= res.materialDelta * 100 - 200;
  if (res.materialDelta >= 1 && credible) {
    motifs.push('material-win');
    if (res.promotion) motifs.push('promotion');
    return { text: `wins ${materialWord(res.materialDelta)}`, motifs, delta: res.materialDelta };
  }
  return { text: '', motifs, delta: res.materialDelta };
}

function joinPhrases(ps: string[]): string {
  const xs = ps.filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
}

function idea(label: string, fen: string, uci: string[], max = 10): Idea {
  const u = uci.slice(0, max);
  const san = uciLineToSan(fen, u);
  return { label, fen, uci: u.slice(0, san.length), san };
}

function moveNo(fen: string): string {
  const [, turn, , , , n] = fen.split(' ');
  return turn === 'w' ? `${n}.` : `${n}...`;
}

/** Positional observations comparing the played move with the engine's choice. */
function positionalNotes(input: ExplainInput, played: MoveFacts, best: MoveFacts | null): { notes: string[]; motifs: Motif[] } {
  const notes: string[] = [];
  const motifs: Motif[] = [];
  const { fenBefore, playedUci, color, phase, moveNumber } = input;
  const before = new Chess(fenBefore);
  const piece = before.get(playedUci.slice(0, 2) as Square);
  const after = new Chess(fenBefore);
  try {
    after.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci[4] });
  } catch {
    return { notes, motifs };
  }
  if (!piece) return { notes, motifs };

  const undeveloped = pieces(before, color).filter(
    (p) => (p.type === 'n' || p.type === 'b') && !isDeveloped(p.type, p.square, color),
  ).length;

  if (phase === 'opening') {
    if (
      piece.type === 'q' &&
      moveNumber <= 8 &&
      !before.get(playedUci.slice(2, 4) as Square) &&
      undeveloped >= 2 &&
      input.epLoss >= 0.03 &&
      !played.motifs.includes('defence')
    ) {
      notes.push(
        'Bringing the queen out this early lets your opponent develop with tempo by attacking it. Develop knights and bishops first.',
      );
      motifs.push('early-queen');
    }
    if (best?.motifs.includes('castling') && !played.motifs.includes('castling')) {
      notes.push('Castling was the priority here — your king is still in the centre where lines can open quickly.');
      motifs.push('castling', 'king-safety');
    } else if (
      best?.motifs.includes('development') &&
      !played.motifs.includes('development') &&
      undeveloped >= 2 &&
      !played.motifs.includes('material-win')
    ) {
      notes.push(`You still have ${undeveloped} minor pieces at home. In the opening, getting pieces out usually beats other plans.`);
      motifs.push('development');
    }
    if (
      piece.type !== 'p' &&
      piece.type !== 'k' &&
      isDeveloped(piece.type, playedUci.slice(0, 2) as Square, color) &&
      undeveloped >= 2 &&
      !played.motifs.includes('material-win') &&
      input.epLoss >= 0.05
    ) {
      notes.push('This moves an already-developed piece again while others are still undeveloped — that costs time.');
      motifs.push('development');
    }
  }

  // King shelter: pushing pawns in front of a castled king.
  const king = pieces(before, color).find((p) => p.type === 'k');
  if (king && piece.type === 'p' && ['g', 'h', 'b', 'c'].includes(king.square[0])) {
    const shield = kingShieldSquares(king.square, color);
    if (shield.includes(playedUci.slice(0, 2) as Square) && input.epLoss >= 0.05) {
      notes.push('Pushing a pawn in front of your castled king loosens your shelter and gives the opponent targets.');
      motifs.push('king-safety');
    }
  }

  // Pawn structure changes.
  const pfBefore = pawnFeatures(before, color);
  const pfAfter = pawnFeatures(after, color);
  if (pfAfter.doubled > pfBefore.doubled && input.epLoss >= 0.03) {
    notes.push('This leaves you with doubled pawns, which are hard to defend and can\'t protect each other.');
    motifs.push('pawn-structure');
  } else if (pfAfter.isolated > pfBefore.isolated && input.epLoss >= 0.03) {
    notes.push('This creates an isolated pawn — with no neighbours to protect it, it can become a long-term target.');
    motifs.push('pawn-structure');
  }

  // Trading when ahead.
  const bal = balance(before, color);
  if (bal >= 2 && played.phrases.some((p) => p.startsWith('trades')) && input.epLoss < 0.05) {
    notes.push('Good technique: when you are ahead in material, trading pieces brings you closer to a winning endgame.');
    motifs.push('trade-when-ahead');
  }

  // Activity: compare mobility after the played move vs. the best move.
  const bestUci = input.lines[0]?.move;
  if (bestUci && bestUci !== playedUci && input.epLoss >= 0.05 && notes.length === 0) {
    const afterBest = new Chess(fenBefore);
    try {
      afterBest.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] });
      const mobPlayed = mobility(after.fen(), color);
      const mobBest = mobility(afterBest.fen(), color);
      if (mobBest - mobPlayed >= 6) {
        notes.push('The engine\'s move gives your pieces noticeably more scope — look for moves that activate your worst piece.');
        motifs.push('piece-activity');
      }
    } catch {
      /* ignore */
    }
  }

  return { notes, motifs };
}

export function explainMove(input: ExplainInput): Explanation {
  const { fenBefore, playedUci, playedSan, color, classification, lines, reply } = input;
  const best = lines[0];
  const bestUci = best?.move ?? playedUci;
  const bestSan = uciLineToSan(fenBefore, [bestUci])[0] ?? bestUci;
  const isBest = bestUci === playedUci;

  const played = describeMove(fenBefore, playedUci, input.prevUci);
  const bestFacts = !isBest && best ? describeMove(fenBefore, bestUci, input.prevUci) : null;
  const bestLine = best ? describeLine(fenBefore, best.pv, color, best.score) : { text: '', motifs: [] as Motif[] };

  // Analyse the refutation (opponent's best reply after our move).
  const chessAfter = new Chess(fenBefore);
  chessAfter.move({ from: playedUci.slice(0, 2), to: playedUci.slice(2, 4), promotion: playedUci[4] });
  const fenAfter = chessAfter.fen();
  // Measure the refutation from *before* our move so that a fair trade isn't reported as a loss.
  const refute = reply
    ? describeLine(fenBefore, [playedUci, ...reply.pv], opp(color), reply.score)
    : { text: '', motifs: [] as Motif[] };
  const replyFacts = reply ? describeMove(fenAfter, reply.move, playedUci) : null;
  const replySan = reply ? (uciLineToSan(fenAfter, [reply.move])[0] ?? reply.move) : '';
  const hungAfter = hangingPieces(chessAfter, color).filter((p) => VALUE[p.type] >= 3);
  const hungBefore = new Set(hangingPieces(new Chess(fenBefore), color).map((p) => p.square));
  const toSq = playedUci.slice(2, 4);
  const wasCapture = !!new Chess(fenBefore).get(toSq as Square);
  const newlyHung = hungAfter.filter((p) => {
    if (p.square !== toSq) return !hungBefore.has(p.square);
    // The piece we just moved: hanging after a capture usually just means "it's a trade".
    return !wasCapture;
  });

  const details: string[] = [];
  const allowed: Motif[] = [];
  const missed: Motif[] = [...bestLine.motifs, ...(bestFacts?.motifs ?? [])];
  const playedMotifs: Motif[] = [...played.motifs];
  let headline = '';

  const doesWhat = (facts: MoveFacts | null, line: { text: string; delta?: number }) => {
    const ps = facts?.phrases.slice(0, line.text.includes('checkmate') ? 1 : 2) ?? [];
    // Only mention the line's material result if it adds to what the move itself grabs.
    const lineAdds = line.text && (line.delta === undefined || line.delta > (facts?.gain ?? 0) + 0.5);
    const xs = lineAdds ? [...ps.filter((p) => !(p.startsWith('trades') && line.text.startsWith('wins'))), line.text] : ps;
    return joinPhrases(xs.filter((x, i, a) => x && a.indexOf(x) === i));
  };

  const playedWhat = doesWhat(played, isBest && !played.motifs.includes('mate') ? bestLine : { text: '' });
  const bestWhat = doesWhat(bestFacts, bestLine);

  switch (classification) {
    case 'brilliant':
      headline = `Brilliant! ${playedSan} gives up material, but it works${bestLine.text ? ` — it ${bestLine.text}` : ''}.`;
      details.push('A sacrifice that the opponent cannot profitably accept. These are hard to find — great calculation.');
      break;
    case 'great':
      headline = `Great move. ${playedSan} was the only move that keeps your position${input.winBefore > 0.6 ? ' winning' : ' together'}.`;
      {
        const second = lines[1];
        if (second) {
          const secondSan = uciLineToSan(fenBefore, [second.move])[0];
          const drop = Math.round((winProb(best.score) - winProb(second.score)) * 100);
          details.push(`The next-best try, ${secondSan}, would have cost about ${drop}% winning chances.`);
        }
      }
      break;
    case 'best':
      headline = `${playedSan} is the best move${playedWhat ? ` — it ${playedWhat}` : ''}.`;
      break;
    case 'excellent':
    case 'good':
      headline = `${playedSan} is a ${classification === 'excellent' ? 'strong' : 'reasonable'} move${playedWhat ? ` that ${playedWhat}` : ''}.`;
      if (!isBest) details.push(`The engine slightly prefers ${bestSan}${bestWhat ? `, which ${bestWhat}` : ''}.`);
      break;
    case 'forced':
      headline = `${playedSan} was the only legal move.`;
      break;
    case 'book':
      headline = `${playedSan} is a standard opening move.`;
      break;
    default: {
      // inaccuracy / mistake / blunder / miss
      const label = classification === 'miss' ? 'a missed opportunity' : `${classification === 'inaccuracy' ? 'an' : 'a'} ${classification}`;
      let reason = '';
      let mentionedBest = false;
      if (reply && reply.score.mate !== undefined && reply.score.mate > 0) {
        reason = `it allows ${replySan}, and your opponent has a forced mate in ${reply.score.mate}`;
        allowed.push('mate');
        if (reply.score.mate <= 3) allowed.push('mate-threat');
      } else if (newlyHung.length && refute.motifs.includes('material-win')) {
        const p = newlyHung[0];
        reason = `it leaves your ${NAME[p.type]} on ${p.square} unprotected — ${replySan} ${refute.text}`;
        allowed.push('hanging-piece', 'material-win');
      } else if (replyFacts?.motifs.includes('fork')) {
        reason = `it walks into ${replySan}, which ${replyFacts.phrases.find((x) => x.startsWith('forks'))}`;
        allowed.push('fork');
      } else if (refute.text && refute.motifs.includes('material-win')) {
        reason = `after ${replySan} your opponent ${refute.text}`;
        allowed.push('material-win');
      } else if (classification === 'miss' || (bestLine.text && input.winBefore - input.winAfter >= 0.1)) {
        reason = `it misses ${bestSan}, which ${bestWhat || 'keeps a clear advantage'}`;
        mentionedBest = true;
      } else if (replyFacts && replyFacts.phrases.length && !replyFacts.phrases[0].startsWith('recaptures')) {
        reason = `it lets your opponent play ${replySan}, which ${joinPhrases(replyFacts.phrases.slice(0, 2))}`;
      } else {
        reason = `${bestSan} was stronger${bestWhat ? ` — it ${bestWhat}` : ''}`;
        mentionedBest = true;
      }
      if (replyFacts) {
        for (const m of replyFacts.motifs) if (['fork', 'pin', 'skewer', 'discovered-attack', 'mate-threat', 'back-rank'].includes(m)) allowed.push(m);
      }
      for (const m of refute.motifs) allowed.push(m);

      headline = `${playedSan} is ${label}: ${reason}.`;
      if (!mentionedBest && bestSan !== playedSan) {
        details.push(`Better was ${bestSan}${bestWhat ? `, which ${bestWhat}` : ''}.`);
      }
      if (classification === 'miss') {
        details.push('Your opponent had just made an error. When that happens, look for checks, captures and threats first — there is often a tactic.');
      }
      const drop = Math.round(input.epLoss * 100);
      details.push(`This cost roughly ${drop}% of your winning chances (${Math.round(input.winBefore * 100)}% → ${Math.round(input.winAfter * 100)}%).`);
    }
  }

  const pos = positionalNotes(input, played, bestFacts);
  details.push(...pos.notes);
  const isBad = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(classification);
  if (isBad) allowed.push(...pos.motifs);
  else playedMotifs.push(...pos.motifs);

  // When the position was already lost/won and stays so, say that explicitly.
  if (isBad && input.winAfter > 0.9) details.push('You are still winning, but this makes the job harder than it needs to be.');

  const ideas: Idea[] = [];
  if (best) ideas.push(idea(isBest ? `Main line after ${moveNo(fenBefore)} ${bestSan}` : `Best: ${moveNo(fenBefore)} ${bestSan}`, fenBefore, best.pv));
  if (reply && isBad) ideas.push(idea(`Why ${playedSan} fails`, fenAfter, reply.pv));
  if (lines[1] && classification === 'great') ideas.push(idea('Next-best try', fenBefore, lines[1].pv));

  return {
    headline,
    details,
    ideas,
    missed: isBest ? [] : uniq(missed),
    allowed: uniq(allowed),
    played: uniq(playedMotifs),
  };
}
