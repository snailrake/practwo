export type Config = {
  name: string; initial: number[]; scales: number[]; factors: string[];
  plus: string[]; minus: string[]; method: 'DOP853' | 'RK45' | 'Radau';
  rtol: number; atol: number; samples: number; t_end: number;
};
export type Result = {
  config: Config; fingerprint: string; t: number[]; y: number[][];
  factors: number[][]; plus: number[][]; minus: number[][]; derivatives: number[][];
  radar_scales: number[];
  quarters: { t: number; values: number[]; normalized: number[] }[];
  state_names: string[]; factor_names: string[]; equations_tex: string[]; factors_tex: string[];
  warnings: string[]; dependencies: { target: string; sources: string[] }[];
  diagnostics: { method: string; rtol: number; atol: number; nfev: number; njev: number;
    samples: number; elapsed_ms: number; max_step: number; scipy_success: boolean };
};
export type Verification = {
  checks: { name: string; error: number; limit: number; passed: boolean }[];
  passed: boolean; note: string;
  reference: { method: string; rtol: number; atol: number; max_step: number; nfev: number };
};
