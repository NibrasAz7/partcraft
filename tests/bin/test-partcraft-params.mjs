#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-partcraft-params.mjs — PartCraft's parametric side: the expression language and the engine (expr.js, params.js),
 * the part adapter (params-part.js) on real parts built by the exact kernel (OpenCascade), the part file's params key,
 * PartCraft scripts (script.js) both ways, design tables, and the command line tool (tools/partcraft-cli) run as a
 * separate process.
 *
 *   node bin/test-partcraft-params.mjs [--verbose] [--keep]      (--keep leaves the CLI's files in tmp/partcraft-params-test)
 *
 * Volumes are compared with closed forms worked out by hand (to 1e-9 relative). The flange: a revolved weld-neck
 * profile (disc thickness t, hub to height t + 50) with n holes of radius r through the disc:
 *   V(t, n, r) = π [ (100² − 34²)·t + (50/3)(52² + 52·40 + 40²) − 34²·50 − n·r²·t ] = π [ 8844 t + 48600 − n r² t ].
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.join(REPO, 'public_html/assets/apps/partcraft/dev/');
const VERBOSE = process.argv.includes('--verbose');
const KEEP = process.argv.includes('--keep');
const TMP = path.join(REPO, 'tmp/partcraft-params-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

const E = await import(DEV + 'expr.js');
const PR = await import(DEV + 'params.js');
const PP = await import(DEV + 'params-part.js');
const SC = await import(DEV + 'script.js');
const S = await import(DEV + 'sketch.js');
const P = await import(DEV + 'part.js');
const { solveSketch } = await import(DEV + 'solver.js');
const B = await import(DEV + 'brep.js');
const F = await import(path.join(REPO, 'tools/partcraft-test/fixtures.mjs'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const section = (t) => console.log('\n== ' + t);
const rel = (a, b, r = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= r * Math.max(1, Math.abs(b));
const PI = Math.PI;
const val = (src, v = {}) => { const r = E.compute(src, v); return r.ok ? r.value : 'ERR: ' + r.error; };
const bad = (src, re, v = {}) => { const r = E.compute(src, v); return !r.ok && (!re || re.test(r.error)); };

// =========================================================================================
section('expressions: units, precedence, functions, refusals');
ok(val('1in') === 25.4 && val("2'") === 609.6 && rel(val('3 "'), 76.2) && val('1.5cm') === 15 && val('2m') === 2000 && val('1ft + 1in') === 330.2, 'units turn into millimetres: 1in, 2\', 3 ", 1.5cm, 2m, 1ft + 1in');
ok(rel(val('0.5rad'), 28.64788975654116) && val('90°') === 90 && val('45deg') === 45, 'angles: rad → degrees, ° and deg');
ok(val('2 + 3 * 4') === 14 && val('(2 + 3) * 4') === 20 && val('2^3^2') === 512 && val('-2^2') === -4 && val('10 % 4') === 2 && val('-7 % 3') === 2, 'precedence: * before +, ^ right-associative, -2^2 = -4, % floors');
ok(val('sin(30)') === 0.5 && val('cos(60)') === 0.5 && val('atan2(1, 1)') === 45 && val('sqrt(16)') === 4 && val('max(1, 7, 3)') === 7 && val('pi') === PI, 'trigonometry in degrees, sqrt, max, pi');
ok(val('if(w > 10, 1, 2)', { w: 12 }) === 1 && val('if(w > 10, 1, 2)', { w: 10 }) === 2 && val('w == 10', { w: 10 }) === 1, 'comparisons give 1/0 and feed if()');
ok(val('round(2.5)') === 3 && val('round(-2.5)') === -3 && val('round(1.005, 2)') === 1.01 && val('ceil(0.1 * 3 / 0.3)') === 1 && val('floor(0.7 + 0.1 + 0.2)') === 1, 'rounding: half away from zero, binary noise ignored by round/ceil/floor');
ok(bad('constructor', /no value|parameter/) && bad('__proto__') && bad('toString(1)', /not a function/) && bad('constructor(1)', /not a function/), 'constructor, __proto__, toString() are only unknown names');
ok(bad('1 / 0', /divides by zero/) && bad('sqrt(-1)') && bad('ln(0)') && bad('tan(90)') && bad('2 +') && bad('(1') && bad('1)') && bad('a b', /operator/, { a: 1, b: 2 }) && bad('x;1') && bad('`1`'), 'division by zero, sqrt(−1), ln(0), tan(90), unfinished and stray tokens are errors');
ok(bad('1+'.repeat(600) + '1', /too long/) && bad('('.repeat(150) + '1' + ')'.repeat(150), /deeply/), 'expressions longer than 1000 characters or nested over 100 deep are refused');
ok(E.literal('40') === 40 && E.literal('-2in') === -50.8 && E.literal('w') === null && E.literal('2*3') === null && E.literal('pi') === null, 'literal(): plain numbers only');
ok(E.renameIn('w*2 + 25mm + width', 'w', 'x') === 'x*2 + 25mm + width' && E.renameIn('2m + m', 'm', 'q') === '2m + q', 'renameIn renames whole names, never units after numbers');

section('engine: variables, cycles, solving backward through chains');
{
  const p = PR.emptyParams();
  ok(PR.setVar(p, 'width', '100').ok && PR.setVar(p, 'half', 'width / 2').ok && PR.setVar(p, 'q', 'half / 2 + 1').ok, 'variables and driven variables');
  const ev = PR.evaluateVars(p);
  ok(ev.values.get('q') === 26 && ev.order.indexOf('width') < ev.order.indexOf('q'), 'evaluated in dependency order: q = 26');
  const cyc = PR.setVar(p, 'width', 'q * 2');
  ok(!cyc.ok && cyc.cycle && PR.varByName(p, 'width').expr === '100', `a cycle is refused and reverted (${cyc.error})`);
  ok(!PR.setVar(p, 'sin', '3').ok && !PR.setVar(p, 'mm', '3').ok && !PR.setVar(p, 'pi', '3').ok && !PR.setVar(p, '2x', '3').ok && !PR.setVar(p, 'a-b', '3').ok, 'reserved names (functions, units) and bad names are refused');
  { const z = PR.emptyParams(); const r = ['__proto__', 'constructor', 'prototype'].map((n) => PR.setVar(z, n, '7')); ok(r.every((x) => !x.ok && /reserved/.test(x.error)) && !z.vars.length && Object.getPrototypeOf({}) === Object.prototype, '__proto__, constructor and prototype are refused as parameter names'); }
  const r = PR.driveVar(p, 'q', 51);
  ok(r.ok && r.var === 'width' && r.to === 200 && PR.evaluateVars(p).values.get('q') === 51, 'typing q = 51 solves width through half: 200');
  const r2 = PR.driveVar(p, 'q', 1);
  ok(r2.ok && r2.to === 0, 'and q = 1 gives width 0 (a clean root, rounded)');
  PR.setVar(p, 'width', '100'); PR.setVar(p, 'b', '3'); PR.setVar(p, 'both', 'width + b');
  const amb = PR.driveVar(p, 'both', 110);
  ok(!amb.ok && amb.choices.join() === 'width,b', 'two driving variables behind a value: the choices are listed');
  const pick = PR.driveVar(p, 'both', 110, { prefer: 'b' });
  ok(pick.ok && pick.var === 'b' && PR.varByName(p, 'b').expr === '10', 'prefer b → b = 10');
  PR.setVar(p, 'sq', 'width ^ 2');
  ok(PR.driveVar(p, 'sq', 14400).to === 120, 'a nonlinear chain (width² = 14400) solves to 120');
  { const r3 = PR.driveVar(p, 'sq', 14401); ok(r3.ok && rel(r3.to ** 2, 14401, 1e-10) && String(r3.to).replace(/^\d+\.?/, '').length <= 13, `an irrational root keeps at most 12–13 significant digits (${r3.to})`); }
  ok(!PR.removeVar(p, 'width').ok && PR.removeVar(p, 'width', { inline: true }).ok && /^\(\d+(\.\d+)?\) \/ 2$/.test(PR.varByName(p, 'half').expr), 'removing a used variable is refused unless its value is written in');
}

// =========================================================================================
section('adapter: targets, labels, keys');
const fl0 = F.flange();
{
  const t = PP.partAdapter.targets(fl0.part);
  const disc = t.get(fl0.ids.profile + '.' + fl0.dims.disc);
  ok(t.get(fl0.ids.hole + '.d')?.label === 'Hole1 diameter' && t.get(fl0.ids.pattern + '.count')?.kind === 'count' && t.get(fl0.ids.revolve + '.angle')?.max === 360, 'feature numbers: Hole1 diameter, CirPattern1 count (count), Revolve1 angle (≤ 360)');
  ok(disc && disc.label === 'Sketch1 D4 (distance)' && disc.kind === 'length', `sketch dimensions: ${disc?.label}`);
  ok(PP.resolveTarget(fl0.part, 'Hole1.d') === fl0.ids.hole + '.d' && PP.resolveTarget(fl0.part, 'Hole1 diameter') === fl0.ids.hole + '.d' && PP.resolveTarget(fl0.part, 'Sketch1.D4') === fl0.ids.profile + '.' + fl0.dims.disc && PP.resolveTarget(fl0.part, 'Nope.d') === null, 'names people type resolve to keys: Hole1.d, "Hole1 diameter", Sketch1.D4');
  PP.registerParamField('loft', 'twist', { label: 'twist', kind: 'angle', min: -360, max: 360 });
  ok(PP.PARAM_FIELDS.loft.twist.kind === 'angle' && (() => { try { PP.registerParamField('loft', 'k7'); return false; } catch { return true; } })(), 'registerParamField adds a field (and refuses names like k7 that sketch dimensions use)');
  delete PP.PARAM_FIELDS.loft.twist;
}

section('flange, exact kernel: bolt_d drives the hole and the pattern count; the disc chain drives two dimensions');
const { default: occtInit } = await import(path.join(REPO, 'public_html/assets/vendor/replicad-opencascadejs/current/replicad_single.js'));
const oc = await occtInit({ print: () => {}, printErr: () => {} });
const xb = (part) => B.regenerateBrep(part, oc);
const allOk = (r) => [...r.results.values()].every((x) => x.status === 'ok');
const Vfl = (t, n, r) => PI * (8844 * t + 48600 - n * r * r * t);
const fl = F.flange();
const part = fl.part;
const heightKey = fl.ids.profile + '.' + fl.dims.height, discKey = fl.ids.profile + '.' + fl.dims.disc;
{
  const p = PP.paramsOf(part);
  PR.setVar(p, 'bolt_d', '14'); PR.setVar(p, 'disc_t', '30'); PR.setVar(p, 'hub_h', 'disc_t + 50');
  ok(PR.setLink(p, PP.partAdapter, part, fl.ids.hole + '.d', 'bolt_d').ok, 'Hole1 diameter = bolt_d');
  ok(PR.setLink(p, PP.partAdapter, part, fl.ids.pattern + '.count', 'if(bolt_d >= 16, 6, 8)').ok, 'CirPattern1 count = if(bolt_d >= 16, 6, 8)');
  ok(PR.setLink(p, PP.partAdapter, part, discKey, 'disc_t').ok && PR.setLink(p, PP.partAdapter, part, heightKey, 'hub_h').ok, 'Sketch1 disc thickness = disc_t, hub height = hub_h = disc_t + 50');
  let a = PP.applyPartParams(part);
  let r = xb(part);
  ok(a.ok && allOk(r) && rel(r.stats.volume, Vfl(30, 8, 7)), `as built: ${Vfl(30, 8, 7).toFixed(6)} = 302160π (got ${r.stats.volume.toFixed(6)})`);
  PR.setVar(p, 'bolt_d', '16');
  a = PP.applyPartParams(part);
  r = xb(part);
  const f = (id) => P.featureById(part, id);
  ok(a.ok && a.changed.sort().join() === [fl.ids.hole + '.d', fl.ids.pattern + '.count'].sort().join() && f(fl.ids.hole).d === 16 && f(fl.ids.pattern).count === 6, 'forward bolt_d = 16: the hole is 16 and the pattern drops to 6');
  ok(allOk(r) && rel(r.stats.volume, Vfl(30, 6, 8)), `volume π(8844·30 + 48600 − 6·64·30) = ${Vfl(30, 6, 8).toFixed(6)} (got ${r.stats.volume.toFixed(6)})`);
  const d = PR.driveBack(p, PP.partAdapter, part, fl.ids.hole + '.d', 12);
  a = PP.applyPartParams(part);
  r = xb(part);
  ok(d.ok && d.var === 'bolt_d' && d.to === 12 && f(fl.ids.pattern).count === 8, 'backward: Hole1 diameter typed 12 → bolt_d = 12, the count goes back to 8');
  ok(allOk(r) && rel(r.stats.volume, Vfl(30, 8, 6)), `volume ${Vfl(30, 8, 6).toFixed(6)} = 305280π (got ${r.stats.volume.toFixed(6)})`);
  const h = PR.driveBack(p, PP.partAdapter, part, heightKey, 90);
  a = PP.applyPartParams(part);
  r = xb(part);
  const sk = f(fl.ids.profile).sketch;
  ok(h.ok && h.var === 'disc_t' && h.to === 40 && sk.constraints.find((c) => c.id === fl.dims.disc).value === 40, 'backward through a chain: hub height typed 90 → hub_h = disc_t + 50 → disc_t = 40, both dimensions move');
  ok(allOk(r) && rel(r.stats.volume, Vfl(40, 8, 6)), `volume π(8844·40 + 48600 − 8·36·40) = ${Vfl(40, 8, 6).toFixed(6)} (got ${r.stats.volume.toFixed(6)})`);
  const wrong = PR.driveBack(p, PP.partAdapter, part, fl.ids.pattern + '.count', 7.5);
  ok(!wrong.ok && /whole number/.test(wrong.error), 'a count typed 7.5 is refused before anything changes');
  PR.setVar(p, 'bolt_d', '-3');
  a = PP.applyPartParams(part);
  ok(!a.ok && a.errors.some((e) => e.where === fl.ids.hole + '.d' && /at least/.test(e.message)) && f(fl.ids.hole).d === 12, 'bolt_d = −3: the hole keeps 12 and the equation reports its limit');
  PR.setVar(p, 'bolt_d', '12'); PP.applyPartParams(part);
}

section('adapter: a sketch that cannot solve is put back');
{
  const pt = P.newPart('Ring');
  const sk = S.newSketch();
  const c = S.addCircle(sk, [0, 0], 10);
  S.addConstraint(sk, 'coincident', [c.c, 'O']);
  const rad = S.addConstraint(sk, 'radius', [c.id], 10);
  const q = S.addPoint(sk, 10, 0);
  S.addConstraint(sk, 'coincident', [q, c.id]);
  S.addConstraint(sk, 'horizontal', ['O', q]);
  const dq = S.addConstraint(sk, 'distance', ['O', q], 10);
  const sf = P.addFeature(pt, 'sketch', { plane: { kind: 'base', name: 'front' }, sketch: sk });
  const p = PP.paramsOf(pt);
  PR.setVar(p, 'r', '10'); PR.setVar(p, 'reach', '10');
  PR.setLink(p, PP.partAdapter, pt, sf.id + '.' + rad.id, 'r');
  PR.setLink(p, PP.partAdapter, pt, sf.id + '.' + dq.id, 'reach');
  PR.setVar(p, 'reach', '5');
  const before = JSON.stringify(sk.entities);
  const a = PP.applyPartParams(pt);
  ok(!a.ok && a.errors.some((e) => e.where === 'Sketch1' && /cannot be solved/.test(e.message)), `reach = 5 with r = 10 cannot be met: reported on Sketch1 (${a.errors[0]?.message})`);
  ok(sk.constraints.find((k) => k.id === dq.id).value === 10 && JSON.stringify(sk.entities) === before, 'its dimension is put back to 10 and no point moved');
  PR.setVar(p, 'reach', '20'); PR.setVar(p, 'r', '20');
  ok(PP.applyPartParams(pt).ok && rel(sk.entities.find((e) => e.id === c.id).r, 20, 1e-9), 'r = reach = 20 solves: the circle grows to 20');
}

// =========================================================================================
section('part file: params key, version, tampered params refused');
{
  const json = P.toJSON(part);
  const j = JSON.parse(json);
  ok(j.version === 3 && j.params && j.params.vars.length === 3 && j.params.links.length === 4, 'a part with params is saved as version 3 with a params key');
  const back = P.readPart(json);
  ok(JSON.stringify(back.params) === JSON.stringify(part.params) && rel(xb(back).stats.volume, Vfl(40, 8, 6)), 'it reads back with the same params and builds the same volume');
  const plain = F.flange().part;
  PP.paramsOf(plain); PP.tidyParams(plain);
  ok(!('params' in JSON.parse(P.toJSON(plain))) && P.fileVersion(plain) === 2, 'no params: no key, and the file stays version 2');
  const empty = F.flange().part; empty.params = PR.emptyParams();
  ok(!('params' in JSON.parse(P.toJSON(empty))) && P.fileVersion(empty) === 2, 'an empty params table is not written either');
  const tamper = (fn) => { const t = JSON.parse(json); fn(t); try { P.readPart(JSON.stringify(t)); return 'read'; } catch (e) { return e.message; } };
  const cases = [
    [(t) => { t.params.links[0].target = 'f99.depth'; }, /does not have/, 'an equation on a feature the file does not have'],
    [(t) => { t.params.links[0].target = fl.ids.hole + '.colour'; }, /does not have/, 'an equation on a field that cannot be driven'],
    [(t) => { t.params.vars[0].name = 'sin'; }, /function/, 'a parameter called sin'],
    [(t) => { t.params.vars.push({ ...t.params.vars[0] }); }, /already/, 'two parameters with one name'],
    [(t) => { t.params.vars[0].expr = 'bolt_d +'; }, /not a valid expression/, 'a broken expression'],
    [(t) => { t.params.vars[0].expr = 'x'.repeat(1001); }, /not a valid expression/, 'an expression over 1000 characters'],
    [(t) => { t.params.links.push({ ...t.params.links[0] }); }, /bad/, 'two equations on one number'],
    [(t) => { t.params.links[0].target = '../../etc'; }, /bad/, 'a target with path characters'],
    [(t) => { t.params.vars = Array.from({ length: 501 }, (_, i) => ({ name: 'v' + i, expr: '1' })); }, /bad/, '501 parameters'],
    [(t) => { t.params = [1, 2]; }, /bad/, 'params as an array'],
  ];
  for (const [fn, re, what] of cases) { const m = tamper(fn); ok(m !== 'read' && re.test(m), `refused: ${what} (${m})`); }
}

// =========================================================================================
section('scripts: every fixture part → script → part (same JSON modulo ids, same exact volume)');
function canon(pt) {
  const j = JSON.parse(P.toJSON(pt));
  const map = new Map();
  for (const f of j.features) {
    if (f.type !== 'sketch') continue;
    delete f.sketch.seq;
    f.sketch.constraints.forEach((c, i) => { const n = 'K' + (i + 1); map.set(f.id + '.' + c.id, f.id + '.' + n); for (const d of f.sketch.constraints) if (d.of === c.id) d.of = n; c.id = n; });
  }
  if (j.params) { for (const l of j.params.links) l.target = map.get(l.target) || l.target; j.params.links.sort((a, b) => (a.target < b.target ? -1 : 1)); }
  delete j.seq;
  return j;
}
function diff(a, b, at = '', out = []) {
  if (typeof a === 'number' && typeof b === 'number') { if (!(Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a)))) out.push(`${at}: ${a} ≠ ${b}`); return out; }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b) || Object.keys(a).join() !== Object.keys(b).join()) { out.push(`${at}: keys ${Object.keys(a)} ≠ ${Object.keys(b)}`); return out; }
    for (const k of Object.keys(a)) diff(a[k], b[k], at + '.' + k, out);
    return out;
  }
  if (a !== b) out.push(`${at}: ${JSON.stringify(a)?.slice(0, 60)} ≠ ${JSON.stringify(b)?.slice(0, 60)}`);
  return out;
}
const fixtures = [];
{
  fixtures.push(['flange with parameters and four equations', part]);
  fixtures.push(['flange as drawn', F.flange().part]);
  // block, fillet, shell, chamfer (edge and face references), a suppressed feature, rollback
  const bp = P.newPart('Block');
  const b = F.blockSketch(100, 50);
  const s1 = P.addFeature(bp, 'sketch', { plane: { kind: 'base', name: 'top' }, sketch: b.sk });
  const e1 = P.addFeature(bp, 'extrude', { sketch: s1.id, depth: 20 });
  let r = B.regenerateBrep(bp, oc);
  const vert = r.edges.filter((e) => e.faces.every((n) => n.includes('.side:')));
  const fil = P.addFeature(bp, 'fillet', { edges: vert.map(B.edgeRef), r: 5 });
  P.addFeature(bp, 'shell', { faces: [{ name: e1.id + '.start' }], t: 2 });
  r = B.regenerateBrep(bp, oc);
  const top = r.edges.filter((e) => e.faces.includes(e1.id + '.end') && !e.faces.some((n) => n.includes('~')));
  P.addFeature(bp, 'chamfer', { edges: top.map(B.edgeRef), d: 1 });
  const pb = PP.paramsOf(bp);
  PR.setVar(pb, 'rad', '5'); PR.setVar(pb, 'w', '100');
  PR.setLink(pb, PP.partAdapter, bp, fil.id + '.r', 'rad');
  PR.setLink(pb, PP.partAdapter, bp, s1.id + '.' + b.dw, 'w');
  fixtures.push(['block with fillet (edge refs), shell (face ref), chamfer', bp]);
  const bs = structuredClone(bp); bs.features[3].suppressed = true; bs.rollback = 3; bs.name = 'Block "rolled" #2';
  fixtures.push(['the same, a suppressed shell, rollback bar above it, a name with quotes and #', bs]);
  // linear pattern + mirror + revolve + cut + counterbore hole on a face
  const lp = P.newPart('Patterns');
  const lb = F.blockSketch(100, 50);
  const ls = P.addFeature(lp, 'sketch', { plane: { kind: 'base', name: 'top' }, sketch: lb.sk });
  const le = P.addFeature(lp, 'extrude', { sketch: ls.id, depth: 20 });
  const hs = S.newSketch(); const hp = S.addPoint(hs, 10, 10); S.addConstraint(hs, 'hdistance', ['O', hp], 10); S.addConstraint(hs, 'vdistance', ['O', hp], 10);
  const hsf = P.addFeature(lp, 'sketch', { plane: { kind: 'face', feature: le.id, face: 'end' }, sketch: hs });
  const ho = P.addFeature(lp, 'hole', { sketch: hsf.id, kind: 'cbore', d: 5, through: true, cboreD: 9, cboreDepth: 3 });
  P.addFeature(lp, 'lpattern', { seeds: [ho.id], dir: { kind: 'world', axis: 'x' }, count: 4, spacing: 25 });
  P.addFeature(lp, 'mirror', { seeds: 'body', plane: { kind: 'fixed', o: [0, 0, 0], n: [0, 0, 1] } });
  const cs = S.newSketch(); S.addCircle(cs, [50, 25], 8);
  const csf = P.addFeature(lp, 'sketch', { plane: { kind: 'base', name: 'top' }, sketch: cs });
  P.addFeature(lp, 'extrude', { sketch: csf.id, op: 'cut', end: 'through', depth: 10 });
  fixtures.push(['block, counterbore on a face, linear pattern, mirror of the body (fixed plane), through cut', lp]);
  const rp = P.newPart('Ring');
  const rs = S.newSketch();
  const ax = S.addLine(rs, [0, 0], [0, 10], { construction: true });
  S.addRect(rs, [10, 0], [20, 5]);
  const arc = S.addCircle(rs, [30, 3], 2);
  const rsf = P.addFeature(rp, 'sketch', { plane: { kind: 'base', name: 'front' }, sketch: rs });
  P.addFeature(rp, 'revolve', { sketch: rsf.id, axis: ax.id, angle: 90 });
  S.addConstraint(rs, 'radius', [arc.id], 2);
  fixtures.push(['revolve about a centerline (a rectangle and a circle with a radius)', rp]);
  // a spline sketch, a reference plane and an extrude to an offset (design features: written as json)
  const dp = P.newPart('Design');
  const ds = S.newSketch(); S.addSpline(ds, [[0, 0], [10, 5], [20, 0], [10, -8]], { closed: true });
  const dsf = P.addFeature(dp, 'sketch', { plane: { kind: 'base', name: 'top' }, sketch: ds });
  P.addFeature(dp, 'extrude', { sketch: dsf.id, depth: 7 });
  P.addFeature(dp, 'plane', { mode: 'offset', planes: [{ kind: 'base', name: 'top' }], d: 15 });
  fixtures.push(['a closed spline extruded, a reference plane (design feature)', dp]);
  // an imported STEP solid
  const ip = P.newPart('Imported');
  ip.features.push({ id: 'f1', type: 'import', name: 'Imported1', file: 'block.step', step: B.exportStep(F.flange().part, oc).text, up: 'y' }); ip.seq = 2;
  fixtures.push(['an imported STEP solid (the STEP written beside the script)', ip]);
}
for (const [what, pt] of fixtures) {
  const src = P.readPart(P.toJSON(pt));
  for (const f of src.features) if (f.type === 'sketch') solveSketch(f.sketch);   // as the app saves them: solved
  const s = SC.partToScript(src);
  let back, err = null;
  const files = new Map(s.files.map((f) => [f.name, f.text]));
  try { back = SC.scriptToPart(s.text, { readFile: (n) => { if (!files.has(n)) throw new Error('missing'); return files.get(n); } }); } catch (e) { err = e.message; }
  if (err) { ok(false, `${what}: script reads back (${err})`); continue; }
  const d = diff(canon(src), canon(back.part));
  const v1 = xb(structuredClone(src)), v2 = xb(structuredClone(back.part));
  ok(d.length === 0, `${what}: same JSON modulo ids${d.length ? ' — ' + d.slice(0, 3).join('; ') : ''}`);
  ok(rel(v1.stats?.volume ?? 0, v2.stats?.volume ?? -1, 1e-9) && v1.stats?.volume > 0, `${what}: same exact volume ${v1.stats?.volume?.toFixed(6)}`);
  const s2 = SC.partToScript(back.part);
  ok(s2.text === s.text, `${what}: written again, the script is identical (${s.text.split('\n').length} lines)`);
}
{
  const s = SC.partToScript(fixtures[0][1]).text;
  ok(/^param bolt_d = 12$/m.test(s) && /^  d = bolt_d$/m.test(s) && /^  count = if\(bolt_d >= 16, 6, 8\)$/m.test(s) && /^  distance l\d+ = disc_t$/m.test(s) && /^sketch Sketch2\n  on face Revolve1 side l\d+$/m.test(s), 'the flange script reads like the spec: param lines, d = bolt_d, count = if(…), distance … = disc_t, on face Revolve1 side …');
  const ex = SC.partToScript(fixtures[0][1], { exact: true }).text;
  ok(ex.length >= s.length && SC.scriptToPart(ex).part.features.length === 5, '--exact writes every digit and reads back');
}

