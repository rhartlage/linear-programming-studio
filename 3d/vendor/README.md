# Vendored browser dependencies

This directory keeps the 3D explorer self-contained under the public site's existing
same-origin content-security policy.

- `three.core.min.js`, `three.module.min.js`, and `OrbitControls.js`: Three.js r185 (`three@0.185.0`), MIT license.
- `javascript-lp-solver.mjs`: `javascript-lp-solver@1.0.3`, Unlicense.

`OrbitControls.js` has one local-path adaptation: its package import of `three` points to
`./three.module.min.js`. The corresponding license texts are stored alongside the files.
