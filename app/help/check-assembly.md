---
title: Check an assembly for clashes and motion
summary: Find parts that overlap with Clash, drag any joint's values to watch the motion, and sweep a joint through its range to find where parts collide.
section: tasks
order: 120
keywords: interference, interference detection, clash, collision, overlap, motion, motion study, sweep, range of motion, check
---

Two checks run on the parts as they are placed: **Clash** looks for overlapping material right now, and the **motion check** moves one joint through its range and looks for overlaps along the way.

## Check for interference

1. Open or build an assembly (see [Build an assembly](topic:build-assembly)).
2. Choose {{ui:Clash}}.

The status bar reports the result:

- "No interference between 3 parts (40 ms)." Nothing overlaps.
- "Interference: Flange1 and Flange2 overlap by 2.5 mm³." Each overlapping pair, with the volume of the overlap.

The **Assembly** box on the left shows **Interference**: "None", "1 pair overlap", or "Not checked". With nothing selected, the right panel lists each overlapping pair and its volume.

The result is cleared whenever the assembly changes. Run {{ui:Clash}} again after moving a joint.

Touching faces (parts face to face) are not a clash; only shared volume is. Every pair of parts is checked against every other, so large assemblies take longer.

## Watch the motion

1. Select a joint that moves (any but rigid) in the list on the left.
2. Drag the slider under one of its values, such as **Angle (°)** or **Offset (mm)**. The part moves as you drag.
3. Let go. The new position is kept and can be undone with {{key:Mod+Z}}.

You can also type an angle or offset in the box and press {{key:Enter}}.

## Sweep a joint for clashes

1. Select a joint that moves.
2. For a joint with several values (cylindrical, planar, ball, pin in slot), choose which one to sweep in **Check moves**.
3. Choose {{ui:Check the motion for clashes}}.

PartCraft moves that value through 25 positions in 24 equal steps, the others staying as they are: an angle from −180° to 180° (a tilt from −90° to 90°), a length from minus to plus the size of the biggest part. It reports:

- "No clash anywhere for Angle (°) from -180 to 180 (25 positions checked)."
- "6 of 25 positions clash, first at Angle (°) 45 (12.4 mm³)." The first position that clashes and the overlap there.

The button is grayed for rigid joints, which do not move. The sweep checks the positions only, not the path between them: a thin part could pass through another between two steps.

:::note
Contact and gravity are not built. Without limits the sweep covers the whole range; give the value **Limits** (see [Parts list, exploded views and moving parts](topic:assembly-bom-explode)) and the sweep covers only those, so a hinge that opens 90° is checked over 90°.
:::
