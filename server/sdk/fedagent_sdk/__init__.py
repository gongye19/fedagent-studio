"""FedAgent Studio 插件开发包。

- 算法插件：继承 Algorithm，写 manifest.yaml，每一步用 @step 标出；
- 任务类型插件：继承 TaskType；判分插件：继承 Grader；
- 每一步通过 StepContext 读写，能力由清单决定。
"""

from .algorithm import Algorithm, step
from .context import OutgoingMessage, SiteInfo, StepContext, StepIO, UnitResult
from .manifest import SERVER, Manifest, ParamDef, StepDef, load_manifest
from .model import ChatResult, Model, ModelError
from .tasktype import CheckIssue, CheckReport, Grader, Row, TaskType
from .types import (
    ApplyRequest,
    ApplyResult,
    Artifact,
    CapabilityError,
    Estimate,
    Issue,
    Item,
    Message,
    OutputEntry,
    SiteSpec,
    StepFailed,
    TaskSpec,
)

__all__ = [
    "SERVER",
    "Algorithm",
    "ApplyRequest",
    "ApplyResult",
    "Artifact",
    "CapabilityError",
    "ChatResult",
    "CheckIssue",
    "CheckReport",
    "Estimate",
    "Grader",
    "Issue",
    "Item",
    "Manifest",
    "Message",
    "Model",
    "ModelError",
    "OutgoingMessage",
    "OutputEntry",
    "ParamDef",
    "Row",
    "SiteInfo",
    "SiteSpec",
    "StepContext",
    "StepDef",
    "StepFailed",
    "StepIO",
    "TaskSpec",
    "TaskType",
    "UnitResult",
    "load_manifest",
    "step",
]
