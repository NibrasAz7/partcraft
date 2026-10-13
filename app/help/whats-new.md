---
title: What's new in 0.4
summary: PartCraft 0.4 builds every part with the mesh kernel, keeps fillets, chamfers, shells and drafts on flat faces, and adds Python scripts, a better script editor, section views, drawing sheets with a title block, configurations, more joints, draft analysis, adaptive clearing and touch support.
section: start
order: 5
keywords: whats new, what's new, release notes, changelog, changes, 0.4, version, new features, mesh kernel, fillet, chamfer, shell, draft, python, script editor, find and replace, section view, title block, sheet size, revisions, hole table, configurations, design table, joints, draft analysis, zebra, curvature, adaptive clearing, touch, language, spanish, recover
---

This is what changed in PartCraft 0.4, compared with 0.3, the version Try runs now.

## The mesh kernel builds every part

PartCraft 0.4 builds every part with the mesh kernel, which runs in your browser. The exact kernel that 0.3 loaded is not part of this version. The status bar's chip says **Mesh kernel**. See [The mesh kernel](topic:solid-kernels).

- **Still there:** {{ui:Fillet}} and {{ui:Chamfer}} on straight edges between two flat faces, outside or inside corners; {{ui:Shell}} with an exact wall thickness, opening flat faces; {{ui:Draft}} on flat faces. Where two rounded edges meet, the rounds are mitred, not blended. See [Round, bevel and hollow with Fillet, Chamfer and Shell](topic:fillet-chamfer-shell).
- **Works as before:** Simulation, Flow, Generative design and Manufacture. The mesh kernel knows faces by name, so you pick faces for loads, supports, pockets and holes, and measure edges, circles and holes. Planes, cylinders, cones, spheres and tori keep their exact sizes. Drawings, section views on the sheet included, are drawn from the facets.
- **Not built yet:** sweeps, lofts and surfaces, several bodies, sheet metal, ribs, rounds on curved edges, shells that open curved faces, STEP import and exact STEP. Choosing one says "Not built yet". Parts that use them still open, and the features are kept when you save. See [What is not built yet](topic:not-built-yet).

## New

