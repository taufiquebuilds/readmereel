import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

export const GIF = { width: 960, fps: 12, maxBytes: 8 * 1024 * 1024, fallbackSeconds: 12 };

export function gifArgs(mp4, gif, seconds) {
  const trim = seconds ? ["-t", String(seconds)] : [];
  const filter = `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];` +
    "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4";
  return ["-v", "error", "-y", ...trim, "-i", mp4, "-filter_complex", filter, "-loop", "0", gif];
}

export function makeGif(mp4, gif, { run = spawnSync, size = (p) => statSync(p).size } = {}) {
  const once = (seconds) => {
    const result = run("ffmpeg", gifArgs(mp4, gif, seconds), { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ffmpeg could not make the GIF: ${result.error?.message ?? result.stderr}`);
    return size(gif);
  };
  const bytes = once();
  return bytes > GIF.maxBytes ? once(GIF.fallbackSeconds) : bytes;
}
