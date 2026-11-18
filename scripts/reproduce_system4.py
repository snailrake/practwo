"""Reproduce the current report's figure-(4) cubic experiments.

The original table-1 evidence used for browser parity stays in experiments.json.
This separate dataset identifies all illustrative parameters explicitly.
"""
import json
from pathlib import Path
import platform
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import numpy as np
import scipy
from backend.defaults import system4_cubic
from backend.model import SimulationConfig, simulate
from backend.verification import verify


def figures(results, verification):
    # Scientific plots are generated from the complete solver output.
    from reproduce import plt, save, COLORS, FancyBboxPatch, FancyArrowPatch
    base = results[0]
    t, y, factors = map(np.array, [base['t'], base['y'], base['factors']])
    indices = base['profile_indices']
    labels = ['Испарение', 'Ликвидация', 'Площадь', 'Подход облака', 'Первичное облако',
              'Вторичное облако', 'Амбулаторная помощь', 'Стационар', 'Техника',
              'Раствор', 'Силы и средства', 'Оповещение', 'Фоновое воздействие']
    for group, name in [(indices[:6], 'states-1'), (indices[6:], 'states-2')]:
        fig, axes = plt.subplots(3, 2, figsize=(7.2, 8), layout='constrained')
        for ax, i in zip(axes.flat, group):
            ax.plot(t, y[:, i], color='#222222', lw=2)
            ax.set_title(f'X{i+1}  {labels[i]}', loc='left', fontsize=10, pad=10)
            ax.grid(alpha=.7); ax.set_xlabel('Машинное время t'); ax.set_ylabel('Отн. ед.')
            for q in base['quarters']: ax.plot(q['t'], q['values'][i], 'o', ms=3, color='#222222')
        if len(group) < 6: axes.flat[-1].set_visible(False)
        save(fig, 'system4-' + name + '.png')
    fig, axes = plt.subplots(4, 2, figsize=(7.2, 8.3), layout='constrained')
    for i, ax in enumerate(axes.flat):
        ax.plot(t, factors[:, i], color='#111111', lw=2, label='Базовый')
        if i in {0, 2, 4}:
            r = results[{0: 3, 2: 1, 4: 2}[i]]
            ax.plot(t, np.array(r['factors'])[:, i], color='#777777', lw=2, ls='--', label='Возмущение')
            ax.legend(fontsize=8, frameon=False)
        ax.set_title(f'F{i+1}  {base["factor_names"][i]}', fontsize=9, loc='left')
        ax.grid(alpha=.6); ax.set_xlabel('t'); ax.set_ylabel('Отн. ед.')
    save(fig, 'system4-factors.png')
    angles = np.linspace(0, 2*np.pi, 11, endpoint=False)
    fig, axes = plt.subplots(2, 2, figsize=(7.2, 7.6), subplot_kw={'projection': 'polar'}, layout='constrained')
    for j, (ax, q) in enumerate(zip(axes.flat, base['quarters'])):
        ax.set_theta_offset(np.pi/2); ax.set_theta_direction(1)
        v = [q['normalized'][i] for i in indices]
        ax.plot(np.r_[angles, angles[0]], v+[v[0]], color='#111111', lw=2)
        ax.fill(np.r_[angles, angles[0]], v+[v[0]], color='#111111', alpha=.04)
        ax.set_xticks(angles, [f'X{i+1}\nR={base["radar_scales"][i]:g}' for i in indices], fontsize=7)
        ax.set_ylim(0, 1); ax.set_yticks([.25, .5, .75, 1], ['0,25', '0,50', '0,75', '1,00'], fontsize=7)
        ax.set_title(f'Четверть {j+1}   t = {q["t"]:.2f}', fontsize=11, pad=22)
    save(fig, 'system4-radar-four.png')
    fig, axes = plt.subplots(2, 2, figsize=(7.2, 5.5), layout='constrained')
    for ax, i in zip(axes.flat, [2, 5, 9, 11]):
        for j, r in enumerate(results[:3]):
            ax.plot(t, np.array(r['y'])[:, i], color=COLORS[j], lw=2, ls=['-', '--', ':'][j], label=['Базовый', 'Ветер', 'Задержка'][j])
        ax.set_title(f'X{i+1}  {labels[i]}', loc='left'); ax.grid(alpha=.7); ax.set_xlabel('t')
    handles, names = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, names, loc='outside lower center', ncol=3, frameon=False)
    save(fig, 'system4-comparison.png')
    fig, axes = plt.subplots(1, 3, figsize=(7.2, 2.9), layout='constrained')
    for ax, i in zip(axes, [1, 5, 11]):
        for j, r in enumerate([base, results[3]]):
            ax.plot(t, np.array(r['y'])[:, i], color=COLORS[j], ls=['-', '--'][j], lw=2, label=['Базовый объём', 'Изменённый объём'][j])
        ax.set_title(f'X{i+1}  {labels[i]}', loc='left', fontsize=9); ax.grid(alpha=.7); ax.set_xlabel('t')
    handles, names = axes[0].get_legend_handles_labels()
    fig.legend(handles, names, loc='outside lower center', ncol=2, frameon=False)
    save(fig, 'system4-volume.png')
    fig, ax = plt.subplots(figsize=(10, 3.8), layout='constrained')
    errors = [c['error'] for c in verification['checks']]
    ax.barh(range(5), [max(v, 1e-17) for v in errors], color=COLORS[:5]); ax.set_xscale('log')
    ax.set_yticks(range(5), ['DOP853 / уточнение', 'RK45 / уточнение', 'Radau / уточнение', 'Экспоненциальный эталон', 'Матричная экспонента'])
    ax.invert_yaxis(); ax.set_xlabel('Максимальная ошибка (логарифмическая шкала)'); ax.grid(axis='x', alpha=.6)
    save(fig, 'system4-verification.png')
    fig, ax = plt.subplots(figsize=(10, 4)); ax.axis('off'); ax.set_xlim(0, 10); ax.set_ylim(0, 4)
    nodes = [(.1, 2.8, 2.7, .8, 'Интерфейс\nReact · ECharts · KaTeX'), (3.7, 2.8, 2.6, .8, 'Онлайн: Worker\nPython / Pyodide'),
             (3.7, .5, 2.6, .8, 'Локально: HTTP API\nFastAPI · Python'), (7.2, 1.7, 2.7, 1.1, 'Общее ядро\nAST · SciPy solve_ivp\nX(t) · F(t) · срезы')]
    for x, z, w, h, label in nodes:
        ax.add_patch(FancyBboxPatch((x, z), w, h, boxstyle='round,pad=0.03,rounding_size=0.06', fc='#fafafa', ec='#111111', lw=1.1))
        ax.text(x+w/2, z+h/2, label, ha='center', va='center', fontsize=10)
    for a, b in [((2.9, 3.2), (3.6, 3.2)), ((2.7, 2.8), (3.8, 1.3)), ((6.4, 3.2), (7.1, 2.6)), ((6.4, .9), (7.1, 1.9))]:
        ax.add_patch(FancyArrowPatch(a, b, arrowstyle='<->', mutation_scale=12, lw=1.1))
    save(fig, 'system4-architecture.png')


