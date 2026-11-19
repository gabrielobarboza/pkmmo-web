"""Simulador de combate do SDD 02 (protótipo). Tempo em ms, passo de 100 ms."""
import sys
from math import floor

DT = 100
GCD = 1000       # premissa: 1 s entre habilidades do mesmo monstro
SWAP_CD = 2000
BUFF_DUR = 10000
FLAT = 0          # constante +2 da fórmula original, removida no protótipo (voltar a 2 para restaurá-la)
EGCD = 2000       # intervalo mínimo entre habilidades de um inimigo (só inimigos)

BASE = {
    'Bulbasaur': dict(types=['GRASS', 'POISON'], hp=45, atk=49, df=49, spa=65, spd=65),
    'Charmander': dict(types=['FIRE'], hp=39, atk=52, df=43, spa=60, spd=50),
    'Squirtle': dict(types=['WATER'], hp=44, atk=48, df=65, spa=50, spd=64),
}
ROLE = {'Bulbasaur': 'controller', 'Charmander': 'dps', 'Squirtle': 'tanker'}

CH = {('FIRE', 'GRASS'): 2, ('FIRE', 'WATER'): .5, ('FIRE', 'FIRE'): .5,
      ('WATER', 'FIRE'): 2, ('WATER', 'GRASS'): .5, ('WATER', 'WATER'): .5,
      ('GRASS', 'WATER'): 2, ('GRASS', 'FIRE'): .5, ('GRASS', 'GRASS'): .5, ('GRASS', 'POISON'): .5,
      ('POISON', 'GRASS'): 2, ('POISON', 'POISON'): .5,
      ('ICE', 'GRASS'): 2, ('ICE', 'FIRE'): .5, ('ICE', 'WATER'): .5}

S = {
    'Ember': dict(type='FIRE', cat='special', power=40, cd=4000, status='burn', hit=2),
    'Acid': dict(type='POISON', cat='special', power=40, cd=4000, status='poison', hit=4),
    'Poison Powder': dict(type='POISON', cat='effect', power=0, cd=10000,
                          area=dict(dur=6000, tick=1000, stk=1, status='poison')),
    'Sleep Powder': dict(type='GRASS', cat='effect', power=0, cd=10000,
                         area=dict(dur=5000, tick=1000, stk=1, status='sleep')),
    'Toxic': dict(type='POISON', cat='effect', power=0, cd=16000, status='poison', hit=14, aoe=True,
                  area=dict(dur=6000, tick=1000, stk=1, status='poison')),
    'Icy Wind': dict(type='ICE', cat='special', power=55, cd=12000, status='freeze', hit=4,
                     area=dict(dur=5000, tick=1000, stk=1, status='freeze'), aoe=True),
    'Tackle': dict(type='NORMAL', cat='physical', power=40, cd=2000),
    'Scratch': dict(type='NORMAL', cat='physical', power=40, cd=2000),
    'Vine Whip': dict(type='GRASS', cat='physical', power=45, cd=3000),
    'Water Gun': dict(type='WATER', cat='special', power=45, cd=3000),
    'Growl': dict(type='NORMAL', cat='effect', power=0, cd=8000, debuff='atk', tag='growl'),
    'Tail Whip': dict(type='NORMAL', cat='effect', power=0, cd=8000, debuff='df', tag='tailwhip'),
    'Iron Defense': dict(type='STEEL', cat='effect', power=0, cd=8000, buff='df', tag='irondef'),
}
KITS = {
    'Charmander': ['Ember', 'Scratch', 'Growl', 'Tail Whip'],
    'Bulbasaur': ['Vine Whip', 'Sleep Powder', 'Acid', 'Poison Powder'],
    'Squirtle': ['Water Gun', 'Iron Defense', 'Icy Wind'],   # Taunt fora (sem efeito com 1 jogador)
}
PRI = ['Iron Defense', 'Icy Wind', 'Sleep Powder', 'Toxic', 'Poison Powder', 'Tail Whip', 'Growl',
       'Acid', 'Ember', 'Water Gun', 'Vine Whip', 'Scratch', 'Tackle']
FILLER_FROM = PRI.index('Water Gun')


