"""Refresh a retained report from current solver evidence, preserving its design.

Usage: bundled-python report/refresh_system4_report.py --source saved-original.docx
The source is never overwritten. Equations remain editable Office Math.
"""
import argparse
import hashlib
from copy import deepcopy
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH as A
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from PIL import Image
from lxml import etree

from math_ooxml import el, run, sub, sup, frac, group, expression, math
from update_ui_report import replace_paragraph

ROOT = Path(__file__).resolve().parent.parent
REPORT = ROOT / 'report'
EVIDENCE = REPORT / 'evidence'
NAME = 'Практическая_работа_2_Химический_выброс'
fmt = lambda x: f'{x:.6g}'.replace('.', ',').replace('e-', '·10−').replace('e+', '·10+')
subscript = str.maketrans('0123456789', '₀₁₂₃₄₅₆₇₈₉')
code = lambda i: 'X' + str(i+1).translate(subscript)


def clean(p):
    for child in list(p._p):
        if child.tag != qn('w:pPr'): p._p.remove(child)


def set_math(p, nodes, size=13):
    clean(p); p.alignment = A.CENTER
    p.paragraph_format.first_line_indent = Cm(0)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1
    node = math(nodes)
    for value in node.iter(qn('w:sz')): value.set(qn('w:val'), str(round(size*2)))
    p._p.append(node)


def x(index, t=False):
    return [sub('X', index)] + ([group([run('t')])] if t else [])


def xmax(index): return sup(sub('X', index), run('max'))


def delimit(nodes, left='[', right=']'):
    pr = el('dPr')
    for tag, value in [('begChr', left), ('endChr', right)]:
        child = el(tag); child.set(qn('m:val'), value); pr.append(child)
    return el('d', pr, el('e', nodes))


def function(index, sign, names):
    args = []
    for j, name in enumerate(names.split()):
        if j: args.append(run(','))
        args += expression(name, state_time=True, time_symbol='t')
    return [sup(sub('f', index), run(sign)), group(args)]


def resize_rows(table, count):
    while len(table.rows) < count: table._tbl.append(deepcopy(table.rows[-1]._tr))
    while len(table.rows) > count: table._tbl.remove(table.rows[-1]._tr)


def plain_table(table, headers, rows, widths, size=11):
    resize_rows(table, len(rows)+1)
    table.autofit = False; table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for col, width in zip(table.columns, widths): col.width = Cm(width)
    for r, values in enumerate([headers, *rows]):
        row = table.rows[r]
        row.height = None
        for c, (cell, value, width) in enumerate(zip(row.cells, values, widths)):
            cell.width = Cm(width); cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            cell.text = str(value)
            p = cell.paragraphs[0]; p.alignment = A.LEFT if c == 1 and len(headers) == 4 else A.CENTER
            p.paragraph_format.first_line_indent = Cm(0)
            p.paragraph_format.space_before = Pt(3); p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.line_spacing = 1; p.paragraph_format.keep_with_next = r == 0
            for item in p.runs:
                item.font.name = 'Times New Roman'; item.font.size = Pt(size); item.bold = r == 0
        props = row._tr.get_or_add_trPr()
        if r == 0 and props.find(qn('w:tblHeader')) is None: props.append(OxmlElement('w:tblHeader'))
        if props.find(qn('w:cantSplit')) is None: props.append(OxmlElement('w:cantSplit'))


