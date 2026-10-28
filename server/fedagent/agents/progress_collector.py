"""只收取接入方明确公开的动作；兼容不支持过程事件的旧服务。"""
import logging

from fedagent_sdk import ProgressUpdate, StepFailed
from pydantic import ValidationError

from ..task_services.process import append, last_sequence
from .protocol import ProgressPage


class ProgressCollector:
    def __init__(self, platform, gateway, agent_id, body, unit_id):
        self.platform, self.gateway, self.agent_id, self.body = platform, gateway, agent_id, body
        self.enabled = unit_id is not None
        self.after = last_sequence(platform, body.task_id, body.run_id) if self.enabled else 0

    def pull(self, available: bool) -> bool:
        if not available or not self.enabled:
            return False
        try:
            # 有界分页，下一次轮询继续，完成时由 drain 拉完。
            for _ in range(10):
                page = ProgressPage.model_validate(self.gateway.request(self.agent_id, "GET", f"/runs/{self.body.run_id}/events?after={self.after}"))
                if page.has_more and not page.events:
                    raise ValueError("事件分页未推进")
                for event in page.events:
                    if event.seq != self.after + 1 or (event.item_id is not None and event.item_id not in {item.id for item in self.body.items}):
                        raise ValueError("事件越过样本或序号边界")
                    self.save(event.seq, ProgressUpdate.model_validate(event.model_dump(exclude={"seq", "at"})), at=event.at)
                    self.after = event.seq
                if not page.has_more:
                    return False
            return True
        except (ValueError, ValidationError, RuntimeError, StepFailed) as error:
            # 可观测性故障不能改变算法产出或判分，但不能假装过程完整。
            logging.getLogger(__name__).warning("Agent progress unavailable: %s", type(error).__name__)
            # 传输警告使用独立origin，不能消耗服务事件序号，否则恢复后会漏读。
            origin = self.body.run_id + ":progress-error"
            if not last_sequence(self.platform, self.body.task_id, origin):
                append(self.platform, task_id=self.body.task_id, origin=origin, seq=1, site=self.body.site_id,
                       round=self.body.round, step=self.body.step, unit=self.body.unit_key,
                       event=ProgressUpdate(activity="progress-unavailable", title="过程记录中断", status="failed",
                                            summary="Agent 过程接口暂不可用，算法执行仍在继续"))
            self.enabled = False
            return False

    def save(self, seq, event, *, at=None):
        append(self.platform, task_id=self.body.task_id, origin=self.body.run_id, seq=seq, site=self.body.site_id,
               round=self.body.round, step=self.body.step, unit=self.body.unit_key, event=event, at=at)
