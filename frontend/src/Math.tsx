import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const definitionHref = /^#(?:(?:definition-[XF]|divisor-X|initial-X)\d{1,2}|model-time)$/;

export function MathFormula({ source, block = false, linkVariables = false }: {
  source: string; block?: boolean; linkVariables?: boolean;
}) {
  const html = useMemo(() => {
    const linked = linkVariables ? source.replace(
      /([XFS])_\{(\d{1,2})\}(\^\{\\max\}|\(t\)|\(0\))?|\\tau(?![A-Za-z])|(?<![A-Za-z\\])t(?![A-Za-z])/g,
      (symbol, kind?: string, index?: string, suffix?: string) => {
        const id = !kind ? 'model-time'
          : kind === 'S' || suffix === '^{\\max}' ? 'divisor-X' + index
          : kind === 'X' && suffix === '(0)' ? 'initial-X' + index : 'definition-' + kind + index;
        return '\\href{#' + id + '}{' + symbol + '}';
      },
    ) : source;
    const active = linked !== source;
    const markup = katex.renderToString(linked, {
      displayMode: block, throwOnError: false,
      trust: context => active && context.command === '\\href' && definitionHref.test(context.url),
      strict: 'error', maxExpand: 500, output: active ? 'html' : 'htmlAndMathml',
    });
    if (!active) return markup;
    return markup.replace('class="katex-html" aria-hidden="true"', 'class="katex-html formula-links"')
      .replace(/href="#model-time"/g, 'href="#model-time" aria-label="Модельное время"')
      .replace(/href="#(definition|divisor|initial)-([XF]\d{1,2})"/g, (href, target: string, name: string) =>
        href + ' aria-label="' + (target === 'initial' ? 'Начальное условие '
          : target === 'divisor' ? 'Делитель ' : name.startsWith('F') ? 'Внешний фактор ' : 'Уравнение ') + name + '"');
  }, [source, block, linkVariables]);
  return <span className={block ? 'math-block' : 'math-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
}
