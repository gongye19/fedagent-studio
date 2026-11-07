"""本地过程记录生成器的模型通道：复用已配置接口，密钥始终留在平台。"""
from typing import Literal

from pydantic import BaseModel, Field

from ..errors import ServiceError
from .dependencies import PlatformDep, admin_router

router = admin_router()


class GenerationMessage(BaseModel):
    role: Literal['system', 'user', 'assistant']
    content: str = Field(min_length=1, max_length=30000)


class GenerationRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    messages: list[GenerationMessage] = Field(min_length=1, max_length=30)


@router.post('/record-generation/chat', tags=['records'])
def generate(body: GenerationRequest, platform: PlatformDep) -> dict:
    """由本地工具主动调用；不创建题库或任务，也不返回模型凭据。"""
    if sum(len(message.content) for message in body.messages) > 60000:
        raise ServiceError(422, '生成请求过长')
    reply = platform.gateway.model(body.model, purpose='record-generation').chat(
        [message.model_dump() for message in body.messages], max_tokens=4096, temperature=0,
    )
    return {'text': reply.text, 'usage': reply.usage}
