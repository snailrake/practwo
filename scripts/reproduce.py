"""Recompute report evidence and figures with the production Python model.

Run from repository root: python scripts/reproduce.py
No report number or plot trajectory is hard-coded.
"""
import csv
import json
from pathlib import Path
import platform
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
import numpy as np
import scipy
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from backend.defaults import BASE, STATE_NAMES, FACTOR_NAMES, presets
from backend.model import SimulationConfig, simulate
from backend.verification import verify

OUT=ROOT/'report/evidence'; OUT.mkdir(parents=True,exist_ok=True)
FIG=ROOT/'report/figures'; FIG.mkdir(parents=True,exist_ok=True)
COLORS=['#176f70','#d49b3e','#173e58','#b56476','#7d6bac','#587f69','#ae795b','#498ca2','#977d2c','#48636d','#a25fa1']
SHORT=['Испарение','Ликвидация','Площадь','Подход','Первичное облако','Вторичное облако','Госпитализация','Техника','Раствор','Ресурсы','Оповещение']
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'axes.edgecolor':'#bdcbd0','axes.labelcolor':'#4b6572','xtick.color':'#637a84','ytick.color':'#637a84','grid.color':'#e1e9ec','axes.titleweight':'normal','savefig.facecolor':'white'})

def save(fig,name):
    fig.savefig(FIG/name,dpi=210,bbox_inches='tight',pad_inches=.14)
    plt.close(fig)

