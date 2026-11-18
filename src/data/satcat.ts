/**
 * Catalogue facts: what the orbital elements do not say about an object — who owns it,
 * when and where it was launched, what kind of object it is and how big it looks on radar.
 *
 * Source: CelesTrak's SATCAT, saved once by `npm run fetch-data` to public/data/satcat.json.
 * The file is optional: without it the inspector simply shows fewer rows.
 *
 * Stored in a Map keyed by NORAD id, so the lookup for the selected object is O(1).
 */

export interface CatalogFacts {
  type: string; // PAY, R/B, DEB, UNK
  status: string; // operational status code
  owner: string; // country / organisation code
  launchDate: string; // YYYY-MM-DD
  launchSite: string; // site code
  rcs: number | null; // radar cross-section, m²
}

type Row = [number, string, string, string, string, string, number | null];

export async function loadFacts(): Promise<Map<number, CatalogFacts>> {
  const facts = new Map<number, CatalogFacts>();
  try {
    const res = await fetch('./data/satcat.json');
    if (!res.ok) return facts;
    const file = (await res.json()) as { rows: Row[] };
    for (const [id, type, status, owner, launchDate, launchSite, rcs] of file.rows) {
      facts.set(id, { type, status, owner, launchDate, launchSite, rcs });
    }
  } catch { /* file not bundled, or offline before the first fetch: carry on without it */ }
  return facts;
}

const TYPES: Record<string, string> = { PAY: 'Payload', 'R/B': 'Rocket body', DEB: 'Debris', UNK: 'Unknown' };

const STATUS: Record<string, string> = {
  '+': 'Operational', '-': 'Non-operational', P: 'Partially operational', B: 'Backup / standby',
  S: 'Spare', X: 'Extended mission', D: 'Decayed', '?': 'Unknown',
};

const OWNERS: Record<string, string> = {
  US: 'United States', CIS: 'Russia / CIS', PRC: 'China', UK: 'United Kingdom', FR: 'France', JPN: 'Japan',
  IND: 'India', ESA: 'European Space Agency', GER: 'Germany', CA: 'Canada', IT: 'Italy', SPN: 'Spain',
  SKOR: 'South Korea', ISRA: 'Israel', LUXE: 'Luxembourg', NETH: 'Netherlands', AUS: 'Australia',
  ARGN: 'Argentina', BRAZ: 'Brazil', INDO: 'Indonesia', TURK: 'Türkiye', UAE: 'United Arab Emirates',
  SAUD: 'Saudi Arabia', FIN: 'Finland', NOR: 'Norway', SWED: 'Sweden', DEN: 'Denmark', SWTZ: 'Switzerland',
  TWN: 'Taiwan', SING: 'Singapore', THAI: 'Thailand', MALA: 'Malaysia', IRAN: 'Iran', NKOR: 'North Korea',
  EGYP: 'Egypt', NZ: 'New Zealand', MEX: 'Mexico', BEL: 'Belgium', POL: 'Poland', CZCH: 'Czechia',
  AUST: 'Austria', UKR: 'Ukraine', KAZ: 'Kazakhstan', PAKI: 'Pakistan', VTNM: 'Vietnam', LTU: 'Lithuania',
  BGR: 'Bulgaria', HUN: 'Hungary', GREC: 'Greece', POR: 'Portugal', CHLE: 'Chile', COL: 'Colombia',
  SAFR: 'South Africa', NIG: 'Nigeria', ALG: 'Algeria', QAT: 'Qatar', ISS: 'International Space Station partners',
  SES: 'SES (Luxembourg)', ITSO: 'Intelsat', IM: 'Inmarsat', EUTE: 'Eutelsat', EUME: 'EUMETSAT',
  GLOB: 'Globalstar', ORB: 'ORBCOMM', O3B: 'O3b Networks', AB: 'Arabsat', AC: 'AsiaSat', NATO: 'NATO',
  RASC: 'RascomStar', STCT: 'Singapore / Taiwan', FGER: 'France / Germany', FRIT: 'France / Italy',
  CHBZ: 'China / Brazil', USBZ: 'United States / Brazil', TBD: 'Not yet assigned', UNK: 'Unknown',
};

const SITES: Record<string, string> = {
  AFETR: 'Cape Canaveral, Florida', AFWTR: 'Vandenberg, California', TYMSC: 'Baikonur Cosmodrome, Kazakhstan',
  TTMTR: 'Baikonur Cosmodrome, Kazakhstan', PLMSC: 'Plesetsk Cosmodrome, Russia', VOSTO: 'Vostochny Cosmodrome, Russia',
  FRGUI: 'Kourou, French Guiana', JSC: 'Jiuquan, China', TAISC: 'Taiyuan, China', XICLF: 'Xichang, China',
  WSC: 'Wenchang, China', YSLA: 'Yellow Sea launch platform', SCSLA: 'South China Sea launch platform',
  SRILR: 'Sriharikota, India', TANSC: 'Tanegashima, Japan', KSCUT: 'Uchinoura, Japan', WLPIS: 'Wallops Island, Virginia',
  RLLB: 'Māhia Peninsula, New Zealand', KODAK: 'Kodiak, Alaska', KWAJ: 'Kwajalein Atoll', SEAL: 'Sea Launch platform, Pacific',
  DLS: 'Dombarovsky, Russia', KYMSC: 'Kapustin Yar, Russia', SVOBO: 'Svobodny, Russia', YAVNE: 'Palmachim, Israel',
  SEMLS: 'Semnan, Iran', SMTS: 'Shahrud, Iran', NSC: 'Naro, South Korea', YUN: 'Sohae, North Korea', TNSTA: 'Tonghae, North Korea',
  ERAS: 'Air launch, Eastern Range', WRAS: 'Air launch, Western Range', CAS: 'Air launch, Canary Islands',
  SNMLP: 'San Marco platform, Kenya', WOMRA: 'Woomera, Australia', HGSTR: 'Hammaguir, Algeria', SUBL: 'Submarine launch, Barents Sea',
  OREN: 'Orenburg, Russia', ALC: 'Alcântara, Brazil', JJSLA: 'Jeju sea launch platform', SPKII: 'Space Port Kii, Japan',
  ANDSP: 'Andøya, Norway', BOS: 'Bowen, Australia', SADOL: 'Submarine launch', UNK: 'Unknown',
};

export const typeLabel = (code: string): string => TYPES[code] ?? code;
export const statusLabel = (code: string): string => STATUS[code] ?? (code ? code : 'Not reported');
export const ownerName = (code: string): string => OWNERS[code] ?? code;
export const siteName = (code: string): string => SITES[code] ?? code;

/** Radar cross-section → the size classes used by space-surveillance catalogues. */
export function sizeClass(rcs: number | null): string {
  if (rcs === null) return 'Not published';
  const label = rcs < 0.1 ? 'small' : rcs < 1 ? 'medium' : 'large';
  return `${rcs < 0.01 ? rcs.toFixed(4) : rcs.toFixed(2)} m² (${label})`;
}