section('scripts by hand: the example bracket, errors with line numbers, limits');
{
  const text = fs.readFileSync(path.join(REPO, 'tools/partcraft-cli/examples/bracket.pcscript'), 'utf8');
  const r = SC.scriptToPart(text);
  const v = xb(r.part).stats.volume;
  ok(r.warnings.length === 0 && rel(v, 120 * 60 * 8 - 2 * PI * 4.25 ** 2 * 8), `bracket.pcscript builds: 120·60·8 − 2π·4.25²·8 = ${v.toFixed(6)}`);
  ok(r.part.params.links.length === 8 && P.featureById(r.part, 'f4').d === 8.5, 'its eight equations are links (hole d = bolt = 8.5)');
  const err = (src, re, line) => { try { SC.scriptToPart(src); return false; } catch (e) { const hit = e.errors?.find((x) => re.test(x.message)); return !!hit && (line === undefined || hit.line === line); } };
  ok(err('extrude E1\n  sketch Nope\n', /no feature called "Nope"/, 2), 'an unknown sketch name: line 2');
  ok(err('param w = 10\nsketch S\n  on top\n  point a 0, 0\n  distance a = w\n', /does not apply/, 5), 'a dimension on the wrong geometry: line 5');
  ok(err('param w = 10\n\n# comment\nsketch S\n  on top\n  point a 0, 0\n  point b 1, 0\n  line l a b\n  distance l = q\n', /no parameter called "q"/, 9), 'an unknown parameter in a dimension: line 9 (blank and comment lines counted)');
  ok(err('param a = b\nparam b = a\n', /use each other/, 1), 'a parameter cycle: refused at its line');
  ok(err('extrud E1\n', /not a statement/, 1) && err('  depth 3\n', /no statement above/, 1) && err('extrude E\n  depth\n', /needs a value/, 2), 'a misspelled statement, an orphan setting and a missing value');
  ok(err('param w = 10\nextrude E\n  depth = -w\n', /at least/), 'an equation giving a negative depth');
  ok(err('pcscript 2\n', /format 2/, 1), 'a newer script format is refused, saying so');
  ok(err('extrude E\n  __proto__ 1\n', /not a setting name/, 2) && err('extrude E\n  op json {"a":\n', /json value/, 2), '__proto__ as a setting and broken json are refused');
  ok(err('sketch S\n' + '  point p1 0, 0\n'.repeat(2), /already has something called p1/, 3), 'two pieces of geometry with one name');
  ok((() => { try { SC.scriptToPart('x'.repeat(SC.SCRIPT_LIMITS.bytes + 1)); return false; } catch (e) { return /MB at most/.test(e.message); } })(), `a script over ${SC.SCRIPT_LIMITS.bytes / 1048576} MB is refused`);
  ok(err('import I\n  step-file "x.step"\n', /needs the STEP file/, 2), 'an import naming a STEP file with no way to read it says so');
  ok(SC.looksLikeScript(text) && !SC.looksLikeScript(P.toJSON(part)), 'looksLikeScript tells a script from a part file');
  const roll = SC.scriptToPart(text + '\nrollback Bolts\n').part;
  ok(roll.rollback === 3 && rel(xb(roll).stats.volume, 57600), 'rollback Bolts: the bar sits above the hole (57600, no holes)');
  const sup = SC.scriptToPart(text.replace('  through\n', '  through\n  suppressed\n')).part;
  ok(sup.features[3].suppressed === true && rel(xb(sup).stats.volume, 57600), 'suppressed: the hole is not built');
}

