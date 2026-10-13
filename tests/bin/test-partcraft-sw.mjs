#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-partcraft-sw.mjs — PartCraft ⇄ SolidWorks exchange (assets/apps/partcraft/dev/swmacro.js, swimport.js,
 * brep-xcaf.js; tools/partcraft-sw/CadCraftExport.swb and its fixtures).
 *
 *   node bin/test-partcraft-sw.mjs [--verbose] [--keep]
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT: SolidWorks is not run here (it is Windows-only and licensed). These checks
 * are structural: the macros are well-formed VBA (balanced blocks, quoting, line and procedure limits, Windows-1252,
 * CRLF, procedures that exist, variables declared), every SolidWorks API call names a member of the table below with
 * the argument count the SolidWorks API Help gives (the table is kept here and in swmacro.js; they must match), the
 * macro's numbers are metres and radians, equations are written in SolidWorks' syntax, and the STEP written for
 * SolidWorks is read back by two other OpenCascade builds with its name, colour and exact volume. The backward path
 * (swimport.js) rebuilds hand-written cadcraft-sw-export files to exact volumes and refuses tampered ones. None of
 * this shows what SolidWorks itself does with a macro.
 *
 * Second readers (skipped with a note when missing): native OpenCascade (cadquery-ocp in tools/partcraft-test/venv)
 * and occt-import-js (tools/partcraft-test/node_modules).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.join(REPO, 'public_html/assets/apps/partcraft/dev/');
const SWDIR = path.join(REPO, 'tools/partcraft-sw/');
const VERBOSE = process.argv.includes('--verbose');
const KEEP = process.argv.includes('--keep');
const TMP = path.join(REPO, 'tmp/partcraft-sw-test');
fs.mkdirSync(TMP, { recursive: true });

console.log('PartCraft ⇄ SolidWorks exchange. SolidWorks is NOT run by this test: the checks are structural (see the file header).');

const SW = await import(DEV + 'swmacro.js');
const SI = await import(DEV + 'swimport.js');
const XC = await import(DEV + 'brep-xcaf.js');
const WO = await import(DEV + 'worker-ops.js');
const P = await import(DEV + 'part.js');
const S = await import(DEV + 'sketch.js');
const B = await import(DEV + 'brep.js');
const PP = await import(DEV + 'params-part.js');
const { solveSketch } = await import(DEV + 'solver.js');
const solveStatus = (sk) => solveSketch(sk).status;
const F = await import(path.join(REPO, 'tools/partcraft-test/fixtures.mjs'));
const OCCT = path.join(REPO, 'public_html/assets/vendor/replicad-opencascadejs/current/replicad_single.js');
const { default: occtInit } = await import(OCCT);
const oc = await occtInit({ print: () => {}, printErr: () => {} });

let pass = 0, fail = 0, skipped = 0;
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const skip = (m) => { skipped++; console.log('  skip ' + m); };
const section = (t) => console.log('\n== ' + t);
const rel = (a, b, r = 1e-9) => Math.abs(a - b) <= r * Math.max(1, Math.abs(b));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const PI = Math.PI;
const PY = path.join(REPO, 'tools/partcraft-test/venv/bin/python');
const HAVE_OCP = fs.existsSync(PY) && spawnSync(PY, ['-I', '-c', 'import OCP'], { encoding: 'utf8' }).status === 0;
const require = createRequire(path.join(REPO, 'tools/partcraft-test/package.json'));

// =========================================================================================
// The API table: interface → member → argument count (null = a property), with the SolidWorks API Help page it
// comes from. swmacro.js exports the same table (SW_API); the test fails when they differ.
const SOURCE = 'SolidWorks API Help (help.solidworks.com/…/sldworksapi), interface member pages';
const TABLE = {
  Application: { SldWorks: null },                                                        // VBA host: Application.SldWorks
  SldWorks: { GetMathUtility: 0, GetUserPreferenceStringValue: 1, NewDocument: 4, GetUserPreferenceToggle: 1, SetUserPreferenceToggle: 2, GetCurrentMacroPathName: 0 },
  ModelDoc2: {
    Extension: null, SketchManager: null, FeatureManager: null, SelectionManager: null, GetEquationMgr: 0, ClearSelection2: 1,
    SketchAddConstraints: 1, AddDimension2: 3, AddHorizontalDimension2: 3, AddVerticalDimension2: 3, FeatureByPositionReverse: 1,
    FirstFeature: 0, ForceRebuild3: 1, EditRollback: 0, ViewZoomtofit2: 0, InsertAxis2: 1,
  },
  PartDoc: { GetPartBox: 1, GetBodies2: 2 },                                              // IPartDoc::GetPartBox(Exact), GetBodies2(BodyType, BVisibleOnly)
  ModelDocExtension: { SetUserPreferenceInteger: 3, SelectByID2: 9, CreateMassProperty: 0 },
  MassProperty: { Volume: null },
  SketchManager: { InsertSketch: 1, Insert3DSketch: 1, ActiveSketch: null, AddToDB: null, DisplayWhenAdded: null, CreateLine: 6, CreateCircleByRadius: 4, CreateArc: 10, CreatePoint: 3, CreateSpline2: 2 },
  Sketch: { ModelToSketchTransform: null },
  MathUtility: { CreatePoint: 1, CreateVector: 1 },
  MathPoint: { MultiplyTransform: 1, ArrayData: null },
  MathVector: { MultiplyTransform: 1, ArrayData: null },
  SketchSegment: { ConstructionGeometry: null, Select4: 2, GetStartPoint2: 0, GetEndPoint2: 0, GetCenterPoint2: 0 },   // ISketchLine / ISketchArc members on the segment
  SketchPoint: { Select4: 2, X: null, Y: null },
  SelectionMgr: { CreateSelectData: 0 },
  SelectData: { Mark: null },
  Feature: { Name: null, Select2: 2, GetTypeName2: 0, GetNextFeature: 0, SetSuppression2: 3, GetFirstDisplayDimension: 0, GetNextDisplayDimension: 1, GetDefinition: 0, ModifyDefinition: 3 },
  FeatureData: { ReverseDirection: null, D1ReverseDirection: null, AccessSelections: 2, ReleaseSelectionAccess: 0 },
  DisplayDimension: { GetDimension2: 1 },
  Dimension: { SystemValue: null, Name: null },
  Body2: { Select2: 2 },
  EquationMgr: { Add2: 3, EvaluateAll: 0 },
  FeatureManager: {
    FeatureExtrusion2: 23, FeatureCut3: 26, FeatureRevolve2: 20, FeatureLinearPattern2: 9, FeatureCircularPattern2: 5,
    InsertMirrorFeature: 4, FeatureFillet: 7, InsertFeatureChamfer: 8, InsertFeatureShell: 2, InsertRefPlane: 6,
  },
};
const CONST = {
  swDefaultTemplatePart: 8, swUnitSystem: 534, swUnitSystem_MMGS: 4, swUnitsLinear: 189, swMM: 0, swDetailingNoOptionSpecified: 0,
  swInputDimValOnCreate: 10, swEndCondBlind: 0, swEndCondThroughAll: 1, swEndCondThroughNext: 2, swEndCondMidPlane: 6,
  swSuppressFeature: 0, swThisConfiguration: 1, swRefPlaneReferenceConstraint_Coincident: 4, swSolidBody: 0,
  swChamferAngleDistance: 1, swChamferDistanceDistance: 2,
};
// The backward macro's members (its own header lists them too)
const EXPORT_TABLE = {
  Application: { SldWorks: null },
  SldWorks: { ActiveDoc: null, GetMathUtility: 0, RevisionNumber: 0, GetCurrentMacroPathName: 0 },
  ModelDoc2: { GetType: 0, GetPathName: 0, GetTitle: 0, FirstFeature: 0, GetEquationMgr: 0, Extension: null },
  ModelDocExtension: { CreateMassProperty: 0 },
  MassProperty: { Volume: null },
  Feature: { Name: null, GetTypeName2: 0, GetNextFeature: 0, GetFirstSubFeature: 0, GetNextSubFeature: 0, IsSuppressed: 0, GetSpecificFeature2: 0, GetDefinition: 0, GetFaces: 0, GetFirstDisplayDimension: 0, GetNextDisplayDimension: 1 },
  Sketch: { ModelToSketchTransform: null, GetSketchPoints2: 0, GetSketchSegments: 0, RelationManager: null },
  SketchRelationManager: { GetRelations: 1 },
  SketchRelation: { GetRelationType: 0, GetEntities: 0 },
  SketchPoint: { X: null, Y: null, GetID: 0 },
  SketchSegment: { GetType: 0, ConstructionGeometry: null, GetID: 0, GetStartPoint2: 0, GetEndPoint2: 0, GetCenterPoint2: 0, IsCircle: 0, GetRadius: 0, GetRotationDir: 0 },
  MathTransform: { Inverse: 0, ArrayData: null },
  MathUtility: { CreatePoint: 1, CreateVector: 1 },
  MathPoint: { MultiplyTransform: 1, ArrayData: null },
  MathVector: { MultiplyTransform: 1, ArrayData: null },
  DisplayDimension: { GetDimension2: 1, GetAnnotation: 0 },
  Annotation: { GetAttachedEntities3: 0 },
  Dimension: { Name: null, FullName: null, SystemValue: null, GetType: 0 },
  FeatureData: {
    GetEndCondition: 1, GetDepth: 1, ReverseDirection: null, BothDirections: null, GetRevolutionAngle: 1, Axis: null, FacesRemoved: null,
    Thickness: null, Outward: null, D1TotalInstances: null, D1Spacing: null, D1ReverseDirection: null, D1Axis: null, PatternFeatureArray: null,
    TotalInstances: null, Spacing: null, EqualSpacing: null, Plane: null, AccessSelections: 2, ReleaseSelectionAccess: 0,
  },
  Face2: { GetBox: 0, GetClosestPointOn: 3, Normal: null },
  Edge: { GetCurveParams2: 0 },
  RefAxis: { GetRefAxisParams: 0 },
  RefPlane: { Transform: null },
  EquationMgr: { GetCount: 0, Equation: 1, GlobalVariable: 1 },
};
const EXPORT_RECEIVERS = {
  Application: ['Application'], swApp: ['SldWorks'], swModel: ['ModelDoc2'], swMath: ['MathUtility'], swEqMgr: ['EquationMgr'], mProp: ['MassProperty'],
  feat: ['Feature'], subF: ['Feature'], ftr: ['Feature', 'RefAxis'], swSketch: ['Sketch'], rel: ['SketchRelation'], sPt: ['SketchPoint'], seg: ['SketchSegment'],
  o: ['SketchPoint', 'SketchSegment'], p: ['SketchPoint', 'SketchSegment'], q: ['SketchPoint', 'SketchSegment'], xf: ['MathTransform'], mPt: ['MathPoint'], mVec: ['MathVector'],
  dDim: ['DisplayDimension'], dm: ['Dimension'], swAnn: ['Annotation'], fData: ['FeatureData'], face: ['Face2'], pl: ['Feature', 'Face2'],
  rp: ['RefPlane'], ent: ['Edge', 'Feature'],
};

