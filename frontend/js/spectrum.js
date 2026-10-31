/*
 * Flow ripple spectrum: discrete Fourier transform of the delivered flow over one outer-rotor
 * revolution (fundamental f₂ = n·(N−1)/(60·N) Hz). Harmonic h has frequency h·f₂; amplitudes are
 * given as % of the mean flow (single-sided). The tooth-pass frequency is f_tp = n·(N−1)/60
 * (harmonic N of the outer revolution). The summed delivery of the N chambers has period 2π/N of outer rotation for every N,
 * so the dominant harmonic is N (the tooth-pass frequency) for odd and even N: there is no frequency doubling for odd N
 * (checked numerically for N = 7 in tests.js). Lobe-count parity changes the ripple amplitude, not the frequency
 * (Gamez-Montero et al. p.12, after Manco 2000). Any other dominant harmonic comes from the numeric spectrum, not from a rule.
 */
(function (G) {
  'use strict';

  function flowSpectrum(signal, rpm, N, nHarm) {
    const M = signal.length;
    let mean = 0;
    for (const v of signal) mean += v;
    mean /= M;
    const f2 = rpm * (N - 1) / (60 * N);
    const out = [];
    for (let h = 1; h <= nHarm; h++) {
      let re = 0, im = 0;
      for (let j = 0; j < M; j++) {
        const a = 2 * Math.PI * h * j / M;
        re += signal[j] * Math.cos(a); im -= signal[j] * Math.sin(a);
      }
      out.push({ h, f: h * f2, amp: 2 * Math.hypot(re, im) / M / Math.abs(mean) * 100 });
    }
    return { mean, f2, toothPass: rpm * (N - 1) / 60, harmonics: out };
  }

  // Strongest harmonics of the kinematic and (if available) port-model delivered flow.
  function rippleSpectrum(p, res, nHarm) {
    nHarm = nHarm || 6 * p.N;
    const kin = flowSpectrum(res.q, p.rpm, p.N, nHarm);
    const port = res.ports && res.ports.Qout ? flowSpectrum(res.ports.Qout, p.rpm, p.N, nHarm) : null;
    const top = s => s.harmonics.slice().sort((a, b) => b.amp - a.amp).slice(0, 4);
    return { kin, port, kinTop: top(kin), portTop: port ? top(port) : null };
  }

  Object.assign(G, { flowSpectrum, rippleSpectrum });
})(window.Gerotor);
