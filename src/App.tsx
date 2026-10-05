import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GamesPage } from './pages/GamesPage';
import { ReviewPage } from './pages/ReviewPage';
import { PracticePage, type PracticeSetup } from './pages/PracticePage';
import { PuzzlesPage } from './pages/PuzzlesPage';
import { InsightsPage } from './pages/InsightsPage';
import { SettingsPage } from './pages/SettingsPage';
import { fetchRecentGames, findGame } from './lib/chesscom';
import { getAnalysisEngine } from './lib/engine';
import { buildProfile } from './lib/profile';
import { extractPuzzles } from './lib/puzzles';
import { reviewGame } from './lib/review';
import * as store from './lib/storage';
import type { Color, GameMeta, GameReview, Puzzle } from './lib/types';

type View = 'games' | 'review' | 'practice' | 'puzzles' | 'insights' | 'settings';

const DEFAULT_DRILLS = [
  { label: 'Forks', angle: 'fork' },
  { label: 'Pins', angle: 'pin' },
  { label: 'Hanging pieces', angle: 'hangingPiece' },
  { label: 'Mate in 2', angle: 'mateIn2' },
  { label: 'Defensive moves', angle: 'defensiveMove' },
  { label: 'Endgames', angle: 'endgame' },
];

export default function App() {
  const [settings, setSettings] = useState(store.loadSettings);
  const [reviews, setReviews] = useState<GameReview[]>(store.loadReviews);
  const [puzzles, setPuzzles] = useState<Puzzle[]>(store.loadPuzzles);
  const [view, setView] = useState<View>('games');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [practice, setPractice] = useState<PracticeSetup | null>(null);
  const [progress, setProgress] = useState<{ id: string; done: number; total: number } | null>(null);
  const [toast, setToast] = useState('');
  const [pendingDrill, setPendingDrill] = useState<string | null>(null);
  const busy = useRef(false);

  const updateSettings = (s: store.Settings) => {
    setSettings(s);
    store.saveSettings(s);
  };

  const runReview = useCallback(
    async (meta: GameMeta, { open = true } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setProgress({ id: meta.id, done: 0, total: 1 });
      try {
        const review = await reviewGame(meta, getAnalysisEngine(), {
          depth: settings.depth,
          username: settings.username,
          onProgress: (done, total) => setProgress({ id: meta.id, done, total }),
        });
        setReviews(store.saveReview(review));
        const found = extractPuzzles(review);
        if (found.length) setPuzzles(store.addPuzzles(found));
        if (open) {
          setCurrentId(meta.id);
          setView('review');
        }
        return review;
      } catch (e) {
        setToast(`Review failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy.current = false;
        setProgress(null);
      }
    },
    [settings.depth, settings.username],
  );

  // Deep link from the browser extension: ?user=<name>&game=<chess.com game url or id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const user = params.get('user');
    const game = params.get('game');
    if (!user || !game) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!settings.username) updateSettings({ ...settings, username: user });
    setToast('Fetching game from chess.com…');
    findGame(user, game)
      .then((meta) => {
        if (!meta) throw new Error("Couldn't find that game in the player's recent archives yet — try again in a minute.");
        const existing = store.loadReviews().find((r) => r.meta.id === meta.id);
        setToast('');
        if (existing) {
          setCurrentId(meta.id);
          setView('review');
        } else runReview(meta);
      })
      .catch((e) => setToast(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-review: poll chess.com for newly finished games.
  useEffect(() => {
    if (!settings.autoWatch || !settings.username) return;
    let stopped = false;
    const check = async () => {
      if (busy.current || stopped) return;
      try {
        const recent = await fetchRecentGames(settings.username, 5);
        const seen = new Set(store.loadSeen());
        const firstRun = seen.size === 0;
        const known = new Set(store.loadReviews().map((r) => r.meta.id));
        const fresh = recent.filter((g) => !seen.has(g.id) && !known.has(g.id));
        store.saveSeen([...seen, ...recent.map((g) => g.id)]);
        if (firstRun) return; // don't bulk-review history the first time we look
        for (const g of fresh.reverse()) {
          if (stopped) return;
          const r = await runReview(g, { open: false });
          if (r && 'Notification' in window && Notification.permission === 'granted') {
            const c = r.userColor;
            const n = new Notification('Game review ready', {
              body: `${g.white} vs ${g.black}${c ? ` — your accuracy ${r.accuracy[c]}%` : ''}`,
            });
            n.onclick = () => {
              window.focus();
              setCurrentId(g.id);
              setView('review');
            };
          } else if (r) {
            setToast(`New game reviewed: ${g.white} vs ${g.black}`);
          }
        }
      } catch {
        /* network hiccup — try again next tick */
      }
    };
    check();
    const t = setInterval(check, 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [settings.autoWatch, settings.username, runReview]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const profile = useMemo(() => buildProfile(reviews), [reviews]);
  const drills = useMemo(() => {
    const fromProfile = profile.insights.filter((i) => i.drill).map((i) => ({ label: i.title, angle: i.drill! }));
    const seen = new Set(fromProfile.map((d) => d.angle));
    return [...fromProfile, ...DEFAULT_DRILLS.filter((d) => !seen.has(d.angle))];
  }, [profile]);

  const current = reviews.find((r) => r.meta.id === currentId) ?? null;

  const startPractice = (fen: string, botElo: number, userColor: Color, label: string) => {
    setPractice({ fen, botElo, userColor, label });
    setView('practice');
  };

  const tabs: [View, string][] = [
    ['games', 'Games'],
    ['review', 'Review'],
    ['practice', 'Play'],
    ['puzzles', `Puzzles${puzzles.length ? ` (${puzzles.filter((p) => p.due <= Date.now()).length})` : ''}`],
    ['insights', 'Insights'],
    ['settings', 'Settings'],
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">♞ Chess Coach</div>
        <nav>
          {tabs.map(([v, label]) => (
            <button key={v} className={`tab ${view === v ? 'active' : ''}`} onClick={() => setView(v)} disabled={v === 'review' && !current}>
              {label}
            </button>
          ))}
        </nav>
        {progress && (
          <div className="progress" title="Reviewing game">
            <div className="progress-fill" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
      </header>

      <main>
        {view === 'games' && (
          <GamesPage
            username={settings.username}
            setUsername={(u) => updateSettings({ ...settings, username: u })}
            reviews={reviews}
            progress={progress}
            onReview={(m) => runReview(m)}
            onOpen={(id) => {
              setCurrentId(id);
              setView('review');
            }}
            onDelete={(id) => setReviews(store.deleteReview(id))}
          />
        )}
        {view === 'review' && current && (
          <ReviewPage
            key={current.meta.id}
            review={current}
            claudeKey={settings.useClaude ? settings.anthropicKey : undefined}
            onPractice={startPractice}
            onSavePuzzle={(p) => setPuzzles(store.addPuzzles([p]))}
          />
        )}
        {view === 'practice' && <PracticePage key={practice ? `${practice.fen}|${practice.label}` : 'free'} setup={practice} />}
        {view === 'puzzles' && (
          <PuzzlesPage
            puzzles={puzzles}
            drills={drills}
            onUpdate={(p) => setPuzzles(store.updatePuzzle(p))}
            onAdd={(ps) => setPuzzles(store.addPuzzles(ps))}
            onRemove={(id) => setPuzzles(store.removePuzzle(id))}
            autoDrill={pendingDrill}
            onAutoDrillStarted={() => setPendingDrill(null)}
          />
        )}
        {view === 'insights' && (
          <InsightsPage
            profile={profile}
            onTrain={(angle) => {
              setPendingDrill(angle);
              setView('puzzles');
            }}
          />
        )}
        {view === 'settings' && <SettingsPage settings={settings} onChange={updateSettings} />}
      </main>

      {toast && (
        <div className="toast" role="status" onClick={() => setToast('')}>
          {toast}
        </div>
      )}
    </div>
  );
}
