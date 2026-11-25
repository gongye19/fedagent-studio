import hashlib
import urllib.request

import pytest

from tools.lifestyle.common import jsonl, save
from tools.lifestyle.preservation.fixtures import (
    AUDIT_SNAPSHOT,
    EXERCISE_ID,
    PLATE_FILE,
    SOURCE_FILE,
    build_references,
)


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("preservation check attempted network access")

    monkeypatch.setattr(urllib.request, "urlopen", forbidden)


@pytest.fixture
def source(tmp_path):
    root = tmp_path / "data"
    body = "Older adults need 150 minutes of moderate-intensity aerobic physical activity each week. "
    body += "Or choose 75 minutes a week of vigorous-intensity activity. Or they could get an equivalent combination. "
    body += "People with chronic conditions may want to talk to a health care professional. Everyone's fitness level is different."
    first = {
        "id": EXERCISE_ID,
        "body": body,
        "url": "https://example.test/exercise",
        "source": "CDC",
        "payloadDigest": "test-version",
        "original": {"sourceDates": ["test-date"]},
    }
    pool = [first] + [{"id": f"other-{i}", "source": "test", "body": "fixture source"} for i in range(443)]
    jsonl(root / SOURCE_FILE, pool)
    html = '<link rel="canonical" href="https://www.cdc.gov/diabetes/healthy-eating/diabetes-meal-planning.html"/>'
    html += "Diabetes Meal Planning. Work with your doctor or a registered dietitian. Try the plate method. "
    html += "Fill half with nonstarchy veggies. Fill one quarter with a lean protein. Fill one quarter with carb foods. "
    html += "A good meal plan will consider your goals. Find out how many carbs you should aim for."
    html = html.replace("Find out", "find out")
    (root / PLATE_FILE).parent.mkdir(parents=True)
    (root / PLATE_FILE).write_text(html)
    save(root / AUDIT_SNAPSHOT, {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in (SOURCE_FILE, PLATE_FILE)})
    full = root / "full/run-20261119/federation"
    jsonl(full / "inputs/batch-01-CDC.jsonl", [{"id": "legacy-record", "provenance": {"sourceItemId": EXERCISE_ID}}])
    jsonl(
        full / "platform/runs/task-f1035bb4/messages/r1/extract.jsonl",
        [{"item_id": "legacy-record", "payload": {"name": "legacy", "description": "generic method"}}],
    )
    save(full / "batch-01/library.json", {"insight_legacy": "generic strategy"})
    diet = root / "diet-trial/run-20261125"
    jsonl(diet / "platform/runs/task-a0491189/messages/r1/extract.jsonl", [{"payload": {"name": "legacy", "description": "plate method"}}])
    save(diet / "batch-01/library.json", {"insight_legacy": "balanced structure"})
    return root


@pytest.fixture
def reference(source):
    return build_references(source)[1][0]
