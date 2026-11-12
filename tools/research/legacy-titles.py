"""FIFA 98–14 workbook -> data/legacy-titles.json (the pinned build input of the older titles).

The workbook ("FIFA 98–14 lean workbook — 10,000 players maximum per title", 17 title sheets
extracted from the games' own PC databases; soccergaming.com archive; Excel binary, .xlsb) is
not in the repository. This script copies the columns the compiler reads -- name, teams and
their ids, nationality, positions, date of birth, foot and the playing skills -- exactly as they
are in the sheets (no skill is changed, scaled or decoded here: scripts/data/legacy-titles.mjs
does all the interpretation) and records where they came from: the workbook's SHA-256, each
title's source file, ranking basis and skill scale, and the ReadMe's source links.
`npm run data:build` then needs neither Python nor the workbook.

Which rows: squad players only (record_status "Assigned to team": the unassigned records of
the career pools are invented players), and of those, per title and nationality, the first
PER_NATION outfielders and PER_NATION_KEEPERS goalkeepers in the workbook's order (its own
ranking) -- what a nation's era pool of 26, a legend or a prime version can use, with room for
the compiler rating them in another order. FIFA 2004 has no nationality column: its rows are
grouped by the nationality the same player id has in FIFA 06, 2005 or 07, and the rest by the
last team named (a national team, where he has one). This grouping only chooses rows.

    python3 -I tools/research/legacy-titles.py <ratings.xlsb> data/legacy-titles.json

Needs pyxlsb (1.0). The workbook is data from outside: keep it in a folder of its own, run with
-I, and nothing in it is executed (cells are read as values). The only conversion: a date of
birth stored as an Excel day number becomes ISO text (dates before 1900 already are). The
output is deterministic: the same workbook gives the same bytes. After a new export, pin the
output's SHA-256 in scripts/data/paths.mjs (LEGACY_TITLES) and run `npm run data:build`.
"""
import datetime
import hashlib
import json
import sys

from pyxlsb import open_workbook

# FIFA 98 came out in 1997: a title's ratings are those of the year before its number (the
# 2007-14 files are the launch databases, 30/31 August).
TITLES = [
    ('FIFA 98', 98), ('FIFA 99', 99), ('FIFA 2000', 0), ('FIFA 2001', 1), ('FIFA 2002', 2),
    ('FIFA 2003', 3), ('FIFA 2004', 4), ('FIFA 2005', 5), ('FIFA 06', 6), ('FIFA 07', 7),
    ('FIFA 08', 8), ('FIFA 09', 9), ('FIFA 10', 10), ('FIFA 11', 11), ('FIFA 12', 12),
    ('FIFA 13', 13), ('FIFA 14', 14),
]
YEAR = lambda edition: (1899 if edition >= 90 else 1999) + edition
HEADER_ROW = 6  # the header is the sixth row of every title sheet
PER_NATION = 36
PER_NATION_KEEPERS = 4
SQUAD = 'Assigned to team'
NATIONALITY = ['nationality_name', 'nationality', 'nationality_code']

IDENTITY = [
    'playerid', 'name', 'teams', 'jersey_numbers', 'nationality_name', 'nationality',
    'nationality_code', 'ranking_position', 'preferredposition2', 'preferredposition3',
    'preferredposition4', 'date_of_birth', 'age', 'Age', 'preferredfoot', 'Foot',
    'weakfootability', 'weakfootabilitytypecode', 'overallrating',
]
SKILLS = [
    # FIFA 98/99 (editor scales), 2000-02 (1-8), 2003 (0-9)
    'acceleration', 'aggression', 'agility', 'awareness', 'ball_control', 'creativity',
    'fitness', 'heading', 'passing', 'reaction', 'shot_accuracy', 'shot_power', 'speed',
    'tackling', 'shooting', 'strength', 'gk_positioning', 'gk_skills',
    'Ball_Control', 'Fitness', 'Heading', 'Passing', 'Shooting', 'Speed', 'Strength',
    'Tackling', 'x_gskills', 'x_gpositioning',
    # FIFA 2004-10
    'anticipation', 'ballcontrol', 'crossing', 'dribbling', 'handling', 'longballs', 'marking',
    'pace', 'reflexes', 'shotaccuracy', 'shotpower', 'stamina', 'playercomposure',
    'gkpositioning', 'longshotaccuracy', 'finishing', 'freekicks', 'gkdiving', 'longpassing',
    'reactions', 'shortpassing', 'sprintspeed', 'positioning',
    # FIFA 11-14
    'curve', 'gkhandling', 'gkkicking', 'gkreflexes', 'headingaccuracy', 'longshots',
    'penalties', 'standingtackle', 'vision',
]
# Named trait flags of FIFA 08-10 that the compiler has a badge for.
FLAGS = [
    'comesforcrosses', 'divesintotackles', 'earlycrosser', 'longshottaker', 'playmaker',
    'rushesoutofgoal', 'technicaldribbler',
]
KEEP = set(IDENTITY + SKILLS + FLAGS)
EXCEL_DAY_ZERO = datetime.date(1899, 12, 30)


