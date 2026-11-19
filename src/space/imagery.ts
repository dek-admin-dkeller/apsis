/**
 * The map of each body: which bundled picture to wrap round it, and where sharper detail can
 * be streamed from.
 *
 * Every bundled map is the same shape: 2:1 equirectangular, north up, longitude 0 in the
 * middle, east to the right, 2048 px wide (the `baseHigh` copies 4096; 1024 where the pictures
 * are no finer: Enceladus, Phoebe and the five moons of Uranus). Beside each is a 256 px copy,
 * `<name>_s.jpg`, which the solar-system view draws every body from. They live in
 * public/textures/space/ and were made by scripts/build-space-maps.py, which records how.
 * `npm run check` confirms every file is there and has that shape.
 *
 * Where a real global mosaic exists it is NASA's (public domain): the surfaces of Mercury,
 * Venus (by radar), the Moon, Mars and Phobos, the four large moons of Jupiter, eight moons of
 * Saturn, five of Uranus, Triton, Pluto and Charon. Fourteen small moons have never been mapped
 * (Deimos has no public-domain global map) and stay plain coloured balls. The Sun, the four giant planets, Saturn's rings and the clouds of Venus have
 * no surface to photograph in one piece; for those the artist-finished "Solar System Scope"
 * textures (CC BY 4.0) are used, which are based on NASA imagery. IMAGE_CREDITS lists every
 * file's author, licence and address; the About sheet must show it (CC BY requires the credit).
 *
 * Streamed detail comes from NASA's Solar System Treks tile service. Every layer listed was
 * checked on 2026-11-19: its deepest level read from the layer's own WMTSCapabilities.xml, and
 * a tile at that level fetched with an Origin header to confirm Access-Control-Allow-Origin: *.
 * All of them use the same grid: 2 × 1 tiles of 256 px at level 0, column 0 at longitude −180°,
 * row 0 at the north pole.
 *
 * Things a renderer should know:
 *   - Some worlds have only ever been seen in part, by one spacecraft flying past: Pluto and
 *     Charon south of about 30° S (in darkness in 2015), the northern third of Triton, the
 *     northern halves of Miranda, Ariel, Umbriel, Titania and Oberon (Voyager 2 came by in
 *     their southern summer), and a quarter of Phoebe. Nobody knows what is there. Those parts
 *     of the maps are ONE FLAT TONE, the average of the mapped part: no terrain is invented,
 *     and the edge of the real pictures stays visible.
 *   - Titan's map is one infrared wavelength (grey) tinted with the colour of its haze; the
 *     streamed Trek layer for Titan is the untinted grey one, so it is not offered as tiles.
 *     Iapetus is the same case the other way round: its map keeps the real contrast between
 *     its dark and bright halves, which the Trek layer evens out.
 *   - Mimas and Rhea are NASA's colour maps used in grey (their colours are exaggerated
 *     infrared-to-ultraviolet ratios, not what an eye would see) and toned to match the Trek
 *     layers that take over close up. The Mimas map was made with the moon's old zero of
 *     longitude and has been moved 3.9° to the present one.
 *   - On the gas giants longitude is not tied to anything visible (the Great Red Spot drifts),
 *     so their maps show the right latitudes but only a plausible moment in longitude.
 */

import type { BodyId, Imagery } from './types.ts';

