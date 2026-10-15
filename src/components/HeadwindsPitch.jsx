// The Headwinds panel on Tailwinds' end screens (victory, final call).
import { headwindsUrl } from '../utils/headwinds.js';

export default function HeadwindsPitch({ campaign, lead }) {
  return (
    <div style={{
      marginTop: 16, padding: '14px 14px 12px', borderRadius: 10, textAlign: 'left',
      background: 'var(--surface2)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>{lead}</div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
        Headwinds is the free multiplayer version of Tailwinds: the same simulation, but every competitor
        is a real person, and the world keeps flying while you're away.
      </p>
      <a
        href={headwindsUrl(campaign)} target="_blank" rel="noopener noreferrer"
        style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
      >
        Find a Headwinds world →
      </a>
    </div>
  );
}
