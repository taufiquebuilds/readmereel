// The <audio> tag for the music bed. Kept free of imports so build.mjs can use it without a cycle through hf.mjs.
export const MUSIC_VOLUME = 0.35;
export const MUSIC_TRACK = 99;

const num = (x) => Number(Number(x).toFixed(4));

// Fade in over the first second, out over the last two. The lane multiplies data-volume (measured: a lane peak of 0.35
// on top of data-volume 0.35 played at 0.35 x 0.35, -18 dB), so the lane peaks at 1 and data-volume sets the level.
export function musicTag(rel, duration) {
  const D = num(duration);
  const points = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: num(Math.max(1, D - 2)), v: 1 }, { t: D, v: 0 }];
  const lane = { target: "volume", points };
  return `<audio id="music" src="${rel}" data-start="0" data-duration="${D}" data-track-index="${MUSIC_TRACK}" data-volume="${MUSIC_VOLUME}" data-automation='${JSON.stringify({ version: 1, lanes: [lane] })}'></audio>`;
}
