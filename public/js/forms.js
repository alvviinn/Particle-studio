// Every "form" is a recipe for how the video is rebuilt. `kind` picks the
// renderer: particles (point sprites), toon (cartoon filter) or immersive (3D
// room). `defaults` seed the sliders; the other keys are fixed traits of the look.

export const PALETTES = {
  sunset: { label: 'Sunset', stops: ['#2a0f2e', '#c1275a', '#f2542d', '#f7b32b', '#fff1d0'] },
  candy:  { label: 'Candy',  stops: ['#ff4f9a', '#ff9f1c', '#ffe14d', '#3ddc97', '#4cc9f0'] },
  ocean:  { label: 'Ocean',  stops: ['#04132b', '#0b4f8a', '#12a4c9', '#7fe3d3', '#f3fff6'] },
  neon:   { label: 'Neon',   stops: ['#6a14ff', '#ff2bd6', '#2bf0ff', '#b6ff3b', '#ffffff'] },
  ember:  { label: 'Ember',  stops: ['#1a0505', '#7a1608', '#e8410f', '#ffb02e', '#fff6c9'] },
  forest: { label: 'Forest', stops: ['#0b2418', '#1f6b3a', '#7bb344', '#f2d54b', '#fff8dc'] },
  aurora: { label: 'Aurora', stops: ['#7b2ff7', '#f72585', '#ff9e00', '#2ee6a6', '#2fa8ff'] },
  twilight: { label: 'Twilight', stops: ['#3a0ca3', '#7209b7', '#f72585', '#ff7b00', '#ffd60a'] },
  blossom: { label: 'Blossom', stops: ['#ff4d8d', '#ff9a3c', '#ffd166', '#7ae582', '#4cc9f0'] },
  mono:   { label: 'Mono',   stops: ['#111111', '#555555', '#999999', '#dddddd', '#ffffff'] },
};

export const BACKGROUNDS = {
  plum:  { label: 'Plum',  color: '#160a14' },
  black: { label: 'Black', color: '#030203' },
  ink:   { label: 'Ink',   color: '#0a1020' },
  ember: { label: 'Ember', color: '#1f0b06' },
};

export const SHAPES = { disc: 0, poly: 2, star: 4, ember: 5 };

