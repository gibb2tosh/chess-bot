import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GamesPage, type BulkResult } from './pages/GamesPage';
import { ReviewPage } from './pages/ReviewPage';
import { PracticePage, type PracticeSetup } from './pages/PracticePage';
import { PuzzlesPage } from './pages/PuzzlesPage';
import { InsightsPage } from './pages/InsightsPage';
import { SettingsPage } from './pages/SettingsPage';
import { fetchRecentGames, findGame } from './lib/chesscom';
import { getAnalysisEngine } from './lib/engine';
import { countPlies } from './lib/pgn';
import { buildProfile } from './lib/profile';
import { extractPuzzles } from './lib/puzzles';
import { reviewGame } from './lib/review';
import { ReviewQueue, type QueueJob } from './lib/reviewQueue';
import * as reviewStore from './lib/reviewStore';
import * as store from './lib/storage';
import { MIN_PLIES } from './lib/trends';
import type { Color, GameMeta, GameReview, Puzzle } from './lib/types';

type View = 'games' | 'review' | 'practice' | 'puzzles' | 'insights' | 'settings';

interface Toast {
  text: string;
  action?: { label: string; run: () => void };
}

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
  const [reviews, setReviews] = useState<GameReview[]>([]);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [puzzles, setPuzzles] = useState<Puzzle[]>(store.loadPuzzles);
  const [view, setView] = useState<View>('games');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [practice, setPractice] = useState<PracticeSetup | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [pendingDrill, setPendingDrill] = useState<string | null>(null);

  // The queue outlives renders, so it reads the latest values through refs.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const viewRef = useRef(view);
  viewRef.current = view;
  const reviewsRef = useRef(reviews);
  reviewsRef.current = reviews;

  const openReview = useCallback((id: string) => {
    setCurrentId(id);
    setView('review');
  }, []);

  const [queue] = useState(
    () =>
      new ReviewQueue(
        (job, signal, onProgress) =>
          reviewGame(job.meta, getAnalysisEngine(), {
            depth: job.depth,
            username: settingsRef.current.username,
            signal,
            onProgress,
          }),
        {
          onResult: async (review, job) => {
            await reviewStore.saveReview(review);
            setReviews((rs) => reviewStore.sortReviews([review, ...rs.filter((r) => r.meta.id !== review.meta.id)]));
            const found = extractPuzzles(review);
            if (found.length) setPuzzles(store.addPuzzles(found));
            const name = `${job.meta.white} vs ${job.meta.black}`;
            if (job.open && viewRef.current === 'games') openReview(job.meta.id);
            else if (job.open) setToast({ text: `Review ready: ${name}`, action: { label: 'Open', run: () => openReview(job.meta.id) } });
            if (job.notify) notifyReviewed(review, () => openReview(job.meta.id), setToast);
          },
          onError: (e, job) =>
            setToast({ text: `Couldn't review ${job.meta.white} vs ${job.meta.black}: ${e instanceof Error ? e.message : String(e)}` }),
        },
      ),
  );
  const queueState = useSyncExternalStore(queue.subscribe, queue.getState);

  useEffect(() => {
    reviewStore
      .loadReviews()
      .then(setReviews)
      .finally(() => setReviewsLoaded(true));
  }, []);

  const updateSettings = (s: store.Settings) => {
    setSettings(s);
    store.saveSettings(s);
  };

  const reviewNow = useCallback(
    (meta: GameMeta) => {
      const existing = reviewStore.findReviewOf(reviewsRef.current, meta);
      if (existing) return openReview(existing.meta.id);
      // Something you clicked jumps ahead of a running bulk import.
      queue.add([{ meta, depth: settingsRef.current.depth, open: true }], { front: true });
    },
    [queue, openReview],
  );

  const bulkReview = async (count: number, depth: number): Promise<BulkResult> => {
    const games = await fetchRecentGames(settings.username, count);
    const notReviewed = games.filter((g) => !reviewStore.findReviewOf(reviewsRef.current, g));
    const longEnough = notReviewed.filter((g) => countPlies(g.pgn) >= MIN_PLIES);
    // Oldest first, so the trend charts fill in left to right.
    const jobs: QueueJob[] = [...longEnough].reverse().map((meta) => ({ meta, depth }));
    const added = queue.add(jobs);
    return {
      found: games.length,
      added,
      alreadyReviewed: games.length - notReviewed.length,
      tooShort: notReviewed.length - longEnough.length,
    };
  };

  // Deep link from the browser extension: ?user=<name>&game=<chess.com game url or id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const user = params.get('user');
    const game = params.get('game');
    if (!user || !game) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!settingsRef.current.username) updateSettings({ ...settingsRef.current, username: user });
    setToast({ text: 'Fetching game from chess.com…' });
    findGame(user, game)
      .then(async (meta) => {
        if (!meta) throw new Error("Couldn't find that game in the player's recent archives yet — try again in a minute.");
        const existing = reviewStore.findReviewOf(await reviewStore.loadReviews(), meta);
        setToast(null);
        if (existing) openReview(existing.meta.id);
        else reviewNow(meta);
      })
      .catch((e) => setToast({ text: e instanceof Error ? e.message : String(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-review: poll chess.com for newly finished games.
  useEffect(() => {
    if (!settings.autoWatch || !settings.username || !reviewsLoaded) return;
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const recent = await fetchRecentGames(settings.username, 5);
        if (stopped) return;
        const seen = new Set(store.loadSeen());
        const firstRun = seen.size === 0;
        const fresh = recent.filter((g) => !seen.has(g.id) && !reviewStore.findReviewOf(reviewsRef.current, g) && countPlies(g.pgn) >= MIN_PLIES);
        store.saveSeen([...seen, ...recent.map((g) => g.id)]);
        if (firstRun) return; // don't bulk-review history the first time we look
        queue.add([...fresh].reverse().map((meta) => ({ meta, depth: settingsRef.current.depth, notify: true })));
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
  }, [settings.autoWatch, settings.username, reviewsLoaded, queue]);

  useEffect(() => {
    if (!toast || toast.action) return;
    const t = setTimeout(() => setToast(null), 6000);
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

  const dueCount = puzzles.filter((p) => p.due <= Date.now()).length;
  const tabs: [View, string][] = [
    ['games', 'Games'],
    ['review', 'Review'],
    ['practice', 'Play'],
    ['puzzles', `Puzzles${puzzles.length ? ` (${dueCount})` : ''}`],
    ['insights', 'Insights'],
    ['settings', 'Settings'],
  ];

  const { current: running, batch } = queueState;

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
        {running && (
          <div
            className="progress"
            role="progressbar"
            aria-label={`Reviewing ${running.job.meta.white} vs ${running.job.meta.black}`}
            aria-valuenow={Math.round((running.done / running.total) * 100)}
            title={`Reviewing ${running.job.meta.white} vs ${running.job.meta.black}${batch && batch.total > 1 ? ` (${batch.completed + batch.failed + 1} of ${batch.total})` : ''}`}
          >
            <div className="progress-fill" style={{ width: `${(running.done / running.total) * 100}%` }} />
          </div>
        )}
      </header>

      <main>
        {view === 'games' && (
          <GamesPage
            username={settings.username}
            setUsername={(u) => updateSettings({ ...settings, username: u })}
            depth={settings.depth}
            reviews={reviews}
            reviewsLoaded={reviewsLoaded}
            queue={queueState}
            onReview={reviewNow}
            onBulk={bulkReview}
            onCancel={() => queue.cancelAll()}
            onOpen={openReview}
            onDelete={async (id) => {
              await reviewStore.deleteReview(id);
              setReviews((rs) => rs.filter((r) => r.meta.id !== id));
            }}
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
            loaded={reviewsLoaded}
            onTrain={(angle) => {
              setPendingDrill(angle);
              setView('puzzles');
            }}
          />
        )}
        {view === 'settings' && <SettingsPage settings={settings} onChange={updateSettings} />}
      </main>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function notifyReviewed(review: GameReview, open: () => void, setToast: (t: Toast) => void) {
  const { meta, userColor: c } = review;
  const body = `${meta.white} vs ${meta.black}${c ? ` — your accuracy ${review.accuracy[c]}%` : ''}`;
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('Game review ready', { body });
    n.onclick = () => {
      window.focus();
      open();
    };
  } else {
    setToast({ text: `New game reviewed: ${body}`, action: { label: 'Open', run: open } });
  }
}