// =========================================================================================
// A small VBA checker (structure, quoting, limits, encoding, procedures, declarations, API calls)
const VBA_RUNTIME = { Err: { Number: null, Description: null, Clear: 0 } };
const BUILTINS = new Set(['msgbox', 'abs', 'sqr', 'instr', 'instrrev', 'left', 'right', 'mid', 'len', 'trim', 'lcase', 'ucase', 'str', 'cstr', 'chr', 'ascw', 'hex', 'format', 'now', 'iif', 'isempty', 'ubound', 'lbound', 'freefile', 'join', 'round', 'choose', 'empty', 'nothing', 'true', 'false', 'vbcrlf', 'vbinformation', 'vbexclamation']);

/** Strip comments and string literals from one line → { code, strings } (or { error }). */
function scan(line) {
  let code = '', i = 0;
  const strings = [];
  while (i < line.length) {
    const c = line[i];
    if (c === '"') {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= line.length) return { error: 'a string is not closed' };
        if (line[j] === '"') { if (line[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += line[j++];
      }
      strings.push(s); code += '""'; i = j + 1; continue;
    }
    if (c === "'") break;
    code += c; i++;
  }
  if (/^\s*Rem\s/i.test(code)) code = '';
  return { code, strings };
}
/** Split the inside of a call into top-level arguments. */
function args(src, open) {
  let d = 0, n = 0, i = open, any = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '(') { d++; if (d === 1) continue; }
    if (c === ')') { d--; if (d === 0) break; }
    if (d === 1 && c === ',') n++;
    if (d >= 1 && !/\s/.test(c)) any = true;
  }
  return d === 0 ? (any ? n + 1 : 0) : -1;
}