const DIR = 'textures/space/';
/** NASA Solar System Treks, WMTS: one address pattern for every layer. */
const trek = (body: string, layer: string, ext: 'jpg' | 'png'): string =>
  `https://trek.nasa.gov/tiles/${body}/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;

export const IMAGERY: Partial<Record<BodyId, Imagery>> = {
  sun: { base: `${DIR}sun.jpg`, credit: 'Solar System Scope (CC BY 4.0)' },
  mercury: {
    base: `${DIR}mercury.jpg`,
    tiles: { url: trek('Mercury', 'Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m', 'jpg'), maxZoom: 7 },
    credit: 'NASA / JHUAPL / Carnegie Institution (MESSENGER)',
  },
  venus: {
    base: `${DIR}venus.jpg`,
    clouds: `${DIR}venus-clouds.jpg`,
    tiles: { url: trek('Venus', 'Venus_Magellan_C3-MDIR_Colorized_Global_Mosaic_4641m', 'png'), maxZoom: 4 },
    credit: 'NASA / JPL / USGS (Magellan radar); clouds: Solar System Scope (CC BY 4.0)',
  },
  // The Earth keeps the tracker's own textures (public/textures/); its close-up ground is render/tiles.ts.
  earth: { base: 'textures/earth-blue-marble.jpg', credit: 'NASA Blue Marble' },
  moon: {
    base: `${DIR}moon.jpg`,
    baseHigh: `${DIR}moon-4k.jpg`,
    tiles: { url: trek('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02', 'jpg'), maxZoom: 8 },
    credit: 'NASA / GSFC / Arizona State University (Lunar Reconnaissance Orbiter)',
  },
  mars: {
    base: `${DIR}mars.jpg`,
    baseHigh: `${DIR}mars-4k.jpg`,
    tiles: { url: trek('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg'), maxZoom: 7 },
    credit: 'NASA / JPL / USGS (Viking Orbiter)',
  },
  phobos: {
    base: `${DIR}phobos.jpg`,
    tiles: { url: trek('Phobos', 'Phobos_Viking_Mosaic_40ppd_DLRcontrol', 'jpg'), maxZoom: 5 },
    credit: 'NASA / USGS / Philip Stooke (Viking Orbiter)',
  },
  jupiter: { base: `${DIR}jupiter.jpg`, baseHigh: `${DIR}jupiter-4k.jpg`, credit: 'Solar System Scope (CC BY 4.0)' },
  io: {
    base: `${DIR}io.jpg`,
    tiles: { url: trek('Io', 'Io_GalileoSSI_Voyager_Global_Mosaic_ClrMerge_1km', 'png'), maxZoom: 4 },
    credit: 'NASA / JPL / USGS (Galileo, Voyager)',
  },
  europa: {
    base: `${DIR}europa.jpg`,
    tiles: { url: trek('Europa', '20150218_europa_global_map_20000x10000', 'png'), maxZoom: 5 },
    credit: 'NASA / JPL-Caltech / SETI Institute (Galileo, Voyager)',
  },
  ganymede: {
    base: `${DIR}ganymede.jpg`,
    tiles: { url: trek('Ganymede', 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m', 'png'), maxZoom: 4 },
    credit: 'NASA / JPL / USGS (Galileo, Voyager)',
  },
  callisto: {
    base: `${DIR}callisto.jpg`,
    tiles: { url: trek('Callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km', 'png'), maxZoom: 5 },
    credit: 'NASA / JPL / USGS (Galileo, Voyager)',
  },
  saturn: {
    base: `${DIR}saturn.jpg`,
    baseHigh: `${DIR}saturn-4k.jpg`,
    // The strip's ends were found by matching the edges it shows to their known distances from
    // Saturn's centre: the B ring's outer edge (117,580 km) and the A ring's (136,775 km) fix
    // the scale; the C ring's inner edge and the F ring then fall within about 500 km of where
    // they should. The strip runs from just inside the C ring to just outside the F ring.
    ring: { strip: `${DIR}saturn-rings.png`, innerKm: 69700, outerKm: 141000 },
    credit: 'Solar System Scope (CC BY 4.0)',
  },
  mimas: {
    base: `${DIR}mimas.jpg`,
    tiles: { url: trek('Mimas', 'MI_170630_DLR_basemap', 'jpg'), maxZoom: 4 },
    credit: 'NASA / JPL-Caltech / Space Science Institute / LPI (Cassini)',
  },
  enceladus: {
    base: `${DIR}enceladus.jpg`,
    tiles: { url: trek('Enceladus', 'Enceladus_cyl_KH', 'jpg'), maxZoom: 5 },
    credit: 'NASA / JPL-Caltech / Space Science Institute / LPI (Cassini)',
  },
  tethys: {
    base: `${DIR}tethys.jpg`,
    tiles: { url: trek('Tethys', 'Tethys_Cassini_mosaic_global_293m', 'jpg'), maxZoom: 4 },
    credit: 'NASA / JPL / Space Science Institute / USGS (Cassini)',
  },
  dione: {
    base: `${DIR}dione.jpg`,
    tiles: { url: trek('Dione', 'Dione_Cassini_Voyageglobal_154m', 'jpg'), maxZoom: 5 },
    credit: 'NASA / JPL / Space Science Institute / USGS (Cassini, Voyager)',
  },
  rhea: {
    base: `${DIR}rhea.jpg`,
    tiles: { url: trek('Rhea', 'RH_120803_DLR_basemap', 'jpg'), maxZoom: 4 },
    credit: 'NASA / JPL-Caltech / Space Science Institute / LPI (Cassini)',
  },
  iapetus: { base: `${DIR}iapetus.jpg`, credit: 'NASA / JPL-Caltech / Space Science Institute / LPI (Cassini)' },
  phoebe: { base: `${DIR}phoebe.jpg`, credit: 'NASA / JPL / Space Science Institute (Cassini)' },
  titan: { base: `${DIR}titan.jpg`, credit: 'NASA / JPL-Caltech / Space Science Institute (Cassini), tinted' },
  uranus: { base: `${DIR}uranus.jpg`, credit: 'Solar System Scope (CC BY 4.0)' },
  miranda: { base: `${DIR}miranda.jpg`, credit: 'NASA / JPL / USGS (Voyager 2)' },
  ariel: { base: `${DIR}ariel.jpg`, credit: 'NASA / JPL / USGS (Voyager 2)' },
  umbriel: { base: `${DIR}umbriel.jpg`, credit: 'NASA / JPL / USGS (Voyager 2)' },
  titania: { base: `${DIR}titania.jpg`, credit: 'NASA / JPL / USGS (Voyager 2)' },
  oberon: { base: `${DIR}oberon.jpg`, credit: 'NASA / JPL / USGS (Voyager 2)' },
  neptune: { base: `${DIR}neptune.jpg`, credit: 'Solar System Scope (CC BY 4.0)' },
  triton: { base: `${DIR}triton.jpg`, credit: 'NASA / JPL / Paul Schenk, Lunar and Planetary Institute (Voyager 2)' },
  pluto: { base: `${DIR}pluto.jpg`, credit: 'NASA / JHUAPL / SwRI (New Horizons)' },
  charon: { base: `${DIR}charon.jpg`, credit: 'NASA / JHUAPL / SwRI (New Horizons)' },
};

const PD = 'Public domain (NASA)';
const CC = 'CC BY 4.0';
const SSS = 'Solar System Scope (solarsystemscope.com), based on NASA imagery';
const commons = (file: string): string => `https://commons.wikimedia.org/wiki/File:${file}`;
const trekLayer = (body: string, layer: string): string => `https://trek.nasa.gov/tiles/${body}/EQ/${layer}/`;

