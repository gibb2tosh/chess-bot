import { useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';

export interface BoardArrow {
  from: string;
  to: string;
  color: string;
}

interface Props {
  fen: string;
  orientation?: 'white' | 'black';
  arrows?: BoardArrow[];
  /** Squares to tint (e.g. last move). */
  highlights?: Record<string, string>;
  /** Return true if the move was accepted. Omit to make the board read-only. */
  onMove?: (uci: string) => boolean;
  id?: string;
}

/** Chessboard with drag-and-drop *and* click-to-move; auto-promotes to a queen. */
export function Board({ fen, orientation = 'white', arrows = [], highlights = {}, onMove, id = 'board' }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const targets = useMemo(() => {
    if (!selected) return [];
    try {
      return new Chess(fen).moves({ square: selected as Square, verbose: true }).map((m) => m.to as string);
    } catch {
      return [];
    }
  }, [fen, selected]);

  const tryMove = (from: string, to: string): boolean => {
    if (!onMove) return false;
    const chess = new Chess(fen);
    const piece = chess.get(from as Square);
    if (!piece) return false;
    const promo = piece.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : '';
    try {
      chess.move({ from, to, promotion: promo || undefined });
    } catch {
      return false;
    }
    return onMove(from + to + promo);
  };

  const squareStyles: Record<string, React.CSSProperties> = {};
  for (const [s, c] of Object.entries(highlights)) squareStyles[s] = { background: c };
  if (selected) squareStyles[selected] = { background: 'rgba(255, 255, 0, 0.45)' };
  for (const t of targets) {
    squareStyles[t] = { ...squareStyles[t], backgroundImage: 'radial-gradient(circle, rgba(0,0,0,.25) 22%, transparent 24%)' };
  }

  const turn = fen.split(' ')[1];

  return (
    <div className="board-wrap">
      <Chessboard
        options={{
          id,
          position: fen,
          boardOrientation: orientation,
          arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color })),
          squareStyles,
          allowDragging: !!onMove,
          allowDrawingArrows: true,
          canDragPiece: ({ piece }) => !!onMove && piece.pieceType[0] === turn,
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setSelected(null);
            return targetSquare ? tryMove(sourceSquare, targetSquare) : false;
          },
          onSquareClick: ({ square, piece }) => {
            if (!onMove) return;
            if (selected && targets.includes(square)) {
              tryMove(selected, square);
              setSelected(null);
            } else if (piece && piece.pieceType[0] === turn) {
              setSelected(square === selected ? null : square);
            } else {
              setSelected(null);
            }
          },
          darkSquareStyle: { backgroundColor: 'var(--sq-dark)' },
          lightSquareStyle: { backgroundColor: 'var(--sq-light)' },
        }}
      />
    </div>
  );
}

export function lastMoveHighlight(uci?: string): Record<string, string> {
  if (!uci) return {};
  const c = 'rgba(255, 214, 64, 0.42)';
  return { [uci.slice(0, 2)]: c, [uci.slice(2, 4)]: c };
}