class Mon:
    def __init__(self, name, level, side, role=None, kit=None):
        b = BASE[name]
        self.name, self.level, self.side, self.role = name, level, side, role
        self.types = b['types']
        self.st = {k: floor(2 * b[k] * level / 100) + 5 for k in ('atk', 'df', 'spa', 'spd')}
        self.max_hp = floor(2 * b['hp'] * level / 100) + level + 10
        if role == 'tanker':
            self.max_hp *= 1.1
            self.st['df'] *= 1.1
            self.st['spd'] *= 1.1
        self.hp = self.max_hp
        self.alive = True
        self.kit = kit or KITS[name]
        self.idx = 0
        self.cd = {}
        self.gcd = 0
        self.stacks = {}
        self.eff = {}
        self.immune_until = 0
        self.mods = []   # (stat, mult, end, tag)

    def mult(self, stat, now):
        m = 1.0
        for st, mu, end, tag in self.mods:
            if st == stat and end > now:
                m *= mu
        return m

    def has_tag(self, tag, now):
        return any(t == tag and end > now for _, _, end, t in self.mods)

    def stunned(self):
        return 'freeze' in self.eff or 'sleep' in self.eff


def calc(att, dfn, sk, now):
    if sk['power'] == 0:
        return 0.0
    if sk['cat'] == 'physical':
        A, D = att.st['atk'], dfn.st['df']
    else:
        A, D = att.st['spa'], dfn.st['spd']
    A *= att.mult('atk', now)
    D *= dfn.mult('df', now)
    v = r = 0
    for t in dfn.types:
        e = CH.get((sk['type'], t), 1.0)
        if e == 0:
            return 0.0
        if e > 1:
            v += 1
        elif e < 1:
            r += 1
    D *= 1 - 0.25 * v + 0.25 * r
    pw = sk['power'] * (1.5 if sk['type'] in att.types else 1)
    d = ((2 * att.level / 5 + 2) * pw * (A / D)) / 50 + FLAT
    if 'burn' in att.eff:
        d *= 0.9
    p = min(1, max(0, 0.15 + 0.10 * (v - r) + (0.10 if att.role == 'attacker' else 0)))
    d *= 1 + 0.5 * p       # crítico: valor esperado (+50% de dano)
    return d


