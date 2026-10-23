/*
 * OpenModelica export: writes the current design as a self-contained Modelica package
 * (Modelica Standard Library 4.x) with
 *   Interfaces.FluidPort       hydraulic connector (p, flow q; q > 0 into the component)
 *   Components.Gerotor         N chamber volumes, port orifices, tip gaps, face gaps, port lands,
 *                              shaft torque — the 1:1 counterpart of js/leakage.js (docs/lumped-model.md);
 *                              angle-dependent geometry (A, dA/dθ, A_s, A_d, G_tip) as periodic tables
 *                              computed by js/geometry.js and js/ports.js
 *   Components.Volume / Restriction / Tank
 *   Examples.PumpSystem        speed source → gerotor → outlet volume → load restriction → tank
 *                              (as the GT-SUITE model built by Gerotor Design Studio)
 * and a .mos script that runs the case table (speeds × pressure rises), like the GT "Case Setup".
 *
 * Simplifications vs the browser solver: cavitation by a smooth drop of the effective bulk modulus
 * below p_cav (instead of a tracked void volume); orifice √ regularised near Δp = 0.
 */
(function (G) {
  'use strict';

  const TAU = 2 * Math.PI;
  const num = x => {
    if (!Number.isFinite(x)) return '0';
    if (x === 0) return '0';
    const s = Math.abs(x) >= 1e-3 && Math.abs(x) < 1e7 ? (+x.toPrecision(12)).toString() : x.toExponential(10);
    return s.includes('.') || s.includes('e') ? s : s + '.0';
  };
  const ident = s => (String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1') || 'Design');

  // Angle tables of chamber 0 (outer-rotor angle, SI): θ, A, dA/dθ, A_s, A_d, G_tip.
  function tables(p, res) {
    const { M, dt } = res, b = p.b * 1e-3;
    const pr = res.ports, sim = pr && pr.sim;
    const fillS = p.fillS || 1, fillD = p.fillD || 1;
    const rows = [];
    for (let j = 0; j <= M; j++) {
      const jj = j % M;
      rows.push([j * dt, res.A[jj] * 1e-6, res.dA[jj] * 1e-6,
        pr && pr.As ? pr.As[jj] * 1e-6 * fillS : 0, pr && pr.Ad ? pr.Ad[jj] * 1e-6 * fillD : 0,
        sim && sim.Gtip ? sim.Gtip[jj] : 0]);
    }
    return rows;
  }

  function cases(p, res, opt) {
    opt = opt || {};
    const lin = (a, c, n) => n <= 1 ? [a] : Array.from({ length: n }, (_, i) => a + (c - a) * i / (n - 1));
    const speeds = lin(opt.rpmMin ?? p.rpm, opt.rpmMax ?? p.rpm, opt.nRpm || 1);
    const dps = lin(opt.dpMin ?? p.dp, opt.dpMax ?? p.dp, opt.nDp || 1);
    const etaV = res.ports && res.ports.portEfficiency ? res.ports.portEfficiency : 1;
    const out = [];
    for (const n of speeds) for (const dp of dps) {
      const qExp = res.cc * 1e-6 * n / 60 * etaV;
      const A = dp > 0 ? qExp / (p.Cd * Math.sqrt(2 * dp * 1e5 / p.rho)) : 1e-3;
      out.push({ label: `${n.toFixed(0)} rpm : ${+dp.toFixed(2)} bar`, rpm: n, dp, qExpLpm: qExp * 6e4, A });
    }
    return out;
  }

  function packageText(p, res, opt) {
    opt = opt || {};
    const name = ident(opt.name || 'GerotorPump');
    const sim = res.ports && res.ports.sim;
    const c = sim ? sim.conductances : { Gbore: 0, Gper: 0, Gland: 0 };
    const tab = tables(p, res);
    const tabText = tab.map(r => '      ' + r.map(num).join(', ')).join(';\n');
    const w1 = p.rpm * TAU / 60, w2 = w1 * (p.N - 1) / p.N;
    const revs = opt.revolutions || 6, stop = revs * TAU / Math.max(w2, 1e-9);
    const etaV = res.ports && res.ports.portEfficiency ? res.ports.portEfficiency : 1;
    const qExp = res.cc * 1e-6 * p.rpm / 60 * etaV;
    const Ar = p.dp > 0 ? qExp / (p.Cd * Math.sqrt(2 * p.dp * 1e5 / p.rho)) : 1e-3;
    const Vout = Math.max(p.outletVol || 0, 1) * 1e-6;
    const date = new Date().toISOString().slice(0, 10);

    return `within ;
package ${name} "Gerotor pump exported from the Gerotor Design Tool (${date})"
  extends Modelica.Icons.Package;
  import SI = Modelica.Units.SI;

  constant Integer nLobes = ${p.N} "Outer rotor lobes N (inner rotor N-1 teeth)";

  package Interfaces
    extends Modelica.Icons.InterfacesPackage;
    connector FluidPort "Hydraulic port: absolute pressure and volume flow (q > 0 into the component)"
      SI.AbsolutePressure p;
      flow SI.VolumeFlowRate q;
      annotation (Icon(graphics={Ellipse(extent={{-100,100},{100,-100}}, lineColor={0,0,127},
        fillColor={0,127,255}, fillPattern=FillPattern.Solid)}));
    end FluidPort;
  end Interfaces;

  package Functions
    extends Modelica.Icons.FunctionsPackage;
    function regRoot "sign(x)*sqrt(|x|), regularised for |x| < delta"
      input Real x;
      input Real delta = 0.01;
      output Real y;
    algorithm
      y := x/(x*x + delta*delta)^0.25;
      annotation (smoothOrder=2);
    end regRoot;
    function cavitationFactor "Effective bulk modulus factor: 1 above p_cav, -> eps below (smooth)"
      input SI.AbsolutePressure p;
      input SI.AbsolutePressure pCav;
      input SI.PressureDifference width;
      output Real f;
    protected
      Real x = (p - pCav)/width;
    algorithm
      f := 1e-3 + (1 - 1e-3)*(if x >= 1 then 1 elseif x <= 0 then 0 else x*x*(3 - 2*x));
      annotation (smoothOrder=1);
    end cavitationFactor;
  end Functions;

  package Components
    extends Modelica.Icons.Package;

    model Gerotor "Gerotor pump: N chambers with port orifices, tip/face/land leakage and shaft torque"
      parameter Integer N = nLobes "Outer rotor lobes";
      parameter SI.Length b = ${num(p.b * 1e-3)} "Rotor width";
      parameter SI.BulkModulus K = ${num(p.bulk * 1e6)} "Fluid bulk modulus";
      parameter SI.Density rho = ${num(p.rho)} "Fluid density";
      parameter Real Cd = ${num(p.Cd)} "Port discharge coefficient";
      parameter SI.AbsolutePressure pCav = ${num(p.pVap * 1e5)} "Cavitation pressure";
      parameter SI.PressureDifference cavWidth = 0.1e5 "Transition width of the cavitation model";
      parameter Real Gbore(unit="m3/(s.Pa)") = ${num(c.Gbore)} "Face gaps chamber -> shaft bore (per chamber)";
      parameter Real Gper(unit="m3/(s.Pa)") = ${num(c.Gper)} "Face gaps chamber -> periphery (per chamber)";
      parameter Real Gland(unit="m3/(s.Pa)") = ${num(c.Gland)} "Port lands delivery -> suction";
      parameter Boolean boreVented = ${sim && sim.boreVented === false ? 'false' : 'true'} "Shaft bore vented to suction";
      parameter Real table[:, 6] = [
${tabText}] "Chamber 0 vs outer angle: theta [rad], A [m2], dA/dtheta [m2/rad], A_s [m2], A_d [m2], G_tip [m3/(s.Pa)]";
      parameter SI.AbsolutePressure p_start = ${num(p.pIn * 1e5)} "Initial chamber pressure";

      Interfaces.FluidPort suction annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      Interfaces.FluidPort delivery annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      Modelica.Mechanics.Rotational.Interfaces.Flange_a shaft "Inner rotor (drive) shaft"
        annotation (Placement(transformation(extent={{-10,-110},{10,-90}})));

      SI.Angle phi1 = shaft.phi "Inner rotor angle";
      SI.AngularVelocity w1 = der(phi1) "Inner rotor speed";
      SI.AngularVelocity w2 = w1*(N - 1)/N "Outer rotor speed";
      SI.Angle theta = phi1*(N - 1)/N "Outer rotor angle";
      SI.AbsolutePressure p[N](each start=p_start, each fixed=true) "Chamber pressures";
      SI.Volume V[N] "Chamber volumes";
      SI.VolumeFlowRate dV[N] "Chamber volume rates";
      SI.VolumeFlowRate qs[N] "Flow suction port -> chamber";
      SI.VolumeFlowRate qd[N] "Flow delivery port -> chamber";
      SI.VolumeFlowRate qt[N] "Flow chamber k+1 -> chamber k through tip gap k";
      Real Gtip[N](each unit="m3/(s.Pa)") "Tip gap conductance between chambers k and k+1";
      SI.Area As[N] "Suction port opening of chamber k";
      SI.Area Ad[N] "Delivery port opening of chamber k";
      SI.AbsolutePressure pPer = sum(p)/N "Periphery node (outer rotor OD)";
      SI.AbsolutePressure pBore = if boreVented then suction.p else pPer "Shaft bore";
      SI.VolumeFlowRate qDelivered = -delivery.q "Delivered flow";
      SI.Torque tauShaft = shaft.tau "Shaft torque";
      Modelica.Blocks.Tables.CombiTable1Ds tab[N](each table=table, each columns=2:6,
        each smoothness=Modelica.Blocks.Types.Smoothness.LinearSegments,
        each extrapolation=Modelica.Blocks.Types.Extrapolation.Periodic) "Geometry of chamber k";
    equation
      for k in 1:N loop
        tab[k].u = theta + 2*Modelica.Constants.pi*(k - 1)/N;
        V[k] = b*tab[k].y[1];
        dV[k] = b*tab[k].y[2]*w2;
        As[k] = tab[k].y[3];
        Ad[k] = tab[k].y[4];
        Gtip[k] = tab[k].y[5];
        qs[k] = Cd*As[k]*sqrt(2/rho)*Functions.regRoot(suction.p - p[k], 100);
        qd[k] = Cd*Ad[k]*sqrt(2/rho)*Functions.regRoot(delivery.p - p[k], 100);
        qt[k] = Gtip[k]*(p[if k == N then 1 else k + 1] - p[k]);
        V[k]/(K*Functions.cavitationFactor(p[k], pCav, cavWidth))*der(p[k]) =
          qs[k] + qd[k] + qt[k] - qt[if k == 1 then N else k - 1]
          + Gbore*(pBore - p[k]) + Gper*(pPer - p[k]) - dV[k];
      end for;
      // Port flows (bore drain returns to the suction side when vented).
      suction.q = sum(qs) - (if boreVented then sum(Gbore*(p[k] - suction.p) for k in 1:N) else 0) - Gland*(delivery.p - suction.p);
      delivery.q = sum(qd) + Gland*(delivery.p - suction.p);
      // Power balance: shaft power = sum of p*(-dV/dt)  ->  torque on the inner shaft.
      shaft.tau*w1 = -sum(p[k]*dV[k] for k in 1:N);
      annotation (Icon(graphics={
        Ellipse(extent={{-90,90},{90,-90}}, lineColor={0,0,0}, fillColor={215,215,215}, fillPattern=FillPattern.Solid),
        Polygon(points={{-40,60},{40,60},{70,0},{40,-60},{-40,-60},{-70,0},{-40,60}}, lineColor={0,0,0},
          fillColor={170,85,0}, fillPattern=FillPattern.Solid, smooth=Smooth.Bezier),
        Ellipse(extent={{-15,15},{15,-15}}, lineColor={0,0,0}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Text(extent={{-150,140},{150,100}}, textString="%name", lineColor={0,0,255})}),
        Documentation(info="<html><p>Exported gerotor: N = ${p.N}, e = ${num(p.e)} mm, R = ${num(p.R)} mm, r_p = ${num(p.rp)} mm,
          c = ${num(p.c)} mm, b = ${num(p.b)} mm, displacement ${res.cc.toFixed(4)} cm3/rev.</p>
          <p>Angle tables from the exact chamber model (Gerotor Design Tool, js/geometry.js, js/ports.js).</p></html>"));
    end Gerotor;

    model Volume "Fluid volume with compressibility"
      parameter SI.Volume V = ${num(Vout)} "Volume";
      parameter SI.BulkModulus K = ${num(p.bulk * 1e6)} "Bulk modulus";
      parameter SI.AbsolutePressure p_start = ${num((p.pIn + p.dp) * 1e5)} "Initial pressure";
      Interfaces.FluidPort port annotation (Placement(transformation(extent={{-10,-110},{10,-90}})));
      SI.AbsolutePressure p(start=p_start, fixed=true) = port.p;
    equation
      V/K*der(p) = port.q;
      annotation (Icon(graphics={Rectangle(extent={{-80,60},{80,-80}}, lineColor={0,0,0}, fillColor={0,127,255},
        fillPattern=FillPattern.HorizontalCylinder), Text(extent={{-150,110},{150,70}}, textString="%name", lineColor={0,0,255})}));
    end Volume;

    model Restriction "Sharp-edged orifice (load restriction)"
      parameter SI.Area A = ${num(Ar)} "Flow area";
      parameter Real Cd = ${num(p.Cd)} "Discharge coefficient";
      parameter SI.Density rho = ${num(p.rho)} "Density";
      Interfaces.FluidPort port_a annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      Interfaces.FluidPort port_b annotation (Placement(transformation(extent={{90,-10},{110,10}})));
    equation
      port_a.q + port_b.q = 0;
      port_a.q = Cd*A*sqrt(2/rho)*Functions.regRoot(port_a.p - port_b.p, 100);
      annotation (Icon(graphics={Line(points={{-90,0},{90,0}}, color={0,127,255}, thickness=0.5),
        Polygon(points={{-30,40},{30,40},{0,6},{-30,40}}, lineColor={0,0,0}, fillColor={0,0,0}, fillPattern=FillPattern.Solid),
        Polygon(points={{-30,-40},{30,-40},{0,-6},{-30,-40}}, lineColor={0,0,0}, fillColor={0,0,0}, fillPattern=FillPattern.Solid),
        Text(extent={{-150,90},{150,50}}, textString="%name", lineColor={0,0,255})}));
    end Restriction;

    model Tank "Fixed pressure boundary"
      parameter SI.AbsolutePressure p = ${num(p.pIn * 1e5)} "Pressure";
      Interfaces.FluidPort port annotation (Placement(transformation(extent={{-10,90},{10,110}})));
    equation
      port.p = p;
      annotation (Icon(graphics={Rectangle(extent={{-80,40},{80,-60}}, lineColor={0,0,0}, fillColor={0,127,255},
        fillPattern=FillPattern.Solid), Line(points={{-80,40},{-80,80}}), Line(points={{80,40},{80,80}}),
        Text(extent={{-150,-70},{150,-110}}, textString="%name", lineColor={0,0,255})}));
    end Tank;
  end Components;

  package Examples
    extends Modelica.Icons.ExamplesPackage;
    model PumpSystem "Gerotor at constant speed delivering through an outlet volume and a load restriction"
      extends Modelica.Icons.Example;
      parameter SI.AngularVelocity w = ${num(w1)} "Shaft speed (${p.rpm} rpm)";
      parameter SI.AbsolutePressure pIn = ${num(p.pIn * 1e5)} "Inlet / tank pressure";
      parameter SI.Area A = ${num(Ar)} "Load restriction area (sized for ${p.dp} bar at the expected flow)";
      Modelica.Mechanics.Rotational.Sources.ConstantSpeed speed(w_fixed=w, phi(start=0, fixed=true))
        annotation (Placement(transformation(extent={{-70,-60},{-50,-40}})));
      Components.Gerotor pump annotation (Placement(transformation(extent={{-20,-20},{20,20}})));
      Components.Tank inletTank(p=pIn) annotation (Placement(transformation(extent={{-70,-20},{-50,0}})));
      Components.Volume outletVolume annotation (Placement(transformation(extent={{30,30},{50,50}})));
      Components.Restriction load(A=A) annotation (Placement(transformation(extent={{50,-10},{70,10}})));
      Components.Tank returnTank(p=pIn) annotation (Placement(transformation(extent={{80,-40},{100,-20}})));
    equation
      connect(speed.flange, pump.shaft) annotation (Line(points={{-50,-50},{0,-50},{0,-20}}));
      connect(inletTank.port, pump.suction) annotation (Line(points={{-60,0},{-20,0}}, color={0,127,255}));
      connect(pump.delivery, outletVolume.port) annotation (Line(points={{20,0},{40,0},{40,30}}, color={0,127,255}));
      connect(pump.delivery, load.port_a) annotation (Line(points={{20,0},{50,0}}, color={0,127,255}));
      connect(load.port_b, returnTank.port) annotation (Line(points={{70,0},{90,0},{90,-20}}, color={0,127,255}));
      annotation (experiment(StopTime=${num(stop)}, Interval=${num(stop / 4000)}, Tolerance=1e-6),
        Documentation(info="<html><p>${revs} outer-rotor revolutions at ${p.rpm} rpm; the load restriction is sized
          for &Delta;p = ${p.dp} bar at the expected flow ${(qExp * 6e4).toFixed(3)} L/min.</p></html>"));
    end PumpSystem;
  end Examples;
  annotation (uses(Modelica(version="4.1.0")));
end ${name};
`;
  }

  // Case script: one simulation per case with overridden speed and restriction area.
  function caseScript(p, res, opt, pkgFile) {
    const name = ident(opt.name || 'GerotorPump');
    const list = cases(p, res, opt);
    const lines = [
      '// Gerotor Design Tool — case setup (speeds x pressure rises); run with: omc cases.mos',
      'loadModel(Modelica, {"4.1.0"}); getErrorString();',
      `loadFile("${pkgFile}"); getErrorString();`,
    ];
    list.forEach((cs, i) => {
      const w1 = cs.rpm * TAU / 60, w2 = w1 * (p.N - 1) / p.N, stop = 6 * TAU / Math.max(w2, 1e-9);
      lines.push(`// Case ${i + 1}: ${cs.label}, expected flow ${cs.qExpLpm.toFixed(3)} L/min`);
      lines.push(`simulate(${name}.Examples.PumpSystem, stopTime=${num(stop)}, numberOfIntervals=4000, ` +
        `fileNamePrefix="case${i + 1}", simflags="-override=w=${num(w1)},A=${num(cs.A)}"); getErrorString();`);
    });
    return lines.join('\n') + '\n';
  }

  function caseCsv(p, res, opt) {
    const list = cases(p, res, opt);
    const head = ['case', 'label', 'rpm', 'dp_bar', 'expected_flow_Lmin', 'outlet_restrict_area_mm2', 'fluid_density', 'fluid_viscosity_cSt',
      'tip_clearance_um', 'axial_clearance_total_um', 'radial_clearance_um', 'friction_coeff', 'rotor_diameter_mm', 'rotor_width_mm', 'shadow_ports'];
    const rows = list.map((cs, i) => [i + 1, `"${cs.label}"`, cs.rpm, cs.dp, cs.qExpLpm.toFixed(4), (cs.A * 1e6).toFixed(5), p.rho, p.nu,
      p.c * 1000, p.axialClr * 1000, p.odClr / 2 * 1000, p.faceMu, p.OD, p.b, p.shadow ? 1 : 0]);
    return [head.join(','), ...rows.map(r => r.join(','))].join('\n') + '\n';
  }

  function exportModelica(p, res, opt) {
    opt = opt || {};
    const name = ident(opt.name || 'GerotorPump');
    const mo = packageText(p, res, Object.assign({}, opt, { name }));
    return {
      name,
      files: {
        [name + '.mo']: mo,
        'cases.mos': caseScript(p, res, Object.assign({}, opt, { name }), name + '.mo'),
        'cases.csv': caseCsv(p, res, opt),
      },
    };
  }

  G.modelica = { exportModelica, packageText, caseScript, caseCsv, cases, tables, ident };
})(window.Gerotor);