section('design tables');
{
  const text = fs.readFileSync(path.join(REPO, 'tools/partcraft-cli/examples/bracket.pcscript'), 'utf8');
  const br = SC.scriptToPart(text).part;
  const t = PR.readDesignTable('name,width,thick,bolt\nsmall,100,6,6.6\nmedium,140,8,8.5\nlarge,8in,0.5in,13\n', br.params);
  ok(t.ok && t.rows.length === 3 && t.rows[2].overrides.get('width') === 203.2, 'three configurations read (units allowed: 8in = 203.2)');
  const want = { small: 100 * 60 * 6 - 2 * PI * 3.3 ** 2 * 6, medium: 140 * 60 * 8 - 2 * PI * 4.25 ** 2 * 8, large: 203.2 * 60 * 12.7 - 2 * PI * 6.5 ** 2 * 12.7 };
  for (const row of t.rows) {
    const pt = structuredClone(br);
    const a = PP.applyPartParams(pt, { overrides: row.overrides });
    ok(a.ok && rel(xb(pt).stats.volume, want[row.name]), `${row.name}: ${want[row.name].toFixed(6)}`);
  }
  ok(!PR.readDesignTable('name,colour\na,1\n', br.params).ok && (() => { try { PR.readDesignTable('name,width\na,wide\n', br.params); return false; } catch (e) { return /not a number/.test(e.message); } })(), 'a column that is not a parameter, and a cell that is not a number, are refused');
}

