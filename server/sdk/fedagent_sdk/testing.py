"""插件契约测试：在小数据和假模型上把一个算法跑完所有轮次，并检查数据流声明被遵守。

测试工具用平台真实的编排（不是另写一套），所以开发插件时要把平台包 fedagent 装成开发依赖。
用法见 fedagent.testing.run_contract。
"""

from __future__ import annotations

from typing import Any


def run_contract(*args: Any, **kwargs: Any) -> Any:
    try:
        from fedagent.testing import run_contract as _run
    except ImportError as error:  # pragma: no cover - 只在没装平台包时触发
        raise RuntimeError("契约测试需要安装平台包 fedagent（插件开发时作为开发依赖）") from error
    return _run(*args, **kwargs)