class Sim:
    def __init__(self, team, enemies, avoid_wake=True, swap_while_stunned=False):
        self.team, self.enemies = team, enemies
        for i, m in enumerate(team):
            m.idx = i
        for i, m in enumerate(enemies):
            m.idx = i
        self.log = []
        self.checkpoints = []
        # buffs são do jogador (SDD 02): a lista de modificadores é compartilhada entre os monstros do time
        shared = []
        for m in team:
            m.mods = shared
        self.active = 0
        self.swap_ready = 0
        self.areas = []
        self.avoid_wake = avoid_wake
        self.swap_while_stunned = swap_while_stunned
        self.now = 0
        self.cnt = {}
        self.dot_dmg = {'p': 0.0, 'e': 0.0}
        self.dir_dmg = {'p': 0, 'e': 0}
        self.first = {}

    def bump(self, k):
        self.cnt[k] = self.cnt.get(k, 0) + 1
        self.first.setdefault(k, self.now)

    # ---------- status ----------
    def remove_eff(self, t, st):
        if st in t.eff:
            del t.eff[st]
            if st in ('freeze', 'sleep'):
                t.immune_until = self.now + 2000

    def trigger(self, t, status, role):
        now = self.now
        dps = role == 'dps'
        ctl = role == 'controller'
        self.bump(f'{t.side}:{status}')
        if status == 'burn':
            t.eff['burn'] = dict(end=now + 5000 + (1000 if dps else 0), next=now + 1000,
                                 pct=0.025 * (1.1 if dps else 1))
        elif status == 'freeze':
            t.stacks.pop('sleep', None)
            t.eff['freeze'] = dict(end=now + 5000 + (1000 if ctl else 0))
        elif status == 'sleep':
            t.stacks.pop('freeze', None)
            t.eff['sleep'] = dict(end=now + 5000 + (1000 if ctl else 0))
        elif status == 'poison':
            dur = 5000 + (1000 if dps else 0)
            f = 1.1 if dps else 1
            if 'deadly' in t.eff:
                t.eff['deadly'] = dict(end=now + dur, next=now + 1000, pct=0.05 * f)
            elif 'poison' in t.eff:
                del t.eff['poison']
                t.eff['deadly'] = dict(end=now + dur, next=now + 1000, pct=0.05 * f)
                self.bump(f'{t.side}:deadly')
            else:
                t.eff['poison'] = dict(end=now + dur, next=now + 1000, pct=0.025 * f)

    def add_stacks(self, t, status, n, role):
        if not t.alive:
            return
        now = self.now
        if status in ('freeze', 'sleep'):
            if now < t.immune_until or t.stunned() or status in t.eff:
                return
        elif status == 'burn':
            if 'burn' in t.eff:
                return
        cnt = t.stacks.get(status, [0, 0])[0] + n
        thr = 10 if status == 'poison' else 8
        if cnt >= thr:
            t.stacks.pop(status, None)
            if status == 'poison' and cnt > thr:
                t.stacks[status] = [cnt - thr, now + 5000]
            self.trigger(t, status, role)
        else:
            t.stacks[status] = [cnt, now + 5000]

    # ---------- dano ----------
    def hurt(self, t, amount, direct):
        if not t.alive:
            return
        t.hp -= amount
        key = 'p' if t.side == 'p' else 'e'
        # dano causado POR quem? registrar pelo lado atingido
        if direct:
            self.dir_dmg['p' if t.side == 'e' else 'e'] += amount
        else:
            self.dot_dmg['p' if t.side == 'e' else 'e'] += amount
        if t.hp <= 0:
            t.alive = False
            t.hp = 0

    def direct(self, att, tgt, sk_name):
        sk = S[sk_name]
        now = self.now
        if sk['type'] in ('WATER', 'ICE') and 'burn' in tgt.eff:
            del tgt.eff['burn']
            tgt.stacks.pop('burn', None)
            self.bump(f'{tgt.side}:burn_removed')
        if sk['type'] == 'FIRE' and 'freeze' in tgt.eff:
            self.remove_eff(tgt, 'freeze')
            tgt.stacks.pop('freeze', None)
            self.bump(f'{tgt.side}:freeze_thawed')
        d = floor(calc(att, tgt, sk, now) + 0.5)
        if sk['power'] > 0:
            if 'sleep' in tgt.eff:
                self.remove_eff(tgt, 'sleep')
                self.bump(f'{tgt.side}:woken')
            self.hurt(tgt, d, True)
        n = sk.get('hit', 0)
        if n:
            st = sk['status']
            if st in ('burn', 'poison') and att.role == 'dps':
                n += 1
            if st in ('freeze', 'sleep') and att.role == 'controller':
                n += 1
            self.add_stacks(tgt, st, n, att.role)

    # ---------- ações ----------
    def foes_of(self, m):
        if m.side == 'p':
            return [e for e in self.enemies if e.alive]
        a = self.team[self.active]
        return [a] if a.alive else []

    def area_active(self, side, status):
        return any(a['side'] == side and a['status'] == status and a['end'] > self.now for a in self.areas)

    def usable(self, m, name, ignore_gcd=False):
        now = self.now
        sk = S[name]
        if m.cd.get(name, 0) > now:
            return None
        if not ignore_gcd and m.gcd > now:
            return None
        foes = self.foes_of(m)
        if not foes:
            return None
        aw = self.avoid_wake and m.side == 'p'
        if 'buff' in sk:
            return [m] if not m.has_tag(sk['tag'], now) else None
        if 'debuff' in sk:
            tg = [f for f in foes if not f.has_tag(sk['tag'], now)]
            return tg or None
        if 'area' in sk and sk['power'] == 0:
            stt = sk['area']['status']
            if self.area_active(m.side, stt, ):
                return None
            if stt == 'sleep':
                tg = [f for f in foes if 'sleep' not in f.eff and not f.stunned() and now >= f.immune_until]
            elif stt == 'poison':
                tg = [f for f in foes if 'poison' not in f.eff and 'deadly' not in f.eff]
            else:
                tg = foes
            return tg or None
        if name == 'Icy Wind':
            if self.area_active(m.side, 'freeze'):
                return None
            tg = [f for f in foes if not f.stunned() and now >= f.immune_until]
            return tg or None
        if name == 'Acid' and m.side == 'p' and not self.area_active(m.side, 'poison'):  # só o bot do jogador espera a área
            return None
        tg = list(foes)
        if aw:
            tg = [f for f in tg if 'sleep' not in f.eff]
        if name == 'Ember':
            tg = [f for f in tg if 'freeze' not in f.eff]
        if not tg:
            return None
        tg.sort(key=lambda f: f.hp)
        return tg[:1]

    def adv(self, sk, tgt):
        v = r = 0
        for t in tgt.types:
            e = CH.get((sk['type'], t), 1.0)
            if e > 1:
                v += 1
            elif e < 1:
                r += 1
        return v - r

    def best(self, m, ignore_gcd=False):
        if m.side == 'e':
            cands = []
            for name in m.kit:
                sk = S[name]
                if sk['power'] > 0 and not sk.get('aoe'):
                    tg = self.usable(m, name, ignore_gcd)
                    if tg:
                        cands.append((self.adv(sk, tg[0]), sk['power'], name, tg))
            if not cands:
                return None
            cands.sort(key=lambda c: (c[0], c[1]), reverse=True)
            return cands[0][2], cands[0][3]
        for name in PRI:
            if name in m.kit:
                tg = self.usable(m, name, ignore_gcd)
                if tg:
                    return name, tg
        return None

    def cast(self, m, name, tg):
        now = self.now
        sk = S[name]
        m.cd[name] = now + sk['cd']
        m.gcd = now + (EGCD if m.side == 'e' else GCD)
        self.bump(f'{m.side}:cast:{name}')
        self.log.append(dict(t=now, kind='cast', side=m.side, mon=m.idx, skill=name, target=tg[0].idx))
        if 'buff' in sk:
            dur = BUFF_DUR * (1.2 if m.role == 'tanker' else 1)
            allies = [m] if m.side == 'p' else [e for e in self.enemies if e.alive]
            for a in allies:
                a.mods.append((sk['buff'], 1.3, now + dur, sk['tag']))
            return
        if 'debuff' in sk:
            dur = BUFF_DUR * (1.2 if m.role == 'controller' else 1)
            for f in tg:
                f.mods.append((sk['debuff'], 0.7, now + dur, sk['tag']))
            return
        if sk.get('aoe'):
            for f in self.foes_of(m):
                self.direct(m, f, name)
        elif sk['power'] > 0 or sk.get('hit'):
            self.direct(m, tg[0], name)
        if 'area' in sk:
            a = sk['area']
            tick = a['tick']
            if a['status'] in ('freeze', 'sleep', 'paralyze') and m.role == 'controller':
                tick = 500
            if a['status'] in ('burn', 'poison') and m.role == 'dps':
                tick = 500
            self.areas.append(dict(side=m.side, status=a['status'], tick=tick, stk=a['stk'],
                                   end=now + a['dur'], next=now + tick, role=m.role))

    # ---------- passo ----------
    def all_mons(self):
        return self.team + self.enemies

    def forced_swap(self):
        a = self.team[self.active]
        if a.alive:
            return
        for i, m in enumerate(self.team):
            if m.alive:
                self.active = i
                self.bump('p:forced_swap')
                return

    def step(self):
        now = self.now
        # áreas
        for a in list(self.areas):
            while a['next'] <= now and a['next'] <= a['end']:
                tg = ([e for e in self.enemies if e.alive] if a['side'] == 'p'
                      else [self.team[self.active]])
                for t in tg:
                    self.add_stacks(t, a['status'], a['stk'], a['role'])
                a['next'] += a['tick']
            if a['end'] < now:
                self.areas.remove(a)
        # DoT
        for t in self.all_mons():
            if not t.alive:
                continue
            on_field = t.side == 'e' or t is self.team[self.active]
            for st in list(t.eff):
                e = t.eff[st]
                if 'pct' in e:
                    while e['next'] <= now and e['next'] <= e['end']:
                        if on_field:
                            self.hurt(t, e['pct'] * t.max_hp, False)
                        e['next'] += 1000
        # expiração
        for t in self.all_mons():
            for st in list(t.eff):
                if now >= t.eff[st]['end']:
                    self.remove_eff(t, st)
            for st in list(t.stacks):
                if now >= t.stacks[st][1]:
                    del t.stacks[st]
        self.forced_swap()
        # ação do jogador
        P = self.team[self.active]
        if P.alive and any(e.alive for e in self.enemies):
            can = not P.stunned()
            act = self.best(P) if can else None
            if self.swap_ready <= now and (can or self.swap_while_stunned):
                a_pri = PRI.index(act[0]) if act else 99
                if act is None and not can:
                    a_pri = 99
                cand = None
                for i, m in enumerate(self.team):
                    if i == self.active or not m.alive:
                        continue
                    b = self.best(m, ignore_gcd=True)
                    if b and PRI.index(b[0]) < FILLER_FROM and PRI.index(b[0]) < a_pri:
                        if cand is None or PRI.index(b[0]) < cand[0]:
                            cand = (PRI.index(b[0]), i)
                if cand and (a_pri >= FILLER_FROM or not can):
                    self.active = cand[1]
                    self.log.append(dict(t=now, kind='swap', side='p', to=cand[1]))
                    self.swap_ready = now + SWAP_CD
                    self.bump('p:swap')
                    P = self.team[self.active]
                    act = self.best(P) if not P.stunned() else None
            if act and not P.stunned():
                self.cast(P, *act)
        # inimigos
        for e in self.enemies:
            if e.alive and not e.stunned():
                tgt = self.foes_of(e)
                if tgt and tgt[0].alive:
                    act = self.best(e)
                    if act:
                        self.cast(e, *act)
        self.forced_swap()

    def run(self, tmax=300000):
        while self.now < tmax:
            self.step()
            if self.now % 1000 == 0:
                self.checkpoints.append(dict(t=self.now, active=self.active,
                    team=[round(m.hp, 6) for m in self.team], enemies=[round(m.hp, 6) for m in self.enemies]))
            if not any(e.alive for e in self.enemies):
                return 'jogador', self.now
            if not any(m.alive for m in self.team):
                return 'inimigos', self.now
            self.now += DT
        return 'tempo', self.now


