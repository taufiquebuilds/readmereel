import { spawnSync } from "node:child_process";

// The poster and the contact sheet, cut from the rendered videos with ffmpeg. Frames are picked by number (the frame
// at a scene's midpoint), never by seeking, so each tile is exactly the frame the film shows there. Labels are drawn
// with a small built-in bitmap font: ffmpeg's drawtext needs a build with libfreetype and a font file, and many builds
// (Homebrew's among them) have neither, while a label drawn here looks the same everywhere.

export const FPS = 30;
export const POSTER_WIDTH = 960;
export const TILE = { width: 640, height: 360, tallWidth: 202, gap: 16 };
const BG = [22, 24, 29];

// 5 x 7 glyphs, "#" is ink.
const GLYPHS = {
  0: [" ### ", "#   #", "#  ##", "# # #", "##  #", "#   #", " ### "],
  1: ["  #  ", " ##  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  2: [" ### ", "#   #", "    #", "   # ", "  #  ", " #   ", "#####"],
  3: ["#####", "   # ", "  #  ", "   # ", "    #", "#   #", " ### "],
  4: ["   # ", "  ## ", " # # ", "#  # ", "#####", "   # ", "   # "],
  5: ["#####", "#    ", "#### ", "    #", "    #", "#   #", " ### "],
  6: ["  ## ", " #   ", "#    ", "#### ", "#   #", "#   #", " ### "],
  7: ["#####", "    #", "   # ", "  #  ", " #   ", " #   ", " #   "],
  8: [" ### ", "#   #", "#   #", " ### ", "#   #", "#   #", " ### "],
  9: [" ### ", "#   #", "#   #", " ####", "    #", "   # ", " ##  "],
  a: ["     ", "     ", " ### ", "    #", " ####", "#   #", " ####"],
  b: ["#    ", "#    ", "# ## ", "##  #", "#   #", "#   #", "#### "],
  c: ["     ", "     ", " ### ", "#    ", "#    ", "#   #", " ### "],
  d: ["    #", "    #", " ## #", "#  ##", "#   #", "#   #", " ####"],
  e: ["     ", "     ", " ### ", "#   #", "#####", "#    ", " ### "],
  f: ["  ## ", " #  #", " #   ", "###  ", " #   ", " #   ", " #   "],
  g: ["     ", " ####", "#   #", "#   #", " ####", "    #", " ### "],
  h: ["#    ", "#    ", "# ## ", "##  #", "#   #", "#   #", "#   #"],
  i: ["  #  ", "     ", " ##  ", "  #  ", "  #  ", "  #  ", " ### "],
  j: ["   # ", "     ", "  ## ", "   # ", "   # ", "#  # ", " ##  "],
  k: ["#    ", "#    ", "#  # ", "# #  ", "##   ", "# #  ", "#  # "],
  l: [" ##  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  m: ["     ", "     ", "## # ", "# # #", "# # #", "# # #", "# # #"],
  n: ["     ", "     ", "# ## ", "##  #", "#   #", "#   #", "#   #"],
  o: ["     ", "     ", " ### ", "#   #", "#   #", "#   #", " ### "],
  p: ["     ", "#### ", "#   #", "#   #", "#### ", "#    ", "#    "],
  q: ["     ", "     ", " ## #", "#  ##", " ####", "    #", "    #"],
  r: ["     ", "     ", "# ## ", "##  #", "#    ", "#    ", "#    "],
  s: ["     ", "     ", " ####", "#    ", " ### ", "    #", "#### "],
  t: [" #   ", " #   ", "###  ", " #   ", " #   ", " #  #", "  ## "],
  u: ["     ", "     ", "#   #", "#   #", "#   #", "#  ##", " ## #"],
  v: ["     ", "     ", "#   #", "#   #", "#   #", " # # ", "  #  "],
  w: ["     ", "     ", "#   #", "#   #", "# # #", "# # #", " # # "],
  x: ["     ", "     ", "#   #", " # # ", "  #  ", " # # ", "#   #"],
  y: ["     ", "     ", "#   #", "#   #", " ####", "    #", " ### "],
  z: ["     ", "     ", "#####", "   # ", "  #  ", " #   ", "#####"],
  "-": ["     ", "     ", "     ", "#####", "     ", "     ", "     "],
};

// An RGB image: { width, height, data } with 3 bytes a pixel.
export function canvas(width, height, rgb = BG) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(rgb, i);
  return { width, height, data };
}

function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= dst.height) continue;
    const from = y * src.width * 3;
    const to = (ty * dst.width + x0) * 3;
    src.data.copy(dst.data, to, from, from + src.width * 3);
  }
}

function fillRect(img, x0, y0, w, h, rgb, alpha = 1) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
      const i = (y * img.width + x) * 3;
      for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(img.data[i + c] * (1 - alpha) + rgb[c] * alpha);
    }
  }
}

