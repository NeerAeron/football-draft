// Legends, Prime versions and era pools from 29 past titles: FIFA 15–23 (the legacy CSV),
// FIFA 98–14 (data/legacy-titles.json) and FC 24–26 (scripts/data/modern-titles.mjs), compiled
// through the same compiler as the current players (compilePlayer: attribute mapping,
// tendencies, badges). Era pools ("nation X in era Y", app/data/eras.v1.json): see the `eras`
// section of compileLegends and the ERA_* rules.
//   * A past version has an overall on EA's modern scale: the one EA printed (FIFA 09–23), or
//     for the titles that printed none (FIFA 98–08) the one the chain of shared players gives
//     it (scripts/legends-calibration.mjs). Its card has the skills of that year, moved
//     together by the few points that make the game's own rating model show that overall —
//     so every threshold below is in the rating a card shows.
//   * FC 27 is the baseline of the scale: a title whose best players EA rated lower than it
//     rates today's (FIFA 09–16, and FIFA 98–08 through the chain) is lifted at the top by
//     that difference; no title is lowered.
//   * One person, all his versions: EA's player id ties FIFA 2000–23 and the catalog together;
//     FIFA 98/99 rows join by name and team. Best version = the highest overall; ties → the
//     latest title (the richer data).
//   * Legend = a best version shown at LEGEND_MINIMUM or more, of
//       – a player who is NOT in the current catalog, or
//       – a catalog player whose card today shows at least LEGEND_GAIN (2) less and whom EA
//         rates lower today (`legendOf` = his catalog profileId).
//     FC 24–26 are today's scale: as printed, never lifted.
//     He has today's name of his nation and the positions of that title, and its club when
//     that club is in the catalog (EA's team id), so he links with club mates; otherwise he
//     has no club. A catalog player's legend carries his catalog name.
//   * Prime version of a current catalog player: his best version, whenever EA's overall of
//     it is above today's and its card shows more than today's card — any gain.
//   * The year of a version is the year of its ratings: `fifa_update_date` (FIFA 15–23), the
//     year before the title's number for the launch databases (FIFA 98 → 1997 … 14 → 2013).
//   * What a title lacks comes from the player's nearest version that has it — composure
//     (FIFA 11–16; else his reactions), the preferred foot and the weak foot (the early
//     titles; else right and 3) — and is recorded in the provenance. Nothing is invented.
// Deterministic.
import { writeFileSync } from 'node:fs';
import { compilePlayer, positions as rowPositions } from './compile-players.mjs';
import { overallRating, POSITIONS } from '../app/core/players/ratings.js';
import { normalizeBadges } from '../app/core/players/badges.js';
import { explicitEvidence } from '../app/core/players/catalog-derived.js';
import { foldDiacritics } from '../app/core/util/text.js';
import { ERAS, ERA_SQUAD } from '../app/core/players/eras.js';
import { SKILL_FIELDS } from './data/legacy-titles.mjs';
import {
  calibrateTitles,
  cardFields,
  secondStrikerRoles,
  teamWords,
  POOL_YEARS,
} from './legends-calibration.mjs';