def duel(pname, ename, level=5):
    team = [Mon(pname, level, 'p', ROLE[pname])]
    enemy = [Mon(ename, 5, 'e')]
    s = Sim(team, enemy)
    w, t = s.run()
    hp = team[0].hp / team[0].max_hp if w == 'jogador' else enemy[0].hp / enemy[0].max_hp
    return w, t / 1000, hp, s


def group(mode, plevel=10, swap_stun=False, avoid=True):
    names = ['Bulbasaur', 'Bulbasaur', 'Charmander', 'Charmander', 'Squirtle', 'Squirtle']
    enemies = [Mon(n, 5, 'e') for n in names]
    if mode == 'team':
        team = [Mon(n, plevel, 'p', ROLE[n]) for n in ('Squirtle', 'Bulbasaur', 'Charmander')]
    else:
        team = [Mon(mode, plevel, 'p', ROLE[mode])]
    s = Sim(team, enemies, avoid_wake=avoid, swap_while_stunned=swap_stun)
    w, t = s.run()
    left = sum(1 for e in enemies if e.alive)
    hp = sum(m.hp for m in team) / sum(m.max_hp for m in team)
    return w, t / 1000, left, hp, s


if __name__ == '__main__':
    print('=== atributos (nível 5 e 10, antes de bônus de função) ===')
    for n in BASE:
        for L in (5, 10):
            m = Mon(n, L, 'p', ROLE[n])
            print(n, L, 'HP %.2f atk %.2f df %.2f spa %.2f spd %.2f' % (m.max_hp, m.st['atk'], m.st['df'], m.st['spa'], m.st['spd']))
    print('\n=== duelos 1x1 (nível 5 x nível 5) ===')
    for p in BASE:
        for e in BASE:
            w, t, hp, s = duel(p, e)
            print(f'{p:10s} x {e:10s}: {w:9s} {t:6.1f}s  HP restante do vencedor {hp*100:5.1f}%  {s.cnt}')
    print('\n=== grupo 6 (jogador nível 10, 6 inimigos nível 5) ===')
    for mode in ('Bulbasaur', 'Charmander', 'Squirtle', 'team'):
        w, t, left, hp, s = group(mode)
        print(f'{mode:10s}: {w:9s} {t:6.1f}s  inimigos vivos {left}  HP do time {hp*100:5.1f}%')
        print('   ', s.cnt)
    w, t, left, hp, s = group('team', swap_stun=True)
    print(f'team (troca mesmo atordoado): {w} {t:.1f}s inimigos vivos {left} HP {hp*100:.1f}%')
    w, t, left, hp, s = group('team', avoid=False)
    print(f'team (ataca alvo dormindo): {w} {t:.1f}s inimigos vivos {left} HP {hp*100:.1f}%')