export const FORMS = {
  particles: {
    kind: 'particles', label: 'Particles',
    blurb: 'Dense, lit grains with real depth.',
    shape: 'disc', blend: 'alpha', alpha: 1, shade: 0.25, jitter: 0.9,
    life: 0, sizeLuma: 0, sizeVar: 0.25, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 150, layers: 2, size: 0.95, depth: 0.55, motion: 0.3, speed: 1, color: 'artistic', palette: 'aurora', sat: 1.2, bright: 1.5, bgKeep: 0.4, cutoff: 0.02, abstract: 0.55 },
  },
  polygons: {
    kind: 'particles', label: 'Polygons',
    blurb: 'Small faceted shapes in loud colours.',
    shape: 'poly', blend: 'alpha', alpha: 1, shade: 0, jitter: 0.5,
    life: 0, sizeLuma: 0.3, sizeVar: 0.5, spin: 0.5, randRot: 1, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 42, layers: 2, size: 1.45, depth: 0.7, motion: 0.5, speed: 1, color: 'artistic', palette: 'candy', sat: 1.2, bright: 1.1, bgKeep: 0.2, cutoff: 0.04, abstract: 0.5 },
  },
  circles: {
    kind: 'particles', label: 'Circles',
    blurb: 'Halftone dots that swell with the light.',
    shape: 'disc', blend: 'alpha', alpha: 1, shade: 0.12, jitter: 0,
    life: 0, sizeLuma: 1, sizeVar: 0, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 36, layers: 1, size: 1.55, depth: 0.25, motion: 0.2, speed: 1, color: 'artistic', palette: 'blossom', sat: 1.3, bright: 1.15, bgKeep: 0.1, cutoff: 0.05, abstract: 0.4 },
  },
  stardust: {
    kind: 'particles', label: 'Stardust',
    blurb: 'Twinkling stars with a soft halo.',
    shape: 'star', blend: 'add', alpha: 0.5, shade: 0, jitter: 1,
    life: 0, sizeLuma: 0.6, sizeVar: 1, spin: 0.25, randRot: 1, sides: 0, twinkle: 1, rise: 0,
    defaults: { density: 55, layers: 2, size: 2.1, depth: 0.7, motion: 0.4, speed: 1, color: 'artistic', palette: 'neon', sat: 1.4, bright: 1.05, bgKeep: 0.08, cutoff: 0.06, abstract: 0.5 },
  },
  embers: {
    kind: 'particles', label: 'Embers',
    blurb: 'Glowing sparks that rise and fade out.',
    shape: 'ember', blend: 'add', alpha: 0.5, shade: 0, jitter: 1,
    life: 1, sizeLuma: 0.5, sizeVar: 0.8, spin: 0, randRot: 0, sides: 0, twinkle: 0.3, rise: 1.4,
    defaults: { density: 130, layers: 2, size: 2.8, depth: 0.35, motion: 0.9, speed: 1.1, color: 'gradient', palette: 'ember', sat: 1.2, bright: 1.45, bgKeep: 0.0, cutoff: 0.05, abstract: 0.5 },
  },
  pixels: {
    kind: 'particles', label: 'Pixels',
    blurb: 'Square voxels pushed out of the screen.',
    shape: 'poly', blend: 'alpha', alpha: 1, shade: 0, jitter: 0,
    life: 0, sizeLuma: 0, sizeVar: 0, spin: 0, randRot: 0, sides: 4, twinkle: 0, rise: 0,
    defaults: { density: 40, layers: 1, size: 1.02, depth: 1.0, motion: 0.25, speed: 1, color: 'artistic', palette: 'twilight', sat: 1.2, bright: 1.05, bgKeep: 0.3, cutoff: 0.02, abstract: 0.3 },
  },

  // ---- animation: the frame is repainted as a cartoon ----
  toon: {
    kind: 'toon', style: 0, label: 'Toon',
    blurb: 'Flat acid colours, thick wobbly ink lines and hard cel shadows, like a late-night sci-fi cartoon.',
    defaults: { lines: 1.25, bands: 4, smooth: 0.55, hold: 12, boil: 1, glow: 0.15, extras: 0.6, sat: 1.2, bright: 1.05 },
  },
  anime: {
    kind: 'toon', style: 1, label: 'Anime',
    blurb: 'Soft cel shading, painted skies, fine coloured line art and bloom, Japanese animation style.',
    defaults: { lines: 0.8, bands: 3, smooth: 0.7, hold: 12, boil: 0.25, glow: 0.7, extras: 0.6, sat: 1.25, bright: 1.08 },
  },
  kungfu: {
    kind: 'toon', style: 2, label: 'Kung Fu',
    blurb: 'Warm golden light, painterly textures, brush-ink edges and drifting blossom, like a big martial-arts feature.',
    defaults: { lines: 1.0, bands: 5, smooth: 0.85, hold: 24, boil: 0.5, glow: 0.8, extras: 0.7, sat: 1.15, bright: 1.05 },
  },

  // ---- step inside the video ----
  immersive: {
    kind: 'immersive', label: 'Immersive',
    blurb: 'Step inside: the clip wraps around you in 3D with real parallax. Drag to look, scroll or WASD to move, click to ripple.',
    defaults: { pop: 0.8, wrap: 0.4, swarm: 0.5, ambient: 0.75, skin: 'original', depthSrc: 'auto', tour: 0.5, sat: 1.1, bright: 1.05 },
  },
};

export const KINDS = {
  particles: { label: 'Particles' },
  toon: { label: 'Animate' },
  immersive: { label: 'Immersive' },
};

export const DEFAULT_FORM = 'particles';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
