// The single conversion between plan coordinates (x east, n north, y up) and Three.js world space.
// Three.js is right-handed with -z "into the screen", so north maps to -z.
export const toWorldZ = (n: number): number => -n;
export const toPlanN = (z: number): number => -z;
