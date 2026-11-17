# Where this mod comes from

`main.js`, `icons/` and `fonts/` are copied from the Excalidraw mod in
[VladTemp27/herdr-orca](https://github.com/VladTemp27/herdr-orca/tree/4e3c9ea921f2f5c8ef8ee09b4925adee31a9c799/mods/excalidraw)
at commit `4e3c9ea`. The mod is © 2026 coyaSONG, MIT (`LICENSE`); it bundles Excalidraw's `@excalidraw/math`,
`@excalidraw/common` and `@excalidraw/element` (MIT, `LICENSE-excalidraw.txt`) and the Excalifont font (OFL, `fonts/OFL.txt`).

Our changes are kept out of the copied bundle where we can: the theme (`theme.js`) and the agent handoff
(`handoff.js`) are our own files, called from a few lines in `main.js` marked `// herdr-mods:`.
