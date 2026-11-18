/** One orbital-element record in CelesTrak's OMM JSON format (only the fields we keep). */
export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string; // international designator, e.g. "1998-067A"
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number; // revolutions per day
  ECCENTRICITY: number;
  INCLINATION: number; // degrees
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  GROUP?: string; // CelesTrak group it was downloaded from (added by fetch-data.mjs)
}

export interface Snapshot {
  fetchedAt: string;
  objects: OmmRecord[];
}

export const CATEGORIES = ['Starlink', 'OneWeb', 'GNSS', 'Space Stations', 'Weather / Earth-obs', 'Debris', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export const ORBIT_CLASSES = ['LEO', 'MEO', 'GEO', 'HEO'] as const;
export type OrbitClass = (typeof ORBIT_CLASSES)[number];

/** Display colour per category (also used by the satellite shader). */
export const CATEGORY_COLORS: Record<Category, string> = {
  Starlink: '#6fb1ff',
  OneWeb: '#b693ff',
  GNSS: '#4ff0b4',
  'Space Stations': '#ffffff',
  'Weather / Earth-obs': '#ffd966',
  Debris: '#ff8a5c',
  Other: '#9fb4c9',
};

export const ORBIT_COLORS: Record<OrbitClass, string> = {
  LEO: '#6fb1ff',
  MEO: '#4ff0b4',
  GEO: '#ffd966',
  HEO: '#ff8a5c',
};

/** Everything the UI knows about one tracked object. `index` is its slot in every typed array. */
export interface Satellite {
  index: number;
  noradId: number;
  name: string;
  intlDes: string;
  launchYear: number | null;
  category: Category;
  orbitClass: OrbitClass;
  inclinationDeg: number;
  periodMin: number;
  meanAltKm: number; // semi-major axis minus Earth's radius
  omm: OmmRecord;
}
