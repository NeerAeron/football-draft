// Who is missing? The stars of each World Cup cycle (a reviewed list of about fifty names per
// era, by nation) checked against the era pools (app/data/eras.v1.json): which have no card in
// their nation's pool of that era, and what the data says about them (a card in another era,
// a nation that cannot be spun then). A judgement aid, not a test: the lists are one
// follower's memory of who mattered.
//   node tools/research/era-names.mjs
import { readFile } from 'node:fs/promises';
import { loadRuntimeCatalog } from '../../scripts/data/catalog-file.mjs';
import { PATHS } from '../../scripts/data/paths.mjs';
import { decodeEras } from '../../app/core/players/eras-codec.js';
import { attachEras, eraList, eraPool } from '../../app/core/players/eras.js';
import { overallRating } from '../../app/core/players/ratings.js';
import { foldDiacritics } from '../../app/core/util/text.js';

// era → nation → names (a name is looked for as whole words in the card's name or full name).
const STARS = {
  1998: {
    Brazil:
      'Ronaldo, Rivaldo, Roberto Carlos, Cafu, Dunga, Taffarel, Bebeto, Romario, Leonardo, Aldair',
    France:
      'Zidane, Deschamps, Desailly, Blanc, Thuram, Lizarazu, Barthez, Djorkaeff, Petit, Henry',
    Netherlands: 'Bergkamp, Kluivert, Davids, de Boer, Overmars, Seedorf, van der Sar, Cocu',
    Croatia: 'Suker, Boban, Prosinecki',
    Argentina: 'Batistuta, Ortega, Simeone, Veron, Crespo, Zanetti, Redondo',
    Italy: 'Maldini, Baggio, Del Piero, Vieri, Cannavaro, Nesta, Inzaghi, Zola',
    Germany: 'Klinsmann, Matthaus, Bierhoff, Kahn, Sammer, Moller',
    England: 'Shearer, Owen, Beckham, Seaman, Adams, Ince, Scholes',
    Spain: 'Raul, Hierro, Luis Enrique, Guardiola',
    Denmark: 'Laudrup, Schmeichel',
    Portugal: 'Figo, Rui Costa',
    Romania: 'Hagi',
    Nigeria: 'Okocha, Kanu',
    Liberia: 'Weah',
    Paraguay: 'Chilavert',
    Chile: 'Salas, Zamorano',
    Bulgaria: 'Stoichkov',
    Finland: 'Litmanen',
    Serbia: 'Mijatovic, Stojkovic',
    Czechia: 'Nedved',
    Wales: 'Giggs',
    'Republic of Ireland': 'Keane',
    Japan: 'Nakata',
    Mexico: 'Blanco, Hernandez',
    Colombia: 'Valderrama',
  },
  2002: {
    Brazil: 'Ronaldo, Rivaldo, Ronaldinho, Roberto Carlos, Cafu',
    France: 'Zidane, Henry, Vieira, Trezeguet, Desailly, Thuram, Barthez, Pires',
    Portugal: 'Figo, Rui Costa',
    Spain: 'Raul, Hierro, Casillas, Mendieta, Luis Enrique',
    England: 'Beckham, Owen, Scholes, Gerrard, Ferdinand, Seaman',
    Germany: 'Kahn, Ballack, Klose',
    Italy: 'Totti, Del Piero, Maldini, Nesta, Buffon, Vieri, Cannavaro',
    Argentina: 'Batistuta, Crespo, Veron, Zanetti, Aimar, Ortega',
    Czechia: 'Nedved',
    Ukraine: 'Shevchenko',
    Netherlands: 'van Nistelrooy, Kluivert, Davids, Seedorf, Stam, van der Sar',
    'Republic of Ireland': 'Keane',
    Wales: 'Giggs',
    Sweden: 'Larsson, Ljungberg',
    Türkiye: 'Rustu, Sukur, Hasan Sas',
    'Korea Republic': 'Park Ji Sung, Ahn',
    Japan: 'Nakata',
    Senegal: 'Diouf',
    Cameroon: "Eto'o, Mboma",
    Nigeria: 'Okocha, Kanu',
    Denmark: 'Schmeichel, Tomasson',
    Uruguay: 'Recoba',
    Finland: 'Litmanen, Hyypia',
    Croatia: 'Suker, Boban',
    Paraguay: 'Chilavert',
  },
  2006: {
    Brazil: 'Ronaldinho, Kaka, Ronaldo, Adriano, Roberto Carlos, Cafu, Lucio, Dida, Juninho',
    France: 'Zidane, Henry, Vieira, Makelele, Thuram, Ribery, Trezeguet',
    Italy: 'Cannavaro, Buffon, Pirlo, Totti, Gattuso, Nesta, Del Piero, Zambrotta, Toni',
    Germany: 'Ballack, Klose, Lahm, Podolski, Schweinsteiger, Kahn, Lehmann',
    Argentina: 'Riquelme, Messi, Tevez, Crespo, Ayala, Zanetti, Mascherano',
    Portugal: 'Cristiano Ronaldo, Figo, Deco, Carvalho',
    England: 'Gerrard, Lampard, Rooney, Terry, Ferdinand, Beckham, Owen',
    Ukraine: 'Shevchenko',
    Czechia: 'Nedved, Cech, Rosicky',
    Cameroon: "Eto'o",
    "Côte d'Ivoire": 'Drogba',
    Ghana: 'Essien',
    Spain: 'Xavi, Puyol, Casillas, Torres, Raul',
    Netherlands: 'van Nistelrooy, Robben, van der Sar, van Persie',
    Sweden: 'Ibrahimovic, Larsson, Ljungberg',
    Mexico: 'Marquez',
    Australia: 'Cahill, Kewell',
    'Korea Republic': 'Park Ji Sung',
    Japan: 'Nakamura',
    Togo: 'Adebayor',
  },
  2010: {
    Argentina: 'Messi, Tevez, Higuain, Milito, Mascherano, Aguero',
    Portugal: 'Cristiano Ronaldo, Deco, Carvalho',
    Spain: 'Xavi, Iniesta, Villa, Torres, Casillas, Puyol, Ramos, Alonso, Pique, Busquets',
    Brazil: 'Kaka, Maicon, Lucio, Julio Cesar, Robinho, Fabiano',
    Netherlands: 'Sneijder, Robben, van Persie, van Bommel',
    Uruguay: 'Forlan, Suarez, Cavani',
    England: 'Rooney, Gerrard, Lampard, Terry, Ferdinand',
    "Côte d'Ivoire": 'Drogba, Toure',
    Cameroon: "Eto'o",
    Ghana: 'Essien',
    France: 'Ribery, Henry, Evra',
    Germany: 'Muller, Schweinsteiger, Lahm, Ozil, Klose, Podolski',
    Italy: 'Buffon, Pirlo, Cannavaro, De Rossi',
    Sweden: 'Ibrahimovic',
    Serbia: 'Vidic',
    Czechia: 'Cech',
    Bulgaria: 'Berbatov',
    Croatia: 'Modric',
    'Korea Republic': 'Park Ji Sung',
    Japan: 'Honda',
    'United States': 'Donovan, Dempsey',
    Mexico: 'Marquez',
    Slovakia: 'Hamsik',
    Wales: 'Bale, Giggs',
  },
  2014: {
    Argentina: 'Messi, Aguero, Di Maria, Mascherano, Higuain',
    Portugal: 'Cristiano Ronaldo, Pepe',
    Brazil: 'Neymar, Thiago Silva, Marcelo, David Luiz, Oscar',
    Uruguay: 'Suarez, Cavani, Godin',
    Netherlands: 'Robben, van Persie, Sneijder',
    Germany: 'Muller, Neuer, Lahm, Schweinsteiger, Kroos, Ozil, Gotze, Reus, Hummels, Klose',
    Spain: 'Xavi, Iniesta, Ramos, Casillas, Busquets, Alonso, Diego Costa, Silva',
    France: 'Ribery, Benzema, Pogba, Lloris',
    Belgium: 'Hazard, Kompany, Courtois',
    Sweden: 'Ibrahimovic',
    Colombia: 'Falcao, James',
    Italy: 'Pirlo, Buffon, Chiellini, Balotelli',
    England: 'Rooney, Gerrard, Hart',
    Wales: 'Bale',
    Croatia: 'Modric, Rakitic',
    "Côte d'Ivoire": 'Toure, Drogba',
    Chile: 'Vidal, Sanchez',
    Poland: 'Lewandowski',
    'Costa Rica': 'Navas',
    Mexico: 'Ochoa',
    Algeria: 'Brahimi',
    'United States': 'Howard, Dempsey',
  },
  2018: {
    Argentina: 'Messi, Aguero, Dybala, Di Maria',
    Portugal: 'Cristiano Ronaldo, Pepe, Bernardo Silva',
    Brazil: 'Neymar, Marcelo, Casemiro, Coutinho, Alisson, Thiago Silva',
    France: 'Mbappe, Griezmann, Pogba, Kante, Varane, Lloris',
    Croatia: 'Modric, Rakitic, Perisic, Mandzukic',
    Belgium: 'Hazard, De Bruyne, Lukaku, Courtois',
    England: 'Kane, Sterling',
    Uruguay: 'Suarez, Cavani, Godin',
    Germany: 'Kroos, Neuer, Muller, Hummels, Boateng',
    Spain: 'Ramos, Iniesta, Busquets, Isco, De Gea, Pique',
    Poland: 'Lewandowski',
    Egypt: 'Salah',
    Senegal: 'Mane, Koulibaly',
    Wales: 'Bale',
    Italy: 'Buffon, Chiellini, Bonucci',
    Gabon: 'Aubameyang',
    'Korea Republic': 'Son',
    Colombia: 'James, Falcao',
    Slovenia: 'Oblak',
    Denmark: 'Eriksen',
    Sweden: 'Ibrahimovic',
    Mexico: 'Ochoa',
    'Costa Rica': 'Navas',
    Netherlands: 'van Dijk, Robben',
    Algeria: 'Mahrez',
  },
  2022: {
    Argentina: 'Messi, Lautaro Martinez, Di Maria, Emiliano Martinez, De Paul',
    France: 'Mbappe, Benzema, Griezmann, Kante, Lloris, Varane',
    Portugal: 'Cristiano Ronaldo, Bruno Fernandes, Bernardo Silva, Ruben Dias, Cancelo',
    Brazil: 'Neymar, Vinicius, Casemiro, Thiago Silva, Marquinhos, Alisson',
    Poland: 'Lewandowski',
    Belgium: 'De Bruyne, Courtois, Lukaku',
    Egypt: 'Salah',
    Senegal: 'Mane, Koulibaly',
    Netherlands: 'van Dijk, De Jong',
    England: 'Kane, Foden, Saka, Bellingham, Sterling',
    'Korea Republic': 'Son',
    Norway: 'Haaland, Odegaard',
    Croatia: 'Modric, Gvardiol',
    Germany: 'Kroos, Neuer, Kimmich, Musiala',
    Spain: 'Pedri, Gavi, Rodri, Busquets',
    Morocco: 'Hakimi, Ziyech, Bounou',
    Slovenia: 'Oblak',
    Italy: 'Donnarumma, Verratti, Chiesa, Jorginho',
    Algeria: 'Mahrez',
    Nigeria: 'Osimhen',
    Canada: 'Davies',
    'United States': 'Pulisic',
    Uruguay: 'Valverde, Suarez',
    Japan: 'Mitoma',
  },
  2026: {
    France: 'Mbappe, Dembele, Olise, Saliba',
    Norway: 'Haaland, Odegaard',
    England: 'Bellingham, Kane, Saka, Foden, Rice, Palmer',
    Brazil: 'Vinicius, Raphinha, Rodrygo, Alisson, Neymar, Marquinhos',
    Spain: 'Rodri, Yamal, Pedri, Nico Williams',
    Argentina: 'Messi, Lautaro Martinez, Alvarez, Emiliano Martinez, Mac Allister',
    Portugal: 'Cristiano Ronaldo, Bruno Fernandes, Bernardo Silva, Ruben Dias, Vitinha',
    Egypt: 'Salah',
    Belgium: 'De Bruyne, Courtois',
    Netherlands: 'van Dijk, De Jong',
    Germany: 'Musiala, Wirtz, Kimmich',
    Uruguay: 'Valverde',
    Italy: 'Donnarumma, Barella',
    Morocco: 'Hakimi',
    'Korea Republic': 'Son, Kim Min Jae',
    Nigeria: 'Osimhen, Lookman',
    Sweden: 'Gyokeres, Isak',
    Croatia: 'Modric, Gvardiol',
    Poland: 'Lewandowski',
    Canada: 'Davies',
    'United States': 'Pulisic',
    Japan: 'Mitoma, Kubo',
    Georgia: 'Kvaratskhelia',
    Senegal: 'Mane',
  },
};