def cell(value):
    if isinstance(value, float) and value == int(value):
        return int(value)
    if isinstance(value, str):
        return value.strip()
    return value


def text(row):
    return [str(c).strip() for c in row if c is not None and str(c).strip()]


def sheet_rows(book, name):
    with book.get_sheet(name) as sheet:
        return [[cell(c.v) for c in row] for row in sheet.rows()]


def read_me(rows):
    """The ReadMe's per-title table and its source links."""
    table, links, header, prepared = {}, [], None, None
    for row in rows:
        cells = text(row)
        if not cells:
            continue
        if prepared is None and 'Prepared' in cells[0]:
            prepared = cells[0]
        if cells[0] == 'Title':
            header = cells
        elif header and cells[0].startswith('FIFA ') and len(cells) == len(header):
            table[cells[0]] = dict(zip(header, cells))
        elif len(cells) == 1 and ': http' in cells[0]:
            label, url = cells[0].split(': http', 1)
            links.append({'label': label, 'url': 'http' + url})
    return table, links, prepared


def main(source, output):
    with open(source, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    book = open_workbook(source)
    table, links, prepared = read_me(sheet_rows(book, 'ReadMe'))
    if len(table) != len(TITLES) or not links:
        raise SystemExit('ReadMe sheet: unexpected layout')
    sheets = {}
    for title, _ in TITLES:
        rows = sheet_rows(book, title)
        header = rows[HEADER_ROW - 1]
        if 'playerid' not in header or 'record_status' not in header:
            raise SystemExit(f'{title}: no header in row {HEADER_ROW}')
        width = len(header)
        body = [row + [None] * (width - len(row)) for row in rows[HEADER_ROW:]]
        sheets[title] = header, [row for row in body if row[header.index('playerid')] is not None]

    def nationality(title, playerid):
        header, body = sheets[title]
        column = next(header.index(c) for c in NATIONALITY if c in header)
        at = header.index('playerid')
        return {row[at]: row[column] for row in body}.get(playerid)

    lookups = {}

    def group_key(title, header, row):
        for column in NATIONALITY:
            if column in header:
                return row[header.index(column)]
        # FIFA 2004: the nationality of the same id in a neighbouring title, else his last team.
        playerid = row[header.index('playerid')]
        for other in ('FIFA 06', 'FIFA 2005', 'FIFA 07'):
            if other not in lookups:
                h, body = sheets[other]
                column = next(h.index(c) for c in NATIONALITY if c in h)
                at = h.index('playerid')
                lookups[other] = {r[at]: r[column] for r in body}
            found = lookups[other].get(playerid)
            if found is not None:
                return f'{other}:{found}'
        return 'team:' + str(row[header.index('teams')]).split(' / ')[-1]

    out = [
        '{"format":"football-draft-legacy-titles","version":2,',
        '"source":' + dump({
            'file': source.replace('\\', '/').split('/')[-1],
            'sha256': digest,
            'description': prepared,
            'archive': links[0]['url'],
            'references': links,
            'note': f'Squad players ("{SQUAD}") of each title: per nationality the first '
                    f'{PER_NATION} outfielders and {PER_NATION_KEEPERS} goalkeepers in the '
                    'workbook\'s order (its own ranking: the stored overall for FIFA 09-14, a '
                    'position-weighted estimate before). Values are the workbook\'s, unchanged '
                    '(a date of birth stored as an Excel day number is written as ISO text).',
        }) + ',',
        '"titles":[',
    ]
    total = 0
    for n, (title, edition) in enumerate(TITLES):
        header, body = sheets[title]
        keep = [i for i, name in enumerate(header) if name in KEEP]
        status, position = header.index('record_status'), header.index('ranking_position')
        born = header.index('date_of_birth') if 'date_of_birth' in header else None
        squad = [row for row in body if row[status] == SQUAD]
        counts, chosen = {}, []
        for row in squad:
            key = group_key(title, header, row)
            count = counts.setdefault(key, [0, 0])
            keeper = row[position] == 'GK'
            if count[keeper] >= (PER_NATION_KEEPERS if keeper else PER_NATION):
                continue
            count[keeper] += 1
            if born is not None and isinstance(row[born], int):
                row = list(row)
                row[born] = (EXCEL_DAY_ZERO + datetime.timedelta(days=row[born])).isoformat()
            chosen.append([row[i] for i in keep])
        info = table[title]
        total += len(chosen)
        out.append('{' + ','.join([
            f'"title":{dump(title)}', f'"edition":{edition}', f'"year":{YEAR(edition)}',
            f'"ranking":{dump(info["Ranking basis"])}', f'"scale":{dump(info["Skill scale"])}',
            f'"sourceFile":{dump(info["Selected source file"])}',
            f'"pool":{len(squad)}',
            f'"columns":{dump([header[i] for i in keep])}', '"rows":[',
        ]))
        out.extend(dump(row) + (',' if i < len(chosen) - 1 else '')
                   for i, row in enumerate(chosen))
        out.append(']}' + (',' if n < len(TITLES) - 1 else ''))
    out.append(']}')
    with open(output, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out) + '\n')
    print(json.dumps({'titles': len(TITLES), 'players': total, 'sha256': digest}))


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
