"""Gera os cenários de referência (fixtures) para os testes do motor em TypeScript.

Cada fixture guarda os comandos do jogador, as habilidades usadas pelos inimigos e o
HP de todos a cada segundo. O motor reproduz os comandos e precisa chegar aos mesmos números.

Uso: python3 export_fixtures.py ../../packages/combat/fixtures
"""
import json
import os
import sys

from sim import BASE, KITS, ROLE, Mon, Sim


def skill_id(name):
    return name.lower().replace(' ', '-')


def unit(m):
    return dict(monster=m.name.lower(), level=m.level, moves=[skill_id(k) for k in m.kit])


def record(name, team, enemies, **sim_opts):
    sim = Sim(team, enemies, **sim_opts)
    winner, t = sim.run()
    commands = []
    enemy_casts = []
    for e in sim.log:
        if e['side'] == 'p':
            if e['kind'] == 'swap':
                commands.append(dict(t=e['t'], kind='swap', to=e['to']))
            else:
                commands.append(dict(t=e['t'], kind='cast', skill=skill_id(e['skill']), target=e['target']))
        else:
            enemy_casts.append(dict(t=e['t'], enemy=e['mon'], skill=skill_id(e['skill']), target=e['target']))
    return dict(
        name=name,
        player=[unit(m) for m in team],
        enemies=[unit(m) for m in enemies],
        commands=commands,
        enemyCasts=enemy_casts,
        checkpoints=sim.checkpoints,
        result=dict(winner={'jogador': 'player', 'inimigos': 'enemy', 'tempo': 'timeout'}[winner], timeMs=t),
    )


def team(names, level):
    return [Mon(n, level, 'p', ROLE[n]) for n in names]


def wild(names, level):
    return [Mon(n, level, 'e') for n in names]


def build():
    out = []
    mons = list(BASE)
    for level in (5, 30):
        for p in mons:
            for e in mons:
                out.append(record(f'duel-{p.lower()}-vs-{e.lower()}-l{level}', team([p], level), wild([e], level)))
    order = ['Squirtle', 'Bulbasaur', 'Charmander']
    b3 = ['Bulbasaur', 'Charmander', 'Squirtle']
    for avoid in (True, False):
        tag = 'avoid' if avoid else 'attack'
        out.append(record(f'team-vs-3-l30-{tag}', team(order, 30), wild(b3, 30), avoid_wake=avoid))
    six = ['Bulbasaur', 'Bulbasaur', 'Charmander', 'Charmander', 'Squirtle', 'Squirtle']
    for plevel in (30, 35):
        for avoid in (True, False):
            tag = 'avoid' if avoid else 'attack'
            out.append(record(f'team-vs-6-l{plevel}-vs-25-{tag}', team(order, plevel), wild(six, 25), avoid_wake=avoid))
    out.append(record('solo-squirtle-vs-6-l30-vs-25', team(['Squirtle'], 30), wild(six, 25)))
    # Toxic: o Bulbasaur troca o Sleep Powder pelo Toxic (kit alternativo de teste)
    toxic_kit = ['Vine Whip', 'Toxic', 'Acid', 'Poison Powder']
    for foes in (['Squirtle'], b3):
        p = [Mon('Bulbasaur', 30, 'p', ROLE['Bulbasaur'], kit=toxic_kit)]
        out.append(record(f'toxic-bulbasaur-vs-{len(foes)}-l30', p, wild(foes, 30)))
    return out


if __name__ == '__main__':
    dest = sys.argv[1] if len(sys.argv) > 1 else 'fixtures'
    os.makedirs(dest, exist_ok=True)
    for fx in build():
        with open(os.path.join(dest, fx['name'] + '.json'), 'w', encoding='utf-8') as f:
            json.dump(fx, f, separators=(',', ':'))
            f.write('\n')
        r = fx['result']
        print(f"{fx['name']:42s} {r['winner']:8s} {r['timeMs']/1000:6.1f}s  comandos {len(fx['commands'])}")
