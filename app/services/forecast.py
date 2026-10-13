"""Monte Carlo delivery forecast: how many sprints until N points are done.

Each trial replays the future as a sequence of sprints whose throughput is
drawn (with replacement) from what the team actually completed in recent
closed sprints. Repeating that a few thousand times turns one velocity number
into a distribution, from which come the P50/P85 sprint counts and the share
of trials that land by a given date.

Several targets are simulated against the *same* draws — milestones ahead in
the roadmap consume throughput first, so targets are cumulative point totals,
and sharing the draws keeps a later milestone from ever forecasting earlier
than one in front of it.

Pure functions, no database: the caller supplies samples and thresholds.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

TRIALS = 2000
# Beyond this many sprints a forecast is fiction; such trials count as "never".
MAX_SPRINTS = 104
MIN_SAMPLES = 3
SAMPLE_WINDOW = 8
# How far planned capacity may stretch or squeeze historical throughput.
CAPACITY_FACTOR_BOUNDS = (0.5, 1.5)


@dataclass(frozen=True)
class Distribution:
    """Sprints needed per trial, sorted ascending; MAX_SPRINTS + 1 = didn't finish."""

    sprints: tuple[int, ...]

    def percentile(self, p: float) -> int | None:
        """Sprints needed at the p-th percentile, or None if past MAX_SPRINTS."""
        idx = min(len(self.sprints) - 1, max(0, math.ceil(p * len(self.sprints)) - 1))
        value = self.sprints[idx]
        return None if value > MAX_SPRINTS else value

    def probability_within(self, sprints: int) -> float:
        """Share of trials finishing within `sprints` sprints."""
        if sprints < 0:
            return 0.0
        done = sum(1 for s in self.sprints if s <= sprints)
        return round(done / len(self.sprints), 3)


def usable_samples(completed_points: list[float]) -> list[float] | None:
    """The recent throughput to resample, or None when too thin to simulate.

    Zero-point sprints stay in — they happened, and dropping them would flatter
    the forecast — but a history of nothing but zeros has nothing to say.
    """
    window = completed_points[-SAMPLE_WINDOW:]
    if len(window) < MIN_SAMPLES or sum(window) <= 0:
        return None
    return window


def capacity_factor(historical: list[float], planned: list[float]) -> float:
    """Planned capacity relative to what the sampled sprints had, clamped.

    1.0 when either side is unknown, so missing capacity data leaves the
    forecast on pure throughput rather than guessing.
    """
    hist = [c for c in historical if c > 0]
    plan = [c for c in planned if c > 0]
    if not hist or not plan:
        return 1.0
    ratio = (sum(plan) / len(plan)) / (sum(hist) / len(hist))
    lo, hi = CAPACITY_FACTOR_BOUNDS
    return round(min(hi, max(lo, ratio)), 3)


def simulate(
    thresholds: list[float],
    samples: list[float],
    *,
    factor: float = 1.0,
    trials: int = TRIALS,
    seed: int = 0,
) -> list[Distribution]:
    """One Distribution per cumulative threshold (points), in the given order.

    Deterministic for a given seed, so a page reload doesn't move the dates.
    """
    rng = random.Random(seed)
    draws = [s * factor for s in samples]
    per_target: list[list[int]] = [[] for _ in thresholds]
    for _ in range(trials):
        done = 0.0
        sprint = 0
        pending = 0  # index of the first threshold not yet reached
        while pending < len(thresholds) and sprint < MAX_SPRINTS:
            sprint += 1
            done += rng.choice(draws)
            while pending < len(thresholds) and done >= thresholds[pending]:
                per_target[pending].append(sprint)
                pending += 1
        for i in range(pending, len(thresholds)):
            per_target[i].append(MAX_SPRINTS + 1)
    return [Distribution(tuple(sorted(t))) for t in per_target]