/**
 * Who made each picture, under what terms, and where it was taken from. One line per file;
 * `body` names what it shows (and what was changed, where anything was).
 */
/**
 * Worlds whose maps have parts no camera has photographed (given one flat tone in the bundled
 * map), with what is missing and why. The app draws an educated guess there by default
 * (worker/unseen.worker.ts; Settings → "Fill in unseen ground") and says so on the world's card.
 */
export const UNSEEN: Partial<Record<BodyId, string>> = {
  pluto: 'Its far south was in the dark of a decades-long winter when New Horizons flew past in 2015.',
  charon: 'Its far south was in the dark when New Horizons flew past in 2015.',
  triton: 'Its north was in the dark of a long winter when Voyager 2 flew past in 1989.',
  miranda: 'Its north was in the dark when Voyager 2 flew past in 1986, the only visit to Uranus.',
  ariel: 'Its north was in the dark when Voyager 2 flew past in 1986, the only visit to Uranus.',
  umbriel: 'Its north was in the dark when Voyager 2 flew past in 1986, the only visit to Uranus.',
  titania: 'Its north was in the dark when Voyager 2 flew past in 1986, the only visit to Uranus.',
  oberon: 'Its north was in the dark when Voyager 2 flew past in 1986, the only visit to Uranus.',
  phoebe: 'Cassini saw it closely from one side only, in 2004.',
  callisto: 'Small areas near its poles were never photographed in detail.',
};

