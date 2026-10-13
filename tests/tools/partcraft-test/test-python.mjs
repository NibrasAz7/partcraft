#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-python.mjs — Python as a CraftScript language (0.4 P10, cs-lang-python.js on the vendored Pyodide), in Node:
 * builtins and the analysis library through cs.*, numpy-like arithmetic (* elementwise, @ the matrix product) against
 * CraftScript's own answers, 0-based indexing (negative, slices, a logical mask) and assignment, structs ↔ dicts and cells ↔
 * lists, the workspace shared with CraftScript both ways, errors with the script's line (a Python error and a builtin's),
 * the instruction budget, the refused imports, and the console note on the first run.
 *   node tools/partcraft-test/test-python.mjs [--verbose]    (or runPythonTests() from bin/test-craftscript.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEV = path.join(REPO, 'public_html/assets/apps/partcraft/dev/');

export async function runPythonTests({ ok, section, skip = (m) => console.log('  skip ' + m) }) {
  if (!fs.existsSync(path.join(REPO, 'public_html/assets/vendor/pyodide/current/pyodide.mjs'))) { skip('Pyodide is not vendored here (assets/vendor/pyodide)'); return; }
  const { makeRuntime } = await import(pathToFileURL(DEV + 'cs-all.js').href);
  const RT = await import(pathToFileURL(DEV + 'cs-runtime.js').href);
  const library = (n) => { const f = path.join(DEV, 'craftlib', n + '.craft'); return fs.existsSync(f) ? { source: fs.readFileSync(f, 'utf8'), file: n + '.craft' } : null; };
  let out = '';
  const rt = makeRuntime({ budget: 2e9, onPrint: (s) => { out += s; }, onDisplay: () => {}, library });
  const py = async (src, file = 'test.py') => { out = ''; const r = await rt.run(src, { lang: 'python', file }); return { ...r, out }; };
  const craft = async (src) => { out = ''; const r = await rt.run(src, { lang: 'craft' }); return { ...r, out }; };
  const num = (name) => { const v = rt.ws.get(name); return typeof v === 'number' ? v : v && v.data ? Array.from(v.data) : v; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  section('Python (cs-lang-python.js, Pyodide)');
  ok(RT.languageList().some((l) => l.id === 'python' && l.ext.includes('.py')) && RT.languageForFile('wing.py') === 'python', 'Python is a language for .py files');
  let r = await py('A = cs.magic(3)\nB = A @ A.T\nC = A * A\nD = A / 2 + 1\nE = 2 ** cs.tensor([1, 2, 3])\nF = -A\n');
  const rc = await craft('A2 = magic(3); B2 = A2 * A2\'; C2 = A2 .* A2; D2 = A2 / 2 + 1; E2 = 2 .^ [1 2 3]; F2 = -A2;');
  ok(r.ok && rc.ok && ['B', 'C', 'D', 'E', 'F'].every((k) => same(num(k), num(k + '2'))), `A @ A.T, A * A, A / 2 + 1, 2 ** [1 2 3], -A: the same numbers as CraftScript's A*A', A.*A, A/2+1, 2.^[1 2 3], -A ${r.ok ? '' : r.error.message}`);
  r = await py('A = cs.magic(4)\na = A[0, 1]\nb = A[-1, -1]\nrow = A[1]\nsub = A[0:2, 1:3]\nbig = A[A > 12]\nv = cs.tensor([10, 20, 30])\nlast = v[-1]\nsh = list(A.shape)\nn = len(A)\nA[0, 0] = -5\nfirst = A[0, 0]\n');
  // magic(4) = [16 2 3 13; 5 11 10 8; 9 7 6 12; 4 14 15 1]
  ok(r.ok && num('a') === 2 && num('b') === 1 && same(num('row'), [5, 11, 10, 8]) && same(num('sub'), [2, 11, 3, 10]) && same(num('big').slice().sort((x, y) => x - y), [13, 14, 15, 16]) && num('last') === 30 && same(num('sh'), [4, 4]) && num('n') === 4 && num('first') === -5, `0-based indexing: A[0,1] 2, A[-1,-1] 1, A[1] a row, A[0:2,1:3], a mask A[A > 12], v[-1], shape, len, assignment ${r.ok ? '' : r.error.message}`);
  r = await py('s = {"name": "bracket", "t": 3.5, "sizes": [1, 2, 3]}\nc = ["a", 2.0]\n');
  const s = rt.ws.get('s'), c = rt.ws.get('c');
  ok(r.ok && s.t === 'struct' && s.fields.name === 'bracket' && s.fields.t === 3.5 && same(Array.from(s.fields.sizes.data), [1, 2, 3]) && c.t === 'cell' && c.items[0] === 'a', 'a dict lands as a struct (a list of numbers in it as a tensor), a list of mixed things as a cell');
  r = await py('back = s["sizes"].tolist()\nname = s["name"]\n');
  ok(r.ok && same(num('back'), [1, 2, 3]) && rt.ws.get('name') === 'bracket', 'and they come back to Python as a dict and a Value');
  // the workspace both ways
  await craft('k = 7;');
  r = await py('k2 = k * 6\nws.from_py = 99\nnames = ws_names()\n');
  const rc2 = await craft('m = k2 + from_py;');
  ok(r.ok && rc2.ok && num('m') === 42 + 99 && Array.isArray(r.vars) && r.vars.includes('k2'), 'the workspace is shared: CraftScript k = 7 → Python k2 = k * 6 and ws.from_py = 99 → CraftScript m = k2 + from_py = 141');
  // the analysis library and several results
  r = await py("m = cs.box_mesh(20, 10, 10, 5, 'hex')\nkind = m.type\nV, D = cs.call('eig', 2, cs.tensor([[2, 0], [0, 3]]))\nd1 = float(D[1, 1])\n");
  ok(r.ok && rt.ws.get('kind') === 'mesh' && num('d1') === 3, `the analysis library (cs.box_mesh) and cs.call('eig', 2, …) → V, D ${r.ok ? '' : r.error.message}`);
  // print → the console; the note on the first run
  ok(/Python scripts are not sealed off/.test(out) === false, 'the note is printed once (on the first Python run, not every run)');
  r = await py('print("hello", 1 + 1)\n');
  ok(r.ok && r.out === 'hello 2\n', `print goes to the console ("${r.out.trim()}")`);
  // errors: a Python one and a builtin's, with the script's line
  r = await py('x = 1\ny = x +\n', 'bad.py');
  ok(!r.ok && r.error.line === 2 && /SyntaxError/.test(r.error.message), `a syntax error says where: line ${r.error.line}, "${r.error.message}"`);
  r = await py('a = 1\nb = no_such_name\n');
  ok(!r.ok && r.error.line === 2 && /NameError: name 'no_such_name' is not defined/.test(r.error.message) && num('a') === 1, `a NameError on line ${r.error.line}; what ran before it is kept (a = 1)`);
  r = await py('q = 1\nz = cs.reshape(cs.tensor([1, 2, 3]), 2, 2)\n');
  ok(!r.ok && r.error && r.error.line === 2 && !/JsException/.test(r.error.message), `an error inside a builtin keeps its words, at the script's line (${r.error?.line}: "${r.error?.message}")`);
  // the budget
  const small = makeRuntime({ budget: 2e5, onPrint: () => {}, onDisplay: () => {} });
  const rb = await small.run('i = 0\nwhile True:\n    i += 1\n', { lang: 'python', file: 'loop.py' });
  ok(!rb.ok && rb.error.stopped && /budget/i.test(rb.error.message), `the instruction budget stops an endless loop ("${rb.error.message}")`);
  // refused imports
  for (const mod of ['js', 'pyodide', 'gc']) {
    r = await py(`import ${mod}\n`);
    ok(!r.ok && /cannot import/.test(r.error.message), `import ${mod} is refused ("${r.error.message}")`);
  }
  r = await py('import math, json\nroot = math.sqrt(2)\ntxt = json.dumps([1, 2])\n');
  ok(r.ok && Math.abs(num('root') - Math.SQRT2) < 1e-15 && rt.ws.get('txt') === '[1, 2]', 'the standard library is there (math, json)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const VERBOSE = process.argv.includes('--verbose');
  let pass = 0, fail = 0;
  const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
  const section = (t) => console.log('\n== ' + t);
  await runPythonTests({ ok, section });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
