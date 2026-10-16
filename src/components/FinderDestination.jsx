// The Destination cell of the route finders.
//
// Reported on Discord (Oct 2026): on a phone, "CDG Paris, FR Europe +2 airports"
// filled the screen, so distance, demand and profit all sat off the right-hand
// edge. On a narrow screen the cell now leads with the IATA code, puts the city
// underneath in small type (cut short if it has to be), drops the country and
// region, and shortens its badges — the full name is still on the row's
// tooltip. Desktop is unchanged.

/** Padding for every cell of a finder table: tighter on a phone. */
export const finderCellPad = (compact) => (compact ? '6px 8px' : '7px 12px');

const BADGE_TONES = {
  dim:    { color: 'var(--text-dim)', border: '1px solid var(--border)' },
  red:    { color: 'var(--red)',      border: '1px solid rgba(220,53,69,0.4)' },
  yellow: { color: 'var(--yellow)',   border: '1px solid rgba(210,153,34,0.4)' },
};

/**
 * @param airport   the destination airport record
 * @param compact   true on a phone
 * @param region    region label, desktop only
 * @param badges    [{ text, short?, title, tone }] — `short` is the phone wording
 * @param children  anything else to put after the code (e.g. an in-range glyph)
 */
export default function FinderDestination({ airport: a, compact = false, region = null, badges = [], children = null }) {
  const badgeEls = badges.filter(Boolean).map((b, i) => (
    <span
      key={i}
      title={b.title}
      style={{
        marginLeft: compact ? 5 : 8, fontSize: 10, borderRadius: 3, padding: '1px 5px',
        whiteSpace: 'nowrap', ...(BADGE_TONES[b.tone] ?? BADGE_TONES.dim),
      }}
    >
      {compact && b.short ? b.short : b.text}
    </span>
  ));

  if (!compact) {
    return (
      <>
        <span style={{ fontWeight: 700 }}>{a.code}</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 12 }}>{a.city}, {a.country}</span>
        {region && <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: 11 }}>{region}</span>}
        {children}
        {badgeEls}
      </>
    );
  }

  return (
    <div data-dest-compact="" title={`${a.code} — ${a.name}, ${a.city}, ${a.country}${region ? ` · ${region}` : ''}`}>
      <div style={{ whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700 }}>{a.code}</span>
        {children}
        {badgeEls}
      </div>
      <div style={{
        fontSize: 10, color: 'var(--text-dim)', maxWidth: 110,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {a.city}
      </div>
    </div>
  );
}
