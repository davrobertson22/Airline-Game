// historyMilestones.js — aviation history as it happens, in era games.
// ----------------------------------------------------------------------------
// WHY. Discord (VodkaOnFire, 2026-11-13, "Create a living world"): an era game
// should feel like part of a real, evolving world, and teach a little aviation
// history on the way. Dave chose to start with milestones (no accidents): the
// start-date eras, airliners entering service, the industry changes that shaped
// the business, and the real "firsts" behind features the game unlocks by year.
//
// WHAT. Each entry belongs to the game week that holds its real date. It shows
// in the News tab (category 'history') once that week is reached and, when the
// player's setting allows, pops up as a card that week (HistoryCard.jsx).
// A game also opens with a short card for the era it starts in.
//
// Era games only: classic worlds have no calendar, so nothing here runs and
// golden-master parity holds. Nothing is stored in the save and nothing here
// touches the simulation: history is a function of the calendar, so the News
// tab and the pop-up derive it, and older era saves get it too.
//
// FACTS. Every date and claim was checked against a source (listed per entry).
// Where sources disagree on the day, the entry carries a month-only dateLabel
// and is filed on the earliest of the dates given. Keep it that way: these are
// read as history, so a wrong date is a bug.
//
// Rules the test (tools/history-milestones-test.mjs) holds:
//   • aircraft entries name a typeId whose `eis` is the entry's year, so a card
//     never announces a type the market does not have yet;
//   • feature entries name an ERA_FEATURE_FROM key that is live that year;
//   • ids are unique and dates parse.

export const HISTORY_CATEGORY = 'history';

/** Weeks of the game year on which each month starts (mirrors simulation.js). */
const MONTH_STARTS = [1, 6, 10, 15, 19, 23, 27, 32, 36, 40, 45, 49];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The game week (1–52) a calendar date falls in. The game year has 52 weeks
 * split into months by MONTH_STARTS; a month's days are spread evenly over its
 * weeks, so the 1st is the month's first week and the last day its last.
 */
export function gameWeekOfDate(month, day) {
  const m = Math.min(12, Math.max(1, month)) - 1;
  const start = MONTH_STARTS[m];
  const weeks = (MONTH_STARTS[m + 1] ?? 53) - start;
  const d = Math.min(DAYS_IN_MONTH[m], Math.max(1, day));
  return start + Math.min(weeks - 1, Math.floor(((d - 1) * weeks) / DAYS_IN_MONTH[m]));
}

/** "2 May 1952", or the entry's own month-only label. */
export function milestoneDateLabel(m) {
  if (m.dateLabel) return m.dateLabel;
  const [y, mo, d] = m.date.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  return `${d} ${names[mo - 1]} ${y}`;
}

function parts(date) {
  const [y, mo, d] = date.split('-').map(Number);
  return { year: y, month: mo, day: d };
}

// ── The era you start in ─────────────────────────────────────────────────────
// One card when a game opens, chosen by start year. These follow the setup
// screen's era presets.
export const ERA_INTROS = [
  {
    id: 'era-piston', from: 1950, to: 1957, title: 'Welcome to the piston age',
    body: 'Four-engined propliners like the DC-6 and the Constellation rule the long routes, and a transatlantic crossing takes most of a day. Britain has a jet airliner in the works, and America\'s are still on the drawing board. Choose your aircraft with an eye on what is coming.',
  },
  {
    id: 'era-jets', from: 1958, to: 1969, title: 'Welcome to the dawn of the jets',
    body: 'The Boeing 707 and the Douglas DC-8 are about to change long-haul flying. Within a few years travellers will choose jet service over propellers on any longer route, while turboprops keep the short hops. Bet on the jets early, or milk the propliners a little longer.',
  },
  {
    id: 'era-jumbo', from: 1970, to: 1977, title: 'Welcome to the jumbo age',
    body: 'The Boeing 747 enters service this decade, with the DC-10 and TriStar close behind. Wide-bodies bring the cost of a long-haul seat down and open mass travel across oceans, but they need full cabins to pay.',
  },
  {
    id: 'era-dereg-eve', from: 1978, to: 1978, title: 'Welcome to 1978',
    body: 'Fuel is expensive, the 737 and the A300 are young, and in Washington Congress is debating whether airlines should be free to set their own fares and choose their own routes. The answer will reshape the industry before the year is out.',
  },
  {
    id: 'era-competition', from: 1979, to: 1999, title: 'Welcome to the age of competition',
    body: 'Since the Airline Deregulation Act of 1978, American airlines have set their own fares and routes, and Europe is opening its skies in stages. Low fares, hub networks and new entrants are the order of the day, and so are failures and mergers.',
  },
  {
    id: 'era-modern', from: 2000, to: 2100, title: 'Welcome to the modern era',
    body: 'A320s and 777s fill the skies, global alliances link the big carriers, and low-cost airlines are winning short-haul travellers everywhere. The next generation of efficient twins is on its way.',
  },
];

