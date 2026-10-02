from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fedagent.api import create_app
from fedagent.platform import Platform
from fedagent.seed import seed
from fedagent.settings import Settings


@pytest.fixture
def platform(tmp_path: Path) -> Platform:
    created = Platform.create(Settings(data_dir=tmp_path))
    seed(created)
    return created


@pytest.fixture
def client(platform: Platform) -> Iterator[TestClient]:
    with TestClient(create_app(platform)) as test_client:
        yield test_client