function checkVba(text, { table, receivers, label }) {
  const problems = [];
  const P2 = (m) => { if (problems.length < 40) problems.push(m); };
  if (/[^\r]\n/.test(text) || /\r(?!\n)/.test(text)) P2('line ends are not all CRLF');
  for (const ch of text) if (!SW.in1252(ch)) { P2(`a character outside Windows-1252: U+${ch.codePointAt(0).toString(16)}`); break; }
  const lines = text.split('\r\n');
  const stack = [];
  const procs = new Map();          // lower name → { name, start, bytes, params, locals:Set }
  const module = new Set();
  const calls = [];                 // { name, line }
  const assigns = [];               // { name, proc, line }
  const apiCalls = [];
  let cur = null, bytes = 0, maxProc = 0;
  lines.forEach((raw, k) => {
    const ln = k + 1;
    if (raw.length > 1023) P2(`line ${ln} is ${raw.length} characters (VBA allows 1023)`);
    const sc = scan(raw);
    if (sc.error) { P2(`line ${ln}: ${sc.error}`); return; }
    const code = sc.code.trim();
    if (cur) bytes += raw.length + 2;
    if (!code) return;
    let m;
    if ((m = /^(?:(?:Private|Public)\s+)?(Sub|Function)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(code))) {
      if (cur) P2(`line ${ln}: ${m[2]} starts inside ${cur.name}`);
      const params = new Set(m[3].split(',').map((x) => x.trim().replace(/^(ByVal|ByRef|Optional)\s+/i, '').split(/\s+/)[0].replace(/\(\)$/, '').toLowerCase()).filter(Boolean));
      if (m[1] === 'Function') params.add(m[2].toLowerCase());
      cur = { name: m[2], kind: m[1], start: ln, params, locals: new Set() };
      if (procs.has(m[2].toLowerCase())) P2(`${m[2]} is defined twice`);
      procs.set(m[2].toLowerCase(), cur);
      stack.push(m[1]); bytes = raw.length + 2;
      return;
    }
    if ((m = /^End\s+(Sub|Function|If|With|Select)$/i.exec(code))) {
      const want = { sub: 'Sub', function: 'Function', if: 'If', with: 'With', select: 'Select' }[m[1].toLowerCase()];
      const top = stack.pop();
      if (top !== want) P2(`line ${ln}: End ${m[1]} closes ${top || 'nothing'}`);
      if (want === 'Sub' || want === 'Function') { maxProc = Math.max(maxProc, bytes); if (bytes >= 65536) P2(`${cur.name} is ${bytes} bytes (VBA allows under 64 KB)`); cur = null; }
      return;
    }
    if (/^(Dim|Const)\s/i.test(code)) {
      for (const part of code.replace(/^(Dim|Const)\s+/i, '').split(',')) {
        const nm = part.trim().split(/[\s(]/)[0].toLowerCase();
        (cur ? cur.locals : module).add(nm);
      }
      return;
    }
    if (/^Option\s+Explicit$/i.test(code)) return;
    if (!cur) { P2(`line ${ln}: code outside a procedure: ${code.slice(0, 60)}`); return; }
    if (/^[A-Za-z_]\w*:$/.test(code)) return;                         // a label
    // blocks
    if (/^If\b/i.test(code) && /\bThen$/i.test(code)) stack.push('If');
    else if (/^ElseIf\b/i.test(code)) { if (stack[stack.length - 1] !== 'If' || !/\bThen$/i.test(code)) P2(`line ${ln}: ElseIf outside an If block`); }
    else if (/^Else$/i.test(code)) { if (stack[stack.length - 1] !== 'If') P2(`line ${ln}: Else outside an If block`); }
    else if (/^For\s/i.test(code)) stack.push('For');
    else if (/^Next\b/i.test(code)) { if (stack.pop() !== 'For') P2(`line ${ln}: Next without For`); }
    else if (/^Do\b/i.test(code)) stack.push('Do');
    else if (/^Loop\b/i.test(code)) { if (stack.pop() !== 'Do') P2(`line ${ln}: Loop without Do`); }
    else if (/^With\s/i.test(code)) stack.push('With');
    else if (/^Select\s+Case\s/i.test(code)) stack.push('Select');
    else if (/^If\b/i.test(code) && !/\bThen\s+\S/i.test(code)) P2(`line ${ln}: an If without Then`);
    // own procedures called
    for (const c of code.matchAll(/\bCall\s+([A-Za-z_]\w*)\b(?!\.)/g)) calls.push({ name: c[1], line: ln });
    for (const c of code.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)) calls.push({ name: c[1], line: ln, maybe: true });
    // assignments
    if ((m = /^(?:Set\s+)?([A-Za-z_]\w*)(?:\([^)]*\))?\s*=/.exec(code)) && !/^(If|ElseIf)\b/i.test(code)) assigns.push({ name: m[1], proc: cur, line: ln });
    if ((m = /\bThen\s+(?:Set\s+)?([A-Za-z_]\w*)(?:\([^)]*\))?\s*=/i.exec(code))) assigns.push({ name: m[1], proc: cur, line: ln });
    if ((m = /^For\s+([A-Za-z_]\w*)\s*=/i.exec(code))) assigns.push({ name: m[1], proc: cur, line: ln });
    // member access
    for (const mm of code.matchAll(/([A-Za-z_]\w*|\))\s*\.([A-Za-z_]\w*)/g)) {
      const at = mm.index + mm[0].length;
      const recv = mm[1];
      const before = code[mm.index - 1];
      const chained = recv === ')' || before === '.';
      apiCalls.push({ recv, member: mm[2], chained, paren: code[at] === '(' ? args(code, at) : null, line: ln });
    }
  });
  if (stack.length) P2(`blocks left open at the end: ${stack.join(', ')}`);
  for (const c of calls) {
    const lc = c.name.toLowerCase();
    if (procs.has(lc) || BUILTINS.has(lc)) continue;
    if (c.maybe) continue;   // an array index or a member: checked elsewhere
    P2(`line ${c.line}: ${c.name} is called but not defined`);
  }
  for (const c of calls) if (c.maybe && /^(Sk|Rel|Sel|Make|Got|Keep|Get|Set|Note|Bad|Good)[A-Z]?/.test(c.name) && !procs.has(c.name.toLowerCase()) && !BUILTINS.has(c.name.toLowerCase())) P2(`line ${c.line}: ${c.name}( is not a procedure`);
  for (const a of assigns) {
    const n2 = a.name.toLowerCase();
    if (a.proc.params.has(n2) || a.proc.locals.has(n2) || module.has(n2) || procs.has(n2)) continue;
    P2(`line ${a.line}: ${a.name} is assigned but not declared (Option Explicit)`);
  }
  // API members
  const iface = (names) => names.flatMap((n2) => (table[n2] || VBA_RUNTIME[n2] ? [[n2, table[n2] || VBA_RUNTIME[n2]]] : []));
  const allIf = Object.entries(table);
  const used = new Set();
  for (const c of apiCalls) {
    let cands;
    if (c.chained) cands = allIf.filter(([, t]) => Object.hasOwn(t, c.member));
    else if (receivers[c.recv]) cands = iface(receivers[c.recv]).filter(([, t]) => Object.hasOwn(t, c.member));
    else if (VBA_RUNTIME[c.recv]) cands = [[c.recv, VBA_RUNTIME[c.recv]]].filter(([, t]) => Object.hasOwn(t, c.member));
    else { P2(`line ${c.line}: ${c.recv}.${c.member}: "${c.recv}" is not a known receiver`); continue; }
    if (!cands.length) { P2(`line ${c.line}: ${c.recv}.${c.member} is not in the API table`); continue; }
    const fits = cands.some(([, t]) => {
      const want = t[c.member];
      if (c.paren === null) return true;                          // a property, or a method called without arguments
      if (c.paren < 0) return false;
      return want === null ? c.paren <= 1 : c.paren === want;     // a property may be indexed: Equation(i)
    });
    if (!fits) P2(`line ${c.line}: ${c.recv}.${c.member} called with ${c.paren} arguments; the table says ${cands.map(([n2, t]) => `${n2} ${t[c.member]}`).join(' / ')}`);
    for (const [n2] of cands) used.add(`${n2}.${c.member}`);
  }
  return { problems, procs: [...procs.values()], maxProc, used, apiCalls };
}

