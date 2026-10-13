#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * test-craftscript.mjs — CraftScript (docs/SCRIPTING-SPEC.md §7, docs/apps/craftscript.md): values, lexer, parser, VM
 * (operators, indexing incl. end / logical / growth, control flow, functions, errors with line numbers, budget stop),
 * the runtime API (§3), the worker ops, the core builtins, the CLI `run`, and the acceptance test: top88 (Andreassen et
 * al. 2011) on the MBB beam 60×20 for ft = 1 and ft = 2, checked iteration by iteration against an independent plain-JS
 * implementation of the same algorithm (own banded Cholesky; no CraftScript, no cs-lib-linalg.js).
 *
 *   node bin/test-craftscript.mjs [--verbose] [--lib] [--lua] [--no-top88] [--only <section>]
 *
 * Sections other builders own live in their own files, each exporting `async function run(T)` with
 * T = { ok, section, near, rel, skip, throws, runCraft, makeRuntime, DEV, REPO, VERBOSE } — add a file and it is picked up:
 *   tools/partcraft-test/test-cs-linalg.mjs · test-cs-mesh.mjs · test-cs-io.mjs   (builder B: builtins vs reference values)
 *   tools/partcraft-test/test-cs-lua.mjs      (builder B: Lua adapter + parity with CraftScript)       --lua runs only it
 *   tools/partcraft-test/test-craftlib.mjs    (builder D: every craftlib/ check from §4)              --lib runs only it
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = path.join(REPO, 'public_html/assets/apps/partcraft/dev/');
const DEVURL = pathToFileURL(DEV).href;
const FIX = path.join(REPO, 'tools/partcraft-test/fixtures');
const TMP = path.join(REPO, 'tmp/partcraft-craftscript');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const ONLY_LIB = argv.includes('--lib'), ONLY_LUA = argv.includes('--lua'), NO_TOP88 = argv.includes('--no-top88');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
fs.mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0, skipped = 0, current = '';
const ok = (c, m) => { if (c) { pass++; if (VERBOSE) console.log('  ok   ' + m); } else { fail++; console.log(`  FAIL [${current}] ${m}`); } return !!c; };
const skip = (m) => { skipped++; console.log('  skip ' + m); };
const section = (t) => { current = t; console.log('\n== ' + t); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const rel = (a, b, r = 1e-9) => Math.abs(a - b) <= r * Math.max(1, Math.abs(b));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const want = (name) => !ONLY || name.toLowerCase().includes(ONLY.toLowerCase());

const V = await import(DEVURL + 'cs-values.js');
const RT = await import(DEVURL + 'cs-all.js');
const { lex } = await import(DEVURL + 'cs-lex.js');
const { parse } = await import(DEVURL + 'cs-parse.js');
const { makeRuntime } = RT;

/** Run CraftScript; returns { ok, error, out, displays, ws, rt, r }. opts: { rt, budget, library, file }. */
async function runCraft(src, opts = {}) {
  let out = '';
  const displays = [];
  const rt = opts.rt || makeRuntime({ budget: opts.budget ?? 2e9, onPrint: (t) => { out += t; }, onDisplay: (c) => displays.push(c), library: opts.library || null });
  if (opts.rt) { rt._out = ''; }
  const r = await rt.run(src, { lang: opts.lang || 'craft', file: opts.file || null });
  return { ok: r.ok, error: r.error, out, displays, ws: rt.ws, rt, r };
}
/** Value of a variable after running src (as a JS number / array / string). */
async function val(src, name = 'ans') {
  const r = await runCraft(src);
  if (!r.ok) return { error: r.error.message };
  return js(r.ws.get(name));
}
function js(v) {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) return v;
  if (v.t === 'tensor') return { shape: v.shape.slice(), data: Array.from(v.data, (x) => (v.dtype === 'u8' ? !!x : x)) };
  if (v.t === 'cell') return { cell: v.items.map(js), shape: V.sizeOf(v) };
  if (v.t === 'struct') return { struct: Object.fromEntries(Object.entries(v.fields).map(([k, x]) => [k, js(x)])) };
  return v;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T = { ok, section, near, rel, skip, throws, runCraft, makeRuntime, DEV, DEVURL, REPO, VERBOSE, js, val };

async function external(file, label) {
  const p = path.join(REPO, 'tools/partcraft-test', file);
  if (!fs.existsSync(p)) { section(label); skip(`${file} is not written yet (${label})`); return; }
  const m = await import(pathToFileURL(p).href);
  if (typeof m.run !== 'function') { section(label); ok(false, `${file} exports run(T)`); return; }
  await m.run(T);
}

if (ONLY_LIB) { await external('test-craftlib.mjs', 'Library checks (builder D)'); done(); }
else if (ONLY_LUA) { await external('test-cs-lua.mjs', 'Lua adapter (builder B)'); done(); }
else {
  if (want('values')) await testValues();
  if (want('lexer')) await testLexer();
  if (want('parser')) await testParser();
  if (want('operators')) await testOperators();
  if (want('indexing')) await testIndexing();
  if (want('control')) await testControl();
  if (want('functions')) await testFunctions();
  if (want('errors')) await testErrors();
  if (want('builtins')) await testBuiltins();
  if (want('runtime')) await testRuntime();
  if (want('worker')) await testWorker();
  if (want('performance')) await testPerformance();
  if (want('cli')) await testCli();
  if (want('top88') && !NO_TOP88) await testTop88();
  if (want('linalg')) await external('test-cs-linalg.mjs', 'Linear algebra builtins (builder B)');
  if (want('mesh')) await external('test-cs-mesh.mjs', 'Mesh builtins (builder B)');
  if (want('io')) await external('test-cs-io.mjs', 'File builtins (builder B)');
  if (want('lua')) await external('test-cs-lua.mjs', 'Lua adapter (builder B)');
  if (want('lib')) await external('test-craftlib.mjs', 'Library checks (builder D)');
  done();
}

function done() {
  console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}.`);
  process.exitCode = fail ? 1 : 0;
}

/* ================================================================== values */
async function testValues() {
  section('Values (cs-values.js)');
  const t = V.tensor([2, 3], Float64Array.from([1, 2, 3, 4, 5, 6]));
  ok(eq(V.sizeOf(t), [2, 3]) && V.typeOf(t) === 'tensor', 'tensor shape and type');
  ok(eq(V.tensor([3, 1, 1]).shape, [3, 1]), 'trailing singleton dims dropped');
  ok(throws(() => V.tensor([2 ** 20, 2 ** 8]), /limit/), 'tensor size cap (2^27)');
  const ws = new Map([['a', t], ['s', V.struct({ x: 1, y: 'two', z: V.cell([true, V.tensor([1, 2], Uint8Array.of(1, 0))]) })], ['f', V.func('craft', 'sin')]]);
  const ser = V.serializeWorkspace(ws);
  const back = V.readWorkspace(structuredClone(ser.vars, { transfer: ser.transfer })).ws;
  ok(!back.has('f') && ser.skipped.some((x) => x.name === 'f'), 'function handles are not saved');
  ok(eq(js(back.get('a')), js(t)) && back.get('a').data instanceof Float64Array, 'tensor survives structured clone (transferred)');
  ok(eq(js(back.get('s')), js(ws.get('s'))) && back.get('s').fields.z.items[1].dtype === 'u8', 'struct/cell/logical survive the round trip');
  const sp = { t: 'sparse', n: 2, m: 2, rowPtr: Int32Array.of(0, 1, 2), col: Int32Array.of(1, 0), val: Float64Array.of(3, 4) };
  ok(V.readValue(structuredClone(sp)).val[1] === 4, 'sparse round trip');
  ok(throws(() => V.readValue({ t: 'tensor', shape: [2, 2], data: [1, 2, 3] })), 'readValue refuses a short data array');
  ok(throws(() => V.readValue({ t: 'sparse', n: 1, m: 1, rowPtr: [0, 1], col: [5], val: [1] })), 'readValue refuses a column out of range');
  ok(throws(() => V.readValue({ t: 'struct', fields: { 'bad name': 1 } })), 'readValue refuses a bad field name');
  ok(throws(() => V.readValue({ t: 'evil' })), 'readValue refuses unknown types');
  ok(V.readWorkspace({ ok: 1, '1bad': 2 }).dropped.length === 1, 'readWorkspace drops bad names');
  ok(V.displayText('x', 5) === 'x = 5' && V.displayText('s', 'hi') === "s = 'hi'", 'echo text of scalars and text');
  ok(/1\s+3\s+5\n\s+2\s+4\s+6/.test(V.displayText('A', t)), 'echo text of a matrix');
  const s = V.summary(t);
  ok(s.min === 1 && s.max === 6 && s.bytes > 48, 'summary min/max/bytes');
}

/* ================================================================== lexer */
async function testLexer() {
  section('Lexer (cs-lex.js)');
  const types = (s) => lex(s).filter((x) => x.type !== 'nl' && x.type !== 'eof').map((x) => x.type === 'op' ? x.value : x.type);
  ok(eq(types('[1 -2]'), ['[', 'num', ',', 'num', ']']) === false ? eq(types('[1 -2]'), ['[', 'num', ',', '-', 'num', ']']) : true, '[1 -2] is two elements');
  ok(eq(types('[1 - 2]'), ['[', 'num', '-', 'num', ']']), '[1 - 2] is one element');
  ok(eq(types("[a' b']"), ['[', 'id', "'", ',', 'id', "'", ']']), "[a' b'] transposes both");
  ok(eq(types("x = 'it''s'"), ['id', '=', 'str']) && lex("x = 'it''s'")[2].value === "it's", "'' inside text");
  ok(eq(types('a.^2.*b'), ['id', '.^', 'num', '.*', 'id']), 'dotted operators');
  ok(eq(types('1.5e-3 .5 3.'), ['num', 'num', 'num']), 'number forms');
  ok(lex('x = 1 % comment\n%{\nblock\n%}\ny = 2').filter((x) => x.type === 'id').length === 2, 'comments and %{ %} blocks');
  ok(lex('x = [1, 2, ...\n 3]').filter((x) => x.type === 'num').length === 3, '... continues a line');
  ok(eq(types('[1 2\n3 4]'), ['[', 'num', ',', 'num', ';', 'num', ',', 'num', ']']), 'newline in [ ] is a row break');
  ok(eq(types('{"a", \'b\'}'), ['{', 'str', ',', 'str', '}']), 'double and single quotes');
  ok(throws(() => lex("x = 'open"), /closing quote/), 'unclosed text is an error');
  ok(throws(() => lex('x = (1 + 2'), /never closed/), 'unclosed bracket is an error');
  ok(throws(() => lex('x = 3i'), /Complex/), 'complex literals are refused clearly');
  const e = (() => { try { lex('a = 1\nb = $'); } catch (x) { return x; } })();
  ok(e && e.line === 2 && e.col === 5, 'lexer errors carry line and column');
}

/* ================================================================== parser */
async function testParser() {
  section('Parser (cs-parse.js)');
  const p = parse('function [a, b] = f(x, y)\na = x; b = y;\nend\nfunction g\nend');
  ok(p.functions.length === 2 && eq(p.functions[0].outs, ['a', 'b']) && eq(p.functions[0].params, ['x', 'y']), 'function headers');
  const q = parse('x = 1;\nif x, y = 2; elseif x > 3, y = 3; else, y = 4; end\nfor i = 1:3\nend\nwhile false, end\nswitch x\ncase 1\ny=1;\notherwise\ny=2;\nend\ntry\nerror(\'a\');\ncatch err\nend');
  ok(eq(q.body.map((s) => s.k), ['assign', 'if', 'for', 'while', 'switch', 'try']), 'statement kinds');
  ok(q.body[0].echo === false && parse('x = 1')['body'][0].echo === true, '";" suppresses echo');
  const c = parse('axis equal; hold on\nformat long');
  ok(c.body.every((s) => s.k === 'cmd') && c.body[0].words[0] === 'equal', 'command syntax (axis equal)');
  ok(parse('[a, ~] = size(x);').body[0].lhs[1].tilde, '[a, ~] = …');
  ok(parse('s.a(2).b{3} = 1;').body[0].lhs[0].chain.length === 4, 'assignment chains');
  const e = (() => { try { parse('x = 1\nif x\ny = 2'); } catch (z) { return z; } })();
  ok(e && /missing its "end"/.test(e.message) && e.line === 2, 'missing end names the if and its line');
  ok(throws(() => parse('x = = 2'), /Expected a value/), 'bad expression');
  ok(throws(() => parse('1 = x'), /left side/), 'bad assignment target');
  ok(throws(() => parse('end'), /does not close anything/), 'stray end');
  ok(throws(() => parse('global x'), /not supported/), 'global is refused clearly');
}

/* ================================================================== operators */
async function testOperators() {
  section('Operators and precedence');
  const cases = [
    ['ans = 1 + 2 * 3;', 7], ['ans = -2^2;', -4], ['ans = 2^-1;', 0.5], ['ans = 2^3^2;', 64], ['ans = (1:3) + 1;', { shape: [1, 3], data: [2, 3, 4] }],
    ['ans = 1:3+1;', { shape: [1, 4], data: [1, 2, 3, 4] }], ['ans = 10:-3:1;', { shape: [1, 4], data: [10, 7, 4, 1] }], ['ans = 0:0.1:0.3;', { shape: [1, 4], data: [0, 0.1, 0.2, 0.3] }],
    ['ans = 5:1;', { shape: [1, 0], data: [] }], ['ans = [1 2; 3 4] * [5; 6];', { shape: [2, 1], data: [17, 39] }],
    ['ans = [1 2; 3 4] .* [5 6; 7 8];', { shape: [2, 2], data: [5, 21, 12, 32] }], ["ans = [1 2 3]';", { shape: [3, 1], data: [1, 2, 3] }],
    ['ans = [1 2 3] + [10; 20];', { shape: [2, 3], data: [11, 21, 12, 22, 13, 23] }], ['ans = [2 4] ./ [1; 2];', { shape: [2, 2], data: [2, 1, 4, 2] }],
    ['ans = 3 > 2;', true], ['ans = [1 2 3] >= 2;', { shape: [1, 3], data: [false, true, true] }], ['ans = ~[1 0];', { shape: [1, 2], data: [false, true] }],
    ['ans = [1 0 1] & [1 1 0];', { shape: [1, 3], data: [true, false, false] }], ['ans = 1 ~= 2;', true], ['ans = 1 != 1;', false],
    ['ans = [4 2; 1 3] \\ [10; 5];', { shape: [2, 1], data: [2, 1] }], ['ans = [10 5] / [4 1; 2 3];', { shape: [1, 2], data: [2, 1] }],
    ['ans = [1 1; 0 1]^3;', { shape: [2, 2], data: [1, 0, 3, 1] }], ['ans = 2 \\ 6;', 3], ['ans = true + true;', 2],
    ["ans = 'a' + 1;", 98], ["ans = ['ab' 'cd'];", 'abcd'], ["ans = ['x = ' num2str(3)];", 'x = 3'],
    ['ans = 7 / 2;', 3.5], ['ans = 1e3 + .5;', 1000.5], ['ans = [1, 2; 3, 4](2, 1);', 3],   // indexing a literal: a CraftScript extension
  ];
  for (const [src, want] of cases) {
    const got = await val(src);
    if (want && want.error) ok(got && got.error, `${src} → an error`);
    else ok(eq(got, want) || (typeof want === 'number' && typeof got === 'number' && rel(got, want, 1e-12)), `${src} → ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
  ok((await val('a = false && error("boom"); ans = a;')) === false, '&& short-circuits');
  ok((await val('a = true || error("boom"); ans = a;')) === true, '|| short-circuits');
  ok(/single true\/false/.test((await val('ans = [1 1] && 1;')).error || ''), '&& on arrays says to use & or all()');
  ok(/inner sizes must agree/.test((await val('ans = [1 2] * [3 4];')).error || ''), '* with mismatched sizes suggests .*');
  ok(/do not match/.test((await val('ans = [1 2 3] + [1 2];')).error || ''), 'elementwise size mismatch');
}