def generate():
    experiments=[simulate(SimulationConfig(**p)) for p in presets()]
    base=experiments[0]
    verification=verify(SimulationConfig(**BASE))
    # All tolerances refer to actual errors saved by the verification routine.
    (OUT/'experiments.json').write_text(json.dumps(experiments,ensure_ascii=False,indent=2),encoding='utf8')
    (OUT/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2),encoding='utf8')
    summary={'python':platform.python_version(),'numpy':np.__version__,'scipy':scipy.__version__,
             'experiments':[{'name':r['config']['name'],'fingerprint':r['fingerprint'],
                 'final':r['y'][-1],'quarters':r['quarters'],'radar_scales':r['radar_scales'],
                 'diagnostics':r['diagnostics'],'warnings':r['warnings']} for r in experiments],
             'verification':verification}
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    with (OUT/'baseline.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f,delimiter=';');w.writerow(['tau']+[f'X{i}' for i in range(1,12)]+[f'F{i}' for i in range(1,8)])
        w.writerows([t,*base['y'][j],*base['factors'][j]] for j,t in enumerate(base['t']))
    t=np.array(base['t']);y=np.array(base['y'])
    for lo,hi,filename in [(0,6,'states-1.png'),(6,11,'states-2.png')]:
        fig,axes=plt.subplots(3,2,figsize=(7.2,8),layout='constrained')
        for ax,i in zip(axes.flat,range(lo,hi)):
            ax.plot(t,y[:,i],color=COLORS[i],lw=2)
            ax.set_title(f'X{i+1}  {SHORT[i]}',loc='left',fontsize=10,pad=10)
            ax.grid(alpha=.7);ax.set_xlabel('Машинное время τ');ax.set_ylabel('Отн. ед.')
            for q in base['quarters']:
                ax.plot(q['t'],q['values'][i],'o',ms=3,color=COLORS[i])
        if hi-lo<6: axes.flat[-1].set_visible(False)
        save(fig,filename)
    fig,axes=plt.subplots(4,2,figsize=(7.2,8.3),layout='constrained')
    for i,ax in enumerate(axes.flat[:7]):
        ax.plot(t,np.array(base['factors'])[:,i],color=COLORS[i],lw=2,label='Базовый')
        if i in {2,4}:
            r=experiments[1 if i==2 else 2]
            ax.plot(r['t'],np.array(r['factors'])[:,i],color=COLORS[1],ls='--',lw=2,label='Возмущение')
            ax.legend(fontsize=8,frameon=False)
        ax.set_title(f'F{i+1}  {FACTOR_NAMES[i]}',fontsize=10,loc='left');ax.grid(alpha=.6);ax.set_xlabel('τ');ax.set_ylabel('Отн. ед.')
        if i not in {2,4}: ax.set_ylim(float(base['factors'][0][i])-.1,float(base['factors'][0][i])+.1)
    axes.flat[-1].set_visible(False);save(fig,'factors.png')
    angles=np.linspace(0,2*np.pi,11,endpoint=False)
    fig,axes=plt.subplots(2,2,figsize=(7.2,7.6),subplot_kw={'projection':'polar'},layout='constrained')
    for j,(ax,q) in enumerate(zip(axes.flat,base['quarters'])):
        ax.set_theta_offset(np.pi/2);ax.set_theta_direction(-1)
        ax.plot(np.r_[angles,angles[0]],q['normalized']+[q['normalized'][0]],color=COLORS[j],lw=2)
        ax.fill(np.r_[angles,angles[0]],q['normalized']+[q['normalized'][0]],color=COLORS[j],alpha=.07)
        ax.set_xticks(angles,[f'X{i+1}' for i in range(11)]);ax.set_ylim(0,1);ax.set_yticks([.25,.5,.75,1],['0,25','0,50','0,75','1,00'],fontsize=7);ax.grid(alpha=.9);ax.set_title(f'Четверть {j+1}   τ = {q["t"]:.2f}',fontsize=12,pad=22)
    save(fig,'radar-four.png')
    fig,axes=plt.subplots(2,2,figsize=(7.2,5.5),layout='constrained')
    for ax,i in zip(axes.flat,[2,5,9,10]):
        for j,r in enumerate(experiments[:3]):
            ax.plot(r['t'],np.array(r['y'])[:,i],color=COLORS[j],lw=2,ls=['-','--',':'][j],label=['Базовый','Ветер','Задержка'][j])
        ax.set_title(f'X{i+1} {SHORT[i]}',loc='left');ax.grid(alpha=.7);ax.set_xlabel('τ');ax.set_ylabel('Отн. ед.')
    handles,labels=axes[0,0].get_legend_handles_labels();fig.legend(handles,labels,loc='outside lower center',ncol=3,frameon=False);save(fig,'comparison.png')
    fig,axes=plt.subplots(1,3,figsize=(7.2,2.9),layout='constrained')
    for ax,i in zip(axes,[1,5,10]):
        for j,r in enumerate([base,experiments[3]]):ax.plot(r['t'],np.array(r['y'])[:,i],color=COLORS[j*2],lw=2,label=['Буквальные знаки','Модуль f⁻'][j])
        ax.set_title(f'X{i+1} {SHORT[i]}',loc='left',fontsize=10);ax.grid(alpha=.7);ax.set_xlabel('τ')
    handles,labels=axes[0].get_legend_handles_labels();fig.legend(handles,labels,loc='outside lower center',ncol=2,frameon=False);save(fig,'signs.png')
    fig,ax=plt.subplots(figsize=(10,3.8),layout='constrained')
    errors=[c['error'] for c in verification['checks']]
    ax.barh(range(5),errors,color=COLORS[:5]);ax.set_xscale('log');ax.set_yticks(range(5),['DOP853 / уточнение','RK45 / уточнение','Radau / уточнение','Экспоненциальный эталон','Матричная экспонента']);ax.invert_yaxis();ax.set_xlabel('Максимальная ошибка (логарифмическая шкала)');ax.grid(axis='x',alpha=.6)
    for i,error in enumerate(errors):
        if error==0:ax.text(1e-17,i,'0 (совпадение)',va='center',fontsize=9)
    save(fig,'verification.png')
    # Architecture is a genuine implementation diagram; no invented cloud geography.
    fig,ax=plt.subplots(figsize=(10,4));ax.axis('off');ax.set_xlim(0,10);ax.set_ylim(0,4)
    nodes=[(.1,2.6,2.7,.9,'Браузер\nReact · TypeScript · ECharts'),(3.7,2.6,2.6,.9,'HTTP API\nFastAPI · Pydantic'),(7.2,2.6,2.7,.9,'Безопасные выражения\nРазбор AST без eval'),(7.2,.5,2.7,.95,'Вычислительное ядро\nSciPy solve_ivp'),(3.7,.5,2.6,.95,'Результаты\nX(τ) · F(τ) · срезы · JSON')]
    for x,z,w,h,label in nodes:
        ax.add_patch(FancyBboxPatch((x,z),w,h,boxstyle='round,pad=0.03,rounding_size=0.06',fc='#f2f6f7',ec=COLORS[0],lw=1.1));ax.text(x+w/2,z+h/2,label,ha='center',va='center',fontsize=10,color='#244954')
    for a,b in [((2.85,3.05),(3.65,3.05)),((6.35,3.05),(7.15,3.05)),((8.55,2.55),(8.55,1.5)),((7.15,.95),(6.35,.95))]:ax.add_patch(FancyArrowPatch(a,b,arrowstyle='-|>',mutation_scale=12,color=COLORS[0],lw=1.2))
    ax.add_patch(FancyArrowPatch((3.65,.95),(1.45,2.55),arrowstyle='-|>',mutation_scale=12,color=COLORS[0],lw=1.2,connectionstyle='angle,angleA=180,angleB=90,rad=12'))
    save(fig,'architecture.png')
    print(json.dumps({'experiments':len(experiments),'verification_passed':verification['passed'],'base_final':base['y'][-1],'figures':len(list(FIG.glob('*.png')))},ensure_ascii=False,indent=2))

if __name__=='__main__':generate()
