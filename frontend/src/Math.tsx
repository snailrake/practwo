import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export function MathFormula({ source, block = false }: { source: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(source, {
    displayMode: block, throwOnError: false, trust: false,
    strict: 'error', maxExpand: 500, output: 'htmlAndMathml',
  }), [source, block]);
  return <span className={block ? 'math-block' : 'math-inline'} dangerouslySetInnerHTML={{ __html: html }} />;
}
