"""A small thread-safe LRU cache with an optional byte budget."""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable, Hashable


class LRUCache[K: Hashable, V]:
    """Least-recently-used cache bounded by item count and (optionally) total size.

    ``sizeof`` reports the cost of a value in bytes; entries are evicted oldest
    first until both limits hold. A single value larger than ``max_bytes`` is
    not cached at all.
    """

    def __init__(
        self,
        max_items: int = 128,
        max_bytes: int | None = None,
        sizeof: Callable[[V], int] | None = None,
    ) -> None:
        self.max_items = max_items
        self.max_bytes = max_bytes
        self._sizeof = sizeof or (lambda _v: 0)
        self._data: OrderedDict[K, tuple[V, int]] = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key: K) -> V | None:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                self.misses += 1
                return None
            self._data.move_to_end(key)
            self.hits += 1
            return entry[0]

    def put(self, key: K, value: V) -> None:
        size = self._sizeof(value)
        if self.max_bytes is not None and size > self.max_bytes:
            return
        with self._lock:
            old = self._data.pop(key, None)
            if old is not None:
                self._bytes -= old[1]
            self._data[key] = (value, size)
            self._bytes += size
            while len(self._data) > self.max_items or (
                self.max_bytes is not None and self._bytes > self.max_bytes
            ):
                _, (_, evicted) = self._data.popitem(last=False)
                self._bytes -= evicted

    def get_or_compute(self, key: K, compute: Callable[[], V]) -> V:
        """Return the cached value or compute, store and return it."""
        value = self.get(key)
        if value is None:
            value = compute()
            self.put(key, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self._bytes = 0

    def __len__(self) -> int:
        return len(self._data)

    @property
    def nbytes(self) -> int:
        return self._bytes
