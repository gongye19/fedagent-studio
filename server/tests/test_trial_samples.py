from fastapi.testclient import TestClient
from test_api import config


def test_trial_sample_count_cannot_exceed_any_selected_dataset(client: TestClient):
    datasets = client.get("/v1/datasets").json()[:2]
    selected = [{"participantId": d["participantId"], "datasetId": d["id"]} for d in datasets]
    limit = min(d["count"] for d in datasets)
    body = config(selected, trialCap=limit + 1)
    validation = client.post("/v1/tasks/validate", json=body)
    assert validation.status_code == 200
    assert any(issue["field"] == "trialCap" for issue in validation.json()["issues"])
    assert client.post("/v1/tasks", json=body).status_code == 422
    valid = client.post("/v1/tasks/validate", json=config(selected, trialCap=limit)).json()
    assert not any(issue["field"] == "trialCap" for issue in valid["issues"])
    full = client.post("/v1/tasks/validate", json={**body, "mode": "full"}).json()
    assert not any(issue["field"] == "trialCap" for issue in full["issues"])
