# Linear Programming Studio

This is a static 2D linear optimization app designed for GitHub Pages. Students can:

- add and edit linear constraints,
- enter slope and intercept form for line-based constraints,
- visualize the feasible polygon,
- define an objective function,
- drag the objective line parallel to itself to locate the optimum.

## Local use

Because the app is plain `HTML`, `CSS`, and `JavaScript`, you can open `index.html` directly in a browser or serve the folder with any static file server.

## Deploy to GitHub Pages

Your root site at `https://rhartlage.github.io/` is already publishing a tool-hub landing page, so the safest pattern is:

1. Publish this app in its own public repository, such as `linear-programming-studio`.
2. Enable GitHub Pages for that repository from the `main` branch and `/ (root)`.
3. Visit the deployed app at `https://rhartlage.github.io/linear-programming-studio/`.
4. Optionally add a card on the root hub repo `rhartlage.github.io` that links to the new app.

If you decide you want this app to replace the root homepage instead, move the files into the `rhartlage.github.io` repository root and publish from there.