export const LEGEND_MINIMUM = 85;
// A catalog player's past version is a legend version only when it shows at least this much
// more than his card today (a prime version: any gain).
export const LEGEND_GAIN = 2;
// The lift of a stingy title (see `lifts` below): measured on the title's LIFT_TOP best,
// nothing under LIFT_FROM, in full from the level of those best.
// The most a card may show above the number its title has for the man (see `checked`).
export const MOST_ABOVE = 9;
export const LIFT_TOP = 30;
// The least the cap on a card's rating at a role that is not its own (see offRoleCap): level.
export const OFF_ROLE = 0;
export const LIFT_FROM = 87;
// … and in full from here: the very top (an 88 gets a third of it, an 89 two thirds).
export const LIFT_FULL = 90;
export const LEGACY = {
  url: 'https://huggingface.co/datasets/jsulz/FIFA23',
  author: 'jsulz',
  upstream: 'SoFIFA / EA SPORTS FIFA 15–23 (career mode)',
  license: 'MIT',
  licenseUrl: 'https://huggingface.co/datasets/jsulz/FIFA23/blob/main/README.md',
};
export const TITLES = {
  upstream: "EA SPORTS FIFA 98–14, the games' own PC databases",
  license: 'No licence stated (community archive; player data © Electronic Arts)',
};
// The judgement (see `judged` in compileLegends): per title number, `top` points at the level
// of the title's 30 best, in proportion above and below, nothing at `from` and under; `why` is
// the reviewed reason. Titles that are not listed read right as they are.
export const TITLE_JUDGEMENT = {
  98: {
    top: 4.8,
    from: 60,
    why: 'FIFA 98 (1997): the coarse scale and the pooling leave the whole title five to six points under every later one — its best 50 average 82 against 87–89 — in the years of Ronaldo, Zidane, Del Piero, Baggio and Batistuta. Raised most of the way (its ranking of players is too noisy to trust with all of it).',
  },
  99: {
    top: 3.4,
    from: 60,
    why: 'FIFA 99 (1998): as FIFA 98, a little less far under.',
  },
  0: {
    top: 4.1,
    from: 60,
    why: 'FIFA 2000 (1999): as FIFA 98.',
  },
  1: {
    top: 1.0,
    from: 70,
    why: 'FIFA 2001 (2000): a point under its neighbours of 2003–05 at every level; the top of world football was not weaker in 2000.',
  },
  2: { top: 1.0, from: 70, why: 'FIFA 2002 (2001): as FIFA 2001.' },
  3: { top: 1.0, from: 70, why: 'FIFA 2003 (2002): as FIFA 2001.' },
  4: {
    top: -0.8,
    from: 84,
    why: 'FIFA 2004 (2003): generous at the top only — ten cards at 92+ (Beckham, Kahn, Owen, Vieri and Figo next to Ronaldo and Zidane), its ten best a point above FIFA 2005 and 06 while its best 200 are level with them. Its link to FIFA 2005 is the loosest of the fully described titles. Brought level with its neighbours.',
  },
  7: {
    top: 0.8,
    from: 80,
    why: 'FIFA 07 (2006): a little stingy — its best 50 average 87.2 against 87.9–88.9 around it, in a World Cup year (Cannavaro, Henry, Kaká, Buffon).',
  },
};
// A nation's players in some titles (`judgedNation` in compileLegends): `top` points at
// `level`, in proportion above and below, nothing at `from` and under.
export const NATION_JUDGEMENT = {
  England: {
    editions: [98, 99, 0, 1, 2, 3, 4],
    top: -2,
    level: 90,
    from: 76,
    why: 'FIFA 98–2004 were made in and for England and rate its players, stars and squad men alike, as the game’s followers never did: Beckham, Owen and Scholes at 90–93, Dyer, James and Heskey at 85–87 — England’s best XI of 2002 level with Italy’s and above Brazil’s, the world champions’. Not measurable against FIFA 2005/06 (which keep the habit; England’s players fall no more than others’ there), so this is a judgement: two points off at 90, fading to nothing at 76 — a strong quarter-final side. No other nation reads the same way in those titles (per-nation drift against FIFA 2005/06: within a point for every nation with six or more players at 82+).',
  },
};
// The cards of single players the title rules cannot put right: the peaks the game's
// followers agree on, where a title's flat top hides them, and cards that are plainly wrong.
// { id (EA's, the person's), name (checked against the data), cards: { title number → points },
// why }. Kept to a handful of players.
export const PLAYER_JUDGEMENT = [
  {
    id: 37576,
    name: 'Ronaldo',
    cards: { 98: 3, 99: 4, 1: -2, 3: 4 },
    why: 'The best player in the world in 1996–98 (Ballon d’Or 1997, World Cup Golden Ball 1998) and the man of the 2002 World Cup (Ballon d’Or): the coarse titles have him level with Denilson and Del Piero, and FIFA 2003 at 89 after his injury years. FIFA 2001 (2000, a year he did not play) has him as its best player: two points off.',
  },
  {
    id: 1397,
    name: 'Zidane',
    cards: { 98: 3, 99: 3, 0: 1, 1: 1, 2: 1, 3: 2 },
    why: 'The best midfielder of 1998–2002 (Ballon d’Or 1998, FIFA World Player 1998 and 2000, Euro 2000, the 2002 Champions League final): the coarse titles rate him with Kluivert and Möller.',
  },
  {
    id: 28130,
    name: 'Ronaldinho',
    cards: { 5: 3, 6: 2, 7: 2 },
    why: 'FIFA World Player 2004 and 2005, Ballon d’Or 2005, the Champions League of 2006: the best player in the world for three years, rated 90–92 beside Giggs and Scholes.',
  },
  {
    id: 158023,
    name: 'Messi',
    cards: { 10: 2, 11: 2 },
    why: 'Ballon d’Or 2009 and 2010 (the sextuple, 47 and 53 goals): EA printed 90, level with Casillas; his 2011–15 cards (94–95) are his own.',
  },
  {
    id: 20801,
    name: 'Cristiano Ronaldo',
    cards: { 9: 1 },
    why: 'Ballon d’Or 2008 (42 goals, the Champions League): a point clear of Casillas and Kaká.',
  },
  {
    id: 4231,
    name: 'Rivaldo',
    cards: { 99: 3, 0: 4 },
    why: 'Ballon d’Or and FIFA World Player 1999, La Liga’s best in 1998–99: the coarse titles have him outside their top twenty.',
  },
  {
    id: 1625,
    name: 'Henry',
    cards: { 4: 2, 5: 1, 6: 4 },
    why: 'Runner-up for the Ballon d’Or 2003 and the FIFA World Player 2003 and 2004, the Invincibles’ forward, four Premier League Golden Boots in five years: FIFA 2004–05 have him level with Trezeguet and Makaay, FIFA 06 (2005) at 87 under Valerón.',
  },
  {
    id: 138449,
    name: 'Kaká',
    cards: { 8: 2 },
    why: 'Ballon d’Or and FIFA World Player 2007, the Champions League’s best player: FIFA 08 has him fourth among outfielders.',
  },
  {
    id: 1109,
    name: 'Maldini',
    cards: { 98: 4, 99: 4, 0: 4, 1: 2, 2: 2, 3: 2 },
    why: 'The best defender in the world from 1994 to 2003 (third for the Ballon d’Or in 1994 and 2003). FIFA 98 and 99 themselves have him as their best or second-best player (96 and 94 on their own scales); pooled with FIFA 2000’s odd 78 he came out at 85, under Southgate, Campbell and Blanc.',
  },
  {
    id: 232,
    name: 'Schmeichel',
    cards: { 98: 4, 99: 4, 0: 3 },
    why: 'The best goalkeeper of the 1990s (IFFHS World’s Best Goalkeeper 1992 and 1993, UEFA’s club goalkeeper of 1998, the 1999 treble): FIFA 98/99 have no keeper skills and he retired before a fully described title could vouch for him, so he came out at 84, level with Rossi and Letizi.',
  },
  {
    id: 2384,
    name: 'Poom',
    cards: { 1: -4, 4: -8 },
    why: 'A good Premier League and Championship goalkeeper (Derby, Sunderland), Estonia’s best player — never one of the world’s best. Two titles are flukes far above his standing: FIFA 2004 (2003) gives him goalkeeping 89, level with Kahn, between cards of 78 and 73 the years around, and FIFA 2001’s coarse scale reads 86. Judged down to 81 (2003) and 82 (2000), a little above his other cards: Estonia is no star nation on a fluke.',
  },
  // The icons of 1997–2002 the coarse titles plainly under-rate (`kind: 'icon'`).
  {
    id: 240,
    name: 'Keane',
    kind: 'icon',
    cards: { 98: 4, 99: 4, 0: 4, 1: 3, 2: 3, 3: 3 },
    why: 'Manchester United’s driving force through the 1999 Treble, PFA and FWA Player of the Year 2000: the coarse titles have him at 81–85, an ordinary midfielder.',
  },
  {
    id: 1030,
    name: 'Batistuta',
    kind: 'icon',
    cards: { 98: 3, 99: 3, 0: 3, 1: 4 },
    why: 'The centre-forward of the 1990s — Serie A’s top scorer, five goals at the 1998 World Cup, third for the FIFA World Player 1999, Roma’s title in 2001: 87 and then 84 undersells him.',
  },
  {
    id: 4000,
    name: 'Bergkamp',
    kind: 'icon',
    cards: { 98: 3, 99: 4 },
    why: 'PFA and FWA Player of the Year 1998, third for the FIFA World Player 1997, the goal against Argentina: 85–87 for the best player in England.',
  },
  {
    id: 5003,
    name: 'Cafu',
    kind: 'icon',
    cards: { 99: 4, 0: 3, 1: 3, 2: 3, 3: 3 },
    why: 'The right-back of his generation: three World Cup finals running, captain of the 2002 champions, Roma’s 2001 title. 83–85 has him behind club full-backs.',
  },
  {
    id: 1615,
    name: 'Thuram',
    kind: 'icon',
    cards: { 98: 3, 99: 4, 0: 3, 1: 2 },
    why: 'World champion 1998 (both goals of the semi-final) and European champion 2000, the best defender in Serie A at Parma: 83–86.',
  },
  {
    id: 7332,
    name: 'Suker',
    kind: 'icon',
    cards: { 98: 2, 99: 7 },
    why: 'Golden Boot and Silver Ball of the 1998 World Cup, second for the Ballon d’Or 1998: FIFA 99 has him at 80.',
  },
  {
    id: 51,
    name: 'Shearer',
    kind: 'icon',
    cards: { 98: 3, 99: 2 },
    why: 'The Premier League’s record scorer at his peak, top scorer of Euro 96, England’s captain: 85.',
  },
  {
    id: 10967,
    name: 'Chilavert',
    kind: 'icon',
    cards: { 98: 3, 99: 4, 0: 3 },
    why: 'IFFHS World’s Best Goalkeeper 1995, 1997 and 1998, in the 1998 World Cup’s all-star team: FIFA 98/99 have no keeper skills.',
  },
  {
    id: 98002616,
    name: 'Djorkaeff',
    kind: 'icon',
    cards: { 98: 3, 99: 3 },
    why: 'The No. 10 of the 1998 world champions, Inter’s best in 1997–98 (UEFA Cup): only FIFA 98/99 know him, so he is pulled to the titles’ average.',
  },
  {
    id: 98006900,
    name: 'Dunga',
    kind: 'icon',
    cards: { 98: 5, 99: 6 },
    why: 'Captain of the 1994 world champions and of the 1998 finalists, in the 1998 all-star team: only in FIFA 98/99, in the national squad alone — rated like a squad player.',
  },
  {
    id: 7557,
    name: 'Taffarel',
    kind: 'icon',
    cards: { 98: 4, 99: 5 },
    why: 'Brazil’s keeper in the 1994 and 1998 finals (the semi-final shoot-out of 1998): FIFA 98/99 have no keeper skills.',
  },
  {
    id: 1607,
    name: 'Barthez',
    kind: 'icon',
    cards: { 99: 3, 0: 3, 1: 4 },
    why: 'Yashin Award of the 1998 World Cup, European champion 2000, IFFHS World’s Best Goalkeeper 2000: 83–84.',
  },
  {
    id: 10961,
    name: 'Salas',
    kind: 'icon',
    cards: { 98: 4, 99: 4 },
    why: 'South American Footballer of the Year 1997, four goals at the 1998 World Cup, Lazio’s striker: 82–83.',
  },
  {
    id: 98000111,
    name: 'Romário',
    kind: 'icon',
    cards: { 98: 4, 99: 5 },
    why: 'Top scorer of the 1997 Copa América and Confederations Cup with Ronaldo beside him, out of the 1998 World Cup only through injury: only FIFA 98/99 know him.',
  },
  {
    id: 5602,
    name: 'Mijatovic',
    kind: 'icon',
    cards: { 98: 4, 99: 3 },
    why: 'Second for the Ballon d’Or 1997, the goal that won the 1998 Champions League final: 83.',
  },
  {
    id: 1040,
    name: 'Roberto Carlos',
    kind: 'icon',
    cards: { 98: 3, 99: 2, 0: 2, 1: 4, 2: 4, 3: 6 },
    why: 'Second for the FIFA World Player 1997 and for the Ballon d’Or 2002, three Champions Leagues and the 2002 World Cup: the coarse titles keep the best left-back of his time at 84–87.',
  },
  {
    id: 1088,
    name: 'Nesta',
    kind: 'icon',
    cards: { 99: 3 },
    why: 'Serie A’s Young Player of 1998 and Lazio’s captain at 22, a starter at the 1998 World Cup: 83 the year before the titles have him at 87–89.',
  },
  {
    id: 1183,
    name: 'Cannavaro',
    kind: 'icon',
    cards: { 99: 3, 0: 3, 1: 4, 2: 4, 3: 3 },
    why: 'Parma’s and Italy’s centre-back from 1998, in the team of Euro 2000: 81–83 until his 2006 card.',
  },
  {
    id: 1041,
    name: 'Zanetti',
    kind: 'icon',
    cards: { 99: 4, 2: 2, 3: 2 },
    why: 'Argentina’s right-back at the 1998 World Cup (the free-kick goal against England) and Inter’s captain from 2001: 80–84.',
  },
  {
    id: 5672,
    name: 'Davids',
    kind: 'icon',
    cards: { 99: 2 },
    why: 'Juventus’s engine and in the 1998 World Cup’s all-star team: 86, four under his cards of 2000.',
  },
  {
    id: 5590,
    name: 'Guardiola',
    kind: 'icon',
    cards: { 98: 5, 99: 5 },
    why: 'Barcelona’s captain and playmaker of the 1990s: the coarse titles rate a passer by his speed and shooting — 79–80.',
  },
  {
    id: 10758,
    name: 'Mendieta',
    kind: 'icon',
    cards: { 1: 5, 2: 5 },
    why: 'UEFA’s Club Midfielder of the Year 2000 and 2001, Valencia’s captain in two Champions League finals, the most expensive Spanish player in 2001: FIFA 2001 has him as one of its very best on its own scale, pooled down to 82.',
  },
  {
    id: 13128,
    name: 'Shevchenko',
    kind: 'icon',
    cards: { 5: 2 },
    why: 'Ballon d’Or 2004 (Serie A’s top scorer, champion): 90, level with five others.',
  },
  {
    id: 49131,
    name: 'Luis Enrique',
    kind: 'icon',
    cards: { 0: 3, 1: 6, 2: 6 },
    why: 'Barcelona’s captain and a Spain starter to the 2002 World Cup: FIFA 2000–02 list him under two ids, and the rows of 2000–02 fall from 86 to 77.',
  },
  {
    id: 36,
    name: 'Yorke',
    kind: 'icon',
    cards: { 99: 2, 0: 2 },
    why: 'The Premier League’s top scorer and the Champions League’s joint top scorer in Manchester United’s 1999 Treble: the coarse titles have him at 81.',
  },
  // Breakout lag (`kind: 'breakout'`): a key man of his national team at that World Cup —
  // starter, award winner — whose card of the tournament year still shows a prospect or a
  // squad player. Lifted to what reads fair for that tournament: inside the squad, right
  // next to his team-mates, not above established stars without cause — modestly (one to three
  // points; Xavi and Iniesta 2010 are the exception): the starter rule sees to it that he is
  // in the pool.
  {
    id: 246,
    name: 'Scholes',
    kind: 'breakout',
    cards: { 99: 3 },
    why: 'World Cup 1998: a starter who scored for England at 23; his card is still a squad player’s (80), two years before 88.',
  },
  {
    id: 11141,
    name: 'Klose',
    kind: 'breakout',
    cards: { 3: 2, 7: 1 },
    why: 'World Cup 2002: five goals, Silver Boot (81). World Cup 2006: Golden Boot (86).',
  },
  {
    id: 3647,
    name: 'Ballack',
    kind: 'breakout',
    cards: { 3: 1 },
    why: 'World Cup 2002: carried Germany to the final, Germany’s Footballer of the Year and UEFA’s midfielder of the year 2002 (86).',
  },
  {
    id: 52582,
    name: 'Reçber',
    kind: 'breakout',
    cards: { 3: 2 },
    why: 'World Cup 2002: Rüştü, the all-star team’s goalkeeper of third-placed Türkiye; FIFA 2003 has him at 80, FIFA 2004 at 88.',
  },
  {
    id: 726,
    name: 'Hasan',
    kind: 'breakout',
    cards: { 3: 2 },
    why: 'World Cup 2002: in the all-star team for third-placed Türkiye (79; 84 a year later).',
  },
  {
    id: 39943,
    name: 'Park',
    kind: 'breakout',
    cards: { 3: 1 },
    why: 'World Cup 2002: the goal that beat Portugal, a starter of the semi-finalists (79).',
  },
  {
    id: 121939,
    name: 'Lahm',
    kind: 'breakout',
    cards: { 7: 3 },
    why: 'World Cup 2006: the opening goal, every minute played, all-star team (80; 88 two years later).',
  },
  {
    id: 121944,
    name: 'Schweinsteiger',
    kind: 'breakout',
    cards: { 7: 2 },
    why: 'World Cup 2006: a starter of the hosts’ run, two goals in the third-place match (80).',
  },
  {
    id: 150516,
    name: 'Podolski',
    kind: 'breakout',
    cards: { 7: 1 },
    why: 'World Cup 2006: Best Young Player, three goals (82).',
  },
  {
    id: 156616,
    name: 'Ribéry',
    kind: 'breakout',
    cards: { 7: 1 },
    why: 'World Cup 2006: the discovery of the finalists, a starter from the second match (83; 86–89 after).',
  },
  {
    id: 7763,
    name: 'Pirlo',
    kind: 'breakout',
    cards: { 7: 2 },
    why: 'World Cup 2006: Bronze Ball, man of the match in the final and twice more (86).',
  },
  {
    id: 189596,
    name: 'Müller',
    kind: 'breakout',
    cards: { 11: 3 },
    why: 'World Cup 2010: Golden Boot and Best Young Player (80).',
  },
  {
    id: 189511,
    name: 'Busquets',
    kind: 'breakout',
    cards: { 11: 2 },
    why: 'World Cup 2010: started every match but one for the world champions, after Barcelona’s 2009 treble (81).',
  },
  {
    id: 176635,
    name: 'Özil',
    kind: 'breakout',
    cards: { 11: 2 },
    why: 'World Cup 2010: Germany’s playmaker, Golden Ball nominee, bought by Real Madrid (83).',
  },
  {
    id: 179846,
    name: 'Khedira',
    kind: 'breakout',
    cards: { 11: 1 },
    why: 'World Cup 2010: Ballack’s replacement in every match of the third-placed side (80).',
  },
  {
    id: 189505,
    name: 'Pedro',
    kind: 'breakout',
    cards: { 11: 1 },
    why: 'World Cup 2010: started the semi-final and the final; 23 goals in Barcelona’s 2009–10 (82).',
  },
  {
    id: 176580,
    name: 'Suárez',
    kind: 'breakout',
    cards: { 11: 2 },
    why: 'World Cup 2010: three goals for the semi-finalists after 49 goals for Ajax (82).',
  },
  {
    id: 168320,
    name: 'Gyan',
    kind: 'breakout',
    cards: { 11: 3 },
    why: 'World Cup 2010: Ghana’s three goals on the way to the quarter-final (75; EA’s own 81 a year later).',
  },
  {
    id: 139869,
    name: 'Sneijder',
    kind: 'breakout',
    cards: { 11: 1 },
    why: 'World Cup 2010: Silver Ball and joint top scorer for the finalists in the year of Inter’s treble (88).',
  },
  {
    id: 10535,
    name: 'Xavi',
    kind: 'breakout',
    cards: { 10: 4, 11: 4 },
    why: 'Player of Euro 2008, third for the Ballon d’Or 2009 and 2010, world champion: EA kept him at 89 until FIFA 12’s 93.',
  },
  {
    id: 41,
    name: 'Iniesta',
    kind: 'breakout',
    cards: { 11: 4 },
    why: 'World Cup 2010: the final’s goal and man of the match, second for the Ballon d’Or (89; 92 a year later).',
  },
  {
    id: 195864,
    name: 'Pogba',
    kind: 'breakout',
    cards: { 15: 1 },
    why: 'World Cup 2014: Best Young Player (83; 87 a year later).',
  },
  {
    id: 182521,
    name: 'Kroos',
    kind: 'breakout',
    cards: { 15: 1 },
    why: 'World Cup 2014: in the all-star team for the champions, two goals in the 7–1 (85; 88 a year later).',
  },
  {
    id: 192985,
    name: 'De Bruyne',
    kind: 'breakout',
    cards: { 15: 2 },
    why: 'World Cup 2014: Belgium’s best player (goal and assist against the United States) and the Bundesliga’s assist leader (81; 87 a year later).',
  },
  {
    id: 193041,
    name: 'Navas',
    kind: 'breakout',
    cards: { 15: 2 },
    why: 'World Cup 2014: three man-of-the-match awards for quarter-finalists Costa Rica, bought by Real Madrid (79; 85 two years later).',
  },
  {
    id: 140233,
    name: 'Ochoa',
    kind: 'breakout',
    cards: { 15: 1 },
    why: 'World Cup 2014: the saves against Brazil and the Netherlands (80).',
  },
  {
    id: 179944,
    name: 'David Luiz',
    kind: 'breakout',
    cards: { 15: 1 },
    why: 'World Cup 2014: Brazil’s best player up to the semi-final (two goals, the fans’ Dream Team), the world’s most expensive defender that summer (82).',
  },
  {
    id: 178509,
    name: 'Giroud',
    kind: 'breakout',
    cards: { 19: 3, 23: 1 },
    why: 'World Cup 2018: the champions’ centre-forward in every match — the man the attack was built around — whom EA kept at 82; World Cup 2022: four goals at 36, France’s record scorer. Not breakout lag (he was never a prospect): a card that rates goals and pace misses what he did for France.',
  },
  {
    id: 231747,
    name: 'Mbappé',
    kind: 'breakout',
    cards: { 19: 1 },
    why: 'World Cup 2018: Best Young Player, four goals, one in the final (87).',
  },
  {
    id: 226851,
    name: 'Pavard',
    kind: 'breakout',
    cards: { 19: 1 },
    why: 'World Cup 2018: the champions’ right-back in six matches, goal of the tournament (80).',
  },
  {
    id: 246669,
    name: 'Saka',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: three goals as an England starter after Euro 2020 and Arsenal’s player of the season (82).',
  },
  {
    id: 256790,
    name: 'Musiala',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: Germany’s best player at 19 (81; 86 a year later).',
  },
  {
    id: 252371,
    name: 'Bellingham',
    kind: 'breakout',
    cards: { 23: 1 },
    why: 'World Cup 2022: England’s midfield at 19, in most teams of the tournament (84).',
  },
  {
    id: 264240,
    name: 'Gavi',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: a Spain starter and scorer at 18, Kopa Trophy and Golden Boy 2022 (79).',
  },
  {
    id: 247090,
    name: 'Fernández',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: Best Young Player for the champions (78).',
  },
  {
    id: 246191,
    name: 'Alvarez',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: four goals for the champions, a starter from the third match (78).',
  },
  {
    id: 239837,
    name: 'Mac Allister',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: a starter of the champions from the second match, goal and assist in the knock-outs (76; 86 two years later).',
  },
  {
    id: 251517,
    name: 'Gvardiol',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: the tournament’s best young defender for third-placed Croatia (81).',
  },
  {
    id: 224158,
    name: 'Amrabat',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: the midfield of semi-finalists Morocco (76).',
  },
  {
    id: 241671,
    name: 'Livaković',
    kind: 'breakout',
    cards: { 23: 1 },
    why: 'World Cup 2022: the shoot-outs against Japan and Brazil for third-placed Croatia (80).',
  },
  {
    id: 202811,
    name: 'Martínez',
    kind: 'breakout',
    cards: { 23: 2 },
    why: 'World Cup 2022: Golden Glove for the champions (84).',
  },
  {
    id: 209981,
    name: 'Bounou',
    kind: 'breakout',
    cards: { 23: 1 },
    why: 'World Cup 2022: Morocco’s keeper to the semi-final, Zamora Trophy 2022 (84).',
  },
  {
    id: 93,
    name: 'Denilson',
    cards: { 98: -6, 99: -4, 0: -4, 1: -3, 2: -3 },
    why: 'The coarse scales max out his dribbling and speed: second or third best in the world in FIFA 98–2000. A fine winger and a record transfer, never that.',
  },
];
// Era pools (app/data/eras.v1.json): a World Cup squad per nation and cycle.
export const ERA_KEEPERS = 3;
export const ERA_LINES = { DEF: 7, MID: 7, ATT: 4 }; // at least, where the nation has them
// A nation can be spun in an era when its pool can field a team with a few spares: 14 players,
// three defenders, four midfielders — a forward beyond the first four counts as one, he can
// play wide — and two forwards. (No goalkeeper needed: `keepers` tells the draft which pools
// have one.)
export const ERA_SPIN = { players: 14, DEF: 3, MID: 4, ATT: 2 };
// Always in, whatever it has (even four players — `size` tells the draft): a nation that played
// that era's World Cup finals (data/world-cups.json), and a nation with a star — a card that
// shows ERA_STAR or more (Weah's Liberia, Shevchenko's Ukraine of 1998, Yorke's Trinidad).
export const ERA_STAR = 85;
// What a place its pool cannot fill counts in a nation's strength (a pool of eight is not a
// strong side because its eight are good).
export const ERA_FILL = 60;
// A card that shows this much in an era is kept even when it is in no pool — not in the file
// the game loads (with them it would be 4.5 MB, 1.30 MB gzip) but in the archive
// data/eras-archive.v1.json: the same columns (eras-codec.js), never deployed or fetched, for a
// later feature.
export const ERA_KEPT = 75;
export const ERA_NATIONS = 70; // at most, the strongest (best XI of the pool)
// France 98 keeps fewer. FIFA 98/99 know most players by a surname, some national squads by
// first names or invented ones: a pool there needs three in ten of its players to be men a
// later title knows (EA's id: Canada's "Robert, Janny, Aaron, Mike" and the United States'
// and Slovakia's squads are not), and the era keeps its strongest 41 — below them the pools
// are thin squads of surnames nobody can check.
export const ERA_NATION_LIMIT = { 1998: 41 };
export const ERA_IDENTIFIED = { 1998: 0.3 };
const LOCAL_PERSON = 98_000_000; // FIFA 98/99's own ids, as persons (legends-calibration.mjs)
const nationLimit = era => ERA_NATION_LIMIT[era] ?? ERA_NATIONS;
export const ERA_MINIMUM = 20; // an era with fewer nations is not an era: the build fails
const ERA_LINE = {
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LM: 'MID',
  RM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT',
};
/** The era rules in words, for the eras file's `selection` block. */
export const ERA_SELECTION = {
  pool: `A nation's best ${ERA_SQUAD} players of the era, each at his best version inside its years (highest overall; ties: the later year); ${ERA_KEEPERS} goalkeepers and at least ${ERA_LINES.DEF} defenders, ${ERA_LINES.MID} midfielders and ${ERA_LINES.ATT} forwards where the nation has them; no minimum rating`,
  today: `The ${ERAS.at(-1).label} era: FC 24, FC 25, FC 26 and today's catalog — a catalog player is in it as he is unless one of those versions shows more`,
  spinnable: `A nation that played the era's World Cup finals, or has a player shown ${ERA_STAR}+ in the era — with whatever players it has; and of the others — a pool of at least ${ERA_SPIN.players} players, ${ERA_SPIN.DEF} defenders, ${ERA_SPIN.MID} midfielders (a forward beyond the first ${ERA_LINES.ATT} counts as one) and ${ERA_SPIN.ATT} forwards, with or without a goalkeeper — those among the era's ${ERA_NATIONS} strongest (mean overall of the best XI; without a keeper the era's weakest first-choice keeper stands in, an empty place counts ${ERA_FILL})`,
  starters:
    "A World Cup starter of the reviewed list (data/world-cup-starters.json) or a player with a breakout-lag correction is in his nation's pool of that era: he takes the place of the lowest-rated player (a keeper a keeper’s; an outfielder the lowest-rated outfielder’s whose line keeps its minimum)",
  star: ERA_STAR,
  fill: ERA_FILL,
  best: 'Everyone in a pool also has his best version of all titles in the file (the Prime), in a pool or not',
  squad: ERA_SQUAD,
  spin: ERA_SPIN,
  maximumNations: ERA_NATIONS,
  nationLimit: ERA_NATION_LIMIT,
  identified: ERA_IDENTIFIED,
};
/** The rules in words, for the file's `selection` block. */
export const SELECTION = {
  overall:
    'EA’s printed overall (FIFA 09–23); FIFA 98–08 print none and are chain-linked to the next title through the players both have',
  lift: `A title whose ${LIFT_TOP} best are rated lower on average than FC 27's is lifted by the difference (never lowered) at the very top only: in full from ${LIFT_FULL}, fading to nothing at ${LIFT_FROM}; FIFA 98–08 carry the lift of FIFA 09, whose scale they are linked to`,
  card: 'The skills of that year, moved together until the game shows that overall',
  bestVersion: 'Highest overall; ties: the latest title',
  legends: `Best versions shown ${LEGEND_MINIMUM}+: players who are not in the catalog, and catalog players whose card today shows at least ${LEGEND_GAIN} less; of a catalog nation; the club of that title when it is in the catalog`,
  primes: 'Catalog players whose best version shows more than their card today: any gain',
  year: 'The year of the ratings: the snapshot date (FIFA 15–23), the year before the title’s number (FIFA 98–14)',
  borrowed:
    'Composure (FIFA 11–16), foot and weak foot (early titles): the player’s nearest version that has one',
  legendMinimum: LEGEND_MINIMUM,
  legendGain: LEGEND_GAIN,
};

