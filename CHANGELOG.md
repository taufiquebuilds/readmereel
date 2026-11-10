# Changelog

## 0.2.0 - 2026-11-11

- A new scene library replaces the single template: `hook`, `title`, `ui`, `terminal`, `counter`, `compare`, `list` and `end`. A film has 5 to 8 scenes and runs 15 to 35 seconds, set by how much there is to read.
- `ui` scenes show the real product: a screenshot with the camera pushing in on up to 3 focus boxes, or a screen rebuilt as HTML from the repo's own templates, with `states` that flip rows and labels while the camera watches. Rebuilt screens are cleaned first: no scripts, iframes, forms, remote URLs or at-rules.
- Three styles: `midnight`, `paper` and `signal`, tinted by your `accent`.
- Five transitions (whip, zoom, flood, blur, carry), picked automatically and the same every time for the same story.
- Sound effects on by default (`"sfx": false` turns them off). They are bundled by HyperFrames and resolved at render time under the Pixabay licence; readmereel ships no audio. Music comes from your own file or from HeyGen (`"music": "heygen"`, when you are signed in). With neither, the film has effects only and says how to add music.
- A strict quality gate: any layout error blocks the render, and so does scene text that is too small or too low in contrast to read. Problems name the `story.json` field to fix.
- New outputs: `poster.png` and `contact.png` (one frame per scene, both sizes) next to the two MP4s and the GIF. The GIF is cut to 12 seconds if it would be over 8 MB.
- `story.json` is now version 2. Version 1 stories still render: they are converted to v2 on the fly and the file is not changed.
- SKILL.md is rewritten: how to choose scenes, real material only, measuring focus boxes, showing the shot list first, a render timeout of at least 15 minutes, and looking at `contact.png` before handing over.

## 0.1.0 - 2026-11-03

- First release: turn a README into a 25-second launch video in 16:9 and 9:16 plus a GIF, rendered locally with HyperFrames.
