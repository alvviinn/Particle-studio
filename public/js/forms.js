// Every "form" is a recipe for how the video is rebuilt out of particles.
// `defaults` seed the sliders; the other keys are fixed traits of the look.

export const PALETTES = {
  sunset: { label: 'Sunset', stops: ['#2a0f2e', '#c1275a', '#f2542d', '#f7b32b', '#fff1d0'] },
  candy:  { label: 'Candy',  stops: ['#ff4f9a', '#ff9f1c', '#ffe14d', '#3ddc97', '#4cc9f0'] },
  ocean:  { label: 'Ocean',  stops: ['#04132b', '#0b4f8a', '#12a4c9', '#7fe3d3', '#f3fff6'] },
  neon:   { label: 'Neon',   stops: ['#6a14ff', '#ff2bd6', '#2bf0ff', '#b6ff3b', '#ffffff'] },
  ember:  { label: 'Ember',  stops: ['#1a0505', '#7a1608', '#e8410f', '#ffb02e', '#fff6c9'] },
  forest: { label: 'Forest', stops: ['#0b2418', '#1f6b3a', '#7bb344', '#f2d54b', '#fff8dc'] },
  mono:   { label: 'Mono',   stops: ['#111111', '#555555', '#999999', '#dddddd', '#ffffff'] },
};

export const BACKGROUNDS = {
  plum:  { label: 'Plum',  color: '#160a14' },
  black: { label: 'Black', color: '#030203' },
  ink:   { label: 'Ink',   color: '#0a1020' },
  ember: { label: 'Ember', color: '#1f0b06' },
};

export const SHAPES = { disc: 0, gas: 1, poly: 2, bubble: 3, star: 4, ember: 5 };

export const FORMS = {
  particles: {
    label: 'Particles',
    blurb: 'Dense, lit grains with real depth.',
    shape: 'disc', blend: 'alpha', alpha: 1, shade: 0.7, jitter: 0.9,
    life: 0, sizeLuma: 0, sizeVar: 0.25, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 240, layers: 2, size: 1.2, depth: 0.55, motion: 0.3, speed: 1, color: 'original', palette: 'sunset', sat: 1.25, bright: 1.1, bgKeep: 0.4, cutoff: 0.02 },
  },
  gas: {
    label: 'Gas',
    blurb: 'Soft colour clouds that drift off the shapes in the frame.',
    shape: 'gas', blend: 'add', alpha: 0.2, shade: 0, jitter: 1,
    life: 1, sizeLuma: 0.2, sizeVar: 0.8, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0.4,
    defaults: { density: 110, layers: 2, size: 5.5, depth: 0.3, motion: 1.1, speed: 0.8, color: 'original', palette: 'sunset', sat: 1.45, bright: 1.35, bgKeep: 0.15, cutoff: 0.03 },
  },
  polygons: {
    label: 'Polygons',
    blurb: 'Small faceted shapes in loud colours.',
    shape: 'poly', blend: 'alpha', alpha: 1, shade: 0, jitter: 0.5,
    life: 0, sizeLuma: 0.3, sizeVar: 0.5, spin: 0.5, randRot: 1, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 42, layers: 2, size: 1.45, depth: 0.7, motion: 0.5, speed: 1, color: 'scatter', palette: 'candy', sat: 1.2, bright: 1.1, bgKeep: 0.2, cutoff: 0.04 },
  },
  circles: {
    label: 'Circles',
    blurb: 'Halftone dots that swell with the light.',
    shape: 'disc', blend: 'alpha', alpha: 1, shade: 0.12, jitter: 0,
    life: 0, sizeLuma: 1, sizeVar: 0, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 36, layers: 1, size: 1.55, depth: 0.25, motion: 0.2, speed: 1, color: 'gradient', palette: 'sunset', sat: 1.3, bright: 1.15, bgKeep: 0.1, cutoff: 0.05 },
  },
  bubbles: {
    label: 'Bubbles',
    blurb: 'Glassy soap bubbles with a rainbow film.',
    shape: 'bubble', blend: 'add', alpha: 0.28, shade: 0, jitter: 0.9,
    life: 0, sizeLuma: 0.2, sizeVar: 1, spin: 0, randRot: 0, sides: 0, twinkle: 0, rise: 0,
    defaults: { density: 18, layers: 2, size: 1.55, depth: 0.9, motion: 1.0, speed: 0.7, color: 'original', palette: 'ocean', sat: 1.3, bright: 1.0, bgKeep: 0.15, cutoff: 0.05 },
  },
  stardust: {
    label: 'Stardust',
    blurb: 'Twinkling stars with a soft halo.',
    shape: 'star', blend: 'add', alpha: 0.9, shade: 0, jitter: 1,
    life: 0, sizeLuma: 0.6, sizeVar: 1, spin: 0.25, randRot: 1, sides: 0, twinkle: 1, rise: 0,
    defaults: { density: 55, layers: 2, size: 2.1, depth: 0.7, motion: 0.4, speed: 1, color: 'original', palette: 'neon', sat: 1.4, bright: 1.35, bgKeep: 0.08, cutoff: 0.06 },
  },
  embers: {
    label: 'Embers',
    blurb: 'Glowing sparks that rise and fade out.',
    shape: 'ember', blend: 'add', alpha: 0.5, shade: 0, jitter: 1,
    life: 1, sizeLuma: 0.5, sizeVar: 0.8, spin: 0, randRot: 0, sides: 0, twinkle: 0.3, rise: 1.4,
    defaults: { density: 130, layers: 2, size: 2.8, depth: 0.35, motion: 0.9, speed: 1.1, color: 'gradient', palette: 'ember', sat: 1.2, bright: 1.45, bgKeep: 0.0, cutoff: 0.05 },
  },
  pixels: {
    label: 'Pixels',
    blurb: 'Square voxels pushed out of the screen.',
    shape: 'poly', blend: 'alpha', alpha: 1, shade: 0, jitter: 0,
    life: 0, sizeLuma: 0, sizeVar: 0, spin: 0, randRot: 0, sides: 4, twinkle: 0, rise: 0,
    defaults: { density: 40, layers: 1, size: 1.02, depth: 1.0, motion: 0.25, speed: 1, color: 'original', palette: 'sunset', sat: 1.2, bright: 1.05, bgKeep: 0.3, cutoff: 0.02 },
  },
};

export const DEFAULT_FORM = 'particles';

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