/* ================================================================== indexing */
async function testIndexing() {
  section('Indexing (end, logical, growth, deletion, cells, structs)');
  const A = 'A = [1 2 3; 4 5 6; 7 8 9];';
  const cases = [
    [A + 'ans = A(2, 3);', 6], [A + 'ans = A(end);', 9], [A + 'ans = A(end, 1);', 7], [A + 'ans = A(5);', 5],
    [A + 'ans = A(:, 2);', { shape: [3, 1], data: [2, 5, 8] }], [A + 'ans = A(2, :);', { shape: [1, 3], data: [4, 5, 6] }],
    [A + "ans = A(:)';", { shape: [1, 9], data: [1, 4, 7, 2, 5, 8, 3, 6, 9] }], [A + 'ans = A(A > 6);', { shape: [3, 1], data: [7, 8, 9] }],
    [A + 'ans = A([1 3], [1 3]);', { shape: [2, 2], data: [1, 7, 3, 9] }], [A + 'ans = A(end-1:end, end);', { shape: [2, 1], data: [6, 9] }],
    [A + 'v = 1:5; ans = v(max(1, end-1):end);', { shape: [1, 2], data: [4, 5] }], [A + 'v = 10:10:50; w = [2 4]; ans = v(w(end));', 40],
    [A + 'ans = A([1 end]);', { shape: [1, 2], data: [1, 9] }], ['v = [1 2 3]; ans = v([true false true]);', { shape: [1, 2], data: [1, 3] }],
    ['v = []; v(3) = 5; ans = v;', { shape: [1, 3], data: [0, 0, 5] }], ['v = zeros(3, 1); v(5) = 1; ans = size(v);', { shape: [1, 2], data: [5, 1] }],
    ['B = zeros(2); B(3, 4) = 7; ans = B;', { shape: [3, 4], data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7] }], ['v = 1:5; v(2) = []; ans = v;', { shape: [1, 4], data: [1, 3, 4, 5] }],
    [A + 'A(2, :) = []; ans = A;', { shape: [2, 3], data: [1, 7, 2, 8, 3, 9] }], [A + 'A(:, 1) = [10; 20; 30]; ans = A(:, 1);', { shape: [3, 1], data: [10, 20, 30] }],
    [A + 'A(A > 5) = 0; ans = sum(A(:));', 15], ["s = 'hello'; ans = s(end:-1:1);", 'olleh'], ["s = 'abc'; s(2) = 'X'; ans = s;", 'aXc'],
    ['x = 5; ans = x(1);', 5], ['x = 5; ans = x(1, 1, 1);', 5], ['v = []; v(end+1) = 1; v(end+1) = 2; ans = v;', { shape: [1, 2], data: [1, 2] }],
    ["c = {1, 'two', [3 4]}; ans = c{3}(2);", 4], ["c = {1, 'two'}; ans = class(c(2));", 'cell'], ['c = {}; c{3} = 7; ans = size(c);', { shape: [1, 2], data: [1, 3] }],
    ['c = cell(1, 2); c{2} = 5; ans = isempty(c{1});', true], ['s.a.b = 3; s.a.c = 4; ans = s.a.b + s.a.c;', 7], ["n = 'k'; s.(n) = 9; ans = s.k;", 9],
    ['s = struct(\'x\', 1); s.y = 2; ans = numel(fieldnames(s));', 2], ['c = {1, 2, 3}; ans = plus(c{1:2});', 3], ['c = {4, 5}; ans = [c{:}];', { shape: [1, 2], data: [4, 5] }],
    ['A = magic(4); ans = A(2:3, [1 end]);', { shape: [2, 2], data: [5, 9, 8, 12] }], ['A = zeros(2, 2, 2); A(:, :, 2) = [1 2; 3 4]; ans = A(2, 1, 2);', 3],
    ['A = reshape(1:8, 2, 2, 2); ans = A(end, end, end);', 8], ['A = reshape(1:8, 2, 2, 2); ans = A(2, 3);', 6],
  ];
  for (const [src, want] of cases) {
    const got = await val(src);
    ok(eq(got, want), `${src} → ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
  const e1 = await runCraft('x = [1 2 3];\n\ny = x(12);');
  ok(!e1.ok && e1.error.message === 'Index 12 is past the end (3 elements).' && e1.error.line === 3, 'past-the-end message and line (spec example)');
  const e2 = await runCraft('A = zeros(2, 3); A(3, 1)');
  ok(!e2.ok && /position 1 is past the end \(2 rows\) of the 2×3 array/.test(e2.error.message), '2-D past-the-end message');
  ok(/start at 1/.test((await val('v = 1:3; ans = v(0);')).error || ''), 'index 0 explained');
  ok(/whole numbers/.test((await val('v = 1:3; ans = v(1.5);')).error || ''), 'fractional index explained');
  ok(/one value or as many/.test((await val('v = 1:3; v([1 2]) = [1 2 3];')).error || ''), 'assignment count mismatch');
  ok(/Struct arrays are not supported/.test((await val('s.a = 1; t = s(2);')).error || ''), 'struct arrays are refused clearly');
  // value semantics
  ok(eq(await val('a = [1 2 3]; b = a; b(1) = 9; ans = a;'), { shape: [1, 3], data: [1, 2, 3] }), 'b = a; b(1) = … leaves a alone');
  ok(eq(await val('function r = f(v)\nv(1) = 0; r = v;\nend', 'ans') ?? null, null), '(function file has no script part)');
  ok(eq(await val('a = [1 2]; f = @(v) setfirst(v); b = f(a); ans = a;\nfunction v = setfirst(v)\nv(1) = 7;\nend'), { shape: [1, 2], data: [1, 2] }), 'a function changing its argument leaves the caller\'s alone');
  ok(eq(await val('c = {[1 2]}; d = c; d{1}(1) = 5; ans = c{1};'), { shape: [1, 2], data: [1, 2] }), 'cell copy semantics');
  ok(eq(await val('s.v = [1 2]; t = s; t.v(2) = 0; ans = s.v;'), { shape: [1, 2], data: [1, 2] }), 'struct copy semantics');
  ok(eq(await val('x = 1:3; f = @() x; x(1) = 100; y = f(); ans = y;'), { shape: [1, 3], data: [1, 2, 3] }), 'anonymous functions capture values, not variables');
  ok(eq(await val('K = sparse(4,4); K([1;3],[1;3]) = [1 2;3 4]; K(2,2) = 5; F = sparse(4,1); F(2,1) = -1; F(4) = 7; ans = [reshape(full(K), 16, 1); full(F)];'), { shape: [20, 1], data: [1, 0, 3, 0, 0, 5, 0, 0, 2, 0, 4, 0, 0, 0, 0, 0, 0, -1, 0, 7] }), 'assigning into a sparse matrix: K(rows, cols) = block, F(i, 1), F(i) on a vector (top99 as published)');
}

/* ================================================================== control flow */
async function testControl() {
  section('Control flow');
  const cases = [
    ['x = 5; if x > 3, ans = 1; elseif x > 1, ans = 2; else, ans = 3; end', 1],
    ['x = 2; if x > 3\n ans = 1;\nelseif x > 1\n ans = 2;\nelse\n ans = 3;\nend', 2],
    ['s = 0; for i = 1:10, s = s + i; end; ans = s;', 55], ['s = 0; for i = 10:-2:1, s = s + i; end; ans = s;', 30],
    ['s = 0; for v = [1 2; 3 4], s = s + v(1) * v(2); end; ans = s;', 3 + 8], ["s = ''; for c = {'a', 'b'}, s = [s c{1}]; end; ans = s;", 'ab'],
    ['s = 0; for i = [], s = 1; end; ans = s;', 0], ['n = 0; while true, n = n + 1; if n >= 7, break; end; end; ans = n;', 7],
    ['s = 0; for i = 1:10, if mod(i, 2), continue; end; s = s + i; end; ans = s;', 30],
    ['s = 0; for i = 1:3, for j = 1:3, if j > i, break; end; s = s + 1; end; end; ans = s;', 6],
    ["x = 'b'; switch x, case 'a', ans = 1; case {'b', 'c'}, ans = 2; otherwise, ans = 3; end", 2],
    ['switch 4\ncase 1\nans = 1;\notherwise\nans = 9;\nend', 9], ['switch 2, case {1, 2}, ans = 5; end', 5],
    ["try\n error('my:id', 'bad %d', 3);\ncatch e\n ans = [e.identifier ' ' e.message];\nend", 'my:id bad 3'],
    ['try, x = [1 2](5); catch, ans = 4; end', 4], ['ans = 0; try, ans = 1; catch, ans = 2; end', 1],
    ['for (i = 1:3)\nend\nans = i;', 3], ['k = 0; for i = 1:0.5:2, k = k + 1; end; ans = k;', 3],
    ["ans = 0; x = 3;\nif x == 3 && true\n  ans = 10;\nend", 10],
  ];
  for (const [src, want] of cases) { const got = await val(src); ok(eq(got, want), `${src.replace(/\n/g, '⏎')} → ${JSON.stringify(want)} (got ${JSON.stringify(got)})`); }
  const echo = await runCraft('x = 3\ny = [1 2];\nx + 1\ndisp(\'hi\')');
  ok(echo.out === 'x = 3\nans = 4\nhi\n', `echo without ";" (got ${JSON.stringify(echo.out)})`);
}

/* ================================================================== functions */
async function testFunctions() {
  section('Functions, handles, closures');
  const cases = [
    ['ans = fib(10);\nfunction r = fib(n)\nif n < 2, r = n; else, r = fib(n-1) + fib(n-2); end\nend', 55],
    ['[a, b] = two(3); ans = [a b];\nfunction [x, y] = two(v)\nx = v; y = v * 2;\nend', { shape: [1, 2], data: [3, 6] }],
    ['ans = defs(1) + defs(1, 5);\nfunction r = defs(a, b)\nif nargin < 2, b = 10; end\nr = a + b;\nend', 17],
    ['ans = count(1, 2, 3);\nfunction n = count(varargin)\nn = numel(varargin);\nend', 3],
    ['[a, b, c] = spread(); ans = a + b + c;\nfunction varargout = spread()\nvarargout = {1, 2, 3};\nend', 6],
    ['f = @sin; ans = f(0);', 0], ['f = @(x, y) x + y; ans = f(2, 3);', 5], ['k = 3; f = @(x) x * k; ans = f(2);', 6],
    ['g = @(f, x) f(f(x)); ans = g(@(y) y + 1, 1);', 3], ["ans = feval('max', [1 5 2]);", 5], ['ans = feval(@plus, 1, 2);', 3],
    ['m = maker(4); ans = m(1);\nfunction h = maker(k)\nh = @(x) x + k;\nend', 5], ['f = @helper; ans = f(2);\nfunction y = helper(x)\ny = x^3;\nend', 8],
    ['ans = arrayfun(@(x) x^2, 1:4);', { shape: [1, 4], data: [1, 4, 9, 16] }], ["ans = cellfun(@numel, {'ab', 'cde', ''});", { shape: [1, 3], data: [2, 3, 0] }],
    ["c = cellfun(@(s) [s '!'], {'a', 'b'}, 'UniformOutput', false); ans = c{2};", 'b!'], ["ans = cellfun('isempty', {1, [], 'x'});", { shape: [1, 3], data: [false, true, false] }],
    ['[m, i] = max([3 9 2]); ans = [m i];', { shape: [1, 2], data: [9, 2] }], ['[r, c] = size(zeros(3, 4)); ans = [r c];', { shape: [1, 2], data: [3, 4] }],
    ['[~, i] = min([4 1 3]); ans = i;', 2], ['f = @(x) size(x); [a, b] = f(ones(2, 5)); ans = a * 10 + b;', 25],
    ['ans = nout();\nfunction r = nout()\nr = nargout;\nend', 1], ['x = 2; ans = func2str(@(t) t + x);', '@(t) …'],
    ["h = str2func('cos'); ans = h(0);", 1], ['ans = exist(\'sin\');', 5], ['zz = 1; ans = exist(\'zz\');', 1],
    ['ans = early(5);\nfunction r = early(x)\nr = 1;\nif x > 3, return; end\nr = 2;\nend', 1],
  ];
  for (const [src, want] of cases) { const got = await val(src); ok(eq(got, want), `${src.replace(/\n/g, '⏎')} → ${JSON.stringify(want)} (got ${JSON.stringify(got)})`); }
  const r = await runCraft('x = deep(1);\nfunction r = deep(n)\nr = deep(n + 1);\nend');
  ok(!r.ok && /Too many nested calls/.test(r.error.message), 'runaway recursion is caught');
  const st = await runCraft('a = outer(2);\nfunction r = outer(x)\nr = inner(x);\nend\nfunction r = inner(x)\nr = x(3);\nend');
  ok(!st.ok && st.error.line === 6 && st.error.stack && st.error.stack.map((f) => f.name).join('>') === 'inner>outer', `call stack in the error (${JSON.stringify(st.error.stack)})`);
  ok(/never set/.test((await val('a = noset();\nfunction r = noset()\nend')).error || ''), 'unset output named');
  ok(/at most 1 input/.test((await val('a = one(1, 2);\nfunction r = one(x)\nr = x;\nend')).error || ''), 'too many inputs');
  // library loading by name (transitively)
  const lib = { alpha: 'function r = alpha(x)\nr = beta(x) + 1;\nend', beta: 'function r = beta(x)\nr = 2 * x;\nend\nfunction q = unused()\nq = 0;\nend' };
  const lr = await runCraft('y = alpha(5);', { library: (n) => (lib[n] ? { source: lib[n], file: n + '.craft' } : null) });
  ok(lr.ok && lr.ws.get('y') === 11, 'library functions load by name, transitively');
  const sh = await runCraft('y = alpha(5);\nfunction r = alpha(x)\nr = -1;\nend', { library: (n) => (lib[n] ? { source: lib[n], file: n + '.craft' } : null) });
  ok(sh.ok && sh.ws.get('y') === -1, 'a local function shadows the library');
}

/* ================================================================== errors */
async function testErrors() {
  section('Errors and the budget');
  const a = await runCraft('x = 1;\ny = 2;\nz = undefinedThing + 1;');
  ok(!a.ok && a.error.line === 3 && /no variable or function called "undefinedThing"/.test(a.error.message), 'undefined name, line 3');
  const b = await runCraft('x = [1 2\n3]');
  ok(!b.ok && /sizes do not match/.test(b.error.message), 'ragged matrix');
  const c = await runCraft('a = 1;\nb = (a + ;');
  ok(!c.ok && c.error.line === 2 && c.error.col > 0, 'syntax error with line and column');
  const d = await runCraft("error('Custom %s at %d', 'trouble', 4)");
  ok(!d.ok && d.error.message === 'Custom trouble at 4', 'error() formats its message');
  const e = await runCraft('x = 0;\nwhile true\n  x = x + 1;\nend', { budget: 5e5 });
  ok(!e.ok && e.error.stopped && /budget/.test(e.error.message) && e.error.line >= 2, `budget stops an endless loop (line ${e.error.line})`);
  ok(e.ws.get('x') > 1000, 'variables of a stopped run are kept in the workspace');
  const f = await runCraft('try\n while true, end\ncatch\n x = 1;\nend', { budget: 1e5 });
  ok(!f.ok && f.error.stopped, 'try/catch cannot swallow a Stop');
  const g = await runCraft("assert(1 == 2, 'one is not %d', 2)");
  ok(!g.ok && g.error.message === 'one is not 2', 'assert message');
  const h = await runCraft("x = 3; y = x.field;");
  ok(!h.ok && /Only structs have fields/.test(h.error.message), 'field of a number');
  const i = await runCraft("s.a = 1; y = s.b;");
  ok(!i.ok && /no field "b".*fields: a/.test(i.error.message), 'missing field lists the fields');
  const j = await runCraft('x = sqrt(-1) + (-8)^(1/3);');
  ok(!j.ok && /complex/.test(j.error.message), 'complex results are refused with a reason');
  const k = await runCraft("eval('1+1')");
  ok(!k.ok && /eval is not supported/.test(k.error.message), 'eval refused clearly');
  // stop flag (Stop without killing the worker)
  if (typeof SharedArrayBuffer !== 'undefined') {
    // the page's Stop button sets the flag from another thread while the script runs: a worker thread plays the page
    const { Worker } = await import('node:worker_threads');
    const sab = new SharedArrayBuffer(8), flag = new Int32Array(sab, 0, 1), go = new Int32Array(sab, 4, 1);
    const rt = makeRuntime({ stopFlag: flag, budget: 1e13 });
    // zzGo() (called by the script once it runs) releases the helper thread, which sets the flag 150 ms later
    RT.registerBuiltin('zzGo', () => { Atomics.store(go, 0, 1); Atomics.notify(go, 0); return undefined; }, { doc: 'test: release the stop thread' });
    Atomics.store(go, 0, 0); Atomics.store(flag, 0, 0);
    const w2 = new Worker('const { workerData } = require("node:worker_threads"); const g = new Int32Array(workerData, 4, 1); Atomics.wait(g, 0, 0); const t = Date.now(); while (Date.now() - t < 150); Atomics.store(new Int32Array(workerData, 0, 1), 0, 1);', { eval: true, workerData: sab });
    const t1 = Date.now();
    const r2 = await rt.run('x = 0; zzGo(); while true, x = x + 1; end');
    await w2.terminate();
    ok(!r2.ok && r2.error.stopped === true && /^Stopped\.$/.test(r2.error.message) && Date.now() - t1 < 5000 && rt.ws.get('x') > 0, `stopFlag set by another thread stops a run and keeps the workspace (${Date.now() - t1} ms)`);
  } else skip('SharedArrayBuffer not available');
}

/* ================================================================== builtins */
async function testBuiltins() {
  section('Core builtins (cs-lib-core.js)');
  const cases = [
    ['ans = sum([1 2; 3 4]);', { shape: [1, 2], data: [4, 6] }], ['ans = sum([1 2; 3 4], 2);', { shape: [2, 1], data: [3, 7] }], ["ans = sum(magic(4), 'all');", 136],
    ['ans = prod([1 2 3 4]);', 24], ['ans = mean([1 2 3 4]);', 2.5], ['ans = cumsum([1 2 3]);', { shape: [1, 3], data: [1, 3, 6] }],
    ['ans = max([1 5; 7 2]);', { shape: [1, 2], data: [7, 5] }], ['ans = max([1 5; 7 2], [], 2);', { shape: [2, 1], data: [5, 7] }], ['ans = max(3, [1 5]);', { shape: [1, 2], data: [3, 5] }],
    ['ans = min([4 NaN 2]);', 2], ['ans = any([0 0 1]);', true], ['ans = all([1 1 0]);', false], ['ans = numel(zeros(3, 4));', 12],
    ['ans = size(zeros(3, 4, 2));', { shape: [1, 3], data: [3, 4, 2] }], ['ans = size(zeros(3, 4), 2);', 4], ['ans = length(zeros(3, 7));', 7],
    ['ans = isempty([]);', true], ['ans = zeros(2, 3);', { shape: [2, 3], data: [0, 0, 0, 0, 0, 0] }], ['ans = ones(2, 1) * 3;', { shape: [2, 1], data: [3, 3] }],
    ['ans = eye(2);', { shape: [2, 2], data: [1, 0, 0, 1] }], ['ans = linspace(0, 1, 3);', { shape: [1, 3], data: [0, 0.5, 1] }],
    ['ans = repmat([1 2], 2, 2);', { shape: [2, 4], data: [1, 1, 2, 2, 1, 1, 2, 2] }], ['ans = kron([1 2], [1; 1]);', { shape: [2, 2], data: [1, 1, 2, 2] }],
    ['ans = reshape(1:6, 2, 3);', { shape: [2, 3], data: [1, 2, 3, 4, 5, 6] }], ['ans = reshape(1:6, [], 2);', { shape: [3, 2], data: [1, 2, 3, 4, 5, 6] }],
    ['ans = magic(3);', { shape: [3, 3], data: [8, 3, 4, 1, 5, 9, 6, 7, 2] }], ['ans = sum(magic(6)) - sum(magic(6), 2)\';', { shape: [1, 6], data: [0, 0, 0, 0, 0, 0] }],
    ['ans = sort([3 1 2], \'descend\');', { shape: [1, 3], data: [3, 2, 1] }], ['[s, i] = sort([3 1 2]); ans = i;', { shape: [1, 3], data: [2, 3, 1] }],
    ['ans = unique([3 1 3 2]);', { shape: [1, 3], data: [1, 2, 3] }], ['ans = union([1 3], [2 3]);', { shape: [1, 3], data: [1, 2, 3] }],
    ['ans = setdiff(1:5, [2 4]);', { shape: [1, 3], data: [1, 3, 5] }], ['ans = intersect([1 2 3], [2 3 4]);', { shape: [1, 2], data: [2, 3] }],
    ['ans = ismember([1 5], [5 6]);', { shape: [1, 2], data: [false, true] }], ['ans = find([0 3 0 4]);', { shape: [1, 2], data: [2, 4] }],
    ['[r, c] = find([0 1; 1 0]); ans = [r c];', { shape: [2, 2], data: [2, 1, 1, 2] }], ['ans = mod(-1, 3);', 2], ['ans = rem(-1, 3);', -1],
    ['ans = round(-2.5);', -3], ['ans = round(2.345, 2);', 2.35], ['ans = fix(-2.7);', -2], ['ans = abs([-1 2]);', { shape: [1, 2], data: [1, 2] }],
    ['ans = floor(log10(12345));', 4], ['ans = atan2(1, 1) * 4;', Math.PI], ['ans = hypot(3, 4);', 5], ['ans = sqrt(16);', 4],
    ['ans = isnan([1 NaN]);', { shape: [1, 2], data: [false, true] }], ['ans = isequal([1 2], [1 2]);', true], ['ans = isequal(struct(\'a\', 1), struct(\'a\', 2));', false],
    ['ans = accumarray([1; 2; 1], [10; 20; 30]);', { shape: [2, 1], data: [40, 20] }], ['ans = interp1([0 1 2], [0 10 20], 1.5);', 15],
    ['p = polyfit([0 1 2], [1 3 5], 1); ans = round(p * 1e9) / 1e9;', { shape: [1, 2], data: [2, 1] }], ['ans = polyval([1 0 -1], 3);', 8],
    ['ans = diff([1 4 9 16]);', { shape: [1, 3], data: [3, 5, 7] }], ['ans = trapz([0 1 2], [0 1 4]);', 3], ['ans = dot([1 2 3], [4 5 6]);', 32],
    ['ans = cross([1 0 0], [0 1 0]);', { shape: [1, 3], data: [0, 0, 1] }], ['ans = diag([1 2]);', { shape: [2, 2], data: [1, 0, 0, 2] }], ['ans = diag(magic(3))\';', { shape: [1, 3], data: [8, 5, 2] }],
    ['ans = triu(ones(3)) - tril(ones(3));', { shape: [3, 3], data: [0, -1, -1, 1, 0, -1, 1, 1, 0] }], ['ans = fliplr([1 2 3]);', { shape: [1, 3], data: [3, 2, 1] }],
    ['ans = circshift([1 2 3 4], 1);', { shape: [1, 4], data: [4, 1, 2, 3] }], ['[X, Y] = meshgrid(1:2, 1:3); ans = X + 10 * Y;', { shape: [3, 2], data: [11, 21, 31, 12, 22, 32] }],
    ['ans = sub2ind([3 4], 2, 3);', 8], ['[r, c] = ind2sub([3 4], 8); ans = [r c];', { shape: [1, 2], data: [2, 3] }], ['ans = permute(reshape(1:6, 1, 2, 3), [3 2 1]);', { shape: [3, 2], data: [1, 3, 5, 2, 4, 6] }],
    ['ans = cat(3, [1], [2]);', { shape: [1, 1, 2], data: [1, 2] }], ['ans = nchoosek(5, 2);', 10], ['ans = factorial(5);', 120], ['ans = gamma(0.5)^2;', Math.PI],
    ["ans = sprintf('%5.2f|%d|%s|%e', pi, 42, 'ok', 12345.678);", ' 3.14|42|ok|1.234568e+04'], ["ans = sprintf('%d,', [1 2 3]);", '1,2,3,'],
    ["ans = sprintf('%g %g %g', 0.0001, 100000, 1e6);", '0.0001 100000 1e+06'], ["ans = sprintf('%-4s|%04d|%+d', 'a', 7, 3);", 'a   |0007|+3'],
    ["ans = sprintf('%d', 1.5);", '1.500000e+00'], ["ans = sprintf('a\\tb\\n');", 'a\tb\n'], ["ans = sprintf('%x %o %c %%', 255, 8, 65);", 'ff 10 A %'],
    ["ans = num2str(pi);", '3.1416'], ["ans = num2str(123.456);", '123.456'], ["ans = num2str(42);", '42'], ["ans = num2str([1 2 3]);", '1  2  3'], ["ans = num2str(pi, 8);", '3.1415927'],
    ["ans = mat2str([1 2; 3 4.5]);", '[1 2;3 4.5]'], ["ans = int2str(2.7);", '3'], ["ans = str2double('2.5e3');", 2500], ["ans = isnan(str2double('x'));", true],
    ["c = strsplit('a,b,c', ','); ans = strjoin(c, '-');", 'a-b-c'], ["ans = strrep('aXbX', 'X', 'y');", 'ayby'], ["ans = upper('abc');", 'ABC'], ["ans = strtrim('  hi ');", 'hi'],
    ["ans = strcmp('a', 'a') + strcmpi('A', 'a');", 2], ["ans = strcmp({'a', 'b'}, 'b');", { shape: [1, 2], data: [false, true] }], ["ans = regexprep('a1b22', '(\\d+)', '<$1>');", 'a<1>b<22>'],
    ["ans = strcat('a ', 'b');", 'ab'], ["ans = contains('hello', 'ell');", true], ["ans = strfind('abcabc', 'bc');", { shape: [1, 2], data: [2, 5] }],
    ["ans = class(1);", 'double'], ["ans = class(true);", 'logical'], ["ans = class('a');", 'char'], ["ans = class({});", 'cell'], ["ans = class(@sin);", 'function_handle'],
    ["ans = isa(1, 'numeric');", true], ["s = struct('a', 1, 'b', 'x'); ans = isfield(s, 'b');", true], ["s = rmfield(struct('a', 1, 'b', 2), 'a'); ans = fieldnames(s);", { cell: ['b'], shape: [1, 1] }],
    ["c = num2cell([1 2]); ans = c{2};", 2], ["ans = cell2mat({[1 2], [3]; [4 5], [6]});", { shape: [2, 3], data: [1, 4, 2, 5, 3, 6] }], ['[a, b] = deal(7); ans = a + b;', 14],
    ['rng(3); a = rand(1, 3); rng(3); b = rand(1, 3); ans = isequal(a, b);', true], ['rng(1); r = randn(1, 2000); ans = abs(mean(r)) < 0.1 && abs(std(r) - 1) < 0.1;', true],
    ['ans = median([3 1 4 1 5]);', 3], ['ans = var([1 2 3 4]);', 5 / 3], ['ans = std([2 4 4 4 5 5 7 9], 1);', 2], ['ans = logical([2 0]);', { shape: [1, 2], data: [true, false] }],
    ['ans = xor(true, false);', true], ['ans = int32(2.6);', 3], ['ans = double(\'A\');', 65], ['ans = char([72 105]);', 'Hi'], ['ans = Inf > 1e308;', true],
    ["x = 1; ans = exist('x');", 1], ['ans = eps;', Number.EPSILON], ['ans = pi;', Math.PI], ["ans = nnz([1 0 2]);", 2],
  ];
  for (const [src, want] of cases) {
    const got = await val(src);
    const good = eq(got, want) || (typeof want === 'number' && typeof got === 'number' && rel(got, want, 1e-12));
    ok(good, `${src} → ${JSON.stringify(want)} (got ${JSON.stringify(got)})`);
  }
  const p = await runCraft("fprintf('%d-%d\\n', 1, 2); fprintf(1, 'x\\n'); disp([1 2]); disp('t'); warning('careful %d', 1);");
  ok(p.out === '1-2\nx\n   1   2\nt\nWarning: careful 1\n', `fprintf / disp / warning output (got ${JSON.stringify(p.out)})`);
  const d = await runCraft("plot(1:3, [1 4 9], 'title', 'squares'); imagesc(magic(3)); show(struct('a', 1)); clf; colormap(gray); axis equal; drawnow;");
  ok(d.ok && d.displays.length === 4 && d.displays[0].plot.y.data[2] === 9 && d.displays[0].plot.opts.title === 'squares', 'plot → { plot: { x, y, opts } }');
  ok(d.displays[1].image.shape.join() === '3,3' && d.displays[1].opts.scaled === true && d.displays[2].table && d.displays[3].clear === true, 'imagesc / show / clf display commands');
  const tt = await runCraft('tic; x = toc;');
  ok(tt.ok && tt.ws.get('x') >= 0, 'tic/toc');
}

/* ================================================================== runtime API */
async function testRuntime() {
  section('Runtime API (cs-runtime.js §3)');
  const R = RT;
  ok(throws(() => R.registerBuiltin('zeros', () => 0), /already registered/), 'duplicate builtin refused');
  ok(R.registerBuiltin('zzProv', () => 1, { provisional: true }) === true && R.registerBuiltin('zzProv', () => 2) === true, 'a provisional builtin is replaced by a real one');
  ok(R.registerBuiltin('zzProv', () => 3, { provisional: true }) === false, 'a provisional never replaces a real one');
  ok((await val('ans = zzProv();')) === 2, 'the real one runs');
  R.registerBuiltin('zzTwice', ([f, x], ctx) => ctx.invoke(f, [ctx.invoke(f, [x])]), { args: 'zzTwice(f, x)', doc: 'test' });
  ok((await val('ans = zzTwice(@(v) v * 3, 2);')) === 18, 'a builtin calls a script function through ctx.invoke');
  R.registerBuiltin('zzDemo', ([n]) => ({ t: 'demo', n: V.num(n) }), { doc: 'test type' });
  R.registerMethod('demo', 'plus', ([a, b]) => ({ t: 'demo', n: (a.t === 'demo' ? a.n : V.num(a)) + (b.t === 'demo' ? b.n : V.num(b)) }));
  R.registerMethod('demo', 'subsref', ([a, i]) => a.n * V.num(i));
  R.registerMethod('demo', 'numel', ([a]) => a.n);
  const m = await runCraft('d = zzDemo(2) + 3; e = d(10); f = numel(d); g = d.n;');
  ok(m.ok && m.ws.get('d').n === 5 && m.ws.get('e') === 50 && m.ws.get('f') === 5 && m.ws.get('g') === 5, 'registerMethod: operators, ( ) and builtins dispatch on a value type; .field reads plain fields');
  // a stand-in language through registerLanguage
  R.registerLanguage({ id: 'rev', name: 'Reverse test', ext: ['.rev'], load: async () => ({ highlight: { keywords: [] }, async run(src, { ws, call, ctx }) { ws.set('out', call('upper', [src.split('').reverse().join('')])); ctx.print('ran\n'); return { ok: true, vars: ['out'] }; } }) });
  const lr = makeRuntime({});
  const r1 = await lr.run('abc', { lang: 'rev' });
  const r2 = await lr.run("y = [out '!'];", { file: 'x.craft' });
  ok(r1.ok && r2.ok && lr.ws.get('y') === 'CBA!', 'a second language shares the workspace and the builtins');
  ok(R.languageForFile('a.rev') === 'rev' && R.languageForFile('b.craft') === 'craft' && R.languageForFile('c.m') === 'craft', 'languageForFile');
  // workspace across runs + clear
  const w = makeRuntime({});
  await w.run('a = 1; b = 2;');
  await w.run('c = a + b; clear a');
  ok(!w.ws.has('a') && w.ws.get('c') === 3, 'workspace persists; clear removes');
  await w.run('clear');
  ok(w.ws.names().length === 0, 'clear all');
  const lst = makeRuntime({}); await lst.run('M = [1 5; -2 3];');
  const li = lst.ws.list()[0];
  ok(li.name === 'M' && li.type === 'tensor' && li.min === -2 && li.max === 5 && eq(li.size, [2, 2]), 'ws.list() for the Variables panel');
  ok(R.builtinList().length > 250 && R.builtinList().every((b) => b.name && typeof b.doc === 'string'), `builtin registry (${R.builtinList().length} builtins)`);
  const mods = new Set(R.builtinList().map((b) => b.module));
  ok(mods.has('core') && mods.has('linalg') && mods.has('mesh') && mods.has('io'), `modules registered: ${[...mods].join(', ')}`);
  const unk = await makeRuntime({}).run('x = 1', { lang: 'cobol' });
  ok(!unk.ok && /no "cobol" language/.test(unk.error.message), 'unknown language');
  const ck = (await import(DEVURL + 'cs-lang-craft.js')).check('x = [1 2');
  ok(!ck.ok && ck.error.line === 1, 'check() for the editor');
  const hl = (await import(DEVURL + 'cs-lang-craft.js')).adapter.highlight;
  ok(hl.keywords.includes('function') && hl.comment[0] === '%', 'highlight grammar');
}

/* ================================================================== worker ops */
async function testWorker() {
  section('Worker ops (cs-worker.js)');
  await import(DEVURL + 'cs-worker.js');
  const { OPS } = await import(DEVURL + 'worker-ops.js');
  const msgs = [];
  const ctx = { progress: (m) => msgs.push(m), transfer() {} };
  await OPS.csWorkspace({ op: 'clear' });
  const r = await OPS.csRun({ source: 'a = helper(4)\nplot(1:3, 1:3)', files: [{ name: 'helper.craft', lang: 'craft', text: 'function y = helper(x)\ny = x * 10;\nend' }] }, ctx);
  ok(r.ok && msgs.some((m) => m.print === 'a = 40\n') && msgs.some((m) => m.display && m.display.plot), 'csRun streams print and display; user scripts act as library functions');
  ok(structuredClone(msgs).length === msgs.length, 'progress messages are structured-clonable');
  const r2 = await OPS.csRun({ source: 'b = a + 1;' }, ctx);
  ok(r2.ok && (await OPS.csWorkspace({ op: 'get', name: 'b' })) === 41, 'the workspace persists between csRun calls');
  const r3 = await OPS.csRun({ source: 'while true, end', budget: 2e5 }, ctx);
  ok(!r3.ok && r3.error.stopped, 'budget from csRun');
  const list = await OPS.csWorkspace({ op: 'list' });
  ok(list.length === 2 && list.find((x) => x.name === 'a').type === 'number', 'csWorkspace list');
  const snap = await OPS.csWorkspace({ op: 'snapshot' });
  await OPS.csWorkspace({ op: 'clear' });
  await OPS.csWorkspace({ op: 'load', vars: { ...structuredClone(snap), 'bad name': 1 } });
  ok((await OPS.csWorkspace({ op: 'get', name: 'a' })) === 40 && !(await OPS.csWorkspace({ op: 'list' })).some((x) => x.name === 'bad name'), 'snapshot → load round trip; bad names dropped');
  await OPS.csWorkspace({ op: 'set', name: 'M', value: { t: 'tensor', shape: [1, 2], data: [3, 4] } });
  ok((await OPS.csRun({ source: 'n = sum(M);' }, ctx)).ok && (await OPS.csWorkspace({ op: 'get', name: 'n' })) === 7, 'csWorkspace set (untrusted value checked)');
  const info = await OPS.csInfo({});
  ok(info.stub === false && info.languages.some((l) => l.id === 'craft' && l.highlight) && info.builtins.length > 250, 'csInfo');
  const saved = await OPS.csSaveFile({ names: ['M'], format: 'json' });
  ok(saved.fileName === 'M.json' && saved.bytes.length > 10, 'csSaveFile json');
  const loaded = await OPS.csLoadFile({ name: 'L', fileName: 'M.json', bytes: saved.bytes });
  ok(loaded.name === 'L' && loaded.type === 'struct', 'csLoadFile');
  const chk = await OPS.csCheck({ source: 'for i = 1:3\n' });
  ok(!chk.ok && /missing its "end"/.test(chk.error.message), 'csCheck');
  RT.IO.setIoHost(null);   // importing cs-worker.js set the io host to its in-memory store: back to Node's file system
}

/* ================================================================== performance */
async function testPerformance() {
  section('Performance');
  let t0 = Date.now();
  const a = await runCraft('s = 0; for i = 1:1000000, s = s + i * 0.5; end');
  const loopMs = Date.now() - t0;
  ok(a.ok && a.ws.get('s') === 250000250000 && loopMs < 4000, `1e6 scalar loop iterations: ${loopMs} ms`);
  t0 = Date.now();
  const b = await runCraft('n = 200000; v = zeros(n, 1); for i = 1:n, v(i) = i; end; s = sum(v);');
  const fillMs = Date.now() - t0;
  ok(b.ok && b.ws.get('s') === 200000 * 200001 / 2 && fillMs < 3000, `v(i) = i in place, 2e5 times: ${fillMs} ms`);
  t0 = Date.now();
  const c = await runCraft('A = rand(400); B = rand(400); C = A * B + A .* B; s = sum(C(:));');
  ok(c.ok && Date.now() - t0 < 3000, `400×400 matmul + elementwise: ${Date.now() - t0} ms`);
  t0 = Date.now();
  const d = await runCraft('x = rand(2e6, 1); y = sqrt(x) .* 2 + x.^2 - max(0.5, x); s = sum(y);');
  ok(d.ok && Date.now() - t0 < 3000, `elementwise on 2e6 elements: ${Date.now() - t0} ms`);
}

/* ================================================================== CLI */
async function testCli() {
  section('CLI: partcraft run');
  const cli = path.join(REPO, 'tools/partcraft-cli/partcraft.mjs');
  const dir = path.join(TMP, 'cli');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.craft'), "x = twice(21);\nfprintf('x is %d\\n', x);\nplot(1:3, [2 4 6]);\n");
  fs.writeFileSync(path.join(dir, 'twice.craft'), 'function y = twice(v)\ny = 2 * v;\nend\n');
  fs.writeFileSync(path.join(dir, 'data.csv'), '1,2\n3,4\n');
  let r = spawnSync('node', [cli, 'run', path.join(dir, 'main.craft'), '--load', `D=${path.join(dir, 'data.csv')}`, '--save-ws', path.join(dir, 'ws.json')], { encoding: 'utf8', cwd: dir });
  ok(r.status === 0 && /x is 42/.test(r.stdout) && /1 × plot/.test(r.stdout) && fs.existsSync(path.join(dir, 'ws.json')), `run: output, display summary, --load, --save-ws (exit ${r.status}${r.stderr ? ': ' + r.stderr.trim() : ''})`);
  const saved = fs.existsSync(path.join(dir, 'ws.json')) ? fs.readFileSync(path.join(dir, 'ws.json'), 'utf8') : '';
  ok(/"x"/.test(saved) && /"D"/.test(saved), 'saved workspace has the script\'s and the loaded variables');
  fs.writeFileSync(path.join(dir, 'bad.craft'), 'a = 1;\nb = a(3);\n');
  r = spawnSync('node', [cli, 'run', path.join(dir, 'bad.craft')], { encoding: 'utf8' });
  ok(r.status === 1 && /bad\.craft:2:\d+: error: Index 3 is past the end \(1 element\)\./.test(r.stderr), `error → file:line:col and exit 1 (${r.stderr.trim()})`);
  r = spawnSync('node', [cli, 'run', path.join(dir, 'main.craft'), '--json'], { encoding: 'utf8', cwd: dir });
  let j = null; try { j = JSON.parse(r.stdout); } catch { /* not JSON */ }
  ok(j && j.ok === true && /x is 42/.test(j.output) && j.workspace.some((v) => v.name === 'x'), '--json');
  r = spawnSync('node', [cli, 'run'], { encoding: 'utf8' });
  ok(r.status === 2, 'run without a file is a usage error');
}

/* ================================================================== top88 (acceptance) */
async function testTop88() {
  section('top88 — MBB beam 60×20 (acceptance; Andreassen et al. 2011)');
  const src = fs.readFileSync(path.join(FIX, 'top88.craft'), 'utf8');
  const library = (n) => (n === 'top88' ? { source: src, file: 'top88.craft' } : null);
  for (const ft of [1, 2]) {
    const t0 = Date.now();
    const r = await runCraft(`top88(60,20,0.5,3,1.5,${ft});`, { library });
    const ms = Date.now() - t0;
    if (!ok(r.ok, `ft=${ft} runs${r.ok ? '' : ': ' + r.error.message + ' (line ' + r.error.line + ')'}`)) continue;
    const its = [...r.out.matchAll(/It\.:\s*(\d+) Obj\.:\s*([\d.]+) Vol\.:\s*([\d.]+) ch\.:\s*([\d.]+)/g)].map((m) => ({ it: +m[1], c: +m[2], vol: +m[3], ch: +m[4] }));
    const last = its[its.length - 1];
    const ref = top88Reference(60, 20, 0.5, 3, 1.5, ft);
    console.log(`  ft=${ft}: ${its.length} iterations, c = ${last.c.toFixed(4)}, volume ${last.vol.toFixed(3)}, ${(ms / 1000).toFixed(2)} s (reference: ${ref.length} iterations, c = ${ref[ref.length - 1].c.toFixed(4)})`);
    ok(its.length > 20 && its.every((x, i) => x.it === i + 1), `ft=${ft}: one line per iteration`);
    ok(last.ch <= 0.01 && Math.abs(last.vol - 0.5) < 0.001, `ft=${ft}: stops at change ≤ 0.01 with volume fraction 0.5`);
    ok(its.length === ref.length, `ft=${ft}: same iteration count as the independent JS reference (${its.length} vs ${ref.length})`);
    const n = Math.min(its.length, ref.length);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(its[i].c - ref[i].c) / ref[i].c);
    ok(worst < 1e-6, `ft=${ft}: compliance matches the reference at every iteration (worst ${worst.toExponential(2)}, printed to 4 decimals)`);
    ok(ft === 1 ? last.c > 195 && last.c < 212 : last.c > 205 && last.c < 230, `ft=${ft}: final compliance in the published range (MBB 60×20, c ≈ ${ft === 1 ? '203' : '219'})`);
    ok(r.displays.length === its.length && r.displays.every((d) => d.image && d.image.shape.join() === '20,60'), `ft=${ft}: imagesc(1-xPhys) each iteration (20×60)`);
    ok(ms < 15000, `ft=${ft}: time ${(ms / 1000).toFixed(2)} s`);
  }
}

/**
 * top88 in plain JavaScript (the same algorithm, written independently of CraftScript and cs-lib-linalg.js): banded
 * Cholesky on the free dofs (natural numbering, half bandwidth 2·nely + 5). Returns [{ it, c, change }].
 */
function top88Reference(nelx, nely, volfrac, penal, rmin, ft) {
  const E0 = 1, Emin = 1e-9, nu = 0.3;
  const A11 = [[12, 3, -6, -3], [3, 12, 3, 0], [-6, 3, 12, -3], [-3, 0, -3, 12]];
  const A12 = [[-6, -3, 0, 3], [-3, -6, -3, -6], [0, -3, -6, 3], [3, -6, 3, -6]];
  const B11 = [[-4, 3, -2, 9], [3, -4, -9, 4], [-2, -9, -4, -3], [9, 4, -3, -4]];
  const B12 = [[2, -3, 4, -9], [-3, 2, 9, -2], [4, 9, 2, 3], [-9, -2, 3, 2]];
  const KE = [...Array(8)].map(() => new Array(8).fill(0));
  const blk = (M, i, j, tr) => (tr ? M[j][i] : M[i][j]);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const bi = i >> 2, bj = j >> 2, ii = i & 3, jj = j & 3;
    const A = bi === bj ? blk(A11, ii, jj) : bi === 0 ? blk(A12, ii, jj) : blk(A12, ii, jj, true);
    const B = bi === bj ? blk(B11, ii, jj) : bi === 0 ? blk(B12, ii, jj) : blk(B12, ii, jj, true);
    KE[i][j] = 1 / (1 - nu * nu) / 24 * (A + nu * B);
  }
  const ne = nelx * nely, ndof = 2 * (nelx + 1) * (nely + 1);
  const edof = [];
  for (let ex = 0; ex < nelx; ex++) for (let ey = 0; ey < nely; ey++) {
    const n1 = ex * (nely + 1) + ey + 1;          // 1-based node number (column-major)
    const v = 2 * n1 + 1;
    edof.push([0, 1, 2 * nely + 2, 2 * nely + 3, 2 * nely, 2 * nely + 1, -2, -1].map((o) => v + o - 1));   // 0-based dofs
  }
  const fixed = new Set(); for (let d = 1; d <= 2 * (nely + 1); d += 2) fixed.add(d - 1); fixed.add(ndof - 1);
  const free = [], fmap = new Int32Array(ndof).fill(-1);
  for (let d = 0; d < ndof; d++) if (!fixed.has(d)) { fmap[d] = free.length; free.push(d); }
  const nf = free.length, bw = 2 * nely + 6;
  // filter
  const Hrows = [], Hs = new Float64Array(ne), R = Math.ceil(rmin) - 1;
  for (let i1 = 0; i1 < nelx; i1++) for (let j1 = 0; j1 < nely; j1++) {
    const e1 = i1 * nely + j1, row = [];
    for (let i2 = Math.max(i1 - R, 0); i2 <= Math.min(i1 + R, nelx - 1); i2++) for (let j2 = Math.max(j1 - R, 0); j2 <= Math.min(j1 + R, nely - 1); j2++) {
      const w = Math.max(0, rmin - Math.hypot(i1 - i2, j1 - j2));
      if (w > 0) row.push([i2 * nely + j2, w]);
    }
    Hrows[e1] = row; Hs[e1] = row.reduce((s, [, w]) => s + w, 0);
  }
  const Hmul = (v) => { const o = new Float64Array(ne); for (let e = 0; e < ne; e++) { let s = 0; for (const [k, w] of Hrows[e]) s += w * v[k]; o[e] = s; } return o; };
  let x = new Float64Array(ne).fill(volfrac), xPhys = x.slice();
  const out = [];
  let change = 1, loop = 0;
  while (change > 0.01) {
    loop++;
    // assemble banded lower storage L[i][k] = K(i, i-k), k = 0..bw-1, over free dofs
    const Kb = new Float64Array(nf * bw);
    for (let e = 0; e < ne; e++) {
      const s = Emin + xPhys[e] ** penal * (E0 - Emin), d = edof[e];
      for (let a = 0; a < 8; a++) { const fa = fmap[d[a]]; if (fa < 0) continue; for (let b = 0; b < 8; b++) { const fb = fmap[d[b]]; if (fb < 0 || fb > fa) continue; Kb[fa * bw + (fa - fb)] += s * KE[a][b]; } }
    }
    // banded Cholesky in place: L(i, j) stored at i*bw + (i-j)
    for (let i = 0; i < nf; i++) {
      for (let j = Math.max(0, i - bw + 1); j <= i; j++) {
        let sum = Kb[i * bw + (i - j)];
        for (let k = Math.max(0, i - bw + 1, j - bw + 1); k < j; k++) sum -= Kb[i * bw + (i - k)] * Kb[j * bw + (j - k)];
        if (i === j) Kb[i * bw] = Math.sqrt(sum); else Kb[i * bw + (i - j)] = sum / Kb[j * bw];
      }
    }
    const f = new Float64Array(nf); f[fmap[1]] = -1;
    for (let i = 0; i < nf; i++) { let s = f[i]; for (let k = Math.max(0, i - bw + 1); k < i; k++) s -= Kb[i * bw + (i - k)] * f[k]; f[i] = s / Kb[i * bw]; }
    for (let i = nf - 1; i >= 0; i--) { let s = f[i]; for (let k = i + 1; k < Math.min(nf, i + bw); k++) s -= Kb[k * bw + (k - i)] * f[k]; f[i] = s / Kb[i * bw]; }
    const U = new Float64Array(ndof); for (let i = 0; i < nf; i++) U[free[i]] = f[i];
    const ce = new Float64Array(ne);
    for (let e = 0; e < ne; e++) { const d = edof[e]; let s = 0; for (let a = 0; a < 8; a++) { let t = 0; for (let b = 0; b < 8; b++) t += KE[a][b] * U[d[b]]; s += t * U[d[a]]; } ce[e] = s; }
    let c = 0; const dc = new Float64Array(ne); let dv = new Float64Array(ne).fill(1);
    for (let e = 0; e < ne; e++) { c += (Emin + xPhys[e] ** penal * (E0 - Emin)) * ce[e]; dc[e] = -penal * (E0 - Emin) * xPhys[e] ** (penal - 1) * ce[e]; }
    let dcf = dc;
    if (ft === 1) { const t = new Float64Array(ne); for (let e = 0; e < ne; e++) t[e] = x[e] * dc[e]; const h = Hmul(t); dcf = new Float64Array(ne); for (let e = 0; e < ne; e++) dcf[e] = h[e] / Hs[e] / Math.max(1e-3, x[e]); }
    else { const t = new Float64Array(ne), u = new Float64Array(ne); for (let e = 0; e < ne; e++) { t[e] = dc[e] / Hs[e]; u[e] = dv[e] / Hs[e]; } dcf = Hmul(t); dv = Hmul(u); }
    let l1 = 0, l2 = 1e9; const move = 0.2; let xnew = new Float64Array(ne);
    while ((l2 - l1) / (l1 + l2) > 1e-3) {
      const lmid = 0.5 * (l2 + l1);
      for (let e = 0; e < ne; e++) xnew[e] = Math.max(0, Math.max(x[e] - move, Math.min(1, Math.min(x[e] + move, x[e] * Math.sqrt(-dcf[e] / dv[e] / lmid)))));
      if (ft === 1) xPhys = xnew.slice(); else { const h = Hmul(xnew); xPhys = new Float64Array(ne); for (let e = 0; e < ne; e++) xPhys[e] = h[e] / Hs[e]; }
      let sum = 0; for (let e = 0; e < ne; e++) sum += xPhys[e];
      if (sum > volfrac * ne) l1 = lmid; else l2 = lmid;
    }
    change = 0; for (let e = 0; e < ne; e++) change = Math.max(change, Math.abs(xnew[e] - x[e]));
    x = xnew;
    out.push({ it: loop, c, change });
    if (loop > 2000) break;
  }
  return out;
}