section('rollback helpers');
{
  const pt = structuredClone(fixtures[2][1]);
  const n = pt.features.length;
  ok(PP.stepRollback(pt, -1).ok && pt.rollback === n - 1 && PP.stepRollback(pt, -2).ok && pt.rollback === n - 3, 'back one, back two');
  ok(PP.stepRollback(pt, 1).ok && pt.rollback === n - 2 && PP.rollTo(pt, null).ok && pt.rollback === null, 'forward one, to the end');
  ok(!PP.stepRollback(pt, 1).ok && PP.stepRollback(pt, -99).ok && pt.rollback === 0 && !PP.stepRollback(pt, -1).ok, 'refused past either end; clamped to the start');
  ok(/nothing built/.test(PP.rollbackWords(pt)), PP.rollbackWords(pt));
}

// =========================================================================================
section('command line tool (spawned)');
const CLI = path.join(REPO, 'tools/partcraft-cli/partcraft.mjs');
const cli = (...args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: TMP }); return { code: r.status, out: r.stdout, err: r.stderr, json: (() => { try { return JSON.parse(r.stdout); } catch { return null; } })() }; };
{
  fs.copyFileSync(path.join(REPO, 'tools/partcraft-cli/examples/bracket.pcscript'), path.join(TMP, 'bracket.pcscript'));
  let r = cli('script', 'bracket.pcscript', '-o', 'bracket.partcraft.json');
  ok(r.code === 0 && /4 features, 5 parameters, 8 equations/.test(r.out), 'script → part: ' + r.out.trim());
  r = cli('info', 'bracket.partcraft.json', '--json');
  ok(r.code === 0 && r.json.kernel === 'exact' && rel(r.json.solid.volume, 57600 - 289 * PI), `info --json: exact kernel, volume 57600 − 289π (${r.json?.solid?.volume})`);
  r = cli('params', 'bracket.partcraft.json', '--json');
  ok(r.code === 0 && r.json.vars.find((v) => v.name === 'margin').value === 12.75 && r.json.links.some((l) => l.name === 'Bolts.d' && l.result === 8.5), 'params --json: margin = 12.75, Bolts.d = bolt → 8.5');
  r = cli('set', 'bracket.partcraft.json', 'width=150', 'thick=10');
  ok(r.code === 0 && /width: 120 → 150/.test(r.out) && /driven: Plate D1 \(distance\): 120 → 150/.test(r.out), 'set width=150 thick=10 (forward): the dimensions follow');
  r = cli('drive', 'bracket.partcraft.json', 'Base.depth=12');
  ok(r.code === 0 && /thick: 10 → 12/.test(r.out), 'drive Base.depth=12 (backward): thick → 12');
  r = cli('drive', 'bracket.partcraft.json', 'HoleCentres.D3=130', '--json');
  ok(r.code === 1 && r.json.choices.join() === 'width,bolt', 'drive HoleCentres.D3=130: two parameters behind it → exit 1 with the choices');
  r = cli('drive', 'bracket.partcraft.json', 'HoleCentres.D3=130', '--prefer', 'width');
  ok(r.code === 0 && /width: 150 → 142.75/.test(r.out), '--prefer width → width = 142.75');
  r = cli('set', 'bracket.partcraft.json', 'Base.depth=5');
  ok(r.code === 1 && /driven by = thick/.test(r.out), 'set on a driven number is refused with the way out (drive, or ==)');
  r = cli('info', 'bracket.partcraft.json', '--json');
  ok(rel(r.json.solid.volume, 142.75 * 60 * 12 - 2 * PI * 4.25 ** 2 * 12), `after the edits: 142.75·60·12 − 2π·4.25²·12 = ${r.json.solid.volume.toFixed(6)}`);
  r = cli('check', 'bracket.partcraft.json');
  ok(r.code === 0 && /0 errors, 0 warnings/.test(r.out), 'check: a fully parameterized part has no findings');
  r = cli('build', 'bracket.partcraft.json', '--out', 'plate.step');
  ok(r.code === 0 && fs.readFileSync(path.join(TMP, 'plate.step'), 'utf8').startsWith('ISO-10303-21;'), 'build --out plate.step (exact STEP)');
  r = cli('build', 'bracket.partcraft.json', '--set', 'width=200', '--upto', 'Base', '--out', 'base.stl');
  ok(r.code === 0 && rel(Number(/volume ([\d.]+)/.exec(r.out)?.[1]), 144000, 1e-9) && fs.statSync(path.join(TMP, 'base.stl')).size > 84 && P.readPart(fs.readFileSync(path.join(TMP, 'bracket.partcraft.json'), 'utf8')).params.vars[0].expr === '142.75', 'build --set width=200 --upto Base: 200·60·12 = 144000; the part file is unchanged');
  r = cli('build', 'bracket.partcraft.json', '--out', 'plate.pcscript');
  ok(r.code === 0 && SC.scriptToPart(fs.readFileSync(path.join(TMP, 'plate.pcscript'), 'utf8')).part.params.vars.length === 5, 'build --out plate.pcscript');
  r = cli('build', 'bracket.partcraft.json', '--out', 'plate.swb');
  const haveSw = fs.existsSync(path.join(DEV, 'swmacro.js'));
  ok(haveSw ? r.code === 0 && fs.existsSync(path.join(TMP, 'plate.swb')) : r.code === 1 && /swmacro\.js\) is not in this build/.test(r.err + r.out), haveSw ? 'build --out plate.swb (builder B\'s swmacro.js)' : 'build --out plate.swb says the macro writer is not in this build yet (exit 1)');
  fs.writeFileSync(path.join(TMP, 'sizes.csv'), 'name,width,thick,bolt\nsmall,100,6,6.6\nmedium,140,8,8.5\nlarge,200,12,13\n');
  r = cli('build', 'bracket.pcscript', '--table', 'sizes.csv', '--out-dir', 'sizes', '--format', 'json', '--json');
  ok(r.code === 0 && r.json.results.length === 3 && ['small', 'medium', 'large'].every((n) => fs.existsSync(path.join(TMP, 'sizes', n + '.json'))), 'build --table: one file per row');
  const large = P.readPart(fs.readFileSync(path.join(TMP, 'sizes/large.json'), 'utf8'));
  ok(rel(xb(large).stats.volume, 200 * 60 * 12 - 2 * PI * 6.5 ** 2 * 12) && PR.varByName(large.params, 'width').expr === '200', 'the large row\'s file builds 200·60·12 − 2π·6.5²·12 and carries width = 200');
  r = cli('rollback', 'bracket.partcraft.json', '--steps', '2');
  ok(r.code === 0 && /after Base: 2 of 4/.test(r.out), 'rollback --steps 2');
  r = cli('check', 'bracket.partcraft.json', '--json');
  ok(r.code === 0 && r.json.findings.some((f) => f.kind === 'rollback'), 'check warns that the rollback bar is not at the end');
  r = cli('forward', 'bracket.partcraft.json');
  ok(r.code === 0 && /after HoleCentres: 3 of 4/.test(r.out), 'forward one');
  r = cli('rollback', 'bracket.partcraft.json', 'Base');
  ok(r.code === 0 && /after Plate: 1 of 4/.test(r.out), 'rollback Base: the bar above Base');
  r = cli('forward', 'bracket.partcraft.json', '--end');
  ok(r.code === 0 && /at the end/.test(r.out), 'forward --end');
  r = cli('set', 'bracket.pcscript', 'width=10');
  ok(r.code === 2 && /give -o/.test(r.err), 'editing a script in place is refused (its comments would be lost): exit 2');
  // the unparameterized flange: typed numbers, under-defined sketch, unused parameter, suppressed, failing feature
  const fp = F.flange().part;
  fs.writeFileSync(path.join(TMP, 'flange.partcraft.json'), P.toJSON(fp));
  r = cli('check', 'flange.partcraft.json');
  ok(r.code === 0 && /warning Sketch1: typed numbers no parameter drives: D1 distance 100/.test(r.out) && /Hole1: typed numbers no parameter drives: diameter 14\./.test(r.out) && /CirPattern1: typed numbers no parameter drives: count 8\./.test(r.out) && !/angle 360/.test(r.out), 'check (flange as drawn): typed numbers listed per feature as warnings (a full turn of 360° is not), exit 0');
  r = cli('check', 'flange.partcraft.json', '--strict');
  ok(r.code === 1 && /^error /m.test(r.out), 'check --strict: the same findings are errors, exit 1');
  const messy = F.flange().part;
  messy.features[2].sketch.constraints = messy.features[2].sketch.constraints.slice(0, 1);   // the hole point loses its vertical position
  messy.features[4].suppressed = true;
  messy.params = { vars: [{ name: 'unused_w', expr: '5' }, { name: 'a', expr: 'b + 1' }, { name: 'b', expr: 'a' }], links: [] };
  const fil = P.addFeature(messy, 'fillet', { edges: [{ faces: ['f2.side:zz', 'f2.end'], at: [0, 0, 0] }], r: 1 });
  fs.writeFileSync(path.join(TMP, 'messy.partcraft.json'), P.toJSON(messy));
  r = cli('check', 'messy.partcraft.json', '--json');
  const kinds = new Set(r.json?.findings.map((f) => f.kind));
  ok(r.code === 1 && ['under', 'unused', 'cycle', 'suppressed', 'build', 'typed'].every((k) => kinds.has(k)), `check finds an under-defined sketch, an unused parameter, a cycle, a suppressed feature, a failing feature, typed numbers (${[...kinds].join(', ')})`);
  ok(r.json.findings.some((f) => f.kind === 'build' && f.where === fil.name) && r.json.findings.some((f) => f.kind === 'under' && /1 degree of freedom/.test(f.message)), 'the failing fillet is named, the sketch has 1 degree of freedom left');
  const over = F.flange().part;
  const osk = over.features[0].sketch;
  S.addConstraint(osk, 'distance', [osk.entities.find((e) => e.type === 'line' && !e.construction).id], 99);
  fs.writeFileSync(path.join(TMP, 'over.partcraft.json'), P.toJSON(over));
  r = cli('check', 'over.partcraft.json', '--no-build', '--json');
  ok(r.code === 1 && r.json.findings.some((f) => f.kind === 'over' && f.where === 'Sketch1'), 'check: an over-defined sketch is an error');
  r = cli('to-script', 'flange.partcraft.json', '-o', 'flange.pcscript');
  const back = cli('script', 'flange.pcscript', '-o', 'flange2.partcraft.json');
  ok(r.code === 0 && back.code === 0 && rel(xb(P.readPart(fs.readFileSync(path.join(TMP, 'flange2.partcraft.json'), 'utf8'))).stats.volume, 302160 * PI), 'to-script then script: the flange comes back at 302160π');
  fs.writeFileSync(path.join(TMP, 'broken.pcscript'), 'param w = 10\nextrude E\n  sketch Nope\n');
  r = cli('script', 'broken.pcscript', '-o', 'x.json');
  ok(r.code === 1 && /broken\.pcscript:3: There is no feature called "Nope"/.test(r.out), 'a script error prints file:line and exits 1');
  ok(cli('nonsense').code === 2 && cli('info').code === 2 && cli('info', 'missing.json').code === 2 && cli('build', 'bracket.partcraft.json').code === 2 && cli('info', 'x', '--bogus').code === 2, 'bad usage exits 2 (unknown command, missing file, no --out, unknown option)');
  ok(cli('--help').code === 0 && /partcraft check/.test(cli('--help').out), '--help prints the usage');
  const tampered = JSON.parse(P.toJSON(part)); tampered.params.links[0].target = 'f77.depth';
  fs.writeFileSync(path.join(TMP, 'tampered.partcraft.json'), JSON.stringify(tampered));
  r = cli('params', 'tampered.partcraft.json');
  ok(r.code === 1 && /which this file does not have/.test(r.err), 'a tampered file is refused with the reader\'s message, exit 1');
}

if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