- **Python scripts.** The Script workspace runs Python as well as CraftScript and Lua, with the same variables and built-in functions. The first Python run in a visit loads Python itself (about 13 MB). See [Scripts in Python](topic:craftscript-python).
- **A better script editor.** Find and replace ({{key:Mod+F}}, {{key:Mod+H}}), folding of functions and blocks ({{key:Mod+Shift+[}}), and completions as you type. See [Write and run scripts](topic:craftscript).
- **Lua calls the analysis library.** `cs.static_tet(…)`, `cs.modal_tet(…)` and the rest of the library, plus the CraftScript functions in your part, work from Lua too. Errors point at the Lua line. See [Scripts in Lua](topic:craftscript-lua).
- **Plots side by side, saved as files.** {{ui:Side by side}} shows every plot at once, and each plot saves as PNG, SVG or CSV.
- **Section view.** {{ui:Views}} › {{ui:Section view}}, or {{key:X}}, cuts the part or every part of an assembly with a plane and fills the cut. Cut on the front, top or right plane or on a flat face you click, slide the plane, flip it. Only the view is cut. See [Look inside with a section view](topic:section-view).
- **Drawing sheets in every size, with a title block.** Choose A4 to A0 or ANSI A to E. Fill in the title, drawing number, company, drawn, checked and approved by, date, general tolerance and finish, and add revisions A, B, C. {{ui:Material}} in the Part panel prints in the title block and gives Measure its density. See [Make a drawing](topic:drawing-pdf).
- **Hole tables on drawings.** {{ui:Hole table}} lists every hole square to a view with a tag, its position and its size, on the sheet and in the PDF.
- **Configurations.** Save sizes of a part as named configurations in the part file and switch between them with one click; bring them in and out as a CSV design table. See [Configurations and design tables](topic:design-tables).
- **More joints.** {{ui:Cylindrical}}, {{ui:Planar}}, {{ui:Ball}} and {{ui:Pin in slot}} joints in assemblies, each value with its own limits. See [Build an assembly](topic:build-assembly).
- **Draft analysis.** {{ui:Views}} › {{ui:Draft analysis}} colours the part by draft angle against a pull direction: where it releases, where it needs more draft, and the share of each. See [Check draft for moulding and casting](topic:draft-analysis).
- **Zebra stripes and curvature on any part,** not only in Form, from {{ui:Views}}. See [Zebra stripes and curvature](topic:surface-analysis).
- **Adaptive clearing.** A Manufacture operation whose passes keep the cutter's engagement even. See [Make toolpaths and G-code](topic:manufacture).
- **STEP AP214 (faceted)** next to the AP242 one, under {{ui:Export}} › {{ui:STEP AP214 (faceted, mesh kernel)}}, for programs that read only AP214. See [Export for printing, STEP and DXF](topic:export-files).
- **Touch screens.** Touch keys (Add, Done, Esc) appear when you use a finger; hold a finger still to finish a line chain or add to a selection; points and lines are easier to hit; the drawing sheet pinches and pans. See [Trackpad, touch and small screens](topic:trackpad-and-touch).
- **Recover your work.** PartCraft keeps a recovery copy of the open part or assembly in your browser. After a crash or a closed tab it asks "Recover your work?". See [Recover unsaved work](common:recover).
- **Recent files.** The start screen lists parts you opened lately (Chrome and Edge); click one to open it again.
- **Your language.** Every word on screen comes from a language file, the view cube's too. {{ui:Settings}} › {{ui:General}} › {{ui:Language}} offers "Español (México)": a machine-made draft that nobody has reviewed yet. Help topics are still in English.
- **Find anything.** {{key:Mod+K}}, or {{ui:Find}} in the bar at the top, runs a tool, opens a setting or a help topic. See [Find a tool or setting](common:find-tools).
- **Add-ons in Settings.** {{ui:Settings}} › {{ui:General}} lists the app's add-ons, to switch each on or off. PartCraft comes with none yet.

## Improved

- **Automatic refinement for natural frequencies and buckling.** Tetrahedral modal and buckling studies offer {{ui:Refine automatically (adaptive)}} too, with a table and chart of the frequencies or load factors per pass. See [Check stress and deflection](topic:simulation).
- **Turbulent flow: better wall coupling.** Pipe friction now comes out 30 to 34 % high (it was up to 46 %), and the step's reattachment 21 to 39 % short (it was up to 54 %). It is still experimental: use it for flow patterns, not design numbers. See [Simulate fluid flow](topic:flow-simulation).
- **Runs on any web server.** Without the two headers that allow several threads, PartCraft solves on one thread and says so. [PartCraft settings](topic:settings) shows the two headers.
- **More panel windows.** Give each panel a window of its own (up to four), move panels between them, and resize a floating panel with a finger or a pen. See [Arrange the panels](common:arrange-panels).
- **Save for offline says how much it keeps** before you click. Python is not part of the saved copy yet.

## Fixed

- Undo in the script editor stopped working a few seconds after typing.
- Assigning into a sparse matrix in CraftScript (`K(r, c) = …`, `F(i) = v`) failed.
- The turbulence warning called the −1 % channel check friction; it is the mean speed.
- Opening a part file while an assembly was open kept the assembly on screen.

## Scripts you trust, and one license

:::warning
**Run only Python scripts you trust.** CraftScript and Lua scripts are sealed off; Python scripts are not. A Python script can do what a web page can, the network too. The console says so on the first Python run.
:::

Python runs on Pyodide, which is under the Mozilla Public License 2.0, with CPython under the PSF license. It ships unmodified in its own folder (`assets/vendor/pyodide/<version>/`). It is the one licensed exception to our rule that everything we ship is under Apache 2.0 or a permissive license. Its license texts are in THIRD_PARTY.md.

## Not in this version yet

- Made for 0.4 but waiting for an exact kernel: loft guide rails, Gordon surfaces tangent to planes and flat faces, sheet metal (base and edge flanges, flat patterns as DXF), ribs, and renaming or hiding bodies. Their help topics describe them as they will work.
- Python packages (numpy and others) and Python offline.
- Cloud saving and the desktop builds.
- [What is not built yet](topic:not-built-yet)