export const IMAGE_CREDITS: { body: string; source: string; licence: string; url: string }[] = [
  { body: 'Sun', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_8k_sun.jpg') },
  { body: 'Mercury', source: 'NASA / Johns Hopkins University Applied Physics Laboratory / Carnegie Institution of Washington: MESSENGER MDIS global basemap, via NASA Solar System Treks', licence: PD, url: trekLayer('Mercury', 'Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m') },
  { body: 'Venus, surface', source: 'NASA / JPL / USGS: Magellan radar mosaic (C3-MDIR, colourised), via NASA Solar System Treks', licence: PD, url: trekLayer('Venus', 'Venus_Magellan_C3-MDIR_Colorized_Global_Mosaic_4641m') },
  { body: 'Venus, clouds', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_4k_venus_atmosphere.jpg') },
  { body: 'Earth', source: 'NASA Earth Observatory: Blue Marble', licence: PD, url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble' },
  { body: 'Moon', source: 'NASA Scientific Visualization Studio: CGI Moon Kit colour map, from Lunar Reconnaissance Orbiter Camera images (NASA / GSFC / Arizona State University)', licence: PD, url: 'https://svs.gsfc.nasa.gov/4720' },
  { body: 'Moon, streamed detail', source: 'NASA / GSFC / Arizona State University: LRO Wide Angle Camera global mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02') },
  { body: 'Mars', source: 'NASA / JPL / USGS: Viking Orbiter MDIM 2.1 colour mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m') },
  { body: 'Phobos', source: 'NASA / USGS Astrogeology / Philip Stooke: Viking Orbiter mosaic on DLR\'s control network, via NASA Solar System Treks', licence: PD, url: trekLayer('Phobos', 'Phobos_Viking_Mosaic_40ppd_DLRcontrol') },
  { body: 'Jupiter', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_8k_jupiter.jpg') },
  { body: 'Io', source: 'NASA / JPL / USGS: Galileo SSI and Voyager colour mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Io', 'Io_GalileoSSI_Voyager_Global_Mosaic_ClrMerge_1km') },
  { body: 'Europa', source: 'NASA / JPL-Caltech / SETI Institute: Voyager and Galileo SSI colour map, via NASA Solar System Treks', licence: PD, url: trekLayer('Europa', '20150218_europa_global_map_20000x10000') },
  { body: 'Ganymede', source: 'NASA / JPL / USGS: Voyager and Galileo SSI colour mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Ganymede', 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m') },
  { body: 'Callisto', source: 'NASA / JPL / USGS: Voyager and Galileo SSI mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km') },
  { body: 'Saturn', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_8k_saturn.jpg') },
  { body: 'Saturn, rings (cut down to a thin strip)', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_8k_saturn_ring_alpha.png') },
  { body: 'Mimas (a colour map used in grey, moved to the present zero of longitude)', source: 'NASA / JPL-Caltech / Space Science Institute / Lunar and Planetary Institute: Cassini ISS colour map (PIA18437)', licence: PD, url: commons('Map_of_Mimas_colorized_2014-04_PIA18437.jpg') },
  { body: 'Mimas, streamed detail', source: 'NASA / JPL / Space Science Institute / DLR: Cassini ISS global mosaic, read from NASA Solar System Treks (not bundled)', licence: 'NASA Planetary Data System', url: trekLayer('Mimas', 'MI_170630_DLR_basemap') },
  { body: 'Tethys', source: 'NASA / JPL / Space Science Institute / USGS Astrogeology: Cassini ISS global mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Tethys', 'Tethys_Cassini_mosaic_global_293m') },
  { body: 'Dione', source: 'NASA / JPL / Space Science Institute / USGS Astrogeology: Cassini ISS and Voyager global mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Dione', 'Dione_Cassini_Voyageglobal_154m') },
  { body: 'Rhea (a colour map used in grey)', source: 'NASA / JPL-Caltech / Space Science Institute / Lunar and Planetary Institute: Cassini ISS colour map (PIA18438)', licence: PD, url: commons('Rhea_Color_Map.jpg') },
  { body: 'Rhea, streamed detail', source: 'NASA / JPL / Space Science Institute / DLR: Cassini ISS global mosaic, read from NASA Solar System Treks (not bundled)', licence: 'NASA Planetary Data System', url: trekLayer('Rhea', 'RH_120803_DLR_basemap') },
  { body: 'Iapetus (re-centred on longitude 0)', source: 'NASA / JPL-Caltech / Space Science Institute / Lunar and Planetary Institute: Cassini ISS colour map (PIA18436)', licence: PD, url: commons('Iapetus_Color_Map.jpg') },
  { body: 'Phoebe (unseen parts: a flat tone, drawn as a guess by default)', source: 'NASA / JPL / Space Science Institute: Cassini ISS map (PIA07775)', licence: PD, url: commons('Phoebe_map_PIA07775_cropped.jpg') },
  { body: 'Enceladus', source: 'NASA / JPL-Caltech / Space Science Institute / Lunar and Planetary Institute: Cassini ISS colour mosaic, via NASA Solar System Treks', licence: PD, url: trekLayer('Enceladus', 'Enceladus_cyl_KH') },
  { body: 'Titan (a one-colour infrared map, tinted orange-brown here)', source: 'NASA / JPL-Caltech / Space Science Institute: Cassini ISS mosaic at 938 nm (PIA19658), via NASA Solar System Treks', licence: PD, url: trekLayer('Titan', 'Titan_ISS_P19658_Mosaic_Global_4km') },
  { body: 'Uranus', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_2k_uranus.jpg') },
  { body: 'Miranda, Ariel, Umbriel, Titania and Oberon (unseen northern halves: a flat tone, drawn as a guess by default)', source: 'Caltech / JPL / USGS: Voyager 2 mosaics from JPL\'s planetary map set', licence: PD, url: 'https://commons.wikimedia.org/wiki/Special:Search?search=%22map+JPL+USGS%22+Uranus&ns6=1' },
  { body: 'Neptune', source: SSS, licence: CC, url: commons('Solarsystemscope_texture_2k_neptune.jpg') },
  { body: 'Triton (unseen north: a flat tone, drawn as a guess by default)', source: 'NASA / JPL / Paul Schenk, Lunar and Planetary Institute: Voyager 2 colour map', licence: PD, url: commons('Triton_map_no_grid.jpg') },
  { body: 'Pluto (re-centred on longitude 0; unseen south: a flat tone, drawn as a guess by default)', source: 'NASA / Johns Hopkins University Applied Physics Laboratory / Southwest Research Institute: New Horizons global colour map', licence: PD, url: commons('Pluto_color_mapmosaic.jpg') },
  { body: 'Charon (unseen south: a flat tone, drawn as a guess by default)', source: 'NASA / Johns Hopkins University Applied Physics Laboratory / Southwest Research Institute: New Horizons global map', licence: PD, url: commons('Cpmap_cyl_PS717_HR_180.jpg') },
];