const shown = p => overallRating(p, true, p.primaryPosition);
const KEEPING = ['diving', 'handling', 'kicking', 'positioning', 'reflexes'].map(
  k => `goalkeeping_${k}`,
);
const words = text =>
  foldDiacritics(String(text ?? ''))
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
// An unlicensed stand-in ("No 9", "No. 11") is not a name.
const PLACEHOLDER = /^no\.?\s*\d+$/i;

// The first title of the FC series: its files and the later ones are the "modern" sources.
const FIRST_FC = 24;
const titleName = edition => `${Number(edition) >= FIRST_FC ? 'FC' : 'FIFA'} ${edition}`;
/**
 * The year of a row's ratings snapshot; the build fails without one. EA's launch feed (FC 25)
 * has no date: like every launch database, its ratings are those of the year before the
 * title's number.
 */
function snapshotYear(row) {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(row.fifa_update_date || '');
  if (!m && row.fifa_update_date === '' && Number(row.fifa_version) >= FIRST_FC)
    return 1999 + Number(row.fifa_version);
  if (!m)
    throw Error(
      `${row.short_name} (FIFA ${row.fifa_version}): no snapshot date (fifa_update_date "${row.fifa_update_date}"), so the year of this version is unknown`,
    );
  return Number(m[1]);
}

