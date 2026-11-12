"""FIFA 98–14 workbook -> data/legacy-titles.json (the pinned build input of the old legends).

The workbook ("FIFA 98-14 top 1,000", 17 sheets of 1,000 players each, extracted from the
games' own PC databases; soccergaming.com archive) is not in the repository. This script copies
the columns the compiler reads -- names, teams, nationality, positions, date of birth, foot and
every playing skill -- exactly as they are in the sheets (no value is changed, scaled or
decoded here: scripts/data/legacy-titles.mjs does all the interpretation) and records where they
came from: the workbook's SHA-256, each title's source file, ranking basis and skill scale, and
the ReadMe sheet's source links. `npm run data:build` then needs neither Python nor the workbook.

    python3 -I tools/research/legacy-titles.py <legends-98-14.xlsx> data/legacy-titles.json

Needs openpyxl (3.1). The workbook is data from outside: keep it in a folder of its own, run
with -I, and nothing in it is executed (it is opened read-only, values only). The output is
deterministic: the same workbook gives the same bytes. After a new export, pin the output's
SHA-256 in scripts/data/paths.mjs (LEGACY_TITLES) and run `npm run data:build`.
"""
import datetime
import hashlib
import json
import sys

import openpyxl

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

IDENTITY = [
    'playerid', 'name', 'firstname', 'surname', 'pseudonym', 'First_Name', 'Last_Name',
    'full_name', 'teams', 'team_ids', 'nationality_name', 'nationality', 'nationality_code',
    'Nationality', 'ranking_position', 'position_code', 'alternate_position_code',
    'PreferredPos', 'preferredposition1', 'preferredposition2', 'preferredposition3',
    'preferredposition4', 'date_of_birth', 'age', 'Age', 'preferredfoot', 'Foot',
    'right_footed', 'weakfootability', 'weakfootabilitytypecode', 'overallrating',
]
SKILLS = [
    # FIFA 98/99 (editor scales), 2000-02 (1-8), 2003 (0-9)
    'acceleration', 'aggression', 'agility', 'awareness', 'ball_control', 'creativity',
    'fitness', 'heading', 'passing', 'reaction', 'shot_accuracy', 'shot_power', 'speed',
    'tackling', 'shooting', 'strength', 'gk_aggression', 'gk_positioning', 'gk_skills',
    'Ball_Control', 'Fitness', 'Heading', 'Passing', 'Shooting', 'Speed', 'Strength',
    'Tackling', 'x_gskills', 'x_gpositioning', 'x_gagression',
    # FIFA 2004-10
    'anticipation', 'balance', 'ballcontrol', 'crossing', 'determination', 'dribbling',
    'handling', 'jumping', 'longballs', 'marking', 'pace', 'reflexes', 'rushing',
    'shotaccuracy', 'shotpower', 'stamina', 'throwing', 'punching', 'playercomposure',
    'gkpositioning', 'longshotaccuracy', 'finishing', 'freekicks', 'gkdiving', 'longpassing',
    'reactions', 'shortpassing', 'sprintspeed', 'positioning', 'tacticalawareness',
    # FIFA 11-14
    'curve', 'freekickaccuracy', 'gkhandling', 'gkkicking', 'gkoneonone', 'gkreflexes',
    'headingaccuracy', 'longshots', 'penalties', 'slidingtackle', 'standingtackle', 'volleys',
    'vision', 'interceptions',
]
# Named trait flags of FIFA 08-10 that the compiler has a badge for.
FLAGS = [
    'comesforcrosses', 'divesintotackles', 'earlycrosser', 'longshottaker', 'playmaker',
    'rushesoutofgoal', 'technicaldribbler',
]
KEEP = set(IDENTITY + SKILLS + FLAGS)


def cell(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()[:10]
    if isinstance(value, float) and value == int(value):
        return int(value)
    return value


def text(row):
    return [str(c).strip() for c in row if c is not None and str(c).strip()]


def read_me(sheet):
    """The ReadMe's per-title table and its source links."""
    table, links, header, prepared = {}, [], None, None
    for row in sheet.iter_rows(values_only=True):
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
    book = openpyxl.load_workbook(source, read_only=True, data_only=True)
    table, links, prepared = read_me(book['ReadMe'])
    if len(table) != len(TITLES) or not links:
        raise SystemExit('ReadMe sheet: unexpected layout')
    out = [
        '{"format":"football-draft-legacy-titles","version":1,',
        '"source":' + dump({
            'file': source.replace('\\', '/').split('/')[-1],
            'sha256': digest,
            'description': prepared,
            'archive': links[0]['url'],
            'references': links,
            'note': 'Top 1,000 squad players of each title, in the workbook\'s order (its own '
                    'ranking: the stored overall for FIFA 09-14, a position-weighted estimate '
                    'before). Values are the workbook\'s, unchanged.',
        }) + ',',
        '"titles":[',
    ]
    for n, (title, edition) in enumerate(TITLES):
        rows = [[cell(c) for c in row] for row in book[title].iter_rows(values_only=True)]
        header = rows[HEADER_ROW - 1]
        keep = [i for i, name in enumerate(header) if name in KEEP]
        body = [[row[i] for i in keep] for row in rows[HEADER_ROW:] if row[1] is not None]
        if len(body) != 1000 or 'playerid' not in header:
            raise SystemExit(f'{title}: expected 1,000 players under a header in row {HEADER_ROW}')
        info = table[title]
        out.append('{' + ','.join([
            f'"title":{dump(title)}', f'"edition":{edition}', f'"year":{YEAR(edition)}',
            f'"ranking":{dump(info["Ranking basis"])}', f'"scale":{dump(info["Skill scale"])}',
            f'"sourceFile":{dump(info["Selected source file"])}',
            f'"pool":{int(info["Eligible pool"])}',
            f'"columns":{dump([header[i] for i in keep])}', '"rows":[',
        ]))
        out.extend(dump(row) + (',' if i < len(body) - 1 else '') for i, row in enumerate(body))
        out.append(']}' + (',' if n < len(TITLES) - 1 else ''))
    out.append(']}')
    with open(output, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out) + '\n')
    print(json.dumps({'titles': len(TITLES), 'players': 1000 * len(TITLES), 'sha256': digest}))


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
