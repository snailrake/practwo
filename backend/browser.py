"""Browser bridge: execute the existing Python model, never a translated copy."""
import json
import platform
import sys

import numpy
import scipy
from pydantic import ValidationError

from .defaults import STATE_NAMES, FACTOR_NAMES, presets
from .expressions import ModelError
from .model import SimulationConfig, simulate
from .verification import verify


def dispatch(operation: str, payload: str = '{}') -> str:
    try:
        if operation == 'presets':
            result = {'presets': presets(), 'state_names': STATE_NAMES, 'factor_names': FACTOR_NAMES}
        elif operation == 'environment':
            result = {'python': platform.python_version(), 'numpy': numpy.__version__,
                      'scipy': scipy.__version__, 'platform': sys.platform,
                      'engine': 'WebAssembly' if sys.platform == 'emscripten' else 'native'}
        elif operation in {'simulate', 'verify'}:
            config = SimulationConfig(**json.loads(payload))
            result = simulate(config) if operation == 'simulate' else verify(config)
        else:
            raise ModelError('Неизвестная операция расчёта')
        return json.dumps({'ok': True, 'result': result}, ensure_ascii=False, allow_nan=False)
    except ValidationError as exc:
        first = exc.errors(include_url=False)[0]
        field = '.'.join(map(str, first['loc']))
        return json.dumps({'ok': False, 'error': f"Проверьте параметр {field}: {first['msg']}"}, ensure_ascii=False)
    except (ModelError, ValueError, TypeError) as exc:
        return json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False)
