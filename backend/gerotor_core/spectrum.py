"""Flow ripple spectrum (port of js/spectrum.js).

DFT of the delivered flow over one outer revolution; fundamental f2 = n (N-1) / (60 N) Hz.
Harmonic h at h f2, single-sided amplitude in % of the mean flow. Tooth-pass frequency
f_tp = n (N-1)/60 (harmonic N). The summed delivery of the N chambers has period 2 pi / N of
outer rotation for every N, so the dominant harmonic is N (= tooth-pass frequency, Nichols:
f = n z_inner / 60) for both odd and even N; there is no frequency doubling for odd N (checked
numerically for N = 7, see tests). Lobe-count parity changes the ripple *amplitude* (Gamez-Montero
et al. p.12, after Manco 2000), not the frequency. Any other dominant harmonic must come from the
numeric spectrum, not from a rule.

Raises InvalidDesignError if res has no kinematic flow (invalid design).
"""
from __future__ import annotations

import numpy as np

from .errors import require_analysis


def flow_spectrum(signal, rpm, N, n_harm) -> dict:
    x = np.asarray(signal, dtype=float)
    M = x.size
    mean = float(np.sum(x)) / M
    f2 = rpm * (N - 1) / (60 * N)
    j = np.arange(M)
    harmonics = []
    for h in range(1, n_harm + 1):
        a = 2 * np.pi * h * j / M
        re, im = float(np.sum(x * np.cos(a))), -float(np.sum(x * np.sin(a)))
        harmonics.append({"h": h, "f": h * f2, "amp": 2 * np.hypot(re, im) / M / abs(mean) * 100})
    return {"mean": mean, "f2": f2, "toothPass": rpm * (N - 1) / 60, "harmonics": harmonics}


def ripple_spectrum(p, res, n_harm=None) -> dict:
    """Kinematic (res['q']) and, if present, port-model (res['ports']['Qout']) spectra + top 4."""
    require_analysis(res, "ripple_spectrum", ("q",))
    n_harm = n_harm or 6 * p["N"]
    kin = flow_spectrum(res["q"], p["rpm"], p["N"], n_harm)
    ports = res.get("ports")
    port = flow_spectrum(ports["Qout"], p["rpm"], p["N"], n_harm) if (ports and ports.get("Qout") is not None) else None

    def top(s):
        return sorted(s["harmonics"], key=lambda q: -q["amp"])[:4]

    return {"kin": kin, "port": port, "kinTop": top(kin), "portTop": top(port) if port else None}