const key = text =>
    ` ${foldDiacritics(
      String(text).replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[đĐ]/g, 'd'),
    )
      .toLowerCase()
      .replace(/[^a-z]+/g, ' ')
      .trim()} `,
  // Every word of the name, in any order ("Park Ji Sung" is "J. Sung Park / Ji Sung Park").
  is = (p, name) => {
    const have = key(`${p.name} ${p.fullName}`);
    return key(name)
      .trim()
      .split(' ')
      .every(word => have.includes(` ${word} `));
  },
  shown = p => overallRating(p, true, p.primaryPosition),
  catalog = attachEras(
    await loadRuntimeCatalog(),
    decodeEras(JSON.parse(await readFile(PATHS.eras, 'utf8'))),
  ),
  cardsOf = name => {
    const out = [];
    for (const p of catalog.eras.byId.values()) if (is(p, name)) out.push(p);
    return out;
  };

for (const era of eraList(catalog)) {
  const missing = [];
  let asked = 0;
  for (const [nation, names] of Object.entries(STARS[era.id])) {
    const pool = eraPool(catalog, era.id, nation),
      spinnable = era.nations.some(n => n.name === nation);
    for (const name of names.split(', ')) {
      asked++;
      if (pool.some(p => is(p, name))) continue;
      const others = cardsOf(name).filter(p => p.source.nationality === nation);
      missing.push(
        `${name} (${nation}): ${
          !spinnable
            ? `${nation} cannot be spun in this era`
            : others.length
              ? `not in the pool; has cards ${others.map(p => `’${String(p.year % 100).padStart(2, '0')} ${shown(p)}`).join(', ')}`
              : 'no card in any era'
        }`,
      );
    }
  }
  console.log(`${era.label}: ${asked - missing.length} of ${asked} names have a card`);
  for (const line of missing) console.log(`  - ${line}`);
}