def generate():
    base = SimulationConfig(**system4_cubic())
    variants = [base]
    for index, source, name in [
        (2, '0.23*t**3+0.20*t**2+0.40*t+0.35', 'Изменение ветра F3'),
        (4, '0.40*t**3-0.20*t**2+0.10*t+0.52', 'Изменение задержки F5'),
        (0, '0.63*t**3+0.05*t**2+0.05*t+0.40', 'Изменение объёма F1'),
    ]:
        factor_profiles = base.factors.copy()
        factor_profiles[index] = source
        variants.append(base.model_copy(update={'name': name, 'factors': factor_profiles}))
    results = [simulate(c) for c in variants]
    verification = verify(base)
    assert verification['passed']
    for result in results:
        y = np.array(result['y'])
        assert np.isfinite(y).all() and y.min() > 0
    out = ROOT / 'report/evidence'
    out.mkdir(exist_ok=True)
    for name, data in [('system4-experiments', results), ('system4-verification', verification)]:
        (out / (name + '.json')).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf8')
    b = results[0]
    y, f, t = np.array(b['y']), np.array(b['factors']), np.array(b['t'])
    indices = b['profile_indices']
    span = np.ptp(y[:, indices])
    departure = np.max(abs(y - (y[0] + t[:, None] * (y[-1] - y[0]))), axis=0)
    factor_departure = np.max(abs(f - (f[0] + t[:, None] * (f[-1] - f[0]))), axis=0) / np.ptp(f, axis=0)
    assert min(departure[indices] / span) > .07
    assert min(factor_departure) > .15
    assert np.all(y < np.array(b['config']['scales']))
    summary = {
        'python': platform.python_version(), 'numpy': np.__version__, 'scipy': scipy.__version__,
        'fingerprint': b['fingerprint'], 'common_span': span,
        'state_departures': list(departure[indices] / span),
        'factor_departures': list(factor_departure),
        'minimum_state': float(y.min()),
        'minimum_limit_margin': float(np.min(np.array(b['config']['scales']) - y)),
        'verification_max_error': max(c['error'] for c in verification['checks'][:3]),
    }
    (out / 'system4-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
    figures(results, verification)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    generate()