def refresh(source):
    data = json.loads((EVIDENCE / 'system4-experiments.json').read_text('utf8'))
    b = data[0]; c = b['config']; indices = b['profile_indices']
    summary = json.loads((EVIDENCE / 'system4-summary.json').read_text('utf8'))
    verification = json.loads((EVIDENCE / 'system4-verification.json').read_text('utf8'))
    tests = ET.parse(EVIDENCE / 'pytest.xml').getroot()
    assert not tests.findall('.//failure') and not tests.findall('.//error')
    test_count = len(tests.findall('.//testcase'))
    review = json.loads((EVIDENCE / 'review/checks.json').read_text('utf8'))
    assert all(v['passed'] for v in review['checks']) and not review['errors']
    document = Document(source)
    paragraphs = document.paragraphs[:]
    tables = document.tables[:]
    original_styles = etree.tostring(document.styles.element)
    bibliography = [p._p.xml for p in paragraphs[280:310]]
    values = {
      58: 'Разработанное приложение решает систему рисунка (4), содержащую тринадцать взаимосвязанных характеристик и восемь внешних факторов. Пользователь задаёт начальное состояние, аналитические функции и параметры численного решения. На общем графике и лепестковых диаграммах выделены одиннадцать показателей из списка задания. Вычисления выполняются библиотекой SciPy на Python, интерфейс отвечает за ввод и визуализацию.',
      59: 'Основание работы – предоставленное учебное задание «Моделирование последствий выброса химически опасных веществ на промышленном объекте» и уточнения к изображению системы (4). В стартовом примере сохранены все её индексы, списки аргументов, нормирующие множители и знаки между частями. Аналитические зависимости заданы кубическими полиномами с явно указанными учебными коэффициентами. Для отдельной сверки в приложении сохранены исходные выражения статьи и таблица 1 задания.',
      67: 'Проект включает вычислительное ядро Python, интерфейс React и TypeScript, сервер FastAPI для локального запуска, автоматические тесты и средства воспроизведения экспериментов. Онлайн-версия исполняет то же ядро в браузере через Pyodide. Отчёт содержит полную структуру системы (4), численные параметры кубического примера, рассчитанные графики и скриншоты текущего интерфейса. Числа в таблицах подставлены из файлов результатов.',
      72: 'В работе Зальцано и соавторов причинные связи переводятся в динамическую модель устойчивости промышленной установки [3]. Валлеротонда и соавторы рассматривают системную динамику как средство обучения производственной безопасности [4]. В исследовании хранения водорода и аммиака отдельно представлены причинная диаграмма и количественная модель риска [5]. Поэтому схема связей ещё не определяет численный закон их действия. В настоящей работе структура взята с рисунка (4), а численные параметры кубического примера заданы явно и не заимствованы из перечисленных исследований.',
      78: 'Нумерация сохранена по рисунку (4). Госпитализированным соответствует X₈, эффективности оповещения – X₁₂. Дополнительные X₇ и X₁₃ участвуют в решении; их можно просмотреть отдельно и экспортировать. Основной набор из 11 графиков состоит из X₁–X₆ и X₈–X₁₂. F₈ характеризует площадь фонового загрязнения от транспорта.',
      79: 'В экспериментах Xᵢ и Fⱼ заданы в относительной шкале. Их значения не переводятся автоматически в людей, часы или площадь. Положительный Xᵢᵐᵃˣ расположен в знаменателе исходного уравнения и регулирует скорость изменения Xᵢ. В стартовом примере он равен объявленному верхнему уровню характеристики; все рассчитанные значения остаются ниже него. Отдельный Rᵢ задаёт масштаб изображения и первоначально равен Xᵢᵐᵃˣ.',
      84: 'Все восемь внешних воздействий стартового примера имеют вид Fⱼ(t) = aⱼt³ + bⱼt² + cⱼt + dⱼ. В каждой формуле доступны четыре коэффициента. Для экспериментов меняется один коэффициент одного фактора, остальные условия сохраняются. Эти профили выбраны для учебного исследования нелинейного отклика и не являются измерениями промышленного объекта.',
      86: paragraphs[86].text.replace('одиннадцати агрегированных', 'тринадцати агрегированных'),
      88: paragraphs[88].text.replace('семи скалярных', 'восьми скалярных'),
      92: paragraphs[92].text.replace('характеристика длительности эвакуации', 'характеристика времени ликвидации'),
      96: 'В исходном задании есть две редакции модели: перечень из 11 показателей и таблица 1, а также рисунок системы (4) с 13 состояниями и 8 факторами. Их индексы и зависимости различаются. После уточнения требований основным выбран рисунок (4). Его строки сверены отдельно: в каждой первой и вычитаемой части сохранён полный список X и F. Табличная редакция доступна отдельным сценарием и не смешивается с нумерацией рисунка.',
      97: 'Рисунок задаёт списки аргументов fᵢ⁺ и fᵢ⁻. В частном кубическом примере каждому аргументу соответствует полином a·x³ + b·x² + c·x + d, где x равен значению этого аргумента. Значения полиномов складываются в пределах соответствующей части уравнения. Семь отсутствующих вычитаемых частей равны нулю.',
      98: 'Знаки сохраняются алгебраически: правая часть равна fᵢ⁺ − fᵢ⁻, даже если значение одной из функций отрицательно. Замены модулями нет. В строке X₃ изображённый индекс 31 у максимума прочитан как 3. Это исправление обозначения явно раскрыто. Отдельный сценарий исходных формул статьи сохраняет её коэффициенты и позволяет отличить исходную зависимость от выбранного кубического примера.',
      100: 'Машинное время t задано на единичном интервале 0…1. Это расчётный параметр из задания; перевода в часы не вводится. При положительных Xᵢᵐᵃˣ задача Коши имеет вид:',
      101: 'Все 13 начальных условий, положительные Xᵢᵐᵃˣ и профили Fⱼ(t) заданы явно. Изменение Xᵢᵐᵃˣ меняет производную и требует нового решения. Изменение Rᵢ влияет на длину луча диаграммы. В стартовом примере их численные значения равны, однако назначение параметров различно.',
      103: '3.3 Полная система рисунка (4) и кубические функции',
      104: 'Ниже приведены все 13 строк рисунка (4), включая каждую переменную в списках аргументов. Первая и вычитаемая части раскрываются численно по единой кубической форме. Обозначения Xᵢ(t), Fⱼ и Xᵢᵐᵃˣ соответствуют изображению задания.',
      105: 'В таблице 9 приведены коэффициенты всех 49 полиномов для 19 присутствующих частей. У каждой строки указан её вход. Коэффициенты до сотых используются непосредственно в расчёте.',
      106: f'Например, при t = 0 для X₄ используются X₁ = {fmt(c["initial"][0])}, F₁ = {fmt(b["factors"][0][0])}, F₃ = {fmt(b["factors"][0][2])}, F₄ = {fmt(b["factors"][0][3])} и X₄ᵐᵃˣ = {fmt(c["scales"][3])}. Получены f₄⁺ = {fmt(b["plus"][0][3])} и f₄⁻ = {fmt(b["minus"][0][3])}; начальная производная равна {fmt(b["derivatives"][0][3])}. Такая же численная подстановка раскрывается под каждым уравнением интерфейса.',
      108: 'Дробные степени, квадратные корни и деление на переменные используются в исходных формулах статьи и доступны в пользовательских выражениях. При выходе за область определения приложение сообщает номер характеристики и момент времени.',
      109: 'Математически определённые отрицательные значения сохраняются с предупреждением. Для эффективности оповещения проверяется X₁₂ в системе (4) и X₁₁ в табличной редакции. Верхние пределы Rᵢ используются при построении лепестковых диаграмм. Таблицы и экспорт содержат точные значения решения.',
      113: 'После перехода от общей системы (4) к расчёту открывается кубический пример. Ниже приведены четыре эксперимента с этим примером. Кубический член есть у каждого входа в fᵢ⁺ и fᵢ⁻ и у каждого из восьми профилей Fⱼ(t). Начальные условия, полиномы и масштабы сохранены в экспортированных конфигурациях.',
      120: paragraphs[120].text.replace('(14)', '(16)'),
      127: 'Rᵢ задаётся пользователем и действует во всех четырёх четвертях. В стартовом примере Rᵢ = Xᵢᵐᵃˣ. Значения подписаны у лучей, красный контур проходит через все Rᵢ. Если значение превышает свой предел, точка на диаграмме находится на красной границе, а исходное число сохраняется в подсказке, таблице и экспорте.',
      135: 'FastAPI обеспечивает HTTP-интерфейс локальной версии. React хранит конфигурацию и выполненный эксперимент; ECharts строит графики, KaTeX отображает формулы. Онлайн-версия выполняет тот же Python-код в отдельном Worker через Pyodide. На схеме показаны оба пути к общему вычислительному ядру.',
      136: 'NumPy обрабатывает массивы времени, состояний и результатов сопоставления [28]. Траектории передаются в интерфейс, таблицы и графики отчёта. Для графика суммы полиномов Python меняет выбранный вход и фиксирует остальные в начале интервала.',
      146: 'Для выражений с одним входом допустимы 400 символов и 120 узлов дерева. Для нескольких входов пределы составляют 512 символов и 200 узлов. Модуль показателя степени ограничен 32. Промежуточные и конечные значения проверяются на конечность и вещественность. Внешние факторы зависят от времени и констант.',
      147: 'В текстовых выражениях доступны X1…X13, F1…F8 и t для системы (4); степень обозначается **. В отдельном табличном варианте используются X1…X11 и F1…F7. Разрешены sin, cos, exp, log, sqrt, tanh, abs, min и max. Математическая запись строится из проверенного синтаксического дерева. При вводе чисел заменяются числовые литералы; переменные и операции сохраняются. В системе (4) дополнительно проверяются списки аргументов каждой части.',
      149: 'Класс Dynamics вычисляет Fⱼ(t), формирует окружение X и F, затем получает две алгебраические части каждой производной. Их разность делится на положительный параметр нормирования. Исходные знаки сохраняются. В конфигурации параметр называется scales, а в формулах системы (4) отображается как Xᵢᵐᵃˣ.',
      159: 'Схема Pydantic проверяет согласованные размерности: 13 начальных условий, параметров нормирования и пар выражений с 8 факторами либо 11 состояний с 7 факторами для таблицы 1. Неизвестные поля запрещены. Ограничены точность, число точек и машинный интервал. Локальный сервер ограничивает длительность и число вычислений правой стороны; одновременно выполняются не более двух операций.',
      162: 'CSV системы (4) содержит время, 13 Xᵢ и 8 Fⱼ: всего 22 столбца. Табличный вариант содержит 19 столбцов. Используются десятичная точка и разделитель «;». Полный JSON дополнительно сохраняет конфигурацию, производные, f⁺ и f⁻, четвертные срезы, предупреждения и диагностические данные.',
      165: f'Интерфейс собирается Vite после проверки TypeScript. JavaScript-зависимости зафиксированы в package-lock.json, библиотеки Python – в requirements.txt. Эксперименты текущего отчёта выполнены с Python {summary["python"]}, NumPy {summary["numpy"]} и SciPy {summary["scipy"]}. Онлайн-версия использует собственную зафиксированную среду WebAssembly; согласованность с локальным ядром проверяется отдельно.',
      167: paragraphs[167].text.replace('При первом открытии', 'При переходе к расчёту').replace('; последующие', '. Последующие'),
      171: 'При открытии показаны 13 строк системы (4) в общем виде и обозначения внешних факторов. Кнопка «Перейти к расчёту» открывает частный кубический пример. Слева находятся сценарий, начальные условия и настройки решателя. В расчёте доступны общий график, редактор зависимостей, внешние факторы и лепестковые диаграммы. Вернуться к общей системе можно из расчётного экрана.',
      177: 'Все 11 траекторий показаны на одном графике. Линии отмечены индексами Xᵢ, названия приведены в интерактивной легенде. При прокрутке к формулам компактный график виден слева, а на узких экранах открывается кнопкой. Линии проходят через точки численного решения. В одиночном режиме можно просмотреть каждую из 13 характеристик.',
      179: 'На вкладке «Внешние факторы» все восемь функций расположены подряд. Слева находится Fⱼ(t) с четырьмя редактируемыми коэффициентами, справа – её график. Переключатель между факторами не нужен. После ввода полином фактора и связанная система пересчитываются. Под каждой формулой раскрывается численная подстановка.',
      180: 'В расчётном экране все уравнения доступны последовательно. У функции с несколькими входами выбирается редактируемый кубик. Все слагаемые видны в численной подстановке. Нажатие на X или F переносит к месту задания переменной. Во вкладке «Зависимости» доступны подробный график выбранной части и её численный результат.',
      181: 'Стартовые коэффициенты a, b, c, d подобраны для заметной кривизны всех 11 основных траекторий. Они округляются до сотых до запуска решателя; отображаемая формула соответствует рассчитанной. Кнопка случайного заполнения подбирает близкий корректный кубический пример с положительными конечными значениями и заметным изгибом. При ручной правке сохраняются все требуемые аргументы. Скрытого восстановления коэффициентов статьи нет.',
      182: 'В подробном редакторе слева показана выбранная функция при фиксированных остальных аргументах, справа – решение уравнений по времени. Это разные графики: первый показывает зависимость от выбранного аргумента, второй – итог совместного расчёта всей системы. Подстановка исходных значений, вычисления f⁺ и f⁻, начальная производная и конечное значение доступны под формулами.',
      190: 'Лепестковые диаграммы показывают четыре четверти. Каждый луч соответствует одному из 11 показателей, его край отмечен красным контуром и подписан значением Rᵢ. Начальные пределы совпадают с Xᵢᵐᵃˣ. В разделе «Пределы шкал» для нового значения доступно поле на пять символов. Точные значения срезов приведены в таблице.',
      197: 'Ошибки синтаксиса и области определения отображаются явно. Проверены запрет __import__, нулевые знаменатели и изменение начального состояния. Для узкого экрана блоки перестраиваются, широкие формулы прокручиваются внутри своей области. Ползунки и стрелки внутри формул скрыты; ввод коэффициентов сохранён.',
      204: paragraphs[204].text.replace('деление на S', 'нормирование'),
      213: f'Все пять численных критериев выполнены. Максимальная масштабированная разность трёх методов с уточнённым решением составляет {summary["verification_max_error"]:.3e} при пороге 10⁻⁵. Абсолютные ошибки двух аналитических эталонов меньше 10⁻⁸. Это проверка вычислений на перечисленных задачах, а не оценка достоверности прогноза аварии.',
      215: f'Набор pytest содержит {test_count} успешно выполненный тестовый случай. Проверяются обе редакции системы, списки аргументов, все кубические части и факторы, округление коэффициентов перед решением, аналитические эталоны, четверти, API и ошибки области определения. Для текущего стартового примера дополнительно проверены положительность, согласованные пределы и кривизна всех 11 основных траекторий.',
      217: f'Целевая проверка текущих исправлений содержит {len(review["checks"])} успешных браузерных критериев. Проверены закреплённый график при редактировании на окнах 1366 × 768, 1280 × 650 и 390 × 900, фактический пересчёт после ввода, все восемь факторов, четыре радара и пять численных проверок. Необработанных ошибок JavaScript не обнаружено.',
      218: 'Отдельные сценарии браузерной проверки проверяют локальную и статическую версии, редактирование обеих частей, незавершённые числа, запоздавшие ответы, сброс и экспорт. Статическая версия исполняет production-модули Python в WebAssembly и сравнивается с локальным Python на полной сетке четырёх исходных табличных сценариев. Протоколы хранят фактическую среду и измеренное расхождение; они не подменяют проверку модели по наблюдениям.',
      224: f'Начальные условия, нормирование и профили факторов приведены в таблицах 2, 3 и 9. Для t от 0 до 1 получены {len(b["t"])} точка и четыре четвертных среза. Все 13 характеристик положительны и ниже выбранных Xᵢᵐᵃˣ на полной сетке. Минимальное расстояние до верхней границы составляет {fmt(summary["minimum_limit_margin"])}.',
      225: f'Отпечаток конфигурации SHA-256: {b["fingerprint"]}. Выполнено {b["diagnostics"]["nfev"]} вычислений правой стороны при максимальном шаге 0,01. Отпечаток и полный набор параметров позволяют воспроизвести именно этот сценарий.',
      236: f'Площадь X₃ изменяется с {fmt(c["initial"][2])} до {fmt(b["y"][-1][2])}. Отклонение её траектории от прямой между началом и концом достигает {fmt(summary["state_departures"][2]*100)}% общего вертикального размаха основного графика. Поэтому изгиб виден в совместной шкале.',
      237: f'У всех 11 основных траекторий отклонение от соединяющей концы прямой превышает {fmt(min(summary["state_departures"])*100)}% общего размаха. Имеются ускорение, замедление и внутренние экстремумы. Это поведение численного решения выбранных кубических функций; к линиям не применяется искусственное сглаживание. Показатели остаются относительными величинами.',
      239: 'На четырёх срезах одинаковые порядок осей и пределы Rᵢ из таблицы 2. Красный контур отмечает эти пределы на диаграмме каждой четверти. Внутри контура изменение радиуса пропорционально изменению Xᵢ.',
      243: 'Радиусы меняются неодинаково и не заполняют диаграмму единицами. Значения проверяются по четвертным таблицам и временным графикам. Большой радиус не имеет единого смысла полезности: X₁₂ характеризует эффективность оповещения, X₅ и X₆ – поражение. Многоугольник показывает структуру состояния, а не совокупный риск.',
      245: 'В опыте с ветром коэффициент a₃ изменён с 0,20 до 0,23; F₃(1) меняется с 1,15 до 1,18. В опыте с задержкой d₅ изменён с 0,50 до 0,52; весь профиль F₅(t) увеличен на 0,02. Каждый опыт меняет только один параметр одного фактора. Все остальные уравнения и начальные условия сохраняются.',
      256: f'После изменения ветра X₃(1) = {fmt(data[1]["y"][-1][2])} вместо {fmt(b["y"][-1][2])}. В кубическом примере F₃ имеет собственный полином в частях f₁⁻, f₃⁺ и f₄⁻. Связанные уравнения передают изменение другим характеристикам.',
      257: f'После изменения задержки X₂(1) = {fmt(data[2]["y"][-1][1])} вместо {fmt(b["y"][-1][1])}. В данной редакции F₅ входит в f₆⁺ и f₁₂⁻. Полученный отклик определяется именно этими формулами и обратными связями. Направление изменения не следует заменять заранее выбранной физической интерпретацией.',
      259: 'В четвёртом опыте коэффициент a₁ увеличен с 0,60 до 0,63. Начальное F₁(0) = 0,40 сохраняется, конечное F₁(1) меняется с 1,10 до 1,13. Остальные коэффициенты и условия базовые. F₁ присутствует в f₁⁺, f₂⁺, f₃⁺ и f₄⁻, поэтому воздействие передаётся нескольким характеристикам.',
      263: f'При изменении объёма X₆(1) = {fmt(data[3]["y"][-1][5])} вместо {fmt(b["y"][-1][5])}; относительная разность по формуле (15) равна {fmt(100*(data[3]["y"][-1][5]/b["y"][-1][5]-1))}%. Для X₂ получено {fmt(data[3]["y"][-1][1])}, для X₃ – {fmt(data[3]["y"][-1][2])}. Все числа получены решением текущего кубического примера.',
      264: 'Следует различать точность переноса структуры рисунка, корректность выбранной аналитической формы и точность численного решения. Здесь сверены списки аргументов и подстановки, а решение сопоставлено с другими методами. Численные коэффициенты демонстрации не являются физической калибровкой; для неё необходимы наблюдения.',
      269: 'Для прикладного использования потребовались бы единицы и ограничения показателей, оценка параметров по наблюдениям и проверка на независимых данных. Структура рисунка и кубическая форма реализованы как учебная постановка. Успешное интегрирование само по себе не подтверждает пригодность выбранных коэффициентов для промышленного объекта.',
      273: 'Пределы Rᵢ заданы пользователем и не доказывают ограниченность решения между узлами. Встроенная проверка использует конечный набор эталонов и одну конфигурацию. Она не является доказательством для всех пользовательских формул. Онлайн-версия зависит от WebAssembly, памяти и скорости устройства; локальная версия сохраняет запуск с Python-сервером.',
      275: 'Приложение открывается общей системой из 13 строк рисунка (4). В расчётном примере 19 частей уравнений используют отдельный полином для каждого указанного входа. Восемь факторов кубически зависят от времени. Для 11 основных характеристик построен общий график. Доступны редактирование коэффициентов, численные подстановки, лепестковые срезы и экспорт.',
      276: 'Четыре эксперимента выполнены на текущем кубическом примере: базовый, изменение ветра, задержки и объёма. Для каждой четверти единичного интервала построены лепестковые диаграммы с общими заданными пределами. Таблицы, подстановки и графики получены из файлов рабочего вычислительного ядра.',
      277: f'Завершены {test_count} тестовый случай Python/API и {len(review["checks"])} целевых браузерных проверок текущих исправлений. Все пять встроенных численных критериев выполнены. Проверено, что все 11 основных траекторий заметно изгибаются в общей шкале, а все восемь факторов нелинейны. Исходная табличная редакция и формулы статьи сохранены отдельно для сверки.',
    }
    for i, text in values.items(): replace_paragraph(paragraphs[i], text)
    # The new function table precedes the previous tables 4 through 8.
    for p in document.paragraphs:
        text = p.text
        if m := re.fullmatch(r'Таблица ([4-8])', text):
            text = 'Таблица ' + str(int(m.group(1))+1)
        else:
            text = re.sub(r'таблице ([4-8])(?=\D|$)', lambda m:'таблице '+str(int(m.group(1))+1), text)
        text = text.replace('В таблице 9 приведены', 'В таблице 4 приведены').replace('таблицах 2, 3 и 9', 'таблицах 2, 3 и 4')
        if text != p.text: replace_paragraph(p, text)
    # Renumber the six remaining general formulas after expanding 11 rows to 13.
    for table in tables[5:]:
        if len(table.rows) == 1 and len(table.columns) == 3:
            p = table.cell(0, 2).paragraphs[0]
            m = re.fullmatch(r'\((\d+)\)', p.text.strip())
            if m: replace_paragraph(p, f'({int(m.group(1))+2})')
    for i in [130]:
        replace_paragraph(paragraphs[i], paragraphs[i].text.replace('(16)', '(18)').replace('(17)', '(19)'))
    # Requirements table: retain the original cells and visual design.
    replacements = {'X₁…X₁₁': 'X₁…X₁₃', 'F₁…F₇': 'F₁…F₈', 'семи': 'восьми', 'Семь': 'Восемь', 'одиннадцати': 'тринадцати'}
    for row in tables[0].rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                text = p.text
                for old, new in replacements.items(): text = text.replace(old, new)
                if text != p.text: replace_paragraph(p, text)
    requirements = [
        ('Ввод начальных условий','Экранная форма X₁(0)…X₁₃(0) и положительных Xᵢᵐᵃˣ'),
        ('Ввод fᵢ⁺ и fᵢ⁻','Все 13 строк рисунка (4), 19 присутствующих кубических частей'),
        ('Описание факторов среды','Восемь формул Fⱼ(t), редактируемых последовательно'),
        ('Численное решение на Python','scipy.integrate.solve_ivp: DOP853, RK45 и Radau'),
        ('Графики Xᵢ(t)','Один общий график 11 показателей; каждый из 13 доступен отдельно'),
        ('Лепестковые диаграммы','Четверти t = 0,25; 0,50; 0,75; 1,00, фиксированные пределы Rᵢ'),
        ('Вычислительные эксперименты','Кубический базовый пример, изменение ветра, задержки и объёма'),
        ('Выводы и отчёт','Подстановки, графики, таблицы, проверки и экспорт исходных чисел'),
    ]
    for row, cells in zip(tables[0].rows[1:],requirements):
        for cell, value in zip(row.cells,cells): replace_paragraph(cell.paragraphs[0],value)
    for row in tables[9].rows[1:]:
        if row.cells[0].text == 'backend/defaults.py':
            replace_paragraph(row.cells[1].paragraphs[0], 'Формулы рисунка (4) и таблицы 1; исходные и кубические сценарии')
        if row.cells[0].text == 'scripts/reproduce.py':
            replace_paragraph(row.cells[0].paragraphs[0], 'scripts/reproduce_system4.py')
            replace_paragraph(row.cells[1].paragraphs[0], 'Текущие эксперименты, численные таблицы и научные графики отчёта')
    plain_table(tables[1], ['Код', 'Характеристика', 'Xᵢ(0)', 'Xᵢᵐᵃˣ = Rᵢ'],
                [[code(i), name, fmt(c['initial'][i]), fmt(c['scales'][i])] for i, name in enumerate(b['state_names'])], [1.2, 8.8, 2.2, 3.3])
    plain_table(tables[2], ['Код', 'Внешний фактор', 'Fⱼ(t)'],
                [[f'F{i+1}', name, ''] for i, name in enumerate(b['factor_names'])], [1, 5.5, 9])
    for i, factor_source in enumerate(c['factors']):
        set_math(tables[2].cell(i+1, 2).paragraphs[0], expression(factor_source, time_symbol='t'), 11)
    set_math(tables[3].cell(0, 1).paragraphs[0], [frac([run('d'), *x('i', True)], [run('dt')]), run('='),
        frac([sup(sub('f','i'),run('+')),run('−'),sup(sub('f','i'),run('−'))], [xmax('i')]), run(','),
        *x('i'), group([run('0')]), run('='), sup(sub('X','i'),run('0'))])
    arguments = json.loads((ROOT / 'backend/system4.json').read_text('utf8'))['arguments']
    resize_rows(tables[4], 13)
    for i, (plus, minus) in enumerate(arguments):
        rhs = function(i+1, '+', plus)
        if minus: rhs += [run('−'), *function(i+1, '−', minus)]
        nodes = [frac([run('d'), *x(i+1, True)], [run('dt')]), run('='), frac([run('1')], [xmax(i+1)]), delimit(rhs)]
        set_math(tables[4].cell(i,1).paragraphs[0], nodes, 11.5)
        replace_paragraph(tables[4].cell(i,2).paragraphs[0], f'({i+2})')
    # Replace old automatic-max radar equation by the actual fixed-limit definition.
    set_math(tables[7].cell(0,1).paragraphs[0], [sub('r','i'),group([run('t')]),run('='),frac(x('i',True),[sub('R','i')]),run(','),sub('R','i'),run('>0')])
    for node in document._element.body.iter(qn('m:t')):
        if node.text: node.text=node.text.replace('τ','t')
    plain_table(tables[11], ['Проверка', 'Ошибка', 'Порог', 'Итог'],
        [[v['name'], f'{v["error"]:.3e}', f'{v["limit"]:.0e}', 'Пройдена'] for v in verification['checks']], [7,3,2,3.5])
    replace_paragraph(tables[12].cell(1,0).paragraphs[0], 'F₃ = 0 в исходных формулах статьи')
    replace_paragraph(tables[12].cell(1,1).paragraphs[0], 'Отказ с указанием X₁: нулевой знаменатель, без искусственного ε')
    replace_paragraph(tables[12].cell(4,0).paragraphs[0], 'Нулевые начальные значения и функции в отдельном табличном тесте')
    replace_paragraph(tables[12].cell(7,1).paragraphs[0], 'Остальные семь факторных профилей неизменны в системе (4)')
    plain_table(tables[13], ['Код','t = 0,25','t = 0,50','t = 0,75','t = 1,00'],
        [[code(i), *[fmt(q['values'][i]) for q in b['quarters']]] for i in indices], [2,3.375,3.375,3.375,3.375])
    plain_table(tables[14], ['Код','Базовый','Ветер','Задержка','Объём'],
        [[code(i), *[fmt(r['y'][-1][i]) for r in data]] for i in indices], [2,3.375,3.375,3.375,3.375])
    replace_paragraph(paragraphs[254], 'Итоговые значения Xᵢ при t = 1 в четырёх экспериментах')
    # Add a complete coefficient table in the mathematical-model section.
    anchor = paragraphs[106]._p
    def insert_paragraph(text='', align=None):
        nonlocal anchor
        p = document.add_paragraph(text)
        if align is not None: p.alignment = align; p.paragraph_format.first_line_indent = Cm(0)
        anchor.addnext(p._p); anchor = p._p
        return p
    p = insert_paragraph('Каждый вход в частном примере рассчитывается по кубической формуле.')
    p = insert_paragraph(); set_math(p, [run('P'),group([run('x')]),run('='),*expression('a*x**3+b*x**2+c*x+d',time_symbol='t')])
    p = insert_paragraph('Таблица 4', A.RIGHT); p.paragraph_format.keep_with_next = True
    p = insert_paragraph('Коэффициенты кубических полиномов по входам', A.CENTER); p.paragraph_format.keep_with_next = True
    function_table = document.add_table(rows=1, cols=6)
    function_table.style = tables[1].style
    anchor.addnext(function_table._tbl); anchor = function_table._tbl
    records=[]
    for i, (_, minus) in enumerate(arguments):
        for kind, sign in [('plus','+'), ('minus','−')]:
            if kind == 'minus' and not minus: continue
            fields=b['equation_fields'][kind][i]
            assert fields['multiplier'] is None and fields['projection'] is None
            for part in fields['components'] or [fields]:
                assert len(part['coefficients']) == 4
                records.append({'i':i+1, 'sign':sign, 'argument':part['argument'],
                                'coefficients':part['coefficients']})
    plain_table(function_table, ['Часть','Вход','a','b','c','d'],
        [['','',*[f'{v:.2f}'.replace('.',',') for v in r['coefficients']]] for r in records],
        [2,2.4,2.775,2.775,2.775,2.775], 10.5)
    borders=deepcopy(tables[1]._tbl.tblPr.find(qn('w:tblBorders')))
    if borders is None:
        borders=OxmlElement('w:tblBorders')
        for side in ['top','left','bottom','right','insideH','insideV']:
            edge=OxmlElement('w:'+side)
            for key,value in [('val','single'),('sz','4'),('color','B8C2CC')]: edge.set(qn('w:'+key),value)
            borders.append(edge)
    if borders is not None: function_table._tbl.tblPr.append(borders)
    for cell in function_table.rows[0].cells:
        shading=OxmlElement('w:shd'); shading.set(qn('w:fill'),'E9ECEF')
        cell._tc.get_or_add_tcPr().append(shading)
    for i, r in enumerate(records):
        set_math(function_table.cell(i+1,0).paragraphs[0], [sup(sub('f',r['i']),run(r['sign']))], 11)
        set_math(function_table.cell(i+1,1).paragraphs[0], expression(r['argument'],state_time=True,time_symbol='t'), 11)
    figures = [
      ('figures/system4-architecture.png','Два способа запуска общего вычислительного ядра'),
      ('evidence/review/general.png','Стартовый экран системы (4) с переходом к расчёту'),
      ('evidence/review/factors.png','Последовательный редактор восьми факторов: видимая часть списка'),
      ('evidence/review/calculation.png','Кубические части X₄ и раскрытая численная подстановка'),
      ('evidence/review/radars.png','Лепестковые срезы с красной границей верхних пределов'),
      ('evidence/review/verification.png','Встроенная проверка текущего кубического решения'),
      ('figures/system4-verification.png','Ошибки аналитических и межметодных проверок'),
      ('figures/system4-states-1.png','Временные зависимости X₁–X₆ кубического примера'),
      ('figures/system4-states-2.png','Временные зависимости X₈–X₁₂ кубического примера'),
      ('figures/system4-radar-four.png','Состояния в четырёх четвертях при фиксированных пределах Rᵢ'),
      ('figures/system4-factors.png','Восемь кубических факторов и исследуемые возмущения'),
      ('figures/system4-comparison.png','Отклик на изменение ветра и задержки оповещения'),
      ('figures/system4-volume.png','Изменение объёма и отклик X₂, X₆, X₁₂'),
    ]
    crops=json.loads((EVIDENCE/'review/metrics.json').read_text('utf8')).get('crops',{})
    for i, (relative, caption) in enumerate(figures):
        cap=next(p for p in document.paragraphs if p.text.startswith(f'Рисунок {i+1} –'))
        replace_paragraph(cap, f'Рисунок {i+1} – {caption}')
        shape=document.inline_shapes[i]; image=REPORT/relative
        # Crop only the empty sidebar of viewport captures; preserve real pixels.
        if relative.startswith('evidence/review/'):
            with Image.open(image) as pixels:
                bounds=crops.get(Path(relative).stem)
                if bounds:
                    image=REPORT/'figures'/('report-ui-'+Path(relative).name)
                    pixels.crop(bounds).save(image)
        relationship=shape._inline.xpath('.//a:blip')[0].get(qn('r:embed'))
        document.part.related_parts[relationship]._blob=image.read_bytes()
        with Image.open(image) as pixels: shape.height=round(shape.width*pixels.height/pixels.width)
        shape._inline.docPr.set('descr',caption)
    # Keep the literature and design parts byte-identical before Word refreshes fields.
    assert [p._p.xml for p in document.paragraphs if re.match(r'^\d+\. ',p.text)] == bibliography
    assert etree.tostring(document.styles.element) == original_styles
    output=REPORT/(NAME+'.docx'); document.save(output)
    manifest={'source':source.name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'model':'system4_cubic','fingerprint':b['fingerprint'],
        'tests':test_count,'review_checks':len(review['checks']),'native_math':len(document._element.xpath('.//m:oMath')),
        'figures':figures,'functions':records,'arguments':arguments,
        'headings':[p.text for p in document.paragraphs if p.style.name.startswith('Heading')],
        'main_indices':indices,'coefficient_table_number':4}
    (EVIDENCE/'system4-report-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'output':str(output),'native_math':manifest['native_math'],'tables':len(document.tables),'figures':len(document.inline_shapes)},ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--source',type=Path,required=True)
    refresh(parser.parse_args().source.resolve())
