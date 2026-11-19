from sim import *
def duel2(p,e,pl,el):
    team=[Mon(p,pl,'p',ROLE[p])]; en=[Mon(e,el,'e')]
    s=Sim(team,en); w,t=s.run()
    hp=team[0].hp/team[0].max_hp if w=='jogador' else en[0].hp/en[0].max_hp
    return w,t/1000,hp
def fight(names,pl,el,avoid=True,order=('Squirtle','Bulbasaur','Charmander')):
    en=[Mon(n,el,'e') for n in names]
    team=[Mon(n,pl,'p',ROLE[n]) for n in order]
    s=Sim(team,en,avoid_wake=avoid); w,t=s.run()
    left=sum(1 for e in en if e.alive); hp=sum(m.hp for m in team)/sum(m.max_hp for m in team)
    dead=sum(1 for m in team if m.hp<=0)
    return w,t/1000,left,hp,dead
print('== atributos nivel 30/25')
for n in BASE:
    for L in (25,30):
        m=Mon(n,L,'p',ROLE[n]); print(n,L,'HP %.1f atk %.1f df %.1f spa %.1f'%(m.max_hp,m.st['atk'],m.st['df'],m.st['spa']))
print('== 1x1 nivel 30')
for p in BASE:
    for e in BASE:
        w,t,hp=duel2(p,e,30,30); print(f'{p:10s} x {e:10s}: {w:9s} {t:5.1f}s HP venc {hp*100:5.1f}%')
B3=['Bulbasaur','Charmander','Squirtle']
print('== 1x3 time vs 3 (um de cada) nivel 30')
for av in (True,False):
    print(' avoid' if av else ' ataca dormindo', fight(B3,30,30,av))
print('== solo 1x3 nivel 30')
for n in BASE:
    en=[Mon(x,30,'e') for x in B3]; team=[Mon(n,30,'p',ROLE[n])]
    s=Sim(team,en); w,t=s.run(); print(n,w,t/1000,sum(e.alive for e in en))
print('== 1x6 jogador 30 x selvagens 25')
names=['Bulbasaur','Bulbasaur','Charmander','Charmander','Squirtle','Squirtle']
for av in (True,False):
    print(' avoid' if av else ' ataca dormindo', fight(names,30,25,av))
for n in BASE:
    en=[Mon(x,25,'e') for x in names]; team=[Mon(n,30,'p',ROLE[n])]
    s=Sim(team,en); w,t=s.run(); print(n,w,t/1000,'vivos',sum(e.alive for e in en))
print('== varredura 1x6: time nivel X vs selvagens 25 (ataca dormindo / evita)')
for pl in (30,35,40,45,50):
    a=fight(names,pl,25,False); b=fight(names,pl,25,True)
    print(pl,'ataca',a[0],round(a[1],1),'vivos',a[2],'HP%.0f%%'%(a[3]*100),'| evita',b[0],round(b[1],1),'vivos',b[2],'HP%.0f%%'%(b[3]*100))
print('== referencia: lvl10 vs 5 e lvl 30 vs 25 razao de nivel')
