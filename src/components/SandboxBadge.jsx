// The "Sandbox" marker for a sandbox game (models/sandbox.js): beside the
// airline name in the top bar and on its save cards. A sandbox is fixed at new
// game, so the badge never comes or goes during a game.
export default function SandboxBadge({ style }) {
  return (
    <span
      title="Sandbox game: started with money of your choosing"
      style={{
        display: 'inline-block', padding: '1px 7px', borderRadius: 10,
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
        lineHeight: '16px', verticalAlign: 'middle',
        color: 'var(--gold, #e3b341)', border: '1px solid currentColor',
        background: 'rgba(227,179,65,0.12)', whiteSpace: 'nowrap',
        ...style,
      }}
    >Sandbox</span>
  );
}