export function eraIntroFor(startYear) {
  if (!Number.isInteger(startYear)) return null;
  return ERA_INTROS.find(e => startYear >= e.from && startYear <= e.to) ?? null;
}

// ── Milestones ───────────────────────────────────────────────────────────────
// kind: 'aircraft' (needs typeId), 'industry', 'feature' (needs feature).
// tier: 'major' pops up under the "Major only" setting; 'minor' only under "All".
// unlocks: an optional closing line about what this means in the game.
const W = (slug) => `https://en.wikipedia.org/wiki/${slug}`;

export const MILESTONES = [
  {
    id: 'comet1-service', date: '1952-05-02', kind: 'aircraft', typeId: 'comet1', tier: 'major', icon: '✈️',
    title: 'The jet age begins',
    body: 'BOAC\'s de Havilland Comet 1 flew the world\'s first scheduled jet passenger service, London to Johannesburg, cruising above the weather at speeds no propliner could match.',
    sources: [W('De_Havilland_Comet')],
  },
  {
    id: 'viscount-service', date: '1953-04-18', kind: 'aircraft', typeId: 'viscount700', tier: 'minor', icon: '✈️',
    title: 'The first turboprop airliner',
    body: 'British European Airways put the Vickers Viscount into scheduled service, London to Nicosia via Rome and Athens. Its Rolls-Royce Dart turboprops made it smoother and quieter than the piston airliners it replaced, and it became one of Britain\'s most successful airliners.',
    sources: [W('Vickers_Viscount'), 'https://www.baesystems.com/heritage/page/vickers-viscount'],
  },
  {
    id: 'tu104-service', date: '1956-09-15', kind: 'aircraft', typeId: 'tu104', tier: 'minor', icon: '✈️',
    title: 'Aeroflot\'s first jet',
    body: 'The Tupolev Tu-104 entered service on Aeroflot\'s Moscow–Omsk–Irkutsk route, cutting the journey from nearly 14 hours to under 8. With the Comet grounded, it was for two years the only jet airliner in regular service anywhere.',
    sources: [W('Tupolev_Tu-104')],
  },
  {
    id: 'comet4-transatlantic', date: '1958-10-04', kind: 'aircraft', typeId: 'comet4', tier: 'minor', icon: '✈️',
    title: 'Jets across the Atlantic',
    body: 'BOAC\'s redesigned Comet 4 flew the first transatlantic jet passenger service, between London and New York, three weeks ahead of Pan Am\'s Boeing 707.',
    sources: [W('De_Havilland_Comet')],
  },
  {
    id: 'b707-service', date: '1958-10-26', kind: 'aircraft', typeId: 'b707120', tier: 'major', icon: '✈️',
    title: 'The Boeing 707 enters service',
    body: 'Pan Am flew the first 707 service, New York to Paris. Bigger and faster than the Comet 4, the 707 and the Douglas DC-8 that followed made the jet the standard for long-distance travel within a few years.',
    sources: [W('Boeing_707')],
  },
  {
    id: 'b727-service', date: '1964-02-01', kind: 'aircraft', typeId: 'b727100', tier: 'minor', icon: '✈️',
    title: 'The 727 enters service',
    body: 'Eastern Air Lines flew the first Boeing 727 service, between Philadelphia, Washington and Miami. A trijet built for shorter runways and smaller cities, it went on to sell 1,832 copies.',
    sources: [W('Boeing_727'), 'https://www.centennialofflight.net/essay/Commercial_Aviation/Jet_Era/Tran7.htm'],
  },
  {
    id: 'dc9-service', date: '1965-12-08', kind: 'aircraft', typeId: 'dc910', tier: 'minor', icon: '✈️',
    title: 'The DC-9 enters service',
    body: 'Delta Air Lines put the Douglas DC-9 into daily scheduled service, bringing jets to smaller cities on routes of a few hundred miles. 976 were built, and its descendants, the MD-80, MD-90 and Boeing 717, flew on for decades.',
    sources: [W('McDonnell_Douglas_DC-9'), 'https://www.deltamuseum.org/delta-history/aircraft-by-type/jet/douglas-dc-9'],
  },
  {
    id: 'b737-service', date: '1968-02-10', kind: 'aircraft', typeId: 'b737100', tier: 'minor', icon: '✈️',
    title: 'The 737 enters service',
    body: 'Lufthansa flew the first Boeing 737 service. The stubby twin sold slowly at first; generations later it is one of the best-selling airliner families ever built.',
    sources: [W('Boeing_737')],
  },
  {
    id: 'b747-service', date: '1970-01-22', kind: 'aircraft', typeId: 'b747100', tier: 'major', icon: '✈️',
    title: 'The jumbo jet arrives',
    body: 'Pan Am flew the first Boeing 747 service, New York to London. With more than twice the seats of a 707, the 747 brought down the cost of a long-haul seat and opened mass travel across oceans.',
    sources: [W('Boeing_747'), 'https://www.centennialofflight.net/essay/Commercial_Aviation/Jet_Era/Tran7.htm'],
  },
  {
    id: 'southwest-takeoff', date: '1971-06-18', kind: 'industry', tier: 'minor', icon: '🛫',
    title: 'Southwest Airlines takes off',
    body: 'Southwest began flying within Texas, linking Dallas, Houston and San Antonio with Boeing 737s and $20 fares. Flying only inside one state kept it outside federal fare control, and its low fares, quick turnarounds and single aircraft type became the model for low-cost airlines worldwide.',
    sources: [W('History_of_Southwest_Airlines'), 'https://www.encyclopedia.com/social-sciences-and-law/economics-business-and-labor/businesses-and-occupations/southwest-airlines-co'],
  },
  {
    id: 'dc10-service', date: '1971-08-05', kind: 'aircraft', typeId: 'dc1010', tier: 'minor', icon: '✈️',
    title: 'The DC-10 enters service',
    body: 'American Airlines flew the first McDonnell Douglas DC-10 service, a round trip between Los Angeles and Chicago. Three engines and a wide body, smaller than the 747: a jumbo for busy domestic routes.',
    sources: [W('McDonnell_Douglas_DC-10')],
  },
  {
    id: 'l1011-service', date: '1972-04-26', dateLabel: 'April 1972', kind: 'aircraft', typeId: 'l1011', tier: 'minor', icon: '✈️',
    title: 'The TriStar enters service',
    body: 'Eastern Air Lines put the Lockheed L-1011 TriStar into service between Miami and New York. Eastern called it the Whisperliner for its quiet cabin. It was Lockheed\'s last airliner.',
    sources: [W('Lockheed_L-1011_TriStar'), 'https://www.flightglobal.com/in-focus-the-tristar-heritage-40-years-on/104584.article'],
  },
  {
    id: 'concorde-service', date: '1976-01-21', kind: 'aircraft', typeId: 'concorde', tier: 'major', icon: '🚀',
    title: 'Supersonic passenger service',
    body: 'British Airways and Air France launched Concorde on the same day, London to Bahrain and Paris to Rio de Janeiro via Dakar. At twice the speed of sound it would soon cross the Atlantic in about three and a half hours.',
    sources: [W('Concorde')],
  },
  {
    id: 'laker-skytrain', date: '1977-09-26', kind: 'industry', tier: 'minor', icon: '🎟️',
    title: 'Laker\'s Skytrain',
    body: 'Freddie Laker\'s Skytrain began walk-on, no-reservation flights between London Gatwick and New York for £59 one way. The big airlines cut their own transatlantic fares to compete; Laker Airways itself collapsed in 1982.',
    sources: [W('Laker_Airways'), 'https://www.flightglobal.com/the-peoples-champion/65572.article'],
  },
  {
    id: 'us-deregulation', date: '1978-10-24', kind: 'industry', tier: 'major', icon: '⚖️',
    title: 'The Airline Deregulation Act',
    body: 'President Carter signed the Airline Deregulation Act, phasing out government control of US airline fares and routes, and in time the Civil Aeronautics Board itself. New entrants, low fares and hub-and-spoke networks followed, and so did a wave of failures and mergers.',
    sources: [W('Airline_Deregulation_Act')],
  },
  {
    id: 'aadvantage', date: '1981-05-01', kind: 'feature', feature: 'loyaltyPrograms', tier: 'minor', icon: '🎖️',
    title: 'Frequent flyer programs take off',
    body: 'American Airlines launched AAdvantage, rewarding its most frequent flyers with free trips, and United answered with its own program within a week. Texas International had tried a mileage scheme in 1979, but AAdvantage set the template nearly every airline copied.',
    sources: [W('AAdvantage'), 'https://thepointsguy.com/guide/evolution-frequent-flyer-programs/'],
  },
  {
    id: 'b767-service', date: '1982-09-08', kind: 'aircraft', typeId: 'b767200', tier: 'minor', icon: '✈️',
    title: 'The 767 enters service',
    body: 'United Airlines flew the first Boeing 767 service, Chicago to Denver. Its extended-range versions helped prove that twin-engined jets could fly long routes over water.',
    sources: [W('Boeing_767')],
  },
  {
    id: 'b757-service', date: '1983-01-01', kind: 'aircraft', typeId: 'b757200', tier: 'minor', icon: '✈️',
    title: 'The 757 enters service',
    body: 'Eastern Air Lines put the Boeing 757 into service. Developed alongside the 767, with a cockpit pilots could fly on the same type rating, it carries a single-aisle cabin a very long way.',
    sources: [W('Boeing_757'), 'https://www.netairspace.cc/onthisday/year/1983'],
  },
  {
    id: 'a320-service', date: '1988-04-08', dateLabel: 'April 1988', kind: 'aircraft', typeId: 'a320ceo', tier: 'major', icon: '✈️',
    title: 'Fly-by-wire arrives',
    body: 'Air France put the Airbus A320 into service, the first airliner with digital fly-by-wire controls and side-sticks in place of control columns. The A320 family went on to rival the 737 as the world\'s favourite single-aisle jet.',
    sources: [W('Airbus_A320_family'), 'https://www.flightglobal.com/airbus-supplement-a320-family/17862.article'],
  },
  {
    id: 'b747400-service', date: '1989-02-09', kind: 'aircraft', typeId: 'b747400', tier: 'minor', icon: '✈️',
    title: 'The 747-400',
    body: 'Northwest Airlines flew the first 747-400, with a two-pilot glass cockpit and winglets. It became the best-selling 747 of all, with 694 delivered.',
    sources: [W('Boeing_747-400'), 'https://aerocorner.com/aircraft/boeing-747-400/'],
  },
  {
    id: 'b777-service', date: '1995-06-07', kind: 'aircraft', typeId: 'b777200', tier: 'minor', icon: '✈️',
    title: 'The 777 enters service',
    body: 'United Airlines flew the first Boeing 777 service, London to Washington. Boeing designed it entirely on computer, and it was the largest twin-engined airliner of its day.',
    sources: [W('Boeing_777')],
  },
  {
    id: 'star-alliance', date: '1997-05-14', kind: 'feature', feature: 'globalAlliances', tier: 'major', icon: '⭐',
    title: 'Star Alliance is founded',
    body: 'United, Lufthansa, Air Canada, SAS and Thai Airways formed Star Alliance, the first global airline alliance. oneworld followed in 1999 and SkyTeam in 2000.',
    unlocks: 'Global alliances are open to your airline now, on the Alliances page.',
    sources: [W('Star_Alliance'), 'https://airwaysmag.com/star-alliance-is-founded'],
  },
  {
    id: 'concorde-retired', date: '2003-10-24', kind: 'industry', tier: 'minor', icon: '🚀',
    title: 'Concorde\'s last commercial flight',
    body: 'British Airways flew Concorde\'s last commercial service, New York to London; Air France had retired its fleet in May. Supersonic passenger travel ended with it.',
    sources: [W('Concorde')],
  },
  {
    id: 'first-wifi', date: '2004-05-17', kind: 'feature', feature: 'wifi', tier: 'minor', icon: '📶',
    title: 'Internet in the sky',
    body: 'Lufthansa flight LH452, Munich to Los Angeles, was the first commercial flight to offer passengers live Wi-Fi internet, through Connexion by Boeing. Boeing closed that service in 2006, but onboard connectivity was here to stay.',
    unlocks: 'Onboard Wi-Fi can be fitted to your fleet now.',
    sources: ['https://boeing.mediaroom.com/2004-05-11-The-New-Era-of-Inflight-Connectivity-Is-Here-Connexion-by-Boeing-and-Lufthansa-Announce-the-World-Premiere-of-Airborne-Internet', W('Connexion_by_Boeing')],
  },
  {
    id: 'a380-service', date: '2007-10-25', kind: 'aircraft', typeId: 'a380', tier: 'major', icon: '✈️',
    title: 'The superjumbo',
    body: 'Singapore Airlines flew the first Airbus A380 service, Singapore to Sydney. The largest passenger airliner ever built, its two full-length decks have room for more than 500 seats.',
    sources: [W('Airbus_A380')],
  },
  {
    id: 'bag-fees', date: '2008-06-15', kind: 'feature', feature: 'ancillaries', tier: 'minor', icon: '🧳',
    title: 'Paying for your bag',
    body: 'With oil above $130 a barrel, American Airlines began charging $15 for a first checked bag on domestic tickets. Rivals followed, and fees for bags, seats and extras became a major source of airline revenue.',
    unlocks: 'Ancillary pricing is open to your airline now, on the Ancillaries page.',
    sources: ['https://www.nbcnews.com/id/wbna25191624', 'https://6abc.com/archive/6156176/'],
  },
  {
    id: 'b787-service', date: '2011-10-26', kind: 'aircraft', typeId: 'b7878', tier: 'minor', icon: '✈️',
    title: 'The Dreamliner',
    body: 'All Nippon Airways flew the first Boeing 787, a charter from Tokyo to Hong Kong. Built largely from carbon-fibre composites, it was designed to make long, thinner routes between mid-sized cities pay.',
    sources: [W('Boeing_787_Dreamliner')],
  },
  {
    id: 'a350-service', date: '2015-01-15', kind: 'aircraft', typeId: 'a350900', tier: 'minor', icon: '✈️',
    title: 'The A350 enters service',
    body: 'Qatar Airways flew the first Airbus A350 XWB service, Doha to Frankfurt. Like the 787, it is built largely from composites.',
    sources: [W('Airbus_A350')],
  },
  {
    id: 'a320neo-service', date: '2016-01-24', dateLabel: 'January 2016', kind: 'aircraft', typeId: 'a320neo', tier: 'minor', icon: '✈️',
    title: 'The A320neo',
    body: 'Lufthansa put the first A320neo into service. The "new engine option" brought new-generation engines to the A320, with Airbus promising fuel savings of around 15%.',
    sources: [W('Airbus_A320neo_family'), 'https://www.businesstraveller.com/news/first-look-lufthansaa-s-a320neo'],
  },
  {
    id: 'cseries-service', date: '2016-07-15', kind: 'aircraft', typeId: 'a220100', tier: 'minor', icon: '✈️',
    title: 'The CSeries enters service',
    body: 'Swiss flew the first Bombardier CS100, Zurich to Paris. Airbus later took over the programme and renamed it the A220.',
    sources: [W('Airbus_A220'), 'https://centreforaviation.com/news/swiss-launches-bombardier-c-series-commercial-operations-577285'],
  },
  {
    id: 'b737max-service', date: '2017-05-22', kind: 'aircraft', typeId: 'b737max8', tier: 'minor', icon: '✈️',
    title: 'The 737 MAX enters service',
    body: 'Malindo Air flew the first Boeing 737 MAX 8 service, Kuala Lumpur to Singapore. New CFM LEAP engines were Boeing\'s answer to the A320neo.',
    sources: ['https://www.flightglobal.com/malindo-operates-worlds-first-737-max-flight/124109.article'],
  },
];

