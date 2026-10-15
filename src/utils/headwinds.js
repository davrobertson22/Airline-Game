// Tailwinds → Headwinds cross-promotion. Headwinds is the multiplayer version
// of this game; the pitch appears only where a player has just beaten the AI
// (victory, final call, first buyout), never in the routine game loop.
//
// Links land on Headwinds' live-worlds page (every public world, its open
// seats and a join button) and are UTM-tagged so Headwinds' analytics show
// what Tailwinds actually sends.

export const HEADWINDS_WORLDS = 'https://www.headwindsairlinegame.com/worlds';

export function headwindsUrl(campaign) {
  return `${HEADWINDS_WORLDS}?utm_source=tailwinds&utm_medium=game&utm_campaign=${encodeURIComponent(campaign)}`;
}

export const BUYOUT_NUDGE_KEY = 'tw:headwindsNudge:buyout';

// The toast for a player's first rival buyout, or null. Once per browser (not
// per save: a returning player starting a fifth game has seen it). Skipped when
// the buyout takes the last rival, because the victory screen makes the pitch
// then. If storage is unavailable the answer is "don't show": better to miss
// the nudge than to show it on every buyout.
export function buyoutNudgeToast({ rivalsBefore, storage }) {
  if (!storage || !(rivalsBefore > 1)) return null;
  try {
    if (storage.getItem(BUYOUT_NUDGE_KEY)) return null;
    storage.setItem(BUYOUT_NUDGE_KEY, '1');
  } catch { return null; }
  return {
    type: 'info',
    icon: '🌐',
    title: 'Want rivals who fight back?',
    message: 'Headwinds is the free multiplayer version of Tailwinds: the same simulation, but every competitor is a real person.',
    link: { href: headwindsUrl('first-buyout'), label: 'See open worlds →' },
    duration: 12000,
  };
}
