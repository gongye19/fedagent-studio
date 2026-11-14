"""限制 LLM 接口出站地址，连接已检查的 IP，保留原始 Host 和 TLS 身份。"""
import ipaddress
import socket
import time
from collections.abc import Iterator
from urllib.parse import urlsplit

import httpcore
import httpx
from fedagent_sdk import ModelError


def allowed_address(host: str, address: str, allowlist: tuple[str, ...]) -> bool:
    ip = ipaddress.ip_address(address)
    ip = getattr(ip, "ipv4_mapped", None) or ip
    if ip.is_global:
        return True
    for rule in allowlist:
        if host.casefold().rstrip(".") == rule.casefold().rstrip("."):
            return True
        try:
            if ip in ipaddress.ip_network(rule, strict=False):
                return True
        except ValueError:
            continue
    return False


def validate_url(value: str, allowlist: tuple[str, ...] = ()) -> None:
    try:
        url = urlsplit(value)
        if (url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
                or url.query or url.fragment or any(char.isspace() for char in value) or url.port == 0):
            raise ValueError("invalid URL")
        host = url.hostname.rstrip(".")
        try:
            literal = str(ipaddress.ip_address(host))
        except ValueError:
            literal = "127.0.0.1" if host.casefold() == "localhost" else None
        if literal and not allowed_address(host, literal, allowlist):
            raise ModelError("该模型地址属于受限网络，请由管理员配置允许的接口地址")
    except ValueError as error:
        raise ModelError("接口地址要使用有效的 http:// 或 https:// 地址") from error


class PublicModelBackend(httpcore.SyncBackend):
    def __init__(self, allowlist: tuple[str, ...]):
        self.allowlist = allowlist

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        try:
            addresses = list(dict.fromkeys(str(item[4][0]) for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
        except OSError as error:
            raise httpcore.ConnectError("无法解析模型接口地址") from error
        if not addresses or any(not allowed_address(host, address, self.allowlist) for address in addresses):
            raise httpcore.ConnectError("模型接口地址解析到受限网络")
        # 使用同一次解析检查的字面 IP 建立连接，避免检查后重新解析域名。
        started = time.monotonic()
        last_error = None
        for address in addresses:
            remaining = None if timeout is None else max(0.0, timeout - (time.monotonic() - started))
            try:
                return super().connect_tcp(address, port, remaining, local_address, socket_options)
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as error:
                last_error = error
        raise httpcore.ConnectError("所有允许的模型地址均无法连接") from last_error


class ModelResponseStream(httpx.SyncByteStream):
    def __init__(self, response: httpcore.Response):
        self.response = response

    def __iter__(self) -> Iterator[bytes]:
        try:
            yield from self.response.iter_stream()
        except httpcore.TimeoutException as error:
            raise httpx.ReadTimeout("模型接口读取超时") from error
        except httpcore.NetworkError as error:
            raise httpx.ReadError("模型接口连接中断") from error

    def close(self) -> None:
        self.response.close()


class ModelTransport(httpx.BaseTransport):
    def __init__(self, allowlist: tuple[str, ...]):
        self.pool = httpcore.ConnectionPool(network_backend=PublicModelBackend(allowlist))

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            response = self.pool.handle_request(httpcore.Request(
                method=request.method,
                url=httpcore.URL(scheme=request.url.raw_scheme, host=request.url.raw_host,
                                 port=request.url.port, target=request.url.raw_path),
                headers=request.headers.raw, content=request.stream, extensions=request.extensions,
            ))
        except httpcore.TimeoutException as error:
            raise httpx.ConnectTimeout("模型接口连接超时") from error
        except (httpcore.NetworkError, httpcore.ProtocolError) as error:
            raise httpx.ConnectError("无法连接允许的模型接口地址") from error
        return httpx.Response(response.status, headers=response.headers, stream=ModelResponseStream(response), extensions=response.extensions)

    def close(self) -> None:
        self.pool.close()


def model_client(timeout: httpx.Timeout, allowlist: tuple[str, ...], transport: httpx.BaseTransport | None) -> httpx.Client:
    transport = transport or ModelTransport(allowlist)
    return httpx.Client(timeout=timeout, transport=transport, follow_redirects=False, trust_env=False)
