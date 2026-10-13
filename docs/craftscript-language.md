# How to add a CraftScript language

PartCraft's Script workspace runs CraftScript (its own MATLAB-like language) and Lua 5.4 on one shared runtime: one
workspace of values, one registry of builtins (linear algebra, meshes, solvers, files), one editor. A new language is
**one adapter file plus one import line**; the worker, the command-line runner, the workspace, every builtin and the
editor's language picker see it without other changes.

## 1. The adapter file: `app/cs-lang-<id>.js`

```js
import { registerLanguage } from './cs-runtime.js';

registerLanguage({
  id: 'pas', name: 'Pascal Script', ext: ['.pas'],
  load: async () => { await loadEngine(); return adapter; },   // load the interpreter lazily, here
});

const adapter = {
  id: 'pas',
  highlight: { keywords: [...], comment: [...], string: [...], number: /…/, constants: [...] },   // for the editor
  async run(source, { ws, call, ctx }) { /* … */ return { ok: true, vars: ['x', 'y'] }; },
  check(source, file) { /* optional: syntax only */ return { ok: true }; },
};
```

- **The interpreter** is a vendored library: a versioned folder `assets/vendor/<lib>/<version>/` with its LICENSE and
  SOURCE.txt, loaded from the same origin through `cs-lib-io.js` (`VENDOR` / `vendorUrl`) — never a CDN default. Its
  license must be permissive (see `CONTRIBUTING.md`).
- **`run(source, { ws, call, ctx })`** returns `{ ok, error?: { message, line, col, stopped? }, vars }` and never throws
  for a script error:
  - parse first; a syntax error is `{ ok: false, error: { message, line, col } }`;
  - seed the language's globals from the workspace (`ws.get`, `ws.names`) if it has globals, and at the end write every
    variable the script set back with `ws.set`; list them in `vars`;
  - call builtins with `call(name, args, nargout)` (one value, or an array when `nargout > 1`); call function values with
    `ctx.invoke(func, args, nargout)`; give your own callables a `[CALL]` property (from `cs-values.js`) so builtins
    such as `cellfun` or an ODE solver can call them back;
  - library functions come from `ctx.library(name)`, which returns `{ source, file, lang }`; use only those in your language;
  - output goes through `ctx.print(text)` and `ctx.display(cmd)`.
- **Values** cross the boundary as CraftScript values (`cs-values.js`): convert your numbers, arrays and records to
  tensors, structs and cells and back. Copy the Lua binding's rules (`cs-lang-lua.js`, `toLua` / `fromLua`): a 1×1 tensor
  becomes a plain number; anything else becomes an opaque handle whose indexing and arithmetic call `cs-tensor.js` or
  `call('plus', …)`, so sparse matrices and other types keep their own methods.
- **Budget and Stop.** Call `ctx.check(n)` from the interpreter's own hook at least every few thousand steps (Lua: a count
  hook every 1000 instructions). A Stop or an exhausted budget raises a `StopError`: make it end the run even inside the
  language's own try/catch, and never swallow it.
- **Sandbox.** No file, network or module loading inside the language: files go through the `load` / `save` builtins.

## 2. One import line

Add `import './cs-lang-<id>.js';` to `app/cs-all.js`, next to the Lua line. Do not write single-quoted `'./x.js'` text in
comments of worker-linked files: the worker linker reads it as an import.

## 3. Tests

Add parity programs — the same program giving the same values in every language — and a budget-stop case to
`tests/tools/partcraft-test/test-craftscript-b.mjs`'s list, then `npm test -- --only test-craftscript.mjs`. The command-line
runner runs a file in any registered language:

```sh
node tests/tools/partcraft-cli/partcraft.mjs run my-script.<ext>
```
