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

  /*
   * Loss model for the Modelica friction block, from js/friction.js at the design point:
   *   viscous torque ∝ μ·ω (OD Petroff, lateral rings, journal bearings) → C_visc = M_visc/ω1
   *   floor friction ∝ Δp (single-sided ports)                          → K_floor = M_floor/Δp
   * Rotor inertia (steel 7850 kg/m³): inner rotor ring bore…mean tooth radius, outer rotor ring
   * R_v…OD referred to the shaft by (ω2/ω1)².
   */
  function frictionData(p, res) {
    const me = res.mech, tau = (p.N - 1) / p.N, w1 = p.rpm * TAU / 60, mm = 1e-3;
    const visc = me ? tau * (me.MoutRad + me.MoutLat) + me.MinLat + me.Mjb : 0;
    const floor = me ? tau * (me.MoutFloor || 0) + (me.MinFloor || 0) : 0;
    const ring = (ri, ro) => 7850 * p.b * mm * Math.PI / 2 * ((ro * mm) ** 4 - (ri * mm) ** 4);
    const J = ring(p.bore / 2, 0.5 * (p.innerRoot + p.innerTip)) + tau * tau * ring(p.Rv, p.OD / 2);
    return { Cvisc: w1 > 0 ? visc / w1 : 0, Kfloor: p.dp > 0 ? floor / (p.dp * 1e5) : 0, J, visc, floor };
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
    const fr = frictionData(p, res);

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

  package Data "Design data computed by the Gerotor Design Tool"
    extends Modelica.Icons.RecordsPackage;
    constant Real table[:, 6] = [
${tabText}] "Chamber 1 vs outer-rotor angle: theta [rad], A [m2], dA/dtheta [m2/rad], A_s [m2], A_d [m2], G_tip [m3/(s.Pa)]";
    constant SI.Length b = ${num(p.b * 1e-3)} "Rotor width";
    constant SI.BulkModulus K = ${num(p.bulk * 1e6)} "Fluid bulk modulus";
    constant SI.Density rho = ${num(p.rho)} "Fluid density";
    constant Real Cd = ${num(p.Cd)} "Discharge coefficient";
    constant SI.AbsolutePressure pCav = ${num(p.pVap * 1e5)} "Cavitation pressure";
    constant SI.AbsolutePressure pIn = ${num(p.pIn * 1e5)} "Inlet pressure";
    constant Real Gbore(unit="m3/(s.Pa)") = ${num(c.Gbore)} "Face gaps chamber -> shaft bore (per chamber)";
    constant Real Gper(unit="m3/(s.Pa)") = ${num(c.Gper)} "Face gaps chamber -> periphery (per chamber)";
    constant Real Gland(unit="m3/(s.Pa)") = ${num(c.Gland)} "Port lands outlet -> inlet";
    constant Real Cvisc(unit="N.m.s/rad") = ${num(fr.Cvisc)} "Viscous loss torque per shaft speed (at the design point)";
    constant Real Kfloor(unit="N.m/Pa") = ${num(fr.Kfloor)} "Floor friction torque per pressure rise (single-sided ports)";
    constant SI.Inertia J = ${num(fr.J)} "Rotor inertia referred to the shaft (steel)";
    constant SI.Area AsPort =${num((res.ports && res.ports.suction ? res.ports.suction.area : 100) * 1e-6 * (p.fillS || 1))} "Suction port area";
  end Data;

  package Components
    extends Modelica.Icons.Package;

    model Rotor "Gerotor kinematics (inner shaft angle -> outer rotor angle); declare as 'inner rotor'"
      parameter Integer N = nLobes;
      Modelica.Mechanics.Rotational.Interfaces.Flange_a flange "Inner rotor shaft"
        annotation (Placement(transformation(extent={{-10,-10},{10,10}})));
      SI.Angle theta = flange.phi*(N - 1)/N "Outer rotor angle";
      SI.AngularVelocity w1 = der(flange.phi) "Inner rotor speed";
      SI.AngularVelocity w2 = w1*(N - 1)/N "Outer rotor speed";
    equation
      flange.tau = 0 "massless: torques of the source and the chambers balance at the flange";
      annotation (Icon(graphics={Ellipse(extent={{-100,100},{100,-100}}, lineColor={0,0,0}, fillColor={170,85,0},
        fillPattern=FillPattern.Solid), Ellipse(extent={{-30,30},{30,-30}}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Text(extent={{-150,150},{150,110}}, textString="%name", lineColor={0,0,255})}));
    end Rotor;

    model Chamber "Gerotor chamber k: volume from the angle table, suction (In) and delivery (Out) port orifices"
      parameter Integer k = 1 "Chamber index 1..N";
      parameter Integer N = nLobes;
      parameter SI.PressureDifference cavWidth = 0.1e5 "Transition width of the cavitation model";
      parameter SI.AbsolutePressure p_start = Data.pIn;
      outer Rotor rotor;
      Interfaces.FluidPort In "To the inlet port volume (suction orifice)"
        annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      Interfaces.FluidPort Out "To the outlet port volume (delivery orifice)"
        annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      Interfaces.FluidPort Aux "Chamber node (tip gaps, axial gaps)"
        annotation (Placement(transformation(extent={{-10,90},{10,110}})));
      Modelica.Mechanics.Rotational.Interfaces.Flange_a flange "Pressure torque on the shaft"
        annotation (Placement(transformation(extent={{-10,-110},{10,-90}})));
      Modelica.Blocks.Tables.CombiTable1Ds tab(table=Data.table, columns=2:5,
        smoothness=Modelica.Blocks.Types.Smoothness.LinearSegments,
        extrapolation=Modelica.Blocks.Types.Extrapolation.Periodic);
      SI.AbsolutePressure p(start=p_start, fixed=true) "Chamber pressure";
      SI.Volume V "Volume";
      SI.VolumeFlowRate dV "Volume rate";
      SI.Area As "Suction port opening";
      SI.Area Ad "Delivery port opening";
    equation
      tab.u = rotor.theta + 2*Modelica.Constants.pi*(k - 1)/N;
      V = Data.b*tab.y[1];
      dV = Data.b*tab.y[2]*rotor.w2;
      As = tab.y[3];
      Ad = tab.y[4];
      In.q = Data.Cd*As*sqrt(2/Data.rho)*Functions.regRoot(In.p - p, 100);
      Out.q = Data.Cd*Ad*sqrt(2/Data.rho)*Functions.regRoot(Out.p - p, 100);
      Aux.p = p;
      V/(Data.K*Functions.cavitationFactor(p, Data.pCav, cavWidth))*der(p) = In.q + Out.q + Aux.q - dV;
      flange.tau*rotor.w1 = -p*dV "power balance";
      annotation (Icon(graphics={Ellipse(extent={{-90,90},{90,-90}}, lineColor={0,0,0}, fillColor={128,128,128},
        fillPattern=FillPattern.Solid), Polygon(points={{0,80},{20,20},{80,0},{20,-20},{0,-80},{-20,-20},{-80,0},{-20,20},{0,80}},
        lineColor={0,0,0}, fillColor={255,255,85}, fillPattern=FillPattern.Solid), Ellipse(extent={{-15,15},{15,-15}},
        fillColor={0,0,0}, fillPattern=FillPattern.Solid), Text(extent={{-150,-100},{150,-140}}, textString="%name", lineColor={0,0,255})}));
    end Chamber;

    model TipGap "Tip/flank gap between chamber k and k+1: Q = G_tip(theta)*dp (Reynolds, curved surfaces)"
      parameter Integer k = 1 "Gap after chamber k";
      parameter Integer N = nLobes;
      outer Rotor rotor;
      Interfaces.FluidPort port_a "Chamber k" annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      Interfaces.FluidPort port_b "Chamber k+1" annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      Modelica.Blocks.Tables.CombiTable1Ds tab(table=Data.table, columns={6},
        smoothness=Modelica.Blocks.Types.Smoothness.LinearSegments,
        extrapolation=Modelica.Blocks.Types.Extrapolation.Periodic);
      Real G(unit="m3/(s.Pa)") "Conductance";
    equation
      tab.u = rotor.theta + 2*Modelica.Constants.pi*(k - 1)/N;
      G = tab.y[1];
      port_a.q = G*(port_a.p - port_b.p);
      port_a.q + port_b.q = 0;
      annotation (Icon(graphics={Rectangle(extent={{-80,40},{80,-40}}, lineColor={0,0,0}, fillColor={215,215,215},
        fillPattern=FillPattern.Solid), Line(points={{-60,0},{60,0}}, color={0,127,255}),
        Text(extent={{-150,90},{150,50}}, textString="%name", lineColor={0,0,255})}));
    end TipGap;

    model AxialGap "Axial (face) gaps of all chambers: to the outer-rotor periphery node and to the shaft bore"
      parameter Integer N = nLobes;
      Interfaces.FluidPort chambers[N] annotation (Placement(transformation(extent={{-10,-110},{10,-90}})));
      Interfaces.FluidPort bore "Shaft bore (vented to the inlet)" annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      SI.AbsolutePressure pPer "Periphery node pressure";
    equation
      for i in 1:N loop
        chambers[i].q = Data.Gper*(chambers[i].p - pPer) + Data.Gbore*(chambers[i].p - bore.p);
      end for;
      sum(Data.Gper*(chambers[i].p - pPer) for i in 1:N) = 0;
      bore.q = -sum(Data.Gbore*(chambers[i].p - bore.p) for i in 1:N);
      annotation (Icon(graphics={Rectangle(extent={{-100,60},{100,-60}}, lineColor={0,0,0}, fillColor={192,192,192},
        fillPattern=FillPattern.Solid), Rectangle(extent={{-70,30},{70,10}}, fillColor={255,255,0}, fillPattern=FillPattern.Solid),
        Text(extent={{-150,110},{150,70}}, textString="%name", lineColor={0,0,255})}));
    end AxialGap;

    model PortLand "Leakage across the port lands (outlet -> inlet)"
      Interfaces.FluidPort port_a annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      Interfaces.FluidPort port_b annotation (Placement(transformation(extent={{90,-10},{110,10}})));
    equation
      port_a.q = Data.Gland*(port_a.p - port_b.p);
      port_a.q + port_b.q = 0;
      annotation (Icon(graphics={Rectangle(extent={{-80,30},{80,-30}}, lineColor={0,0,0}, fillColor={215,215,215},
        fillPattern=FillPattern.Solid), Text(extent={{-150,80},{150,40}}, textString="%name", lineColor={0,0,255})}));
    end PortLand;

    model GerotorFriction "Mechanical losses: viscous (OD, faces, shaft bearings) + floor friction of single-sided porting"
      parameter Real Cvisc(unit="N.m.s/rad") = Data.Cvisc "Viscous loss coefficient: tau = Cvisc*w";
      parameter Real Kfloor(unit="N.m/Pa") = Data.Kfloor "Floor friction: tau = Kfloor*(p_out - p_in)";
      Modelica.Mechanics.Rotational.Interfaces.Flange_a flange annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      Interfaces.FluidPort port_out "Outlet pressure (sensing, no flow)" annotation (Placement(transformation(extent={{-10,90},{10,110}})));
      Interfaces.FluidPort port_in "Inlet pressure (sensing, no flow)" annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      SI.AngularVelocity w = der(flange.phi);
      SI.Torque tauLoss = flange.tau "Loss torque";
    equation
      port_out.q = 0;
      port_in.q = 0;
      flange.tau = Cvisc*w + Kfloor*max(port_out.p - port_in.p, 0)*tanh(w/0.1);
      annotation (Icon(graphics={Rectangle(extent={{-90,60},{90,-60}}, lineColor={0,0,0}, fillColor={170,213,255},
        fillPattern=FillPattern.Solid), Line(points={{-60,-30},{60,-30}}, thickness=1), Line(points={{-50,-30},{-30,30}}),
        Line(points={{-10,-30},{10,30}}), Line(points={{30,-30},{50,30}}), Text(extent={{-150,-70},{150,-110}}, textString="%name", lineColor={0,0,255})}));
    end GerotorFriction;

    model GerotorLumped "Gerotor pump as one block: N chambers with port orifices, tip/face/land leakage and shaft torque"
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
      parameter Real table[:, 6] = Data.table "Chamber 1 vs outer angle: theta, A, dA/dtheta, A_s, A_d, G_tip";
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
    end GerotorLumped;

    model Volume "Fluid volume with compressibility"
      parameter SI.Volume V = ${num(Vout)} "Volume";
      parameter SI.BulkModulus K = ${num(p.bulk * 1e6)} "Bulk modulus";
      parameter SI.AbsolutePressure p_start = ${num((p.pIn + p.dp) * 1e5)} "Initial pressure";
      Interfaces.FluidPort port annotation (Placement(transformation(extent={{-10,-10},{10,10}})));
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
${networkSystem(p, { w1, Ar, stop, revs, qExp })}
    model PumpSystemLumped "Same system with the gerotor as one block (Components.GerotorLumped)"
      extends Modelica.Icons.Example;
      parameter SI.AngularVelocity w = ${num(w1)} "Shaft speed (${p.rpm} rpm)";
      parameter SI.AbsolutePressure pIn = ${num(p.pIn * 1e5)} "Inlet / tank pressure";
      parameter SI.Area A = ${num(Ar)} "Load restriction area (sized for ${p.dp} bar at the expected flow)";
      Modelica.Mechanics.Rotational.Sources.ConstantSpeed speed(w_fixed=w, phi(start=0, fixed=true))
        annotation (Placement(transformation(extent={{-70,-60},{-50,-40}})));
      Components.GerotorLumped pump annotation (Placement(transformation(extent={{-20,-20},{20,20}})));
      Components.Tank inletTank(p=pIn) annotation (Placement(transformation(extent={{-70,-20},{-50,0}})));
      Components.Volume outletVolume annotation (Placement(transformation(extent={{30,30},{50,50}})));
      Components.Restriction load(A=A) annotation (Placement(transformation(extent={{50,-10},{70,10}})));
      Components.Tank returnTank(p=pIn) annotation (Placement(transformation(extent={{80,-40},{100,-20}})));
    equation
      connect(speed.flange, pump.shaft) annotation (Line(points={{-50,-50},{0,-50},{0,-20}}));
      connect(inletTank.port, pump.suction) annotation (Line(points={{-60,0},{-20,0}}, color={0,127,255}));
      connect(pump.delivery, outletVolume.port) annotation (Line(points={{20,0},{40,0},{40,40}}, color={0,127,255}));
      connect(pump.delivery, load.port_a) annotation (Line(points={{20,0},{50,0}}, color={0,127,255}));
      connect(load.port_b, returnTank.port) annotation (Line(points={{70,0},{90,0},{90,-20}}, color={0,127,255}));
      annotation (experiment(StopTime=${num(stop)}, Interval=${num(stop / 4000)}, Tolerance=1e-6));
    end PumpSystemLumped;
  end Examples;
  annotation (uses(Modelica(version="4.1.0")));
end ${name};
`;
  }

  /*
   * GT-SUITE-like network diagram: chambers on a ring at their housing angles (rotor in the centre,
   * shaft "spokes" to every chamber), tip gaps between neighbours, inlet / outlet port volumes left /
   * right with an orifice line to every chamber, axial gaps on top, port lands below.
   */
  function networkSystem(p, s) {
    const N = p.N, Rr = 110, Rg = 150, cs = 12, L = [];
    const r1 = v => Math.round(v * 10) / 10;
    const at = (a, r) => [r1(r * Math.cos(a)), r1(r * Math.sin(a))];
    const ext = (c, h) => `extent={{${r1(c[0] - h)},${r1(c[1] - h)}},{${r1(c[0] + h)},${r1(c[1] + h)}}}`;
    const ang = k => TAU * (k - 1) / N + Math.PI / N;            // housing angle of chamber k at t = 0
    const decl = [], eqs = [];
    const line = (a, b, ...pts) => `connect(${a}, ${b}) annotation (Line(points={${pts.map(q => `{${r1(q[0])},${r1(q[1])}}`).join(',')}}, color={0,127,255}));`;
    const mline = (a, b, ...pts) => `connect(${a}, ${b}) annotation (Line(points={${pts.map(q => `{${r1(q[0])},${r1(q[1])}}`).join(',')}}));`;
    const IV = [-215, 0], OV = [215, 0];
    for (let k = 1; k <= N; k++) {
      const c = at(ang(k), Rr);
      decl.push(`      Components.Chamber Vol${k}(k=${k}) annotation (Placement(transformation(${ext(c, cs)})));`);
      eqs.push(line(`InletVol.port`, `Vol${k}.In`, IV, [c[0] - cs, c[1]]));
      eqs.push(line(`Vol${k}.Out`, `OutletVol.port`, [c[0] + cs, c[1]], OV));
      eqs.push(mline(`Vol${k}.flange`, `rotor.flange`, [c[0], c[1] - cs], [0, 0]));
      eqs.push(line(`Vol${k}.Aux`, `Axial_Gap.chambers[${k}]`, [c[0], c[1] + cs], [0, 180]));
      const g = at(ang(k) + Math.PI / N, Rg), kn = k % N + 1, cn = at(ang(kn), Rr);
      decl.push(`      Components.TipGap gap${k}(k=${k}) annotation (Placement(transformation(${ext(g, 8)})));`);
      eqs.push(line(`Vol${k}.Aux`, `gap${k}.port_a`, [c[0], c[1] + cs], [g[0] - 8, g[1]]));
      eqs.push(line(`gap${k}.port_b`, `Vol${kn}.Aux`, [g[0] + 8, g[1]], [cn[0], cn[1] + cs]));
    }
    return `    model PumpSystem "Gerotor network (chambers, tip gaps, axial gaps, port volumes) at constant speed with a load restriction"
      extends Modelica.Icons.Example;
      parameter SI.AngularVelocity w = ${num(s.w1)} "Shaft speed (${p.rpm} rpm)";
      parameter SI.AbsolutePressure pIn = ${num(p.pIn * 1e5)} "Inlet / tank pressure";
      parameter SI.Area A = ${num(s.Ar)} "Outlet restriction area (sized for ${p.dp} bar at the expected flow)";
      parameter Real gearRatio = 1 "Drive gear ratio (engine / pump shaft)";
      SI.VolumeFlowRate qDelivered = OutletRestriction.port_a.q "Delivered flow";
      SI.Torque tauShaft = -PumpGearRatio.flange_b.tau "Pump shaft torque incl. mechanical losses";
      SI.Torque tauPressure = ${Array.from({ length: N }, (_, i) => `Vol${i + 1}.flange.tau`).join(' + ')} "Pressure torque (sum over the chambers)";
      SI.Power powerIn = tauShaft*rotor.w1 "Drive power";
      inner Components.Rotor rotor "PumpAnalysis: shaft angle to all chambers" annotation (Placement(transformation(extent={{-20,-20},{20,20}})));
      Modelica.Mechanics.Rotational.Sources.ConstantSpeed EngineSpeed(w_fixed=w*gearRatio, phi(start=0, fixed=true))
        annotation (Placement(transformation(extent={{270,-270},{250,-250}})));
      Modelica.Mechanics.Rotational.Components.IdealGear PumpGearRatio(ratio=gearRatio)
        annotation (Placement(transformation(extent={{230,-270},{210,-250}})));
      Modelica.Mechanics.Rotational.Components.Inertia PumpMechShaft(J=Data.J)
        annotation (Placement(transformation(extent={{150,-270},{130,-250}})));
      Components.GerotorFriction GerotorFriction annotation (Placement(transformation(extent={{-130,-270},{-110,-250}})));
      Components.Tank InletEnv(p=pIn) annotation (Placement(transformation(extent={{-300,-40},{-280,-20}})));
      Components.Restriction InletLine(A=4*Data.AsPort) "Inlet gallery" annotation (Placement(transformation(extent={{-265,-10},{-245,10}})));
      Components.Volume InletVol(V=${num(Math.max(p.inletVol || 0, 1) * 1e-6)}, p_start=pIn) annotation (Placement(transformation(extent={{-225,-10},{-205,10}})));
      Components.Volume OutletVol annotation (Placement(transformation(extent={{205,-10},{225,10}})));
      Components.Restriction OutletRestriction(A=A) annotation (Placement(transformation(extent={{245,-10},{265,10}})));
      Components.Tank OutletEnv(p=pIn) annotation (Placement(transformation(extent={{280,-40},{300,-20}})));
      Components.AxialGap Axial_Gap annotation (Placement(transformation(extent={{-30,180},{30,220}})));
      Components.PortLand Port_Land annotation (Placement(transformation(extent={{-15,-215},{15,-195}})));
${decl.join('\n')}
    equation
      ${mline('EngineSpeed.flange', 'PumpGearRatio.flange_a', [250, -260], [230, -260])}
      ${mline('PumpGearRatio.flange_b', 'PumpMechShaft.flange_a', [210, -260], [150, -260])}
      ${mline('PumpMechShaft.flange_b', 'rotor.flange', [130, -260], [0, -260], [0, 0])}
      ${mline('GerotorFriction.flange', 'rotor.flange', [-110, -260], [0, -260], [0, 0])}
      ${line('GerotorFriction.port_in', 'InletVol.port', [-130, -260], [-235, -260], [-235, 0], IV)}
      ${line('GerotorFriction.port_out', 'OutletVol.port', [-120, -250], [-120, -235], [245, -235], [245, 0], OV)}
      ${line('InletEnv.port', 'InletLine.port_a', [-290, -20], [-290, 0], [-265, 0])}
      ${line('InletLine.port_b', 'InletVol.port', [-245, 0], IV)}
      ${line('OutletVol.port', 'OutletRestriction.port_a', OV, [245, 0])}
      ${line('OutletRestriction.port_b', 'OutletEnv.port', [265, 0], [290, 0], [290, -20])}
      ${line('Axial_Gap.bore', 'InletVol.port', [-30, 200], [-235, 200], [-235, 0], IV)}
      ${line('OutletVol.port', 'Port_Land.port_a', OV, [235, 0], [235, -205], [15, -205])}
      ${line('Port_Land.port_b', 'InletVol.port', [-15, -205], [-235, -205], [-235, 0], IV)}
      ${eqs.join('\n      ')}
      annotation (Diagram(coordinateSystem(extent={{-310,-290},{310,230}})),
        experiment(StopTime=${num(s.stop)}, Interval=${num(s.stop / 4000)}, Tolerance=1e-6),
        Documentation(info="<html><p>${s.revs} outer-rotor revolutions at ${p.rpm} rpm. Each chamber Vol<i>k</i> is a volume
          with its suction (In) and delivery (Out) port orifices; gap<i>k</i> are the tip/flank gaps between neighbouring
          chambers, Axial_Gap the face gaps to the periphery and the shaft bore, Port_Land the land leakage. The outlet
          restriction is sized for &Delta;p = ${p.dp} bar at the expected flow ${(s.qExp * 6e4).toFixed(3)} L/min.</p></html>"));
    end PumpSystem;
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

  // Top-level system model (own file) so that OMEdit opens straight into the connected diagram.
  function systemText(p, name) {
    const w2 = p.rpm * TAU / 60 * (p.N - 1) / p.N, stop = 6 * TAU / Math.max(w2, 1e-9);
    return `within ;
model ${name}_System "Ready-to-run system: ${p.rpm} rpm, ${p.dp} bar (open the Diagram view; Simulate)"
  extends ${name}.Examples.PumpSystem;
  annotation (experiment(StopTime=${num(stop)}, Interval=${num(stop / 4000)}, Tolerance=1e-6));
end ${name}_System;
`;
  }

  function exportModelica(p, res, opt) {
    opt = opt || {};
    const name = ident(opt.name || 'GerotorPump');
    const mo = packageText(p, res, Object.assign({}, opt, { name }));
    return {
      name,
      files: {
        [name + '.mo']: mo,
        [name + '_System.mo']: systemText(p, name),
        'cases.mos': caseScript(p, res, Object.assign({}, opt, { name }), name + '.mo'),
        'cases.csv': caseCsv(p, res, opt),
      },
    };
  }

  G.modelica = { exportModelica, packageText, systemText, frictionData, caseScript, caseCsv, cases, tables, ident };
})(window.Gerotor);
