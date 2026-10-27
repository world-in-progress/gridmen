"""
Timing helpers for grid mount (assembly + vector interventions).

Exposes a dedicated DEBUG-level logger (`gridmen.grid.timing`) with its own
StreamHandler so timing output is visible regardless of the root logging
config (which is INFO by default in this project).

Inside `collect_timings()`, every `timed()` phase is also recorded as a
wall-clock stage, and `record_value()` adds named values, so a mount can write
a machine-readable report. Worker processes never collect.

Usage:
    from ._timing import timed, timing_logger

    with timed("phase name", extra="more info"):
        do_work()
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar

_LOGGER_NAME = "gridmen.grid.timing"

_collector: ContextVar[dict | None] = ContextVar("gridmen_timing_collector", default=None)


def _make_logger() -> logging.Logger:
    logger = logging.getLogger(_LOGGER_NAME)
    logger.setLevel(logging.DEBUG)
    if not any(getattr(h, "_gridmen_timing", False) for h in logger.handlers):
        handler = logging.StreamHandler()
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(name)s] %(levelname)s: %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        handler._gridmen_timing = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
        # Avoid duplicating through the root handler too.
        logger.propagate = False
    return logger


timing_logger = _make_logger()


@contextmanager
def collect_timings():
    """Collect the stages and values of every timed() phase run inside this block."""
    collected = {"stages": [], "values": {}, "_depth": 0}
    token = _collector.set(collected)
    try:
        yield collected
    finally:
        _collector.reset(token)
        collected.pop("_depth")


@contextmanager
def timed(label: str, **extra):
    """Context manager that logs the elapsed time at DEBUG level.

    Args:
        label: Short description of the phase being timed.
        **extra: Additional key=value pairs appended to the log record.
    """
    collected = _collector.get()
    stage = None
    if collected is not None:
        stage = {"stage": label, "depth": collected["_depth"], "seconds": None, **extra}
        collected["stages"].append(stage)
        collected["_depth"] += 1
    start = time.perf_counter()
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        if stage is not None:
            stage["seconds"] = elapsed
            collected["_depth"] -= 1
        if extra:
            extras = " ".join(f"{k}={v}" for k, v in extra.items())
            timing_logger.debug("%s took %.4fs (%s)", label, elapsed, extras)
        else:
            timing_logger.debug("%s took %.4fs", label, elapsed)


def record_value(name: str, value) -> None:
    """Attach a named value to the active collection (no-op outside collect_timings)."""
    collected = _collector.get()
    if collected is not None:
        collected["values"][name] = value


def log_debug(msg: str, *args, **kwargs) -> None:
    """Convenience wrapper to emit a DEBUG record on the timing logger."""
    timing_logger.debug(msg, *args, **kwargs)
