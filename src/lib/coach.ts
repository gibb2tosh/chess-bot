import Anthropic from '@anthropic-ai/sdk';
import { formatScore } from './eval';
import type { PlyAnalysis } from './types';

// Optional: ask Claude to explain a move in plain language, grounded in the
// engine facts we already computed. The user supplies their own API key, which
// is kept in this browser's localStorage and sent only to api.anthropic.com.

const SYSTEM = `You are a friendly, concrete chess coach reviewing a student's game.
You are given engine analysis (Stockfish) that is ground truth for evaluations and best moves — never contradict it, and never invent variations that are not supported by it.
Explain *why* the played move is good or bad and what idea the better move carries: threats, tactics, plans, piece activity, pawn structure, king safety.
Name squares and pieces. Prefer short paragraphs. End with one practical takeaway the student can apply in future games.
Keep it under 180 words.`;

export function buildPrompt(p: PlyAnalysis, studentRating?: number): string {
  const lines = p.lines
    .map((l, i) => `${i + 1}. ${l.pv.slice(0, 8).join(' ')} (eval for side to move: ${formatScore(l.score)})`)
    .join('\n');
  return [
    `Position (FEN, before the move): ${p.fenBefore}`,
    `Side to move: ${p.color === 'w' ? 'White' : 'Black'}${studentRating ? ` (student rated ~${studentRating})` : ''}`,
    `Move played: ${p.san} — classified as "${p.classification}", losing ${Math.round(p.epLoss * 100)}% win probability (${Math.round(p.winBefore * 100)}% → ${Math.round(p.winAfter * 100)}%).`,
    `Engine best move: ${p.bestSan}`,
    `Engine top lines (UCI):\n${lines}`,
    `Automatic notes: ${p.explanation.headline} ${p.explanation.details.join(' ')}`,
    `Game phase: ${p.phase}`,
    '',
    'Explain this moment to the student.',
  ].join('\n');
}

export async function askCoach(apiKey: string, p: PlyAnalysis, studentRating?: number): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(p, studentRating) }],
    });
    if (response.stop_reason === 'refusal') return 'Claude declined to answer this one.';
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('Invalid Anthropic API key (check Settings).');
    if (error instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Anthropic API — try again shortly.');
    if (error instanceof Anthropic.APIError) throw new Error(`Anthropic API error ${error.status}: ${error.message}`);
    throw error;
  }
}
