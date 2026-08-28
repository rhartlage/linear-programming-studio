# Linear Programming Studio

This repository contains two static linear-optimization teaching apps designed for GitHub Pages and the public tools site.

The 2D explorer at the repository root lets students:

- add and edit linear constraints,
- enter slope and intercept form for line-based constraints,
- visualize the feasible polygon,
- define an objective function,
- drag the objective line parallel to itself to locate the optimum.

The separate 3D explorer in `3d/` adds a three-variable workflow. Students can edit constraint planes, rotate and pan around the feasible solid, compare maximize and minimize directions, distinguish point/edge/face optima, and snap the objective plane to a finite optimum.

## Local use

Because both apps use browser modules, serve the repository with any static file server. Open `/` for the 2D explorer and `/3d/` for the 3D explorer.

The 3D solver tests can be run from `3d/` with `npm test`, and `npm run check` validates its JavaScript syntax.

## Public site

The primary public URL is:

- `https://tools.benhartlage.com/linear-programming/`
- `https://tools.benhartlage.com/linear-programming-3d/`

The original GitHub Pages URL remains a compatibility entry point while the public-site migration is accepted.

## GitHub Pages compatibility

Your root site at `https://rhartlage.github.io/` is already publishing a tool-hub landing page, so the safest pattern is:

1. Publish this app in its own public repository, such as `linear-programming-studio`.
2. Enable GitHub Pages for that repository from the `main` branch and `/ (root)`.
3. Visit the compatibility deployment at `https://rhartlage.github.io/linear-programming-studio/`.
4. Keep its canonical URL pointed at the primary `tools.benhartlage.com` route.

If you decide you want this app to replace the root homepage instead, move the files into the `rhartlage.github.io` repository root and publish from there.