/** The fields the game uses of a compiled profile (as toRuntimeCatalog keeps them). */
function runtimePlayer(p, extra) {
  const player = {
    profileId: p.profileId,
    name: p.name,
    fullName: p.fullName,
    primaryPosition: p.primaryPosition,
    secondaryPositions: [...p.secondaryPositions],
    attrs: { ...p.attrs },
    foot: p.foot,
    weakFoot: p.weakFoot,
    tendencies: { ...p.tendencies },
    tags: [...p.tags],
    sourceOverall: p.sourceOverall,
    edition: Number(p.profileId.split(':')[2].slice(2)),
    ...extra,
    inference: { badges: explicitEvidence(p) },
  };
  player.tags = normalizeBadges(player, player.tags);
  return player;
}

/**
 * @param legacyRows parsed rows of the legacy CSV (every edition of every player)
 * @param catalog the compiled current catalog (compileLeagueCatalog output)
 * @param hash SHA-256 of the legacy CSV
 * @param older the decoded FIFA 98–14 titles ({ titles, sha256 }, scripts/data/legacy-titles.mjs)
 * @param modern FC 24–26: [{ edition, rows (scripts/data/modern-titles.mjs), source: { url,
 *   license, sha256 } }], oldest first
 * @param marks the reviewed lists { goats (data/goats.json), captains (data/captains.json) }:
 *   their cards in the era pools get `goat` / `captain`; an entry that does not meet the data
 *   fails the build
 * @returns {{ legends, primes, eras, stats, calibration, notes }} runtime players, each with
 *   `edition` and `year`; a catalog player's legend carries `legendOf`, a prime `primeOf` (the
 *   current player's profileId) and no name, club or nation (those are the current player's).
 *   `calibration` and `notes` (per card: where its numbers come from) are the provenance.
 */
