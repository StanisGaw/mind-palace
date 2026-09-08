import type { PalaceObject, Vec3 } from '../types';

/** Obrót tylko wokół osi pionowej (dawne `rotationY`) jako pełny wektor kątów Eulera. */
export function yawRotation(yaw: number): Vec3 {
  return [0, yaw, 0];
}

/** Kąt wokół osi pionowej — do drzwi, bramy i kierunku, w którym staje gracz. */
export function yawOfObject(o: Pick<PalaceObject, 'rotation'>): number {
  return o.rotation[1];
}
