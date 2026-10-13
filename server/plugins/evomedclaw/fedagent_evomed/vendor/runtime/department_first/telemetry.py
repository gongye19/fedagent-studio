"""Telemetry helpers for department-first runtime."""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, Iterator, Optional


@dataclass
class TimedSpan:
    """Mutable span populated by the timing context manager."""

    duration_seconds: float = 0.0


class TimingUsageTracker:
    """Aggregates timing events across the department-first runtime."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self._events: list[Dict[str, Any]] = []
            self._by_source: Dict[str, Dict[str, Any]] = defaultdict(
                lambda: {
                    "event_count": 0,
                    "total_duration_seconds": 0.0,
                    "max_duration_seconds": 0.0,
                }
            )
            self._by_kind: Dict[str, Dict[str, Any]] = defaultdict(
                lambda: {
                    "event_count": 0,
                    "total_duration_seconds": 0.0,
                    "max_duration_seconds": 0.0,
                }
            )
            self._scenario_totals: Dict[str, float] = {}
            self._run_total_seconds: float = 0.0

    def record(
        self,
        *,
        source: str,
        duration_seconds: float,
        kind: str = "step",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        duration_seconds = max(float(duration_seconds), 0.0)
        event = {
            "source": str(source),
            "kind": str(kind),
            "duration_seconds": round(duration_seconds, 6),
            "metadata": dict(metadata or {}),
        }
        with self._lock:
            self._events.append(event)
            for bucket in (self._by_source[event["source"]], self._by_kind[event["kind"]]):
                bucket["event_count"] += 1
                bucket["total_duration_seconds"] += duration_seconds
                bucket["max_duration_seconds"] = max(bucket["max_duration_seconds"], duration_seconds)

            if event["kind"] == "scenario_total":
                scenario_id = event["metadata"].get("scenario_id")
                if scenario_id is not None:
                    self._scenario_totals[str(scenario_id)] = event["duration_seconds"]
            elif event["kind"] == "run_total":
                self._run_total_seconds = event["duration_seconds"]

    def summary(self) -> Dict[str, Any]:
        def _finalize(payload: Dict[str, Any]) -> Dict[str, Any]:
            count = int(payload["event_count"])
            total = float(payload["total_duration_seconds"])
            return {
                "event_count": count,
                "total_duration_seconds": round(total, 6),
                "avg_duration_seconds": round(total / count, 6) if count else 0.0,
                "max_duration_seconds": round(float(payload["max_duration_seconds"]), 6),
            }

        with self._lock:
            return {
                "run_total_seconds": round(self._run_total_seconds, 6),
                "scenario_totals_seconds": dict(sorted(self._scenario_totals.items(), key=lambda item: item[0])),
                "event_count": len(self._events),
                "by_source": {
                    source: _finalize(payload)
                    for source, payload in sorted(self._by_source.items())
                },
                "by_kind": {
                    kind: _finalize(payload)
                    for kind, payload in sorted(self._by_kind.items())
                },
                "events_preview": self._events[:20],
                "events": list(self._events),
            }


TIMING_TRACKER = TimingUsageTracker()


@contextmanager
def timed_operation(
    source: str,
    *,
    kind: str = "step",
    metadata: Optional[Dict[str, Any]] = None,
) -> Iterator[TimedSpan]:
    """Records elapsed wall time for the wrapped operation."""

    started = time.perf_counter()
    span = TimedSpan()
    try:
        yield span
    finally:
        span.duration_seconds = time.perf_counter() - started
        TIMING_TRACKER.record(
            source=source,
            duration_seconds=span.duration_seconds,
            kind=kind,
            metadata=metadata,
        )
