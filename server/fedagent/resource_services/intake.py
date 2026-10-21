"""一次事务创建数据与来源，不依赖 HTTP 或文件上传类型。"""

from .. import models as m
from ..errors import ServiceError
from ..registry import SCENARIOS
from ..schemas import DataResourceOut, ParticipantIn
from .common import not_found
from .datasets import create_dataset, dataset_out
from .participants import create_participant, participant_out


def create_data_resource(platform, session, *, name, task_type, hosting, scenario=None, source_id=None, source_name="", description="", raw=None):
    supported = [item.id for item in SCENARIOS if task_type in platform.registry.task_types_for(item.id)]
    if not supported:
        raise ServiceError(422, "还没有算法支持这种任务类型")
    category = scenario or supported[0]
    if source_id:
        source = session.get(m.Participant, source_id)
        if source is None:
            raise not_found("数据来源")
        if source.builtin:
            raise ServiceError(409, "请选择自己的数据来源，或新建来源；公用来源由平台维护")
        if source.hosting != hosting:
            raise ServiceError(422, "运行位置和已有数据来源不一致")
    else:
        source = create_participant(session, ParticipantIn(name=source_name.strip() or name, hosting=hosting))  # type: ignore[arg-type]
    dataset, checked = create_dataset(
        platform, session, participant_id=source.id, name=name, description=description, scenario=category, task_type=task_type, raw=raw
    )
    if dataset is None:
        session.rollback()
        raise ServiceError(422, {"message": "数据文件检查不通过", "check": checked.model_dump() if checked else None})
    return DataResourceOut(dataset=dataset_out(dataset), source=participant_out(platform, source))