/** Entries filed on calendar year `calYear`, game week `week`. */
export function milestonesForWeek(calYear, week) {
  if (!Number.isInteger(calYear)) return [];
  return MILESTONES.filter(m => {
    const p = parts(m.date);
    return p.year === calYear && gameWeekOfDate(p.month, p.day) === week;
  });
}

/** The game week an entry is filed on: { calYear, week }. */
export function milestoneGameWeek(m) {
  const p = parts(m.date);
  return { calYear: p.year, week: gameWeekOfDate(p.month, p.day) };
}

function milestoneRow(m, { year, week, launchPrograms }) {
  const launch = m.typeId != null && launchPrograms?.[m.typeId] != null;
  return {
    id: `hist-${m.id}`,
    absWeek: (year - 1) * 52 + week, year, week,
    category: HISTORY_CATEGORY, kind: 'history_milestone',
    tier: m.tier === 'major' || launch ? 1 : 2,
    subject: m.title, icon: m.icon ?? '🕰',
    data: {
      milestoneId: m.id, milestoneKind: m.kind, dateLabel: milestoneDateLabel(m),
      body: m.body, unlocks: m.unlocks ?? null, typeId: m.typeId ?? null,
      launchCustomer: launch,
    },
  };
}

function eraRow(intro, startYear) {
  return {
    id: `hist-${intro.id}`,
    absWeek: 1, year: 1, week: 1,
    category: HISTORY_CATEGORY, kind: 'history_era', tier: 1,
    subject: intro.title, icon: '🕰',
    data: { milestoneId: intro.id, milestoneKind: 'era', dateLabel: `January ${startYear}`, body: intro.body, unlocks: null, typeId: null, launchCustomer: false },
  };
}

