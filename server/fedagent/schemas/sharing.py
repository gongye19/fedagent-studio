"""资源归属与共享分别表达；当前归属不是多账号身份凭据。"""
from .base import Model


class ResourceInfo(Model):
    owner_id: str
    owner_name: str
    shared: bool


class SharingIn(Model):
    shared: bool