export function compileLegends(
  legacyRows,
  catalog,
  hash = null,
  older = { titles: [] },
  modern = [],
  marks = { goats: null, captains: null },
) {
  // What a national team is called: a nation's name as the catalog or any of the modern files
  // spells it (the older titles list national squads next to clubs).
  const nationWords = new Set(catalog.players.map(p => teamWords(p.source.nationality).join(' ')));
  for (const row of legacyRows) nationWords.add(teamWords(row.nationality_name).join(' '));
  for (const title of modern)
    for (const row of title.rows) nationWords.add(teamWords(row.nationality_name).join(' '));
  const calibration = calibrateTitles(older.titles, name =>
      nationWords.has(teamWords(name).join(' ')),
    ),
    teams = new Map(catalog.teams.map(t => [String(t.id), t])),
    current = new Map(catalog.players.map(p => [String(p.sourcePlayerId), p])),
    nations = new Set(catalog.players.map(p => p.source.nationality));
  // ---- persons: every version of everyone ------------------------------------------------
  const persons = new Map(); // key → { key, legacy: [{ row, index }], old: [rows] }
  const person = key => {
    if (!persons.has(key)) persons.set(key, { key, legacy: [], old: [] });
    return persons.get(key);
  };
  legacyRows.forEach((row, index) => person(row.player_id).legacy.push({ row, index }));
  // FC 24–26 follow the legacy file: a person's `legacy` rows stay oldest first.
  const sourceOf = new Map(); // row → { url, license, sha256 } of a modern file
  for (const title of modern)
    title.rows.forEach((row, index) => {
      sourceOf.set(row, title.source);
      person(row.player_id).legacy.push({ row, index });
    });
  const allRows = [...legacyRows, ...modern.flatMap(title => title.rows)];
  const stats = {
    pureLegends: 0,
    currentLegends: 0,
    composureBorrowed: 0,
    composureFromReactions: 0,
    footBorrowed: 0,
    footUnknown: 0,
    shownOffOverall: 0,
    reshaped: 0,
    otherNations: [],
    dropped: [...calibration.dropped],
    merged: calibration.merged,
  };
  for (const one of calibration.persons.values()) {
    const key = String(one.id),
      known = persons.get(key);
    if (known?.legacy.length) {
      // The same EA id in FIFA 15–23: the same man when a name word or the birthday agrees.
      const names = new Set(
          known.legacy.flatMap(({ row }) =>
            `${words(row.short_name)} ${words(row.long_name)}`.split(' ').filter(w => w.length > 1),
          ),
        ),
        same = one.rows.some(
          p =>
            (p.born && known.legacy.some(({ row }) => row.dob === p.born)) ||
            `${words(p.name)} ${words(p.fullName)}`.split(' ').some(w => names.has(w)),
        );
      if (!same) {
        stats.dropped.push(
          `${one.rows.at(-1).name} (FIFA 98–14, id ${key}): not the ${known.legacy.at(-1).row.short_name} of FIFA 15–23`,
        );
        continue;
      }
    }
    person(key).old.push(...one.rows);
  }
  // ---- judgement cards (data/judgement-cards.json) ---------------------------------------
  // Notable players the source lacks or cannot tell apart: the card of one title, made by
  // hand — the overall is a judgement, the skills, position and club are those of the row
  // named in `like` (his own row of another title or under another id; default: his own row of
  // that title), moved to that overall like every other card.
  const handYear = edition => (edition >= 90 ? 1900 : 2000) + edition - 1;
  const handMade = [];
  for (const entry of marks.handCards?.cards ?? []) {
    const one = person(String(entry.person)),
      from = entry.like ? persons.get(String(entry.like.person)) : one,
      edition = Number(entry.edition),
      source = from?.old.find(p => p.edition === Number(entry.like?.edition ?? edition));
    if (!source?.skills)
      throw Error(`Judgement card ${entry.name} (${entry.title}): no row to make it from`);
    if (!`${words(source.name)} ${words(source.fullName)}`.includes(words(entry.sourceName)))
      throw Error(
        `Judgement card ${entry.name}: the row is "${source.name}", not "${entry.sourceName}"`,
      );
    if (!(entry.overall >= 60 && entry.overall <= 92) || !(entry.why?.length > 20))
      throw Error(`Judgement card ${entry.name}: overall ${entry.overall}, or no reason`);
    let row = one.old.find(p => p.edition === edition);
    if (row && row !== source)
      throw Error(`Judgement card ${entry.name}: he has a row of title ${edition}`);
    if (!row) {
      row = { ...source, edition, year: handYear(edition), given: null };
      one.old.push(row);
      one.old.sort((a, b) => a.year - b.year);
    }
    row.given = entry.overall;
    row.hand = entry.overall;
    handMade.push({ ...entry, year: row.year });
  }
  // ---- nations --------------------------------------------------------------------------
  // Today's catalog name of a past nationality id (Türkiye, Czechia…): the nation most
  // catalog players of that id have today (the current source carries no ids).
  const nationVotes = new Map();
  for (const one of persons.values()) {
    const now = current.get(one.key);
    if (!now || !one.legacy.length) continue;
    const id = one.legacy.findLast(({ row }) => row.nationality_id)?.row.nationality_id;
    if (!id) continue;
    if (!nationVotes.has(id)) nationVotes.set(id, new Map());
    const votes = nationVotes.get(id);
    votes.set(now.source.nationality, (votes.get(now.source.nationality) || 0) + 1);
  }
  const winner = votes => [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const nationNames = new Map([...nationVotes].map(([id, votes]) => [id, winner(votes)[0]]));
  // Nation names as the old titles spell them: the catalog's own, EA's of FIFA 06–23 (through
  // the nationality id), and the national teams of the early titles, which are named after
  // their nation ("Holland", "Czech Rep") — a team counts as one when its name is a nation's.
  const nationByName = new Map();
  for (const name of nations) nationByName.set(teamWords(name).join(' '), name);
  const spell = (name, id) => {
    const nation = nationNames.get(String(id)),
      key = teamWords(name).join(' ');
    if (nation && key && !nationByName.has(key)) nationByName.set(key, nation);
  };
  for (const row of allRows)
    if (row.nationality_id) spell(row.nationality_name, row.nationality_id);
  const teamNation = name => nationByName.get(teamWords(name).join(' ')) ?? null;
  // A person's nation from his own rows: FIFA 15–23, else EA's nationality id (FIFA 2005) or
  // the nation's name (FIFA 06–14) where the catalog or FIFA 15–23 spell it that way, else
  // the national team he is in.
  const ownNation = one => {
    if (one.legacy.length) {
      const row = one.legacy.at(-1).row;
      return (
        nationNames.get(row.nationality_id) ??
        teamNation(row.nationality_name) ??
        row.nationality_name
      );
    }
    for (const p of [...one.old].reverse()) {
      const nation =
        (p.edition === 5 ? nationNames.get(String(p.nationCode)) : null) ??
        teamNation(p.nationName ?? '');
      if (nation) return nation;
    }
    for (const p of [...one.old].reverse())
      for (const team of p.clubs) if (teamNation(team)) return teamNation(team);
    return null;
  };
  // What a title calls a nationality — a code of its own (FIFA 98–2002), an adjective (FIFA
  // 2003), a name spelled another way (FIFA 06–14: "Holland", "Korea Republic") — is the
  // nation most of its players with a known nation have (at least three, four in five
  // agreeing).
  const byOldRow = new Map();
  for (const one of persons.values()) for (const p of one.old) byOldRow.set(p, one);
  const nationKey = p => p.nationCode ?? p.nationName;
  const codeNation = new Map(); // title → Map(code → nation)
  for (const t of older.titles) {
    const votes = new Map();
    for (const p of t.players) {
      const one = byOldRow.get(p),
        nation = one && ownNation(one),
        key = nationKey(p);
      if (!nation || key == null) continue;
      if (!votes.has(key)) votes.set(key, new Map());
      votes.get(key).set(nation, (votes.get(key).get(nation) || 0) + 1);
    }
    const codes = new Map();
    for (const [code, list] of votes) {
      const [nation, count] = winner(list),
        total = [...list.values()].reduce((s, v) => s + v, 0);
      if (count >= 3 && count >= 0.8 * total) codes.set(code, nation);
    }
    codeNation.set(t.edition, codes);
  }
  const nationCache = new Map();
  const nationOf = one => {
    if (nationCache.has(one)) return nationCache.get(one);
    let found = ownNation(one);
    if (!found)
      for (const p of [...one.old].reverse()) {
        found = codeNation.get(p.edition)?.get(nationKey(p)) ?? null;
        if (found) break;
      }
    nationCache.set(one, found);
    return found;
  };
  // ---- clubs of the early titles (names only): the EA team id a later title gives that name
  const teamIds = new Map();
  for (const t of older.titles)
    for (const p of t.players)
      p.clubs.forEach((name, i) => {
        const key = teamWords(name).join(' ');
        if (p.clubIds[i] != null && key && !/^team \d+$/i.test(name) && !teamIds.has(key))
          teamIds.set(key, String(p.clubIds[i]));
      });
  for (const t of catalog.teams) {
    const key = teamWords(t.name).join(' ');
    if (key && !teamIds.has(key)) teamIds.set(key, String(t.id));
  }
  const clubOf = p => {
    for (let i = 0; i < p.clubs.length; i++) {
      const id = p.clubIds[i] ?? teamIds.get(teamWords(p.clubs[i]).join(' '));
      if (id != null && teams.has(String(id))) return teams.get(String(id));
    }
    return null;
  };
  // ---- the lift ---------------------------------------------------------------------------
  // EA printed lower numbers for its best players in some years than it does today (FIFA
  // 09–16: one to two points at the top), and the chain hands FIFA 09's scale down to FIFA
  // 98–08. FC 27 is the baseline: a title whose LIFT_TOP best average less than FC 27's is
  // lifted by the difference — one constant per title, never a lowering (FIFA 17–23 stay as
  // printed). The lift is for the top: in full from the level of the title's best, fading to
  // nothing at LIFT_FROM, so the ordinary players of a lifted year do not become legends.
  const topMean = list => {
    const best = [...list].sort((a, b) => b - a).slice(0, LIFT_TOP);
    return best.reduce((sum, v) => sum + v, 0) / best.length;
  };
  const baseline = topMean(catalog.players.map(p => p.sourceOverall)),
    printed = new Map(); // edition → the printed overalls of the title
  for (const row of allRows) {
    const edition = Number(row.fifa_version);
    if (!printed.has(edition)) printed.set(edition, []);
    printed.get(edition).push(Number(row.overall));
  }
  const official = older.titles.filter(t => t.players[0].overall != null);
  for (const t of official)
    printed.set(
      t.edition,
      t.players.filter(p => p.given != null).map(p => p.overall),
    );
  const lifts = new Map();
  for (const [edition, list] of printed) {
    const top = topMean(list);
    // FC 24–26 are today's scale: as printed.
    const lift = edition >= FIRST_FC && edition < 90 ? 0 : Math.max(0, baseline - top);
    lifts.set(edition, { lift: Math.round(lift * 100) / 100, full: top });
  }
  // The chain titles are on the scale of the first official title: its lift, not a second one.
  for (const t of older.titles)
    if (!lifts.has(t.edition) && official.length)
      lifts.set(t.edition, lifts.get(official[0].edition));
  const lifted = (edition, overall) => {
    const { lift } = lifts.get(edition) ?? { lift: 0 };
    if (!lift) return overall;
    const share = Math.max(0, Math.min(1, (overall - LIFT_FROM) / (LIFT_FULL - LIFT_FROM)));
    return overall + lift * share;
  };
  // ---- the judgement ----------------------------------------------------------------------
  // After the measured calibration, a reviewed correction per title (TITLE_JUDGEMENT): where a
  // title as a whole reads too generous, too stingy or too flat at the top next to what the
  // game's followers think of those players, every card of the title is moved by one rule —
  // `top` points at the level of the title's LIFT_TOP best (after the lift), in proportion
  // above and below it, nothing at `from` and under. No title is made equal to another.
  const levels = new Map(); // edition → mean of its LIFT_TOP best after the lift
  const judged = (edition, overall) => {
    const rule = TITLE_JUDGEMENT[edition];
    if (!rule || overall <= rule.from) return overall;
    return overall + (rule.top * (overall - rule.from)) / (levels.get(edition) - rule.from);
  };
  // ---- versions --------------------------------------------------------------------------
  const rawVersions = one => [
    ...one.old
      .filter(p => p.given != null)
      .map(p => ({
        old: p,
        year: p.year,
        edition: p.edition,
        printed: Math.round(p.given),
        calibrated: p.hand ?? lifted(p.edition, p.given),
        ...(p.hand ? { hand: p.hand } : {}),
      })),
    ...one.legacy.map(entry => ({
      entry,
      year: snapshotYear(entry.row),
      edition: Number(entry.row.fifa_version),
      printed: Number(entry.row.overall),
      calibrated: lifted(Number(entry.row.fifa_version), Number(entry.row.overall)),
    })),
  ];
  {
    const byTitle = new Map();
    for (const one of persons.values())
      for (const v of rawVersions(one)) {
        if (v.hand) continue; // a judgement card says nothing about its title's level
        if (!byTitle.has(v.edition)) byTitle.set(v.edition, []);
        byTitle.get(v.edition).push(v.calibrated);
      }
    for (const [edition, list] of byTitle) levels.set(edition, topMean(list));
  }
  const versionCache = new Map(),
    playerFix = new Map(PLAYER_JUDGEMENT.map(fix => [String(fix.id), fix])),
    fixed = new Set();
  // The nation rule (NATION_JUDGEMENT), after the title's.
  const nationRule = new Map();
  const judgedNation = (one, edition, overall) => {
    if (!nationRule.has(one))
      nationRule.set(
        one,
        NATION_JUDGEMENT[current.get(one.key)?.source.nationality ?? nationOf(one)] ?? null,
      );
    const rule = nationRule.get(one);
    if (!rule || !rule.editions.includes(edition) || overall <= rule.from) return overall;
    return overall + (rule.top * (overall - rule.from)) / (rule.level - rule.from);
  };
  // No card shows an overall far above the title's own number for that man: the lift, the
  // title, nation and player judgements together move a card MOST_ABOVE points at most (a
  // hand-made card is its own number).
  const checked = (one, v) => {
    if (v.hand == null && v.overall - v.printed > MOST_ABOVE)
      throw Error(`${one.key} (title ${v.edition}): ${v.overall}, the title says ${v.printed}`);
    return v;
  };
  const versions = one => {
    if (!versionCache.has(one))
      versionCache.set(
        one,
        rawVersions(one).map(v => {
          const points = playerFix.get(one.key)?.cards[v.edition] ?? 0;
          if (points) fixed.add(`${one.key}:${v.edition}`);
          return checked(one, {
            ...v,
            before: Math.round(v.calibrated),
            overall:
              v.hand ??
              Math.min(
                99,
                Math.round(judgedNation(one, v.edition, judged(v.edition, v.calibrated))) + points,
              ),
          });
        }),
      );
    return versionCache.get(one);
  };
  const bestVersion = one => {
    let best = null;
    for (const v of versions(one))
      if (!best || v.overall > best.overall || (v.overall === best.overall && v.year > best.year))
        best = v;
    return best;
  };
  // What a version lacks, from the nearest version of the same person that has it (a tie in
  // years → the later one).
  const nearest = (one, year, value) => {
    let best = null;
    for (const v of versions(one).concat(
      one.old.filter(p => p.given == null).map(p => ({ old: p, year: p.year })),
    )) {
      const found = value(v),
        gap = Math.abs(v.year - year);
      if (found == null) continue;
      if (!best || gap < best.gap || (gap === best.gap && v.year > best.year))
        best = { found, gap, year: v.year };
    }
    return best;
  };
  const nativeComposure = new Set(
    older.titles
      .filter(t => t.fields.mentality_composure[0] === 'playercomposure')
      .map(t => t.edition),
  );
  const composureOf = v =>
    v.entry
      ? v.entry.row.mentality_composure === ''
        ? null
        : Number(v.entry.row.mentality_composure)
      : nativeComposure.has(v.old.edition)
        ? v.old.native.mentality_composure
        : null;
  const footOf = v => (v.entry ? v.entry.row.preferred_foot.toLowerCase() : v.old.foot);
  const weakFootOf = v => (v.entry ? Number(v.entry.row.weak_foot) : v.old.weakFoot);
  // The name of a player the older titles alone know, in the style of today's cards
  // ("Z. Boban", "Hagi"): from his latest title that has the parts of a name, else the latest
  // with the surname alone, else a whole name as one string; never a stand-in ("No 9").
  // His real name is the one most of his rows agree on (a word in common): an invented name
  // under his own id for a year or two ("Petrovici Teodor" for Mutu) is outvoted.
  const real = one => {
    const groups = [];
    for (const q of one.old) {
      if (q.standIn) continue;
      const own = words(`${q.name} ${q.fullName}`)
          .split(' ')
          .filter(w => w.length > 1),
        group = groups.find(g => own.some(w => g.words.has(w)));
      if (!group) groups.push({ words: new Set(own), rows: [q] });
      else {
        group.rows.push(q);
        for (const w of own) group.words.add(w);
      }
    }
    groups.sort((a, b) => b.rows.length - a.rows.length); // a tie: the earlier name
    return [...(groups[0]?.rows ?? [])].reverse();
  };
  // A whole name in one string ("David Seaman") is shown as today's cards show one: "D. Seaman".
  const abbreviated = q =>
    q.named === 'whole' ? `${q.name[0]}. ${q.name.slice(q.name.indexOf(' ') + 1)}` : q.name;
  const nameSource = one =>
    ['parts', 'whole', 'short'].map(kind => real(one).find(q => q.named === kind)).find(Boolean);
  const fullNameSource = one => real(one).find(q => /\s/.test(q.fullName));
  const notes = {};
  // The compiled card of a version: its skills moved to show its overall.
  // What a real card does at a role that is not its own: per position and other role, the
  // most any catalog player shown 75+ rates there above his own position (never under 0: level
  // with his own). Past cards are held to it (cardFields) — a central midfielder may be a
  // point or two better as a holding one, never a better centre-back.
  const offRoleCap = new Map(); // position → { role: points }
  for (const p of catalog.players) {
    if (p.primaryPosition === 'GK') continue;
    const own = shown(p);
    if (own < 75) continue;
    if (!offRoleCap.has(p.primaryPosition)) offRoleCap.set(p.primaryPosition, {});
    const caps = offRoleCap.get(p.primaryPosition);
    for (const role of POSITIONS)
      if (role !== 'GK' && role !== p.primaryPosition)
        caps[role] = Math.max(caps[role] ?? OFF_ROLE, overallRating(p, true, role) - own);
  }
  const card = (one, v, suffix, count) => {
    const inference = {},
      note = { overall: v.overall };
    if (v.overall !== v.printed) note.lifted = v.overall - v.printed;
    let row, position, skills, index;
    if (v.entry) {
      row = { ...v.entry.row };
      index = v.entry.index + 1;
      skills = {};
      for (const f of SKILL_FIELDS) skills[f] = row[f] === '' ? null : Number(row[f]);
      const list = row.player_positions.split(',').map(s => s.trim());
      if (list[0] === 'CF') {
        const roles = secondStrikerRoles({
          ...skills,
          mentality_composure: skills.mentality_composure ?? skills.movement_reactions,
        });
        row.player_positions = [...roles, ...list.slice(1)].join(', ');
        note.position = `CF → ${roles[0]}`;
      }
      // EA's feed (FC 25) has the full name only: the name of his nearest sofifa-style row.
      if (row.fifa_version === '25') {
        const styled = one.legacy.findLast(e => e.row.fifa_version !== '25')?.row;
        if (styled)
          Object.assign(row, { short_name: styled.short_name, long_name: styled.long_name });
      }
      position = rowPositions(row)[0];
      note.title = titleName(row.fifa_version);
    } else {
      const p = v.old,
        legacy = (one.legacy.findLast(e => e.row.fifa_version !== '25') ?? one.legacy.at(-1))?.row,
        named = nameSource(one) ?? p,
        club = clubOf(p),
        foot = p.foot ? null : nearest(one, v.year, footOf),
        weak = p.weakFoot ? null : nearest(one, v.year, weakFootOf);
      if (!p.foot) {
        inference.foot = foot ? `from his ${foot.year} version` : 'unknown: right';
        if (count) stats[foot ? 'footBorrowed' : 'footUnknown']++;
      }
      if (!p.weakFoot) inference.weakFoot = weak ? `from his ${weak.year} version` : 'unknown: 3';
      skills = { ...p.skills };
      position = p.positions[0];
      index = p.rank;
      row = {
        player_id: one.key,
        fifa_version: String(p.edition),
        fifa_update: '1',
        fifa_update_date: '',
        short_name: legacy?.short_name ?? abbreviated(named),
        long_name: legacy?.long_name ?? fullNameSource(one)?.fullName ?? named.fullName,
        player_positions: p.positions.join(', '),
        preferred_foot: p.foot ?? foot?.found ?? 'right',
        weak_foot: p.weakFoot ?? weak?.found ?? 3,
        player_traits: p.traits.join(', '),
        player_tags: '',
        club_name: club?.name ?? p.clubs[0] ?? '',
        club_team_id: club ? String(club.id) : '',
        nationality_name: p.nationName ?? '',
      };
      const keeping = position === 'GK' ? v.overall : Math.max(1, Math.round(p.outfieldKeeping));
      for (const k of KEEPING) row[k] = keeping;
      note.title = older.titles.find(t => t.edition === p.edition).title;
      if (p.overall == null)
        note.overallFrom = p.backing ? `chain, pooled with ${p.backing.join(', ')}` : 'chain';
    }
    if (
      skills.mentality_composure == null ||
      (v.old && !nativeComposure.has(v.old.edition) && v.old.edition >= 11 && v.old.edition < 90)
    ) {
      const donor = nearest(one, v.year, composureOf);
      skills.mentality_composure = donor ? donor.found : skills.movement_reactions;
      inference.composure = donor ? `from his ${donor.year} version` : 'his reactions';
      if (count) stats[donor ? 'composureBorrowed' : 'composureFromReactions']++;
    }
    const moved = cardFields(
      skills,
      position,
      v.overall,
      10,
      offRoleCap.get(position) ?? {},
      rowPositions(row).slice(1),
    );
    if (moved.reshaped) {
      note.reshaped = moved.reshaped;
      if (count) stats.reshaped++;
    }
    Object.assign(row, moved.fields, { overall: v.overall });
    note.shift = moved.shift;
    const p = compilePlayer(row, index, {
      suffix,
      source: v.entry
        ? (sourceOf.get(v.entry.row) ?? LEGACY)
        : { url: older.source?.archive, license: TITLES.license },
      inference,
    });
    p.source.sha256 = v.entry ? (sourceOf.get(v.entry.row)?.sha256 ?? hash) : older.sha256;
    if (v.old) p.source.edition = note.title;
    if (Object.keys(inference).length) note.borrowed = inference;
    notes[p.profileId] = note;
    if (count && shown(p) !== v.overall) stats.shownOffOverall++;
    return p;
  };
  // ---- selection -------------------------------------------------------------------------
  const legends = [],
    primes = [];
  const legend = (one, v, p, extra, nationality) => {
    const team = v.entry ? teams.get(String(v.entry.row.club_team_id)) : clubOf(v.old);
    legends.push(
      runtimePlayer(p, {
        ...extra,
        year: v.year,
        source: { clubId: team ? team.id : null, nationality },
      }),
    );
  };
  for (const one of persons.values()) {
    const now = current.get(one.key),
      best = bestVersion(one);
    if (!best) continue;
    if (!now) {
      if (best.overall < LEGEND_MINIMUM) continue;
      const nationality = nationOf(one),
        p = card(one, best, 'legend', true);
      if (shown(p) < LEGEND_MINIMUM) continue;
      if (PLACEHOLDER.test(p.name)) {
        stats.dropped.push(`${p.name} ${shown(p)} (${p.source.edition}, id ${one.key}): no name`);
        continue;
      }
      if (!nations.has(nationality)) {
        stats.otherNations.push(`${p.name} ${shown(p)} (${nationality ?? 'nation unknown'})`);
        continue;
      }
      legend(one, best, p, {}, nationality);
      stats.pureLegends++;
      continue;
    }
    // A current player: only a version EA itself rated above today's, shown above today's card.
    const today = shown(now);
    if (best.overall <= now.sourceOverall || best.overall <= today) continue;
    const prime = card(one, best, 'prime', true);
    if (shown(prime) <= today) continue;
    const { name, fullName, ...rest } = runtimePlayer(prime, {
      year: best.year,
      primeOf: now.profileId,
    });
    primes.push(rest);
    if (shown(prime) >= LEGEND_MINIMUM && shown(prime) >= today + LEGEND_GAIN) {
      // His best version is a Legend-spin option: the same player, so the same name and nation.
      legend(
        one,
        best,
        card(one, best, 'legend', false),
        { name: now.name, fullName: now.fullName, legendOf: now.profileId },
        now.source.nationality,
      );
      stats.currentLegends++;
    }
  }
  const id = p => Number(p.profileId.split(':')[1]);
  const rated = new Map(legends.map(p => [p, shown(p)]));
  // Best first as the game shows them, then the latest version, then the id.
  legends.sort((a, b) => rated.get(b) - rated.get(a) || b.year - a.year || id(a) - id(b));
  // One person once, whatever the ids say: of two legends of one nation with the same name
  // the lower-rated (else the older) goes, and is listed.
  const seen = new Map();
  for (const p of [...legends]) {
    const key = `${p.source.nationality}|${words(p.fullName)}`,
      first = seen.get(key);
    if (!first) seen.set(key, p);
    else {
      legends.splice(legends.indexOf(p), 1);
      stats.dropped.push(
        `${p.name} ${rated.get(p)} (’${String(p.year % 100).padStart(2, '0')}, id ${id(p)}): same name and nation as ${first.name} ${rated.get(first)} (id ${id(first)})`,
      );
      stats[p.legendOf ? 'currentLegends' : 'pureLegends']--;
    }
  }
  const order = new Map(catalog.players.map((p, i) => [p.profileId, i]));
  primes.sort((a, b) => order.get(a.primeOf) - order.get(b.primeOf));
  // ---- eras ------------------------------------------------------------------------------
  // "Nation X in era Y": the nation's best ERA_SQUAD players of a World Cup cycle, each at his
  // best version inside the era's years (the overall decides; ties: the later year). The 2026
  // era also has today's card of everyone in the catalog: a catalog player is in it as he is
  // unless one of his FC 24–26 versions shows more. Three keepers and ERA_LINES of each line
  // where the nation has them, the rest by rating; no minimum rating. A nation can be spun in
  // an era when its pool can field a team (ERA_SPIN), at most ERA_NATIONS per era.
  const eraOfYear = year => ERAS.find(e => year >= e.from && year <= e.to) ?? null,
    lineOf = position => (position === 'GK' ? 'GK' : ERA_LINE[position]),
    positionOf = v =>
      v.now ? v.now.primaryPosition : v.entry ? rowPositions(v.entry.row)[0] : v.old.positions[0],
    better = (a, b) => !b || a.overall > b.overall || (a.overall === b.overall && a.year > b.year);
  // The name a person's cards carry (as `card` gives it), to tell two ids of one man.
  const fullNameOf = (one, now) =>
    now?.fullName ??
    one.legacy.at(-1)?.row.long_name ??
    fullNameSource(one)?.fullName ??
    nameSource(one)?.fullName ??
    null;
  const candidates = new Map(), // `${era}|${nation}` → [{ one, now, v, rating, line }]
    eraStats = { noNation: 0, noName: 0, otherNations: new Map(), sameName: [] };
  const candidate = (era, nationality, entry) => {
    const key = `${era}|${nationality}`;
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(entry);
  };
  const versionsOf = new Map(); // person → Map(era id → best version in it)
  for (const one of persons.values()) {
    const now = current.get(one.key) ?? null,
      nationality = now ? now.source.nationality : nationOf(one);
    const inEra = new Map();
    for (const v of versions(one)) {
      const era = eraOfYear(v.year);
      if (era && better(v, inEra.get(era.id))) inEra.set(era.id, v);
    }
    if (now) {
      const today = { now, overall: shown(now), year: ERAS.at(-1).to },
        past = inEra.get(ERAS.at(-1).id);
      if (!past || past.overall <= today.overall) inEra.set(ERAS.at(-1).id, today);
    }
    if (!inEra.size) continue;
    if (!nationality) {
      eraStats.noNation++;
      continue;
    }
    if (!nations.has(nationality)) {
      eraStats.otherNations.set(nationality, (eraStats.otherNations.get(nationality) || 0) + 1);
      continue;
    }
    const fullName = fullNameOf(one, now);
    if (!fullName || PLACEHOLDER.test(fullName)) {
      eraStats.noName++;
      continue;
    }
    versionsOf.set(one, inEra);
    for (const [era, v] of inEra)
      candidate(era, nationality, {
        one,
        now,
        v,
        rating: v.overall,
        line: lineOf(positionOf(v)),
        name: words(fullName),
      });
  }
  // Catalog players the past sources do not know (new in FC 27): today's card only.
  for (const now of catalog.players)
    if (!persons.has(String(now.sourcePlayerId)))
      candidate(ERAS.at(-1).id, now.source.nationality, {
        one: null,
        now,
        v: { now, overall: shown(now), year: ERAS.at(-1).to },
        rating: shown(now),
        line: lineOf(now.primaryPosition),
        name: words(now.fullName),
      });
  const idOf = c => Number(c.now ? c.now.sourcePlayerId : c.one.key),
    byRating = (a, b) => b.rating - a.rating || b.v.year - a.v.year || idOf(a) - idOf(b);
  // Who must be in his nation's pool of an era: the World Cup starters of the reviewed list
  // (data/world-cup-starters.json) and the players with a breakout-lag correction, in the era
  // of the corrected card. Each must be a candidate there (EA's id, a word of the name).
  const eraOfEdition = edition => eraOfYear(handYear(Number(edition)))?.id,
    mustBeIn = new Map(), // `${era}|${nation}` → Map(id → entry)
    must = (era, nation, id, entry) => {
      const key = `${era}|${nation}`;
      if (!mustBeIn.has(key)) mustBeIn.set(key, new Map());
      mustBeIn.get(key).set(Number(id), entry);
    };
  for (const entry of marks.starters?.players ?? [])
    must(entry.era, entry.nation, entry.sofifaId, entry);
  for (const fix of PLAYER_JUDGEMENT)
    if (fix.kind === 'breakout') {
      const one = persons.get(String(fix.id)),
        nation = current.get(one.key)?.source.nationality ?? nationOf(one);
      for (const edition of Object.keys(fix.cards))
        must(eraOfEdition(edition), nation, fix.id, { name: fix.name, breakout: true });
    }
  const finals = new Map(
    Object.entries(marks.worldCups?.finals ?? {}).map(([era, list]) => {
      const expected = Number(era) >= 2026 ? 48 : 32;
      if (list.length !== expected || new Set(list).size !== expected)
        throw Error(`World Cup ${era}: ${list.length} nations, ${expected} expected`);
      for (const name of list)
        if (!nations.has(name)) throw Error(`World Cup ${era}: "${name}" is not a catalog nation`);
      return [Number(era), new Set(list)];
    }),
  );
  const identified = c => !!c.now || Number(c.one.key) < LOCAL_PERSON || c.v.hand != null;
  const dump = {};
  const squads = [], // { era, nation, members, strength, always }
    placed = []; // who the starter rule put in, and for whom
  for (const [key, list] of candidates) {
    const [era, nation] = [Number(key.slice(0, 4)), key.slice(5)];
    list.sort(byRating);
    // One man once: of two candidates of one name the lower-rated goes (two EA ids of a man).
    const names = new Map(),
      unique = [];
    for (const c of list) {
      // (A surname alone, as the early titles have it, is not one man's name.)
      const first = c.name.includes(' ') ? names.get(c.name) : null;
      if (first)
        eraStats.sameName.push(`${era} ${nation}: ${c.name} (ids ${idOf(first)}, ${idOf(c)})`);
      else {
        names.set(c.name, c);
        unique.push(c);
      }
    }
    const wanted = mustBeIn.get(key) ?? new Map();
    for (const [id, entry] of wanted) {
      const c = unique.find(x => idOf(x) === id);
      if (!c) throw Error(`${entry.name} (${id}) has no card for ${nation} in ${era}`);
      if (!entry.breakout && !c.name.includes(words(entry.sourceName)))
        throw Error(`Starter ${entry.name}: the data calls ${id} "${c.name}"`);
    }
    let swaps = []; // the starter rule in this pool: { c: who came in, out: who made way }
    const squad = from => {
      swaps = [];
      const chosen = new Set(),
        take = (line, count) => {
          for (const c of from) {
            if (count <= 0) break;
            if (c.line === line && !chosen.has(c)) {
              chosen.add(c);
              count--;
            }
          }
        };
      take('GK', ERA_KEEPERS);
      for (const [line, count] of Object.entries(ERA_LINES)) take(line, count);
      for (const c of from) {
        if (chosen.size >= ERA_SQUAD) break;
        if (c.line !== 'GK') chosen.add(c);
      }
      // A starter who is not among them takes the place of the lowest-rated player — a keeper
      // a keeper's, an outfielder the lowest-rated outfielder's whose line can spare him (the
      // line minimums hold) — who is not a starter himself.
      for (const c of from) {
        if (!wanted.has(idOf(c)) || chosen.has(c)) continue;
        const size = line => [...chosen].filter(x => x.line === line).length,
          spare = x =>
            x.line === c.line ||
            (c.line !== 'GK' && x.line !== 'GK' && size(x.line) > ERA_LINES[x.line]),
          out = [...chosen].sort(byRating).findLast(x => !wanted.has(idOf(x)) && spare(x));
        if (out && chosen.size >= ERA_SQUAD) chosen.delete(out);
        chosen.add(c);
        swaps.push({ c, out: out && !chosen.has(out) ? out : null });
      }
      return [...chosen].sort(byRating);
    };
    let members = squad(unique);
    // (For the reviewed lists: every candidate of every pool, when asked.)
    if (process.env.ERA_CANDIDATES)
      dump[key] = unique.map(c => [idOf(c), c.name, c.rating, c.line, members.includes(c) ? 1 : 0]);
    const count = line => members.filter(c => c.line === line).length,
      fields =
        members.length >= ERA_SPIN.players &&
        count('DEF') >= ERA_SPIN.DEF &&
        // (A forward beyond the first four can play wide in midfield: Japan's 2002 pool has
        // four midfielders and ten forwards and wingers.)
        count('MID') + Math.max(0, count('ATT') - ERA_LINES.ATT) >= ERA_SPIN.MID &&
        count('ATT') >= ERA_SPIN.ATT,
      share = ERA_IDENTIFIED[era] ?? 0,
      known = members.filter(identified).length >= share * members.length;
    // Always in: a World Cup side of that era, a nation with a star. Where the data cannot
    // say who most of a squad are (France 98), such a pool keeps the players it can identify.
    const finalist = finals.get(era)?.has(nation) ?? false;
    let always = finalist || members.some(c => c.rating >= ERA_STAR);
    if (always && !known) {
      members = squad(unique.filter(identified));
      always = members.length > 0 && (finalist || members.some(c => c.rating >= ERA_STAR));
    }
    for (const { c, out } of swaps)
      placed.push(
        `${era} ${nation}: ${c.name} ${c.rating} for ${out ? `${out.name} ${out.rating}` : 'nobody'}`,
      );
    if (!always && !(fields && known)) continue;
    squads.push({
      era,
      nation,
      members,
      swaps,
      always,
      full: fields,
      keeper: members.find(c => c.line === 'GK'),
      outfield: members.filter(c => c.line !== 'GK').slice(0, 10),
    });
  }
  if (process.env.ERA_CANDIDATES) writeFileSync(process.env.ERA_CANDIDATES, JSON.stringify(dump));
  // Strength = the mean overall of the pool's best XI: its best keeper and ten best
  // outfielders. A pool without a keeper is rated with the weakest first-choice keeper any
  // full pool of that era has (`keeperLevel`): the least a drafted keeper would be. A place
  // the pool cannot fill counts ERA_FILL.
  const keeperLevels = new Map();
  for (const era of ERAS) {
    const firsts = squads
      .filter(sq => sq.era === era.id && sq.keeper && sq.full)
      .map(sq => sq.keeper.rating);
    if (!firsts.length) throw Error(`${era.label}: no pool has a goalkeeper`);
    keeperLevels.set(era.id, Math.min(...firsts));
  }
  for (const sq of squads) {
    const sum =
      (sq.keeper ? sq.keeper.rating : keeperLevels.get(sq.era)) +
      sq.outfield.reduce((total, c) => total + c.rating, 0) +
      ERA_FILL * (10 - sq.outfield.length);
    sq.strength = Math.round((sum / 11) * 10) / 10;
  }
  const eraCards = new Map(), // profileId → runtime card
    cardOf = new Map(); // candidate version → profileId (a card's, or the catalog player's)
  const archived = new Map(); // profileId → runtime card of the archive (in no pool)
  const eraCard = (one, v, now, nationality, into = eraCards) => {
    if (v.now) return v.now.profileId;
    if (cardOf.has(v)) return cardOf.get(v);
    const p = card(one, v, 'era', false),
      team = v.entry ? teams.get(String(v.entry.row.club_team_id)) : clubOf(v.old),
      player = runtimePlayer(p, {
        ...(now ? { name: now.name, fullName: now.fullName, eraOf: now.profileId } : {}),
        year: v.year,
        source: { clubId: team ? team.id : null, nationality },
      });
    into.set(player.profileId, player);
    cardOf.set(v, player.profileId);
    return player.profileId;
  };
  const eraPools = [],
    eraSummary = [];
  for (const era of ERAS) {
    const all = squads
        .filter(sq => sq.era === era.id)
        .sort((a, b) => b.strength - a.strength || (a.nation < b.nation ? -1 : 1)),
      // The strongest, and whoever is always in.
      spun = all.filter((sq, i) => i < nationLimit(era.id) || sq.always);
    if (spun.length < ERA_MINIMUM)
      throw Error(
        `${era.label}: only ${spun.length} nations can field a pool (${ERA_MINIMUM} needed)`,
      );
    for (const sq of spun)
      eraPools.push({
        era: era.id,
        nation: sq.nation,
        strength: sq.strength,
        members: sq.members.map(c => eraCard(c.one, c.v, c.now, sq.nation)),
        people: sq.members,
      });
    eraSummary.push({
      era: era.id,
      label: era.label,
      nations: spun.length,
      withoutKeeper: spun.filter(sq => !sq.keeper).map(sq => sq.nation),
      keeperLevel: keeperLevels.get(era.id),
      qualified: all.length,
      left: all.filter(sq => !spun.includes(sq)).map(sq => sq.nation),
      always: spun
        .filter((sq, i) => all.indexOf(sq) >= nationLimit(era.id) || !sq.full)
        .map(sq => `${sq.nation} (${sq.members.length})`),
    });
  }
  // The Prime: everyone in a pool has his best version of all titles in the file, also when
  // it is in no pool (his nation cannot be spun in that era, or he is not among its 26 then).
  let bestOnly = 0;
  for (const pool of eraPools)
    for (const c of pool.people) {
      if (!c.one) continue;
      let best = null;
      for (const v of versionsOf.get(c.one).values()) if (better(v, best)) best = v;
      if (best.now || cardOf.has(best) || best.overall <= c.rating) continue;
      eraCard(c.one, best, c.now, pool.nation);
      bestOnly++;
    }
  // The players a World Cup starter pushed out of a pool stay in the data: each keeps his era
  // card in the file — in no pool, so never offered in a draft and on no screen (like the
  // best versions above; it is one of his versions for the Prime) — and the build's
  // provenance says who took his place.
  const displaced = [];
  for (const era of ERAS)
    for (const pool of eraPools.filter(x => x.era === era.id)) {
      const sq = squads.find(x => x.era === pool.era && x.nation === pool.nation);
      for (const { c, out } of sq.swaps) {
        if (!out || sq.members.includes(out)) continue;
        displaced.push({
          era: pool.era,
          nation: pool.nation,
          name: out.name,
          rating: out.rating,
          profileId: eraCard(out.one, out.v, out.now, pool.nation),
          by: c.name,
          byRating: c.rating,
          byProfileId: eraCard(c.one, c.v, c.now, pool.nation),
        });
      }
    }
  // Everyone who shows ERA_KEPT or more in an era and has no card in the game's file has it in
  // the archive.
  let keptOnly = 0;
  for (const [one, inEra] of versionsOf) {
    const now = current.get(one.key) ?? null,
      nationality = now ? now.source.nationality : nationOf(one);
    for (const v of inEra.values()) {
      if (v.now || cardOf.has(v) || v.overall < ERA_KEPT) continue;
      eraCard(one, v, now, nationality, archived);
      keptOnly++;
    }
  }
  // GOATs and Captains: reviewed lists of player + era. The card must be there — that man, by
  // EA's id, name and nation, in his nation's pool of that era — or the build fails. Every
  // entry is checked, also the Captains behind the list's `size` cut (so the cut can be moved
  // without a surprise); only the first `size` are marked.
  const marked = { goat: [], captain: [] };
  const mark = (list, flag, size = Infinity) => {
    const out = new Set();
    for (const [i, entry] of (list?.players ?? []).entries()) {
      const names = new Set(),
        on = i < size,
        id = Number(entry.sofifaId);
      if (out.has(id)) throw Error(`${flag} ${entry.name} (${id}) is listed twice`);
      if (!entry.eras?.length || new Set(entry.eras).size !== entry.eras.length)
        throw Error(`${flag} ${entry.name}: eras ${JSON.stringify(entry.eras)}`);
      for (const era of entry.eras) {
        const pool = eraPools.find(x => x.era === era && x.nation === entry.nation),
          at = pool ? pool.people.findIndex(c => idOf(c) === id) : -1;
        if (at < 0)
          throw Error(`${flag} ${entry.name} (${id}): no card in ${entry.nation}'s pool of ${era}`);
        const c = pool.people[at],
          own = eraCards.get(pool.members[at]);
        if (own) {
          if (on) own[flag] = true;
          names.add(own.name);
        } else {
          // Today's catalog player as he is: a Captain there by the catalog's own flag (the
          // catalog compiler reads the same list); the catalog has no GOAT flag.
          if (flag !== 'captain' || !!c.now.captain !== on)
            throw Error(`${flag} ${entry.name}: his ${era} card is the catalog player`);
          names.add(c.now.name);
        }
        if (on) marked[flag].push(`${era} ${entry.nation}: ${entry.name}`);
      }
      if (!names.has(entry.sourceName))
        throw Error(
          `${flag} ${entry.name}: the data calls ${id} "${[...names].join('" / "')}", not "${entry.sourceName}"`,
        );
      out.add(id);
    }
    return out;
  };
  const goatIds = mark(marks.goats, 'goat'),
    captainIds = mark(marks.captains, 'captain', marks.captains?.size);
  for (const person of goatIds)
    if (captainIds.has(person))
      throw Error(`EA id ${person} is a GOAT and a Captain: one list only`);
  const sourceId = p => Number(p.profileId.split(':')[1]),
    eraOrder = new Map(ERAS.map((e, i) => [e.id, i])),
    inOrder = list =>
      [...list].sort(
        (a, b) =>
          eraOrder.get(eraOfYear(a.year).id) - eraOrder.get(eraOfYear(b.year).id) ||
          (a.source.nationality < b.source.nationality
            ? -1
            : a.source.nationality > b.source.nationality
              ? 1
              : 0) ||
          shown(b) - shown(a) ||
          sourceId(a) - sourceId(b) ||
          a.edition - b.edition,
      ),
    cardList = inOrder(eraCards.values());
  const eras = {
    eras: ERAS.map(({ id: eraId, label, short, from, to }) => ({
      id: eraId,
      label,
      short,
      from,
      to,
      keeperLevel: keeperLevels.get(eraId),
    })),
    cards: cardList,
    archive: inOrder(archived.values()),
    pools: eraPools.map(({ era, nation, strength, members }) => ({
      era,
      nation,
      strength,
      members,
    })),
    summary: eraSummary,
    stats: {
      cards: cardList.length,
      goats: marked.goat,
      captains: marked.captain,
      starters: placed,
      displaced,
      handCards: handMade,
      bestOnly,
      keptOnly,
      noNation: eraStats.noNation,
      noName: eraStats.noName,
      otherNations: Object.fromEntries([...eraStats.otherNations].sort()),
      sameName: eraStats.sameName,
    },
  };
  // Per title, before and after the judgement: its best cards and the level of its top.
  const judgement = {},
    careers = {};
  // The single players' corrections must meet the data: the man, and every card named.
  for (const fix of PLAYER_JUDGEMENT) {
    const one = persons.get(String(fix.id)),
      name =
        one &&
        (current.get(one.key)?.name ?? one.legacy.at(-1)?.row.short_name ?? nameSource(one)?.name);
    if (!name || !words(name).includes(words(fix.name)))
      throw Error(`PLAYER_JUDGEMENT: id ${fix.id} is ${name ?? 'nobody'}, not ${fix.name}`);
    const list = versions(one);
    for (const edition of Object.keys(fix.cards))
      if (!fixed.has(`${one.key}:${edition}`))
        throw Error(`PLAYER_JUDGEMENT: ${fix.name} has no card in title ${edition}`);
    careers[fix.name] = list
      .map(
        v =>
          `’${String(v.year % 100).padStart(2, '0')} ${v.before === v.overall ? v.overall : `${v.before}→${v.overall}`}`,
      )
      .join(', ');
  }
  for (const id of (process.env.WATCH_IDS || '').split(',').filter(Boolean)) {
    const one = persons.get(id);
    if (one)
      careers[`watch ${id} ${nameSource(one)?.name ?? one.legacy.at(-1)?.row.short_name}`] =
        versions(one)
          .map(
            v =>
              `’${String(v.year % 100).padStart(2, '0')} ${v.before === v.overall ? v.overall : `${v.before}→${v.overall}`}`,
          )
          .join(', ');
  }
  {
    const byTitle = new Map();
    for (const one of persons.values()) {
      const now = current.get(one.key);
      for (const v of versions(one)) {
        if (!byTitle.has(v.edition)) byTitle.set(v.edition, []);
        byTitle.get(v.edition).push({ one, now, v });
      }
    }
    const label = edition =>
      edition >= 90 ? `FIFA ${edition}` : titleName(String(edition).padStart(2, '0'));
    const titleOrder = edition => (edition >= 90 ? edition - 100 : edition);
    for (const [edition, list] of [...byTitle].sort(
      (a, b) => titleOrder(a[0]) - titleOrder(b[0]),
    )) {
      const mean = (key, n) => {
        const best = list
          .map(x => x.v[key])
          .sort((a, b) => b - a)
          .slice(0, n);
        return Math.round((best.reduce((sum, x) => sum + x, 0) / best.length) * 10) / 10;
      };
      const name = ({ one, now }) =>
        now?.name ??
        one.legacy.findLast(e => e.row.fifa_version !== '25')?.row.short_name ??
        nameSource(one)?.name ??
        one.old.at(-1)?.name ??
        one.legacy.at(-1)?.row.short_name;
      judgement[label(edition)] = {
        rule: TITLE_JUDGEMENT[edition] ?? null,
        level: Math.round(levels.get(edition) * 10) / 10,
        before: {
          top10: mean('before', 10),
          top50: mean('before', 50),
          top200: mean('before', 200),
        },
        after: {
          top10: mean('overall', 10),
          top50: mean('overall', 50),
          top200: mean('overall', 200),
        },
        top: [...list]
          .sort(
            (a, b) =>
              b.v.overall - a.v.overall ||
              b.v.before - a.v.before ||
              Number(a.one.key) - Number(b.one.key),
          )
          .slice(0, 30)
          .map(x => ({
            name: name(x),
            position: x.v.entry ? rowPositions(x.v.entry.row)[0] : x.v.old.positions[0],
            before: x.v.before,
            after: x.v.overall,
          })),
      };
    }
  }
  const { yardstick, links, pool } = calibration;
  return {
    legends,
    primes,
    eras,
    stats,
    calibration: {
      yardstick,
      links,
      pool,
      poolYears: POOL_YEARS,
      judgement,
      players: PLAYER_JUDGEMENT,
      nations: NATION_JUDGEMENT,
      careers,
      lift: {
        baseline: Math.round(baseline * 100) / 100,
        top: LIFT_TOP,
        from: LIFT_FROM,
        titles: Object.fromEntries(
          [...lifts].map(([edition, l]) => [
            edition >= 90 ? `FIFA ${edition}` : titleName(String(edition).padStart(2, '0')),
            l.lift,
          ]),
        ),
      },
    },
    notes,
  };
}