/**
 * The history rows for one game week of this save, in News-row shape. The era
 * card belongs to week 1 of year 1. Pure: nothing here is stored in the save —
 * history is a function of the calendar, so the News tab and the pop-up derive
 * it. `launchPrograms` is state.launchPrograms: a type the player signed up to
 * launch gets a line of its own, and its card shows under "Major only" too.
 */
export function historyRowsForWeek({ startYear, year, week, launchPrograms = null }) {
  if (!Number.isInteger(startYear) || !Number.isInteger(year) || !Number.isInteger(week)) return [];
  const intro = year === 1 && week === 1 ? eraIntroFor(startYear) : null;
  const rows = intro ? [eraRow(intro, startYear)] : [];
  for (const m of milestonesForWeek(startYear + year - 1, week)) rows.push(milestoneRow(m, { year, week, launchPrograms }));
  return rows;
}

/** Every history row from the start of this save up to and including (year, week), oldest first. */
export function historyRowsThrough({ startYear, year, week, launchPrograms = null }) {
  if (!Number.isInteger(startYear) || !Number.isInteger(year) || !Number.isInteger(week)) return [];
  const intro = eraIntroFor(startYear);
  const rows = intro ? [eraRow(intro, startYear)] : [];
  const nowAbs = (year - 1) * 52 + week;
  for (const m of MILESTONES) {
    const { calYear, week: w } = milestoneGameWeek(m);
    const y = calYear - startYear + 1;
    if (y < 1) continue;
    const abs = (y - 1) * 52 + w;
    if (abs > nowAbs) continue;
    rows.push(milestoneRow(m, { year: y, week: w, launchPrograms }));
  }
  return rows.sort((a, b) => a.absWeek - b.absWeek);
}

/** Should this row pop up under the player's setting ('all' | 'major' | 'off')? */
export function historyRowPopsUp(row, mode) {
  if (mode === 'off') return false;
  if (mode === 'major') return row?.tier === 1;
  return true;
}