// Draws `text` (lower case letters, digits, space and "-"; anything else is a space) at (x, y) on a dark box.
export function drawLabel(img, text, x, y, scale = 3) {
  const chars = Array.from(String(text).toLowerCase());
  const pad = 2 * scale;
  const w = chars.length * 6 * scale - scale + 2 * pad;
  const h = 7 * scale + 2 * pad;
  fillRect(img, x, y, w, h, [0, 0, 0], 0.72);
  chars.forEach((ch, k) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] === "#") fillRect(img, x + pad + (k * 6 + gx) * scale, y + pad + gy * scale, scale, scale, [255, 255, 255]);
      }
    });
  });
  return { width: w, height: h };
}

// The frame number at a scene's midpoint.
export const midFrame = (scene) => Math.round((scene.start + scene.duration / 2) * FPS);

function ffmpeg(args, opts, run) {
  const result = run("ffmpeg", ["-v", "error", "-nostdin", ...args], { maxBuffer: 512 * 1024 * 1024, ...opts });
  if (result.status !== 0) {
    const why = result.error?.message ?? String(result.stderr ?? "").trim();
    throw new Error(`ffmpeg failed: ${why}`);
  }
  return result;
}

// The given frames of a video (by number, in the order asked), each scaled to width x height, as RGB images.
export function framesOf(video, numbers, width, height, { run = spawnSync } = {}) {
  const wanted = [...new Set(numbers)].sort((a, b) => a - b);
  const select = wanted.map((n) => `eq(n\\,${n})`).join("+");
  const out = ffmpeg(["-i", video, "-vf", `select=${select},scale=${width}:${height}:flags=area`, "-fps_mode", "passthrough",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {}, run).stdout;
  const size = width * height * 3;
  if (!Buffer.isBuffer(out) || out.length !== size * wanted.length) {
    throw new Error(`ffmpeg returned ${Buffer.isBuffer(out) ? out.length / size : 0} of ${wanted.length} frames from ${video}`);
  }
  const byNumber = new Map(wanted.map((n, k) => [n, { width, height, data: out.subarray(k * size, (k + 1) * size) }]));
  return numbers.map((n) => byNumber.get(n));
}

export function writePng(img, file, { run = spawnSync } = {}) {
  ffmpeg(["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${img.width}x${img.height}`, "-i", "-", "-frames:v", "1", file], { input: img.data }, run);
}

// The scene the poster shows: the title, else the first ui, else the scene after the hook.
export function posterScene(plan) {
  return plan.scenes.find((s) => s.type === "title") ?? plan.scenes.find((s) => s.type === "ui") ?? plan.scenes[1] ?? plan.scenes[0];
}

// poster.png: the 16:9 frame at the poster scene's midpoint, POSTER_WIDTH wide.
export function makePoster(wideVideo, plan, file, { run = spawnSync } = {}) {
  const scene = posterScene(plan);
  const [frame] = framesOf(wideVideo, [midFrame(scene)], POSTER_WIDTH, Math.round((POSTER_WIDTH * 9) / 16), { run });
  writePng(frame, file, { run });
  return scene;
}

export const sceneLabel = (scene) => `${scene.id} ${scene.type}`;

// The contact sheet's layout: one column per scene, the wide frame on top and the tall one below at the same height,
// centred under it.
export function sheetLayout(count) {
  const { width, height, tallWidth, gap } = TILE;
  return {
    width: gap + count * (width + gap),
    height: gap + 2 * (height + gap),
    tiles: Array.from({ length: count }, (_, k) => {
      const x = gap + k * (width + gap);
      return { wide: { x, y: gap }, tall: { x: x + Math.round((width - tallWidth) / 2), y: 2 * gap + height } };
    }),
  };
}

// contact.png: each scene's midpoint frame from both videos, labelled "s1 hook" and so on.
export function makeContactSheet(wideVideo, tallVideo, plan, file, { run = spawnSync } = {}) {
  const numbers = plan.scenes.map(midFrame);
  const wide = framesOf(wideVideo, numbers, TILE.width, TILE.height, { run });
  const tall = framesOf(tallVideo, numbers, TILE.tallWidth, TILE.height, { run });
  const layout = sheetLayout(plan.scenes.length);
  const sheet = canvas(layout.width, layout.height);
  plan.scenes.forEach((scene, k) => {
    const at = layout.tiles[k];
    paste(sheet, wide[k], at.wide.x, at.wide.y);
    paste(sheet, tall[k], at.tall.x, at.tall.y);
    drawLabel(sheet, sceneLabel(scene), at.wide.x + 10, at.wide.y + 10);
    drawLabel(sheet, sceneLabel(scene), at.tall.x + 6, at.tall.y + 6, 2);
  });
  writePng(sheet, file, { run });
  return { frames: numbers, layout };
}
