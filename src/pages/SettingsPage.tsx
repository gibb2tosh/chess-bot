import type { Settings } from '../lib/storage';

export function SettingsPage({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  return (
    <div className="page">
      <section className="card form">
        <h2>Settings</h2>
        <label>
          chess.com username
          <input value={settings.username} onChange={(e) => set('username', e.target.value.trim())} />
        </label>
        <label>
          Analysis depth ({settings.depth})
          <input type="range" min={8} max={20} value={settings.depth} onChange={(e) => set('depth', Number(e.target.value))} />
          <span className="muted small">Higher is more accurate but slower. 14 takes about 30–60s for a typical game.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoWatch}
            onChange={(e) => {
              set('autoWatch', e.target.checked);
              if (e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
            }}
          />
          Automatically review new games when they finish (checks chess.com every minute while this tab is open)
        </label>
      </section>

      <section className="card form">
        <h2>Claude coach (optional)</h2>
        <p className="muted small">
          The built-in explanations work offline. If you add an Anthropic API key you also get an “Ask Claude why” button that turns the engine
          analysis into a coach-style explanation. The key is stored only in this browser and sent only to api.anthropic.com.
        </p>
        <label>
          Anthropic API key
          <input type="password" value={settings.anthropicKey} onChange={(e) => set('anthropicKey', e.target.value.trim())} placeholder="sk-ant-…" />
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.useClaude} onChange={(e) => set('useClaude', e.target.checked)} />
          Enable “Ask Claude why”
        </label>
      </section>
    </div>
  );
}
