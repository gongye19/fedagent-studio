"""Token usage tracking for the EvoMed runtime."""

from __future__ import annotations

import json
import math
import threading
from collections import defaultdict
from typing import Any, Dict, Optional


def estimate_tokens(text: str) -> int:
    """Return a lightweight token estimate when providers do not report usage."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4.0))


class TokenUsageTracker:
    """Aggregate token usage across all LLM calls."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        """Clear all counters."""
        with self._lock:
            self._events: list[Dict[str, Any]] = []
            self._totals = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "request_count": 0,
            }
            self._by_model: Dict[str, Dict[str, Any]] = defaultdict(
                lambda: {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "request_count": 0,
                    "estimated_requests": 0,
                    "actual_requests": 0,
                }
            )
            self._by_source: Dict[str, Dict[str, Any]] = defaultdict(
                lambda: {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "request_count": 0,
                    "estimated_requests": 0,
                    "actual_requests": 0,
                }
            )

    def record(
        self,
        *,
        source: str,
        model_name: str,
        prompt_tokens: int,
        completion_tokens: int,
        estimated: bool,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Store a single token-usage event."""
        total_tokens = max(prompt_tokens + completion_tokens, 0)
        event = {
            "source": source,
            "model_name": model_name,
            "prompt_tokens": max(prompt_tokens, 0),
            "completion_tokens": max(completion_tokens, 0),
            "total_tokens": total_tokens,
            "estimated": estimated,
            "metadata": dict(metadata or {}),
        }
        with self._lock:
            self._events.append(event)
            self._totals["prompt_tokens"] += event["prompt_tokens"]
            self._totals["completion_tokens"] += event["completion_tokens"]
            self._totals["total_tokens"] += event["total_tokens"]
            self._totals["request_count"] += 1
            for bucket in (self._by_model[model_name], self._by_source[source]):
                bucket["prompt_tokens"] += event["prompt_tokens"]
                bucket["completion_tokens"] += event["completion_tokens"]
                bucket["total_tokens"] += event["total_tokens"]
                bucket["request_count"] += 1
                key = "estimated_requests" if estimated else "actual_requests"
                bucket[key] += 1

    def summary(self) -> Dict[str, Any]:
        """Return a JSON-serializable aggregate view."""
        with self._lock:
            return {
                **self._totals,
                "by_model": dict(sorted(self._by_model.items())),
                "by_source": dict(sorted(self._by_source.items())),
                "events_preview": self._events[:20],
            }

    def events(self) -> list[Dict[str, Any]]:
        """Return a thread-safe copy of the recorded events."""
        with self._lock:
            return list(self._events)

    def dumps(self) -> str:
        """Format the current summary as JSON."""
        return json.dumps(self.summary(), indent=2, ensure_ascii=True)


TRACKER = TokenUsageTracker()


__all__ = ["TRACKER", "TokenUsageTracker", "estimate_tokens"]