// =========================================================================================
section('the API table (SolidWorks API Help) and the constants: swmacro.js and this test agree');
{
  ok(JSON.stringify(SW.SW_API) === JSON.stringify(TABLE), `swmacro.js SW_API equals the test's table (${Object.values(TABLE).reduce((a, t) => a + Object.keys(t).length, 0)} members, source: ${SOURCE})`);
  const consts = Object.fromEntries(Object.entries(SW.SW_CONST).map(([k, [v]]) => [k, v]));
  ok(JSON.stringify(consts) === JSON.stringify(CONST), 'the swconst values match the test\'s copy');
  const src = fs.readFileSync(DEV + 'swmacro.js', 'utf8');
  const head = src.slice(0, src.indexOf('import '));
  const missing = Object.entries(TABLE).flatMap(([i, t]) => Object.keys(t).filter((m) => !new RegExp('\\b' + m + '\\b').test(head)).map((m) => `${i}.${m}`));
  ok(!missing.length, `every member is in swmacro.js's comment table at the top${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  ok(/NOT TESTED IN SOLIDWORKS/.test(head), 'the module header says it is not tested in SolidWorks');
  const exp = fs.readFileSync(SWDIR + 'CadCraftExport.swb', 'latin1');
  const ehead = exp.split('\n').filter((l) => l.startsWith("'")).join('\n');
  const emissing = Object.entries(EXPORT_TABLE).flatMap(([i, t]) => Object.keys(t).filter((m) => !new RegExp('\\b' + m + '\\b').test(ehead)).map((m) => `${i}.${m}`));
  ok(!emissing.length, `CadCraftExport.swb's header lists every member of its table${emissing.length ? ' (missing: ' + emissing.join(', ') + ')' : ''}`);
  // the app's File > Export menu serves a copy from the build (so releases freeze it and offline saving includes it)
  const shipped = path.join(REPO, 'public_html/assets/apps/partcraft/dev/CadCraftExport.swb');
  ok(fs.existsSync(shipped) && fs.readFileSync(shipped).equals(fs.readFileSync(SWDIR + 'CadCraftExport.swb')), 'partcraft/dev/CadCraftExport.swb is byte-identical to tools/partcraft-sw/CadCraftExport.swb (copy it when the macro changes)');
}

// =========================================================================================
// Parts to write macros for
const regenAtFor = (part) => { const c = new Map(); return (i) => { if (!c.has(i)) c.set(i, B.regenerateBrep(JSON.parse(JSON.stringify(part)), oc, { upTo: i })); return c.get(i); }; };
const macro = (part, extra = {}) => SW.partToSwb(part, { regen: B.regenerateBrep(JSON.parse(JSON.stringify(part)), oc), regenAt: regenAtFor(part), date: '2026-10-11', ...extra });
function blockPart(depth = 20, w = 100, h = 50) {
  const part = P.newPart('Block');
  const b = F.blockSketch(w, h);
  const s1 = P.addFeature(part, 'sketch', { plane: { kind: 'base', name: 'top' }, sketch: b.sk });
  const e1 = P.addFeature(part, 'extrude', { sketch: s1.id, depth });
  return { part, s1, e1, b };
}
const numbersIn = (line) => [...line.replace(/"[^"]*"/g, '').matchAll(/-?\d+(?:\.\d+)?(?:E-?\d+)?/g)].map((m) => +m[0]);

section('forward: the flange with parameters (revolve, a hole on a named face, a circular pattern, equations)');
let flangeMacro = null;
{
  const fl = F.flange();
  fl.part.params = { vars: [{ name: 'bolt_d', expr: '14' }, { name: 'n', expr: '8' }, { name: 'disc', expr: 'bolt_d * 2 + 2' }], links: [
    { target: fl.ids.hole + '.d', expr: 'bolt_d' }, { target: fl.ids.pattern + '.count', expr: 'n' }, { target: fl.ids.profile + '.' + fl.dims.disc, expr: 'disc' },
    { target: fl.ids.profile + '.' + fl.dims.bore, expr: 'sqrt(bolt_d ^ 2 * 6) + if(n > 6, 0, 1)' }] };
  const t0 = performance.now();
  const out = macro(fl.part);
  flangeMacro = out;
  const text = out.text;
  fs.writeFileSync(path.join(TMP, 'Flange.swb'), SW.toCp1252(text));
  const c = checkVba(text, { table: TABLE, receivers: SW.SW_RECEIVERS });
  ok(!c.problems.length, `the macro is well-formed VBA (${text.split('\r\n').length} lines, ${c.procs.length} procedures, ${Math.round(performance.now() - t0)} ms)${c.problems.length ? ':\n       ' + c.problems.join('\n       ') : ''}`);
  ok(c.maxProc < 65536 && c.procs.every((p) => p.kind), `every procedure is under 64 KB (largest ${c.maxProc} bytes)`);
  ok(out.stats.carried === 5 && out.stats.skipped === 0 && !out.notes.some((n2) => /Not carried/.test(n2)), 'all 5 features carried, nothing left out');
  const mainCalls = [...text.matchAll(/^ {4}Call (Step_\d+)$/gm)].map((m) => m[1]);
  ok(mainCalls.join(',') === 'Step_1,Step_2,Step_3,Step_4,Step_5', 'main builds the features in history order, one Sub each');
  ok(/^ {4}Call AddGlobals\r\n {4}Call Step_1/m.test(text) && /Call Step_5\r\n {4}Call AddEquations\r\n {4}Call FinishUp/.test(text), 'global variables before the features, equations after them');
  ok(/swApp\.NewDocument\(tpl, 0, 0, 0\)/.test(text) && /GetUserPreferenceStringValue\(swDefaultTemplatePart\)/.test(text), 'a new part from the default part template');
  ok(/SetUserPreferenceInteger\(swUnitSystem, swDetailingNoOptionSpecified, swUnitSystem_MMGS\)/.test(text), 'the document is set to millimetres (MMGS)');
  // units: the flange is Ø200 × 80 mm → every sketch coordinate is at most 0.1 (metres)
  const skLines = text.split('\r\n').filter((l) => /Call Sk(Line|Circle|Arc|Point|Origin)\(/.test(l));
  const nums = skLines.flatMap(numbersIn);
  ok(skLines.length >= 9 && nums.length && Math.max(...nums.map(Math.abs)) <= 0.1 + 1e-12 && nums.some((v) => Math.abs(v - 0.1) < 1e-12), `sketch geometry in metres (${skLines.length} calls; largest |value| ${Math.max(...nums.map(Math.abs))} = 100 mm)`);
  ok(/Call SkLine\("f1:l9", "f1:p7", 0\.034, 0, 0, "f1:p8", 0\.1, 0, 0, False\)/.test(text), 'the flange\'s bottom line: (34, 0) → (100, 0) mm written as 0.034 … 0.1 m');
  ok(/MakeRevolve\("f1", "f1:l3", False, 6\.28318530717959, False\)/.test(text), 'the revolve: about its centerline, 2π radians');
  ok(/FeatureCircularPattern2\(8, 6\.28318530717959, False, "NULL", False\)/.test(text), 'the circular pattern: 8 over 2π radians');
  ok(/SkDim\("k39", 0, "f1:l13", "", [^)]*, 0\.03\)/.test(text) && /SkDim\("k38", 1, "f1:O", "f1:p8", [^)]*, 0\.1\)/.test(text), 'dimensions renamed to PartCraft\'s ids (k39 the disc 0.03 m, k38 a horizontal 0.1 m)');
  ok(/SelAt\("FACE", -?[\d.]+, 0\.03, -?[\d.E-]+, False, 0\)/.test(text), 'the bolt-hole sketch sits on the disc\'s top face, picked by a point on it at y 30 mm');
  const fp = /SelAt\("FACE", (-?[\d.E-]+), 0\.03, (-?[\d.E-]+), False, 0\)/.exec(text);
  const rr = fp ? Math.hypot(+fp[1], +fp[2]) * 1000 : 0;
  ok(rr > 52 && rr < 100 && !(Math.abs(rr - 75) < 7), `that point is on the face: radius ${rr.toFixed(2)} mm, between the hub (52) and the rim (100), outside the bolt holes`);
  ok(/Call AddEq\("""bolt_d"" = 14", "bolt_d \(global variable\)"\)/.test(text) && /Call AddEq\("""disc"" = \(""bolt_d"" \* 2\) \+ 2"/.test(text), 'global variables in SolidWorks syntax ("bolt_d" = 14, "disc" = ("bolt_d" * 2) + 2)');
  ok(/Call AddEq\("""d@Hole1_Sketch"" = ""bolt_d""", /.test(text) && /Call AddEq\("""count@CirPattern1"" = ""n""", /.test(text) && /Call AddEq\("""k39@Sketch1"" = ""disc""", /.test(text), 'equations on the hole diameter, the pattern count and the disc dimension');
  ok(/"""k37@Sketch1"" = sqr\(\(""bolt_d"" \^ 2\) \* 6\) \+ iif\(""n"" > 6, 0, 1\)"/.test(text), 'functions translated: sqrt → sqr, if → iif');
  ok(/r = Expect\(0\.000949263636209\d*, -0\.1, 0, -0\.1, 0\.1, 0\.08, 0\.1\)/.test(text), 'the body check after the pattern: 302160π mm³ in m³ and the exact box in metres');
  ok((text.match(/r = Expect\(0/g) || []).length === 3 && out.stats.checks === 3, 'a body check after each solid feature (revolve, hole, pattern)');
  ok(/Not yet tested in SolidWorks/.test(text) && /This macro has not been tested in SolidWorks/.test(text), 'the macro says it has not been tested in SolidWorks (header and the closing message)');
  ok(/Call WriteLog\("Flange macro log\.txt"\)/.test(text), 'it writes a log next to itself');
}

section('forward: fillet, shell, chamfer on a block (edges and faces picked by points), suppressed, rollback');
{
  const { part, e1 } = blockPart();
  let r = B.regenerateBrep(part, oc);
  const vert = r.edges.filter((e) => e.faces.every((n2) => n2.includes('.side:')));
  P.addFeature(part, 'fillet', { edges: vert.map(B.edgeRef), r: 5 });
  P.addFeature(part, 'shell', { faces: [{ name: e1.id + '.start' }], t: 2 });
  r = B.regenerateBrep(part, oc);
  const topEdges = r.edges.filter((e) => e.faces.includes(e1.id + '.end') && !e.faces.some((n2) => n2.includes('~')));
  const ch = P.addFeature(part, 'chamfer', { edges: topEdges.map(B.edgeRef), d: 1 });
  const sk2 = S.newSketch(); S.addCircle(sk2, [30, 12], 4);
  const s2 = P.addFeature(part, 'sketch', { plane: { kind: 'face', feature: e1.id, face: 'end' }, sketch: sk2 });
  const cut = P.addFeature(part, 'extrude', { sketch: s2.id, op: 'cut', end: 'blind', depth: 1.5 });
  cut.suppressed = true;
  part.rollback = part.features.length - 1;          // the bar above the cut
  const out = macro(part);
  const text = out.text;
  fs.writeFileSync(path.join(TMP, 'Block.swb'), SW.toCp1252(text));
  const c = checkVba(text, { table: TABLE, receivers: SW.SW_RECEIVERS });
  ok(!c.problems.length, `well-formed VBA${c.problems.length ? ':\n       ' + c.problems.join('\n       ') : ''}`);
  ok(out.stats.carried === part.features.length, `every feature carried (${out.stats.carried})`);
  ok((text.match(/SelAt\("EDGE", /g) || []).length === 4 + 8 && /FeatureFillet\(FilletOptions, 0\.005, 0, 0, 0, 0, 0\)/.test(text), 'the fillet selects its 4 edges by their middles, radius 0.005 m');
  ok(/InsertFeatureShell\(0\.002, False\)/.test(text) && /SelAt\("FACE", [\d.E-]+, 0, [\d.E-]+, False, 0\)/.test(text), 'the shell opens the bottom face (a point at y 0), 0.002 m inward');
  ok(/InsertFeatureChamfer\(0, swChamferAngleDistance, 0\.001, 0\.785398163397448, 0, 0, 0, 0\)/.test(text), 'the chamfer: 0.001 m at 45° (π/4) on 8 edges');
  const filletEdges = [...text.matchAll(/SelAt\("EDGE", ([^)]*)\)/g)].slice(0, 4).map((m) => numbersIn(m[1]).slice(0, 3));
  ok(filletEdges.every((p) => Math.abs(p[1] - 0.01) < 1e-12) && filletEdges.every((p) => [0, 0.1].some((x) => Math.abs(p[0] - x) < 1e-12)), 'the fillet\'s edge points are the vertical edges\' middles (y 10 mm, x 0 or 100 mm)');
  ok(new RegExp(`Call Suppress\\("${cut.id}", "${cut.name}"\\)`).test(text), 'the suppressed cut is built, then suppressed');
  ok(new RegExp(`SelKey\\("${cut.id}", False, 0\\) Then\\r\\n {8}ok = swModel\\.EditRollback`).test(text), 'the rollback bar goes above the cut, as in the part');
  ok(out.stats.checks === 4, `body checks after extrude, fillet, shell and chamfer (${out.stats.checks}); none for the suppressed cut`);
  ok(new RegExp(`FixDir\\(feat, Nothing, 1, `).test(text), 'an extrude that does not match PartCraft\'s body is flipped once (FixDir)');
}

section('forward: partial revolve, holes (counterbore, tapped), linear pattern, mirror, fixed planes, a sketch on a turned face');
{
  const rp = P.newPart('Bits');
  const rk = S.newSketch(); S.addLine(rk, [0, 0], [0, 10], { construction: true }); S.addRect(rk, [10, 0], [20, 5]);
  const rs = P.addFeature(rp, 'sketch', { sketch: rk });
  P.addFeature(rp, 'revolve', { sketch: rs.id, angle: 90 });
  const out = macro(rp);
  ok(/MakeRevolve\("f1", "f1:l3", False, 1\.5707963267949\d*, False\)/.test(out.text) && /FixDir\(feat, Nothing, 1, /.test(out.text), '90° revolve: π/2 radians, direction checked and flipped if needed');
  ok(out.notes.some((n2) => /90° revolve; its direction is checked/.test(n2)), 'a note says the partial revolve\'s direction is checked by the body test');

  const { part, e1 } = blockPart();
  const hk = S.newSketch(); S.addPoint(hk, 20, 25); S.addPoint(hk, 80, 25);
  const hs = P.addFeature(part, 'sketch', { plane: { kind: 'face', feature: e1.id, face: 'end' }, sketch: hk });
  const h1 = P.addFeature(part, 'hole', { sketch: hs.id, kind: 'cbore', d: 6, through: false, depth: 15, cboreD: 11, cboreDepth: 6 });
  const lp = P.addFeature(part, 'lpattern', { seeds: [h1.id], dir: { kind: 'world', axis: 'z' }, count: 2, spacing: -12 });
  P.addFeature(part, 'mirror', { seeds: [lp.id], plane: { kind: 'fixed', o: [0, 0, -40], n: [0, 0, 1] } });
  const tk = S.newSketch(); S.addPoint(tk, 50, 10);
  const ts = P.addFeature(part, 'sketch', { plane: { kind: 'face', feature: e1.id, face: 'end' }, sketch: tk });
  P.addFeature(part, 'hole', { sketch: ts.id, kind: 'tapped', size: 'M8', d: 8, through: true });
  const sideSk = S.newSketch(); S.addRect(sideSk, [10, 5], [30, 15]);
  const side = P.addFeature(part, 'sketch', { plane: { kind: 'face', feature: e1.id, face: 'side', entity: F.blockSketch().lines[0] }, sketch: sideSk });
  void side;
  part.params = { vars: [{ name: 'w', expr: '100' }], links: [{ target: h1.id + '.cboreD', expr: 'w / 9 - 1/9' }, { target: lp.id + '.spacing', expr: '-12' }] };
  const o2 = macro(part);
  const text = o2.text;
  fs.writeFileSync(path.join(TMP, 'Holes.swb'), SW.toCp1252(text));
  const c = checkVba(text, { table: TABLE, receivers: SW.SW_RECEIVERS });
  ok(!c.problems.length, `well-formed VBA${c.problems.length ? ':\n       ' + c.problems.join('\n       ') : ''}`);
  ok(/CloseSketch\("f4sk", "Hole1_Sketch"\)/.test(text) && /CloseSketch\("f4_cbsk", "Hole1_CBoreSketch"\)/.test(text) && /MakeExtrude\("f4_cbsk", True, swEndCondBlind, 0\.006, False, 0\.006, flip, 0, True\)/.test(text), 'the counterbored hole: a Ø6 cut 15 deep and a Ø11 counterbore cut 6 deep, each with its own sketch');
  ok(/FeatureLinearPattern2\(2, 0\.012, 1, 0\.01, True, False, "NULL", "NULL", False\)/.test(text) && /WorldAxis\("z"\)/.test(text), 'linear pattern along world Z (a reference axis where Top and Right meet), spacing 0.012 m, reversed for the negative spacing');
  ok(/SelKey\("f4_cb", True, MarkPatternSeed\)/.test(text), 'patterning the hole takes its counterbore cut too');
  ok(/MakePlane\("plane:0\.000000,0\.000000,-40\.000000,0\.000000,0\.000000,1\.000000", "Mirror1 plane", 0, 0, -0\.04, /.test(text) && /InsertMirrorFeature\(False, False, False, False\)/.test(text), 'mirror about a fixed plane z = −40 mm: a reference plane through three points, then the mirror');
  ok(/Call SkCircle\("f\d+:c0", "f\d+:p0", [^)]*, 0\.0034, False\)/.test(text) && o2.notes.some((n2) => /tapped M8 hole is written as its tap drill \(Ø6\.8 mm\)/.test(n2)) && /0\.0068\)/.test(text), 'the tapped M8 hole is its Ø6.8 tap drill, with a note');
  ok(/"""cboreD|"""d@Hole1_CBoreSketch"" = \(""w"" \/ 9\) - \(1 \/ 9\)"/.test(text) && /"""spacing@LPattern1"" = abs\(-\(12\)\)"/.test(text), 'equations on the counterbore diameter and the (absolute) pattern spacing');
  ok(/SelAt\("FACE", [^)]*\)/.test(text) && /OpenSketch\(0, 0, 1, 1, 0, 0\)/.test(text), 'a sketch on the block\'s front side face: PartCraft\'s normal and x axis are handed to SolidWorks, which turns its own sketch frame to match at run time');
}

section('forward: things the macro does not write are listed, never guessed; nothing crashes on unknown features');
{
  const { part, e1 } = blockPart();
  const imp = P.addFeature(part, 'import', { file: 'x.step', step: 'ISO-10303-21;', up: 'z' });
  void imp;
  const later = S.newSketch(); S.addCircle(later, [10, 10], 3);
  const ls = P.addFeature(part, 'sketch', { plane: { kind: 'face', feature: e1.id, face: 'end' }, sketch: later });
  P.addFeature(part, 'extrude', { sketch: ls.id, op: 'cut', end: 'blind', depth: 2 });
  part.features.push({ id: 'f99', type: 'warp-drive', name: 'Warp1' });   // a feature type from the future
  P.addFeature(part, 'extrude', { sketch: part.features[0].id, depth: 5, end: 'upto' });
  let out = null, err = null;
  try { out = macro(part); } catch (e) { err = e; }
  ok(out && !err, 'a part with an imported solid, an unknown feature type and an "up to" extrude still gives a macro' + (err ? ': ' + err.message : ''));
  if (out) {
    ok(out.notes.some((n2) => /Not carried over: Imported1 \(an imported solid; open the STEP written beside this macro/.test(n2)), 'the imported solid is listed (open the STEP written beside the macro)');
    ok(out.notes.some((n2) => /Not carried over: Warp1 \(a warp-drive feature, which the macro does not write yet\)/.test(n2)), 'the unknown feature type is listed by name and type');
    ok(out.notes.some((n2) => /Not carried over: Extrude\d \(the end condition "upto" is not written yet\)/.test(n2)), 'the "up to" extrude is listed');
    ok(/' Notes:\r\n'   - Not carried over/.test(out.text), 'the notes are written into the macro\'s header too');
    ok(!checkVba(out.text, { table: TABLE, receivers: SW.SW_RECEIVERS }).problems.length, 'and the macro is still well-formed');
    const mesh = SW.partToSwb(part, {});
    ok(mesh.notes.some((n2) => /Sketch2 \(it sits on a face or reference, and its place needs the exact kernel\)/.test(n2)) && mesh.notes.some((n2) => /Extrude2 \(it needs Sketch2, which is not carried over\)/.test(n2)), 'without the exact kernel: the face sketch and the cut built on it are listed; base-plane features are still written');
    ok(/Call Step_1\r\n {4}Call Step_2/.test(mesh.text) && !/r = Expect\(0/.test(mesh.text), 'mesh-kernel-only macro: the base-plane sketch and extrude are there, with no body checks (nothing to compare with)');
  }
}

section('forward: encoding, long equations, long sketches');
{
  ok(SW.cp1252('Flange Ø200 — €5 日本') === 'Flange Ø200 — €5 ??' && SW.toCp1252('Ø€—').join(',') === '216,128,151', 'Windows-1252: Ø € — kept (0xD8 0x80 0x97), other characters become "?"');
  ok(SW.swName('Hole@1 "big"/x') === 'Hole_1 _big__x', 'feature names lose the characters SolidWorks forbids (@ " / …)');
  const fl = F.flange();
  fl.part.name = 'Flansch Ø200 日本';
  const long = Array.from({ length: 60 }, (_, k) => `a${k}`).join(' + ');
  fl.part.params = { vars: Array.from({ length: 60 }, (_, k) => ({ name: `a${k}`, expr: String(k) })).concat([{ name: 'total', expr: long }]), links: [] };
  // a sketch with 3000 points: the drawing procedure is split
  const big = S.newSketch();
  for (let k = 0; k < 3000; k++) S.addPoint(big, (k % 60) * 2, Math.floor(k / 60) * 2);
  P.addFeature(fl.part, 'sketch', { plane: { kind: 'base', name: 'right' }, sketch: big });
  const out = SW.partToSwb(fl.part, {});
  const c = checkVba(out.text, { table: TABLE, receivers: SW.SW_RECEIVERS });
  ok(!c.problems.length, `well-formed VBA${c.problems.length ? ':\n       ' + c.problems.join('\n       ') : ''}`);
  ok(/^' Flansch Ø200 __\.swb - /.test(out.text) && [...out.text].every(SW.in1252), 'the part name keeps Ø; characters outside Windows-1252 (and ones SolidWorks forbids) become "_"');
  ok(/s = s & "/.test(out.text) && out.text.split('\r\n').every((l) => l.length <= 1023), 'a 300-character equation is built in pieces on lines under 1023 characters');
  const draw = c.procs.filter((p) => /^Step_6_Draw(_\d+)?$/.test(p.name));
  ok(draw.length >= 3 && /Call Step_6_Draw_2/.test(out.text) && c.maxProc < 65536, `a 3000-point sketch is drawn by ${draw.length} chained procedures, each under 64 KB (largest ${c.maxProc} bytes)`);
}

// =========================================================================================
section('the backward macro (tools/partcraft-sw/CadCraftExport.swb) is well-formed VBA');
{
  const raw = fs.readFileSync(SWDIR + 'CadCraftExport.swb');
  const text = raw.toString('latin1');
  const c = checkVba(text, { table: EXPORT_TABLE, receivers: EXPORT_RECEIVERS });
  ok(!c.problems.length, `CadCraftExport.swb: ${text.split('\r\n').length} lines, ${c.procs.length} procedures${c.problems.length ? ':\n       ' + c.problems.join('\n       ') : ''}`);
  ok(/"format"": ""cadcraft-sw-export"", ""version"": 1, ""units"": ""mm""/.test(text), 'it writes format cadcraft-sw-export, version 1, millimetres');
  ok(/Not yet tested in SolidWorks/.test(text) && /has not been tested in SolidWorks yet/.test(text), 'it says it has not been tested in SolidWorks (header and the closing message)');
  ok([...raw].every((b) => b < 0x80), 'it is plain ASCII (non-ASCII text in the part is written as \\uXXXX escapes)');
}

// =========================================================================================
section('STEP for SolidWorks (XCAF: product name, colour, mm, Y up) read back by native OCCT and occt-import-js');
{
  const fl = F.flange();
  const out = XC.exportXcafStep(fl.part, oc, { name: 'Flange Ø200 é', color: '#2f6fd6' });
  const f = path.join(TMP, 'Flange-xcaf.step');
  fs.writeFileSync(f, out.text);
  ok(rel(out.volume, 302160 * PI, 1e-9), `exportXcafStep: the exact volume 302160π (${out.volume.toFixed(4)})`);
  ok(/FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/.test(out.text) && /PRODUCT\('Flange _200 e','Flange _200 e'/.test(out.text) && /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(out.text), 'AP214, the product named after the part (plain ASCII: é → e, Ø → _), millimetres');
  ok(/COLOUR_RGB\('',0\.1843137\d*,0\.4352941\d*,0\.8392157\d*\)/.test(out.text) && /SURFACE_STYLE_FILL_AREA/.test(out.text), 'the part colour #2f6fd6 as a surface colour (47, 111, 214)/255');
  const a242 = XC.exportXcafStep(fl.part, oc, { schema: 'AP242' }).text;
  ok(/AP242_MANAGED_MODEL_BASED_3D_ENGINEERING/.test(a242) && /PRODUCT\('Flange'/.test(a242), 'AP242 on request; the name defaults to the part\'s');
  ok(/ADVANCED_FACE\(/.test(out.text) && (out.text.match(/CYLINDRICAL_SURFACE\(/g) || []).length === 10 && !/FACETED_BREP/.test(out.text), 'true B-rep (10 cylindrical surfaces, no facets)');
  if (!HAVE_OCP) skip('cadquery-ocp missing (tools/partcraft-test/venv): native XCAF read skipped');
  else {
    const j = JSON.parse(execFileSync(PY, ['-I', '-c', `
import sys, json
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ColorType, XCAFDoc_ColorTool
from OCP.TDF import TDF_LabelSequence
from OCP.Quantity import Quantity_Color
from OCP.TDataStd import TDataStd_Name
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from importlib.metadata import version
doc = TDocStd_Document(TCollection_ExtendedString("MDTV-XCAF"))
r = STEPCAFControl_Reader(); r.SetColorMode(True); r.SetNameMode(True)
r.ReadFile(sys.argv[1]); r.Transfer(doc)
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
labels = TDF_LabelSequence(); st.GetFreeShapes(labels)
lab = labels.Value(1)
n = TDataStd_Name(); has = lab.FindAttribute(TDataStd_Name.GetID_s(), n)
col = Quantity_Color(); hc = XCAFDoc_ColorTool.GetColor_s(lab, XCAFDoc_ColorType.XCAFDoc_ColorSurf, col)
shape = st.GetShape_s(lab)
g = GProp_GProps(); BRepGProp.VolumeProperties_s(shape, g)
b = Bnd_Box(); BRepBndLib.AddOptimal_s(shape, b, False, False)
print(json.dumps({'labels': labels.Length(), 'name': n.Get().ToExtString() if has else None, 'color': [round(Quantity_Color.Convert_LinearRGB_To_sRGB_s(v) * 255) for v in (col.Red(), col.Green(), col.Blue())] if hc else None, 'volume': g.Mass(), 'bbox': list(b.Get()), 'valid': BRepCheck_Analyzer(shape).IsValid(), 'ver': version('cadquery-ocp')}))
`, f], { encoding: 'utf8' }).trim().split('\n').pop());
    ok(j.labels === 1 && j.name === 'Flange _200 e', `native OpenCascade (cadquery-ocp ${j.ver}) reads one product named "${j.name}"`);
    ok(JSON.stringify(j.color) === '[47,111,214]', `its surface colour is (47, 111, 214) = #2f6fd6 (got ${JSON.stringify(j.color)})`);
    ok(j.valid && rel(j.volume, 302160 * PI, 1e-9), `a valid solid of volume ${j.volume.toFixed(6)} = 302160π to 1e-9`);
    ok(Math.abs(j.bbox[4] - 80) < 1e-6 && Math.abs(j.bbox[1]) < 1e-6 && Math.abs(j.bbox[5] - 100) < 1e-6, 'Y up, as SolidWorks expects: the hub reaches y 80, z spans ±100');
  }
  let occt = null;
  try { occt = await require('occt-import-js')(); } catch { skip('occt-import-js missing (cd tools/partcraft-test && npm install): STEP not read back by it'); }
  if (occt) {
    const res = occt.ReadStepFile(new Uint8Array(fs.readFileSync(f)), null);
    const m = res.meshes?.[0];
    const srgb = (v) => Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
    ok(res.success && res.meshes.length === 1 && m.name === 'Flange _200 e' && res.root.children?.[0]?.name === 'Flange _200 e', 'occt-import-js reads one mesh and one product node named "Flange _200 e"');
    ok(m && m.color && m.color.map(srgb).join(',') === '47,111,214' && m.brep_faces.length === 14, 'with the colour #2f6fd6 and 14 B-rep faces');
  }
  // the worker op: macro + STEP in one call (as the Export menu does)
  ok(typeof WO.OPS.swExport === 'function' && typeof WO.OPS.swImport === 'function', 'brep-xcaf.js adds the worker ops swExport and swImport');
  const r = await WO.OPS.swExport({ part: JSON.parse(P.toJSON(F.flange().part)), name: 'Flange' }, { oc });
  ok(r.step && rel(r.step.volume, 302160 * PI, 1e-9) && /PRODUCT\('Flange'/.test(r.step.text) && /Call Step_5/.test(r.swb.text) && r.swb.stats.checks === 3, 'swExport gives the STEP (302160π) and the macro (with its 3 body checks) together');
  const empty = await WO.OPS.swExport({ part: P.newPart('Empty') }, { oc });
  ok(empty.step === null && /no solid/.test(empty.stepError) && /Sub main\(\)/.test(empty.swb.text), 'an empty part: no STEP (it says why), a macro that makes an empty part');
}

// =========================================================================================
section('backward: swimport on hand-written cadcraft-sw-export fixtures (exact kernel)');
const fx = (n2) => fs.readFileSync(SWDIR + 'fixtures/' + n2 + '.cadcraft-sw.json', 'utf8');
{
  const allOk = (part) => { const r = B.regenerateBrep(JSON.parse(JSON.stringify(part)), oc); return { r, ok: [...r.results.values()].every((x) => x.status === 'ok') }; };
  // block with fillets
  let { part, report } = SI.fromSwExport(fx('block-fillets'), { oc });
  let b = allOk(part);
  const Vb = 100 * 50 * 20 - 4 * (25 - 25 * PI / 4) * 20;
  ok(b.ok && rel(b.r.stats.volume, Vb, 1e-9), `block-fillets: rebuilds to 100·50·20 − 4(25 − 25π/4)·20 = ${Vb.toFixed(6)} exactly (got ${b.r.stats.volume.toFixed(6)})`);
  ok(report.carried.length === 3 && !report.notCarried.length && report.volume.same === true, 'all 3 features carried; the volume matches the one SolidWorks wrote');
  ok(part.features[0].plane.kind === 'base' && part.features[0].plane.name === 'top' && solveStatus(part.features[0].sketch) === 'full', 'Sketch1 on the Top plane, fully defined (H/V, coincident with the origin, two lengths)');
  const fil = part.features.find((f) => f.type === 'fillet');
  ok(fil.edges.length === 4 && fil.edges.every((e) => e.faces.every((n2) => /\.side:/.test(n2))), 'the fillet\'s 4 points became named edge references (side face × side face)');
  ok(part.params && part.params.vars.map((v) => v.name).join(',') === 'width,height,D2_Sketch1' && part.params.links.length === 4, 'globals width, height + D2@Sketch1 (used in another equation) as parameters; 4 equations');
  // forward and backward through the imported parameters: width 120 → block 120 wide, height 24
  part.params.vars.find((v) => v.name === 'width').expr = '120';
  const ap = PP.applyPartParams(part);
  b = allOk(part);
  const V120 = 120 * 50 * 24 - 4 * (25 - 25 * PI / 4) * 24;
  ok(ap.ok && b.ok && rel(b.r.stats.volume, V120, 1e-9), `width 100 → 120 drives the sketch and (through height = width / 5) the extrude: ${V120.toFixed(6)} exactly`);

  // flange
  ({ part, report } = SI.fromSwExport(fx('flange'), { oc }));
  b = allOk(part);
  ok(b.ok && rel(b.r.stats.volume, 302160 * PI, 1e-9) && b.r.stats.genus === 9, `flange: 302160π to 1e-9 (${b.r.stats.volume.toFixed(4)}), 9 through holes`);
  const s2 = part.features.find((f) => f.name === 'Sketch2');
  ok(s2.plane.kind === 'face' && /^f2\.side:/.test(B.refName(s2.plane)), 'Sketch2 lands on the revolve\'s named top face (so it follows edits), not a fixed plane');
  const cp = part.features.find((f) => f.type === 'cpattern');
  ok(cp.axis.kind === 'axis' && cp.axis.feature === 'f2' && cp.count === 8, 'the circular pattern turns about the revolve\'s axis, 8 times');
  const pt = s2.sketch.entities.find((e) => e.type === 'point');
  ok(Math.abs(pt.x - 75) < 1e-9 && Math.abs(pt.y) < 1e-9 && s2.sketch.constraints.some((k) => k.type === 'horizontal'), 'SolidWorks\' sketch frame (x along −Z) mapped into PartCraft\'s: the hole centre at (75, 0); "vertical" became "horizontal"');
  ok(part.params.vars.map((v) => v.name).join(',') === 'bolt_d,Bolt_count' && report.lines.some((l) => /2 parameters and 2 equations carried over/.test(l)), 'globals bolt_d and "Bolt count" (renamed Bolt_count) with 2 equations');
  part.params.vars.find((v) => v.name === 'bolt_d').expr = '16';
  PP.applyPartParams(part);
  b = allOk(part);
  ok(b.ok && rel(b.r.stats.volume, (302160 - 8 * 15 * 30) * PI, 1e-9), 'bolt_d 14 → 16: every bolt hole grows, volume (302160 − 8·15·30)π exactly');

  // revolve ring + chamfer + an unsupported sweep
  ({ part, report } = SI.fromSwExport(fx('ring-chamfer'), { oc }));
  b = allOk(part);
  const Vr = 1500 * PI - 59 * PI / 3;
  ok(b.ok && rel(b.r.stats.volume, Vr, 1e-9), `ring-chamfer: π(20² − 10²)·5 − 2π(20 − 1/3)·½ = 4441π/3 = ${Vr.toFixed(6)} exactly`);
  ok(report.notCarried.length === 1 && report.notCarried[0].name === 'Sweep1' && report.lines.includes('Not carried over: Sweep1 (Sweep).'), 'the sweep is reported "Not carried over: Sweep1 (Sweep)" — never guessed');
  ok(part.features[0].plane.name === 'right' && part.features.find((f) => f.type === 'chamfer').edges.length === 1, 'the profile on the Right plane; the chamfer\'s point became one named edge');
  // the macro can be written for every imported part (import → macro)
  for (const n2 of ['block-fillets', 'flange', 'ring-chamfer']) {
    const p2 = SI.fromSwExport(fx(n2), { oc }).part;
    const out = macro(p2);
    ok(out.stats.carried === p2.features.length && !checkVba(out.text, { table: TABLE, receivers: SW.SW_RECEIVERS }).problems.length, `${n2}: the imported part goes straight back out as a well-formed macro (all ${p2.features.length} features)`);
  }
}

section('backward: untrusted files are refused with a plain message');
{
  const base = JSON.parse(fx('block-fillets'));
  const bad = (mut, re, what) => { const j = JSON.parse(JSON.stringify(base)); mut(j); ok(throws(() => SI.readSwExport(JSON.stringify(j)), re), what); };
  ok(throws(() => SI.readSwExport('{nope'), /not JSON/), 'not JSON');
  bad((j) => { j.format = 'partcraft'; }, /not a SolidWorks export/, 'another format');
  bad((j) => { j.version = 2; }, /newer macro \(format version 2\)/, 'a newer version says so');
  bad((j) => { j.units = 'in'; }, /units are not millimetres/, 'inches');
  bad((j) => { j.features = 'x'; }, /feature list/, 'features not a list');
  bad((j) => { j.features[0].points[0].x = 1e12; }, /point P1/, 'a coordinate past ±10 km');
  bad((j) => { j.features[0].points[1].x = '5'; }, /point P2/, 'a number written as text');
  bad((j) => { j.features[1].name = 'Sketch1'; }, /two features are called Sketch1/, 'two features with one name');
  bad((j) => { j.features[0].segments[0].b = 'P9'; }, /names a point it does not have/, 'a line to a point that is not there');
  bad((j) => { j.features[0].relations[0].refs = ['S9']; }, /names geometry it does not have/, 'a relation on missing geometry');
  bad((j) => { j.features[0].points[1].id = 'P1'; }, /used twice/, 'an id used twice');
  bad((j) => { j.features[0].points[0].id = '<script>'; }, /point id/, 'an id with markup in it');
  bad((j) => { j.features[2].r = -5; }, /radius/, 'a negative fillet radius');
  bad((j) => { j.features[2].edges = Array.from({ length: 2001 }, () => ({ at: [0, 0, 0] })); }, /edges/, '2001 edges');
  bad((j) => { j.features[0].plane = { o: [0, 0, 0], x: [0, 0, 1], n: [0, 0, 1] }; }, /x axis is not in the plane/, 'a plane whose x axis is not in it');
  ok(throws(() => SI.readSwExport('x'.repeat(50 * 1024 * 1024 + 1)), /too big/), 'over 50 MB');
  const proto = JSON.parse(JSON.stringify(base)); proto.__proto__ = { polluted: true }; proto.features[0].constructor = 'x';
  const clean = SI.readSwExport(JSON.stringify(proto));
  ok(!('polluted' in {}) && !('constructor' in clean.features[0] && clean.features[0].constructor === 'x'), '__proto__ and constructor keys are ignored (only known fields are copied)');
  // feature-level problems are reported, not thrown
  const j = JSON.parse(JSON.stringify(base));
  j.features[1].sketch = 'NoSuchSketch';
  j.equations.push({ lhs: 'D9@Nowhere', rhs: '"width"' }, { lhs: 'D1@Sketch1', rhs: 'cosec("width")' });
  const r = SI.fromSwExport(JSON.stringify(j), { oc });
  ok(r.report.notCarried.some((x) => x.name === 'Boss-Extrude1' && /NoSuchSketch is not carried over/.test(x.why)) && r.report.notCarried.some((x) => x.name === 'Fillet1'), 'an extrude on a missing sketch is reported (and the fillet after it, with no body)');
  ok(r.report.warnings.some((w) => /D9@Nowhere is left out/.test(w)) && r.report.warnings.some((w) => /cosec\(\) has no counterpart/.test(w)), 'an equation on an unknown dimension and an unknown function are reported');
  ok(throws(() => SI.fromSwExport(fx('flange'), {}), /exact kernel/), 'opening an export without the exact kernel says it needs it');
}

section('expressions both ways');
{
  const { parse } = await import(DEV + 'expr.js');
  const t = (src) => SW.swExpr(parse(src).ast);
  ok(t('width / 2 + 3') === '("width" / 2) + 3' && t('-2^2') === '-((2 ^ 2))' && t('pi * r') === 'pi * "r"', 'PartCraft → SolidWorks: names quoted, precedence kept with brackets, pi');
  ok(t('asin(a) + atan(b) + ln(c) + log(d)') === '((arcsin("a") + atn("b")) + log("c")) + (log("d") / log(10))', 'asin → arcsin, atan → atn, ln → log, log → log / log(10)');
  ok(throws(() => t('a % 3'), /% has no counterpart/) && throws(() => t('round(a)'), /round\(\) has no counterpart/) && throws(() => t('a > 2'), /comparison outside if/), '%, round() and a bare comparison are refused with the reason (the macro then writes the value)');
  const back = (s) => SI.fromSwExpr(s, (n2) => n2.replace(/\W/g, '_'));
  ok(back('"width" / 2 + sqr("a") * atn(1)') === 'width / 2 + sqrt(a) * atan(1)' && back('iif("n" > 6, 0, 1)') === 'if(n > 6, 0, 1)' && back('iif("a" = "b", 1, 2)') === 'if(a == b, 1, 2)' && back('iif("a" <> 2, 1, 2)') === 'if(a != 2, 1, 2)', 'SolidWorks → PartCraft: sqr, atn, iif with = and <>');
  ok(throws(() => back('cosec(1)'), /cosec\(\) has no counterpart/) && throws(() => back('width + 1'), /not a name PartCraft knows/) && throws(() => back('"a" = 2'), /comparison outside iif/), 'unknown functions, unquoted names and bare comparisons are refused');
  const taken = new Set();
  ok(SI.varName('Wall thickness', taken) === 'Wall_thickness' && SI.varName('2nd', taken) === 'p_2nd' && SI.varName('sin', taken) === 'sin_' && SI.varName('Wall thickness', taken) === 'Wall_thickness_2', 'SolidWorks names become PartCraft parameter names (spaces, leading digits, function names, clashes)');
}


if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
else console.log(`\nkept: ${TMP}`);
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}. SolidWorks was not run: every check above is structural or against PartCraft's own kernel and two other OpenCascade readers.`);
process.exit(fail ? 1 : 0);
