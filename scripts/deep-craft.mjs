// scripts/deep-craft.mjs — the spacecraft beyond Earth orbit: the facts nobody can compute.
//
// fetch-deep.mjs asks JPL Horizons where each of these is and writes public/data/deep.json; the
// rest (what it is called, what people type when they look for it, who flies it, when it left)
// is this table. One row per craft:
//
//   horizons  JPL's number for it (negative for spacecraft); absent for a craft placed by its
//             landing site alone
//   centre    the body its motion is described about
//   path      'orbit'    an ellipse (or hyperbola) about `centre`
//             'samples'  positions at equal steps: for the halo orbits round the Sun–Earth L1 and
//                        L2 points and for TESS, which no single ellipse describes
//             'surface'  it stands on `centre` at `site` [latitude, east longitude]
//   stepMin   for 'samples': minutes between stored positions
//   model     one of the 3D models in src/render/satModels.ts
//   dsn       the names NASA's Deep Space Network feed uses for it (see src/space/dsn.ts). The
//             feed's own configuration lists none for JUICE, Solar Orbiter, Euclid or Hera,
//             which talk through ESA's stations
//   arrived   the day it got where it is now (entered orbit, landed, reached its station), UTC
//   ended     for a silent craft, the day of its last contact (or the day its agency ended
//             the mission, where that is the date on record)
//   massKg    mass at launch, kg (for a lander that rode on something bigger, the whole stack)
//
// Where the facts come from. Launch dates, arrival dates and masses were checked in November
// 2026 against JPL Horizons' own description of each craft (its "object data" page, which
// quotes the mission) and, where that page is silent, the mission's NASA, ESA, JAXA or ISRO
// press kit. A field is left out rather than guessed: a craft with no `massKg` here is one
// whose sources disagree (Europa Clipper, JUICE, Hayabusa2, Hera, the Voyagers) or give only
// a dry mass. Two notes: JPL's page for Voyager 1 says it was launched on 6 September 1977,
// against NSSDC's and the Voyager project's own 5 September, which is kept; and Hera's page
// lists its arrival at Didymos for 4 November 2026, too recent to confirm, so no `arrived`.
//
// Nothing here is in the CelesTrak catalogue the tracker already shows (Hubble, Chandra, XMM).
// Add a craft only if Horizons has a trajectory for it that covers today.

export const CRAFT = [
  // ── Round the Sun–Earth L2 point, 1.5 million km beyond the Earth ──────────────────────
  {
    id: 'webb', horizons: -170, centre: 'earth', path: 'samples', stepMin: 1440, model: 'webb', status: 'active',
    arrived: '2022-01-24', massKg: 6200,
    name: 'James Webb Space Telescope', short: 'Webb',
    aliases: ['jwst', 'james webb', 'webb telescope', 'james webber', 'james web', 'james webb telescope', 'jame webb', 'web telescope', 'webb space telescope'],
    agency: 'NASA / ESA / CSA', launched: '2021-12-25', role: 'Infrared space telescope',
    blurb: 'The largest telescope ever flown: a 6.5 m gold-coated mirror kept at −233 °C behind a sunshield the size of a tennis court. It circles the L2 point, 1.5 million km beyond the Earth.',
    wiki: 'James Webb Space Telescope', dsn: ['JWST'],
  },
  {
    id: 'euclid', horizons: -680, centre: 'earth', path: 'samples', stepMin: 1440, model: 'euclid', status: 'active',
    arrived: '2023-07-28',
    name: 'Euclid', short: 'Euclid', aliases: ['euclid telescope', 'euclid space telescope', 'euklid', 'dark energy telescope'],
    agency: 'ESA', launched: '2023-07-01', role: 'Dark-universe survey telescope',
    blurb: 'Maps the shapes and distances of billions of galaxies across a third of the sky to learn how dark matter and dark energy have shaped the universe.',
    wiki: 'Euclid (spacecraft)', dsn: [],
  },
  {
    id: 'roman', horizons: -211, centre: 'earth', path: 'samples', stepMin: 1440, model: 'euclid', status: 'active',
    name: 'Nancy Grace Roman Space Telescope', short: 'Roman',
    aliases: ['roman', 'roman telescope', 'roman space telescope', 'nancy grace roman', 'nancy roman', 'wfirst', 'rst'],
    agency: 'NASA', launched: '2026-08-30', role: 'Wide-field infrared telescope',
    blurb: 'A mirror the size of Hubble\'s with a field of view a hundred times wider, built to survey dark energy and to find planets by the way their gravity bends starlight.',
    wiki: 'Nancy Grace Roman Space Telescope', dsn: ['RST'],
  },
  // ── Round the Sun–Earth L1 point, 1.5 million km towards the Sun ───────────────────────
  {
    id: 'soho', horizons: -21, centre: 'earth', path: 'samples', stepMin: 1440, model: 'soho', status: 'active',
    arrived: '1996-02-14', massKg: 1850,
    name: 'Solar and Heliospheric Observatory', short: 'SOHO', aliases: ['soho', 'solar heliospheric observatory', 'solar and heliospheric observatory'],
    agency: 'ESA / NASA', launched: '1995-12-02', role: 'Sun-watching observatory',
    blurb: 'Has stared at the Sun without a break since 1996 and, almost by accident, discovered more than five thousand comets.',
    wiki: 'Solar and Heliospheric Observatory', dsn: ['SOHO'],
  },
  {
    id: 'dscovr', horizons: -78, centre: 'earth', path: 'samples', stepMin: 1440, model: 'l1monitor', status: 'active',
    arrived: '2015-06-08', massKg: 570,
    name: 'Deep Space Climate Observatory', short: 'DSCOVR', aliases: ['dscovr', 'discover', 'dscover', 'deep space climate observatory', 'epic camera'],
    agency: 'NOAA / NASA', launched: '2015-02-11', role: 'Space-weather sentinel and Earth camera',
    blurb: 'Gives up to an hour\'s warning of solar storms, and photographs the whole sunlit face of the Earth every couple of hours.',
    wiki: 'Deep Space Climate Observatory', dsn: ['DSCO'],
  },
  {
    id: 'ace', horizons: -92, centre: 'earth', path: 'samples', stepMin: 1440, model: 'l1monitor', status: 'active',
    arrived: '1997-12-12', massKg: 785,
    name: 'Advanced Composition Explorer', short: 'ACE', aliases: ['ace', 'advanced composition explorer'],
    agency: 'NASA', launched: '1997-08-25', role: 'Solar-wind monitor',
    blurb: 'Samples the particles streaming from the Sun and from between the stars; its readings have fed space-weather forecasts since 1998.',
    wiki: 'Advanced Composition Explorer', dsn: ['ACE'],
  },
  {
    id: 'wind', horizons: -8, centre: 'earth', path: 'samples', stepMin: 1440, model: 'l1monitor', status: 'active',
    massKg: 1250,
    name: 'Wind', short: 'Wind', aliases: ['wind spacecraft', 'wind satellite', 'ggs wind'],
    agency: 'NASA', launched: '1994-11-01', role: 'Solar-wind laboratory',
    blurb: 'A spinning drum of instruments measuring the solar wind before it reaches the Earth, still at work after more than thirty years.',
    wiki: 'Wind (spacecraft)', dsn: ['WIND'],
  },
  {
    id: 'imap', horizons: -43, centre: 'earth', path: 'samples', stepMin: 1440, model: 'l1monitor', status: 'active',
    massKg: 900,
    name: 'Interstellar Mapping and Acceleration Probe', short: 'IMAP', aliases: ['imap', 'interstellar mapping and acceleration probe', 'interstellar mapping probe'],
    agency: 'NASA', launched: '2025-09-24', role: 'Heliosphere mapper',
    blurb: 'Spins four times a minute to map the edge of the Sun\'s bubble in space, using atoms that drift in from beyond it.',
    wiki: 'Interstellar Mapping and Acceleration Probe', dsn: ['IMAP'],
  },
  {
    id: 'carruthers', horizons: -171, centre: 'earth', path: 'samples', stepMin: 1440, model: 'l1monitor', status: 'active',
    name: 'Carruthers Geocorona Observatory', short: 'Carruthers', aliases: ['carruthers', 'geocorona observatory', 'cgo', 'glide'],
    agency: 'NASA', launched: '2025-09-24', role: 'Ultraviolet camera watching the Earth\'s outermost atmosphere',
    blurb: 'Looks back from L1 at the faint ultraviolet glow of hydrogen that surrounds the Earth out to beyond the Moon.',
    wiki: 'Carruthers Geocorona Observatory', dsn: ['CGO'],
  },
  // ── High round the Earth ──────────────────────────────────────────────────────────────
  {
    id: 'tess', horizons: -95, centre: 'earth', path: 'samples', stepMin: 240, model: 'tess', status: 'active',
    massKg: 362,
    name: 'Transiting Exoplanet Survey Satellite', short: 'TESS', aliases: ['tess', 'transiting exoplanet survey satellite', 'exoplanet satellite', 'planet hunter'],
    agency: 'NASA', launched: '2018-04-18', role: 'Planet-hunting telescope',
    blurb: 'Watches the nearest stars for the tiny dips of planets crossing them, from a long orbit that goes round twice for every circuit of the Moon.',
    wiki: 'Transiting Exoplanet Survey Satellite', dsn: ['TESS'],
  },
  // ── At the Moon ───────────────────────────────────────────────────────────────────────
  {
    id: 'lro', horizons: -85, centre: 'moon', path: 'orbit', model: 'lunarorbiter', status: 'active',
    arrived: '2009-06-23', massKg: 1916,
    name: 'Lunar Reconnaissance Orbiter', short: 'LRO', aliases: ['lro', 'lunar reconnaissance orbiter', 'lunar orbiter', 'moon orbiter'],
    agency: 'NASA', launched: '2009-06-18', role: 'Moon mapper',
    blurb: 'Has photographed nearly the whole Moon sharply enough to show the Apollo landers and the astronauts\' footpaths.',
    wiki: 'Lunar Reconnaissance Orbiter', dsn: ['LRO'],
  },
  {
    id: 'chandrayaan-2', horizons: -152, centre: 'moon', path: 'orbit', model: 'lunarorbiter', status: 'active',
    arrived: '2019-08-20', massKg: 3850,
    name: 'Chandrayaan-2 orbiter', short: 'Chandrayaan-2', aliases: ['chandrayaan 2', 'chandrayaan2', 'chandrayan 2', 'chandrayaan', 'indian moon orbiter'],
    agency: 'ISRO', launched: '2019-07-22', role: 'Moon orbiter',
    blurb: 'India\'s second lunar mission: its lander was lost, but the orbiter has mapped the Moon and its water ice from a polar orbit ever since.',
    wiki: 'Chandrayaan-2', dsn: ['CH2', 'CH2O'],
  },
  {
    id: 'danuri', horizons: -155, centre: 'moon', path: 'orbit', model: 'lunarorbiter', status: 'active',
    arrived: '2022-12-16', massKg: 678,
    name: 'Danuri (Korea Pathfinder Lunar Orbiter)', short: 'Danuri', aliases: ['danuri', 'kplo', 'korea pathfinder lunar orbiter', 'korean moon orbiter', 'korean lunar orbiter'],
    agency: 'KARI', launched: '2022-08-04', role: 'Moon orbiter',
    blurb: 'South Korea\'s first craft beyond Earth orbit; one of its cameras can see inside the Moon\'s permanently shadowed craters.',
    wiki: 'Danuri', dsn: ['KPLO'],
  },
  // ── At Mars ───────────────────────────────────────────────────────────────────────────
  {
    id: 'mars-odyssey', horizons: -53, centre: 'mars', path: 'orbit', model: 'marsorbiter', status: 'active',
    arrived: '2001-10-24', massKg: 725,
    name: '2001 Mars Odyssey', short: 'Odyssey', aliases: ['mars odyssey', 'odyssey', '2001 mars odyssey', 'oddysey', 'odyssey orbiter'],
    agency: 'NASA', launched: '2001-04-07', role: 'Mars orbiter and rover relay',
    blurb: 'The longest-serving spacecraft at another planet: it found buried water ice and has relayed most of what the rovers have sent home.',
    wiki: '2001 Mars Odyssey', dsn: ['M01O', 'M01S'],
  },
  {
    id: 'mro', horizons: -74, centre: 'mars', path: 'orbit', model: 'marsorbiter', status: 'active',
    arrived: '2006-03-10', massKg: 2180,
    name: 'Mars Reconnaissance Orbiter', short: 'MRO', aliases: ['mro', 'mars reconnaissance orbiter', 'mars reconnaisance orbiter', 'hirise'],
    agency: 'NASA', launched: '2005-08-12', role: 'Sharp-eyed Mars camera and relay',
    blurb: 'Carries the largest telescope sent to another planet; it can pick out a rover and its tracks from 300 km up.',
    wiki: 'Mars Reconnaissance Orbiter', dsn: ['MRO', 'MROS'],
  },
  {
    id: 'mars-express', horizons: -41, centre: 'mars', path: 'orbit', model: 'marsorbiter', status: 'active',
    arrived: '2003-12-25', massKg: 1223,
    name: 'Mars Express', short: 'Mars Express', aliases: ['mars express', 'mex', 'mars expres'],
    agency: 'ESA', launched: '2003-06-02', role: 'Mars orbiter',
    blurb: 'Europe\'s first planetary mission, on a long looping orbit that also takes it close past the moon Phobos.',
    wiki: 'Mars Express', dsn: ['MEX'],
  },
  {
    id: 'tgo', horizons: -143, centre: 'mars', path: 'orbit', model: 'marsorbiter', status: 'active',
    arrived: '2016-10-19', massKg: 4332,
    name: 'ExoMars Trace Gas Orbiter', short: 'TGO', aliases: ['tgo', 'trace gas orbiter', 'exomars', 'exomars orbiter', 'exo mars'],
    agency: 'ESA / Roscosmos', launched: '2016-03-14', role: 'Atmosphere analyser and rover relay',
    blurb: 'Sniffs the Martian air for gases such as methane at a few parts in a trillion, and passes on data from the rovers below.',
    wiki: 'Trace Gas Orbiter', dsn: ['TGO'],
  },
  {
    id: 'hope', horizons: -62, centre: 'mars', path: 'orbit', model: 'marsorbiter', status: 'active',
    arrived: '2021-02-09', massKg: 1350,
    name: 'Emirates Mars Mission (Hope)', short: 'Hope', aliases: ['hope', 'hope probe', 'al amal', 'emirates mars mission', 'emm', 'uae mars'],
    agency: 'UAE Space Agency', launched: '2020-07-19', role: 'Mars weather satellite',
    blurb: 'The first Arab mission to another planet, on a high orbit from which it sees a whole hemisphere of Martian weather at a time.',
    wiki: 'Emirates Mars Mission', dsn: ['EMM'],
  },
  {
    // Placed where Horizons says the rover is today (it has driven about 35 km since landing);
    // `site` is the landing place, used if that request fails.
    id: 'curiosity', horizons: -76, centre: 'mars', path: 'surface', site: [-4.5895, 137.4417], model: 'rover', status: 'active',
    arrived: '2012-08-06', massKg: 3893,
    name: 'Curiosity (Mars Science Laboratory)', short: 'Curiosity', aliases: ['curiosity', 'curiosity rover', 'msl', 'mars science laboratory', 'curiousity', 'mars rover'],
    agency: 'NASA', launched: '2011-11-26', role: 'Mars rover',
    blurb: 'A car-sized, nuclear-powered rover that has been climbing Mount Sharp in Gale crater since 2012, reading the layers of an ancient lake bed.',
    wiki: 'Curiosity (rover)', dsn: ['MSL'],
  },
  {
    id: 'perseverance', centre: 'mars', path: 'surface', site: [18.4447, 77.4508], model: 'rover', status: 'active',
    arrived: '2021-02-18',
    name: 'Perseverance (Mars 2020)', short: 'Perseverance', aliases: ['perseverance', 'perseverance rover', 'percy', 'mars 2020', 'perserverance', 'perseverence', 'ingenuity'],
    agency: 'NASA', launched: '2020-07-30', role: 'Mars rover',
    blurb: 'Collects rock cores in and around Jezero crater, once a river delta, for a later mission to bring back; it carried the helicopter Ingenuity.',
    wiki: 'Perseverance (rover)', dsn: ['M20'],
  },
  {
    id: 'insight', centre: 'mars', path: 'surface', site: [4.502, 135.623], model: 'lander', status: 'silent',
    arrived: '2018-11-26', ended: '2022-12-15', massKg: 694,
    name: 'InSight', short: 'InSight', aliases: ['insight', 'insight lander', 'mars insight'],
    agency: 'NASA', launched: '2018-05-05', role: 'Mars lander (seismometer)',
    blurb: 'Listened to more than 1,300 marsquakes and measured the size of the planet\'s core before dust on its solar panels ended the mission in December 2022.',
    wiki: 'InSight', dsn: ['NSYT'],
  },
  {
    id: 'zhurong', centre: 'mars', path: 'surface', site: [25.066, 109.925], model: 'rover', status: 'silent',
    arrived: '2021-05-14', ended: '2022-05-18',
    name: 'Zhurong (Tianwen-1 rover)', short: 'Zhurong', aliases: ['zhurong', 'tianwen', 'tianwen-1', 'tianwen 1', 'chinese mars rover'],
    agency: 'CNSA', launched: '2020-07-23', role: 'Mars rover',
    blurb: 'China\'s first Mars rover drove nearly two kilometres across Utopia Planitia; it went into hibernation for the winter of 2022 and has not woken.',
    wiki: 'Zhurong (rover)', dsn: [],
  },
  // ── Landers on the Moon (their missions are over; they are still there) ────────────────
  {
    id: 'blue-ghost', centre: 'moon', path: 'surface', site: [18.56, 61.81], model: 'lander', status: 'silent',
    arrived: '2025-03-02', ended: '2025-03-16',
    name: 'Blue Ghost Mission 1', short: 'Blue Ghost', aliases: ['blue ghost', 'firefly lander', 'firefly blue ghost', 'blueghost'],
    agency: 'Firefly Aerospace / NASA', launched: '2025-01-15', role: 'Moon lander',
    blurb: 'The first fully successful commercial Moon landing: it worked in Mare Crisium for a whole lunar day in March 2025 and filmed a sunset there.',
    wiki: 'Blue Ghost Mission 1', dsn: [],
  },
  {
    id: 'odysseus', centre: 'moon', path: 'surface', site: [-80.13, 1.44], model: 'lander', status: 'silent',
    arrived: '2024-02-22', ended: '2024-02-29',
    name: 'Odysseus (IM-1)', short: 'Odysseus', aliases: ['odysseus', 'im-1', 'im1', 'intuitive machines', 'nova-c'],
    agency: 'Intuitive Machines / NASA', launched: '2024-02-15', role: 'Moon lander',
    blurb: 'The first American landing on the Moon since Apollo 17; it came down near the south pole in February 2024, tipped onto its side and still sent data for six days.',
    wiki: 'IM-1', dsn: [],
  },
  {
    id: 'vikram', centre: 'moon', path: 'surface', site: [-69.373, 32.319], model: 'lander', status: 'silent',
    arrived: '2023-08-23', ended: '2023-09-04', massKg: 3900,
    name: 'Chandrayaan-3 lander (Vikram)', short: 'Vikram', aliases: ['vikram', 'chandrayaan 3', 'chandrayaan-3', 'chandrayaan3', 'pragyan', 'chandrayan 3'],
    agency: 'ISRO', launched: '2023-07-14', role: 'Moon lander and rover',
    blurb: 'Made India the fourth country to land on the Moon, in August 2023, and the first near its south pole; the small rover Pragyan drove off its ramp.',
    wiki: 'Chandrayaan-3', dsn: ['CH3'],
  },
  {
    id: 'slim', centre: 'moon', path: 'surface', site: [-13.316, 25.251], model: 'lander', status: 'silent',
    arrived: '2024-01-19',
    name: 'SLIM (Smart Lander for Investigating Moon)', short: 'SLIM', aliases: ['slim', 'moon sniper', 'smart lander for investigating moon', 'japan moon lander'],
    agency: 'JAXA', launched: '2023-09-06', role: 'Moon lander',
    blurb: 'Japan\'s "Moon Sniper" landed within 55 m of its target in January 2024, ended up on its nose, and still survived three lunar nights.',
    wiki: 'Smart Lander for Investigating Moon', dsn: ['SLIM'],
  },
  // ── At Jupiter ────────────────────────────────────────────────────────────────────────
  {
    id: 'juno', horizons: -61, centre: 'jupiter', path: 'orbit', model: 'juno', status: 'active',
    arrived: '2016-07-05', massKg: 3625,
    name: 'Juno', short: 'Juno', aliases: ['juno', 'juno probe', 'juno spacecraft', 'jupiter orbiter', 'junocam'],
    agency: 'NASA', launched: '2011-08-05', role: 'Jupiter polar orbiter',
    blurb: 'A spinning, solar-powered craft on a long orbit over Jupiter\'s poles; each close pass skims the cloud tops at 200,000 km/h.',
    wiki: 'Juno (spacecraft)', dsn: ['JNO'],
  },
  // ── On their way ──────────────────────────────────────────────────────────────────────
  {
    id: 'europa-clipper', horizons: -159, centre: 'sun', path: 'orbit', model: 'clipper', status: 'active',
    name: 'Europa Clipper', short: 'Europa Clipper', aliases: ['europa clipper', 'clipper', 'europa mission', 'europa cliper', 'europa probe'],
    agency: 'NASA', launched: '2024-10-14', role: 'Europa explorer, on its way',
    blurb: 'The largest planetary spacecraft NASA has built, due at Jupiter in 2030 to fly past Europa about fifty times and learn whether its ocean could support life.',
    wiki: 'Europa Clipper', dsn: ['EURC'],
  },
  {
    id: 'juice', horizons: -28, centre: 'sun', path: 'orbit', model: 'clipper', status: 'active',
    name: 'Jupiter Icy Moons Explorer', short: 'JUICE', aliases: ['juice', 'jupiter icy moons explorer', 'jupiter icy moon explorer', 'esa juice'],
    agency: 'ESA', launched: '2023-04-14', role: 'Jupiter moons explorer, on its way',
    blurb: 'Due at Jupiter in 2031 to study Europa, Callisto and above all Ganymede, where it is to become the first craft to orbit a moon of another planet.',
    wiki: 'Jupiter Icy Moons Explorer', dsn: [],
  },
  {
    id: 'bepicolombo', horizons: -121, centre: 'sun', path: 'orbit', model: 'bepi', status: 'active',
    massKg: 4100,
    name: 'BepiColombo', short: 'BepiColombo', aliases: ['bepicolombo', 'bepi colombo', 'bepi', 'bepi columbo', 'mercury orbiter'],
    agency: 'ESA / JAXA', launched: '2018-10-20', role: 'Mercury orbiters',
    blurb: 'Two orbiters, one European and one Japanese, travelling as a single stack; after nine fly-bys of the Earth, Venus and Mercury they arrive at Mercury in late 2026.',
    wiki: 'BepiColombo', dsn: ['BEPI'],
  },
  {
    id: 'lucy', horizons: -49, centre: 'sun', path: 'orbit', model: 'lucy', status: 'active',
    massKg: 1550,
    name: 'Lucy', short: 'Lucy', aliases: ['lucy', 'lucy mission', 'lucy spacecraft', 'trojan asteroids'],
    agency: 'NASA', launched: '2021-10-16', role: 'Trojan-asteroid explorer',
    blurb: 'On a twelve-year tour of the Trojans, the asteroids that share Jupiter\'s orbit and have hardly changed since the planets formed.',
    wiki: 'Lucy (spacecraft)', dsn: ['LUCY'],
  },
  {
    id: 'psyche', horizons: -255, centre: 'sun', path: 'orbit', model: 'psyche', status: 'active',
    massKg: 2747,
    name: 'Psyche', short: 'Psyche', aliases: ['psyche', 'psyche mission', 'psyche spacecraft', 'metal asteroid', 'psyce'],
    agency: 'NASA', launched: '2023-10-13', role: 'Metal-asteroid orbiter, on its way',
    blurb: 'Flying on ion engines to the asteroid 16 Psyche, which may be the exposed iron core of a world that never finished forming; it arrives in 2029.',
    wiki: 'Psyche (spacecraft)', dsn: ['PSYC'],
  },
  {
    id: 'osiris-apex', horizons: -64, centre: 'sun', path: 'orbit', model: 'samplereturn', status: 'active',
    massKg: 2110,
    name: 'OSIRIS-APEX', short: 'OSIRIS-APEX', aliases: ['osiris-apex', 'osiris apex', 'osiris-rex', 'osiris rex', 'osirisrex', 'osiris', 'bennu', 'apophis mission'],
    agency: 'NASA', launched: '2016-09-08', role: 'Asteroid explorer bound for Apophis',
    blurb: 'As OSIRIS-REx it brought home 121 g of the asteroid Bennu in 2023; renamed, it is heading for Apophis, to arrive just after that asteroid\'s close pass of the Earth in 2029.',
    wiki: 'OSIRIS-REx', dsn: ['ORX'],
  },
  {
    id: 'hayabusa2', horizons: -37, centre: 'sun', path: 'orbit', model: 'samplereturn', status: 'active',
    name: 'Hayabusa2', short: 'Hayabusa2', aliases: ['hayabusa2', 'hayabusa 2', 'hayabusa', 'hyabusa', 'ryugu'],
    agency: 'JAXA', launched: '2014-12-03', role: 'Asteroid sample-return craft',
    blurb: 'Delivered pieces of the asteroid Ryugu to the Earth in 2020 and flew on; its extended mission is to reach a small, fast-spinning asteroid in 2031.',
    wiki: 'Hayabusa2', dsn: ['HYB2'],
  },
  {
    id: 'hera', horizons: -91, centre: 'sun', path: 'orbit', model: 'samplereturn', status: 'active',
    name: 'Hera', short: 'Hera', aliases: ['hera', 'hera mission', 'hera spacecraft', 'didymos', 'dimorphos', 'dart follow-up'],
    agency: 'ESA', launched: '2024-10-07', role: 'Asteroid-deflection investigator',
    blurb: 'Sent to the double asteroid Didymos, which it was due to reach in late 2026, to measure the crater and the change of orbit left when NASA\'s DART deliberately hit its small moon in 2022.',
    wiki: 'Hera (space mission)', dsn: [],
  },
  {
    id: 'mmx', horizons: -239, centre: 'sun', path: 'orbit', model: 'samplereturn', status: 'active',
    massKg: 4480,
    name: 'Martian Moons eXploration', short: 'MMX', aliases: ['mmx', 'martian moons exploration', 'martian moons explorer', 'phobos sample return', 'phobos mission'],
    agency: 'JAXA', launched: '2026-10-19', role: 'Phobos sample-return mission, on its way',
    blurb: 'Due at Mars in 2027 to land on its moon Phobos, collect at least ten grams of the surface and bring them back to the Earth in 2031.',
    wiki: 'Martian Moons eXploration', dsn: ['MMX'],
  },
  // ── Round the Sun ─────────────────────────────────────────────────────────────────────
  {
    id: 'parker', horizons: -96, centre: 'sun', path: 'orbit', model: 'parker', status: 'active',
    massKg: 685,
    name: 'Parker Solar Probe', short: 'Parker', aliases: ['parker', 'parker solar probe', 'parker probe', 'solar probe', 'psp', 'sun probe'],
    agency: 'NASA', launched: '2018-08-12', role: 'Sun-grazing probe',
    blurb: 'The fastest object people have made: it dives to within 6.1 million km of the Sun\'s surface at 690,000 km/h, through the Sun\'s own atmosphere.',
    wiki: 'Parker Solar Probe', dsn: ['SPP'],
  },
  {
    id: 'solar-orbiter', horizons: -144, centre: 'sun', path: 'orbit', model: 'solarorbiter', status: 'active',
    massKg: 1800,
    name: 'Solar Orbiter', short: 'Solar Orbiter', aliases: ['solar orbiter', 'solo', 'solar orbitor', 'esa solar orbiter'],
    agency: 'ESA / NASA', launched: '2020-02-10', role: 'Sun observatory',
    blurb: 'Photographs the Sun from inside Mercury\'s orbit and is tilting its own orbit, pass by pass, to give the first clear views of the Sun\'s poles.',
    wiki: 'Solar Orbiter', dsn: [],
  },
  {
    id: 'stereo-a', horizons: -234, centre: 'sun', path: 'orbit', model: 'stereo', status: 'active',
    massKg: 620,
    name: 'STEREO-A', short: 'STEREO-A', aliases: ['stereo', 'stereo a', 'stereo-a', 'stereo ahead', 'solar terrestrial relations observatory'],
    agency: 'NASA', launched: '2006-10-26', role: 'Sun observatory',
    blurb: 'Orbits the Sun slightly faster than the Earth, so it sees solar storms from an angle no telescope near the Earth can.',
    wiki: 'STEREO', dsn: ['STA'],
  },
  {
    id: 'biosentinel', horizons: -70007, centre: 'sun', path: 'orbit', model: 'probe', status: 'active',
    massKg: 14,
    name: 'BioSentinel', short: 'BioSentinel', aliases: ['biosentinel', 'bio sentinel', 'cubesat'],
    agency: 'NASA', launched: '2022-11-16', role: 'Deep-space radiation CubeSat',
    blurb: 'A satellite the size of a cereal box that rode along with Artemis I and now measures the radiation of deep space from its own orbit round the Sun.',
    wiki: 'BioSentinel', dsn: ['BIOS'],
  },
  // ── Leaving the solar system ──────────────────────────────────────────────────────────
  {
    id: 'voyager-1', horizons: -31, centre: 'sun', path: 'orbit', model: 'voyager', status: 'active',
    name: 'Voyager 1', short: 'Voyager 1', aliases: ['voyager', 'voyager 1', 'voyager1', 'voyager one', 'voyger', 'voyager i', 'golden record'],
    agency: 'NASA', launched: '1977-09-05', role: 'Interstellar probe',
    blurb: 'The most distant thing people have made. It passed Jupiter and Saturn, crossed into interstellar space in 2012 and still answers, on a signal that takes about a day to arrive.',
    wiki: 'Voyager 1', dsn: ['VGR1'],
  },
  {
    id: 'voyager-2', horizons: -32, centre: 'sun', path: 'orbit', model: 'voyager', status: 'active',
    name: 'Voyager 2', short: 'Voyager 2', aliases: ['voyager 2', 'voyager2', 'voyager two', 'voyger 2', 'voyager ii'],
    agency: 'NASA', launched: '1977-08-20', role: 'Interstellar probe',
    blurb: 'The only spacecraft to have visited Uranus and Neptune; it followed its twin into interstellar space in 2018.',
    wiki: 'Voyager 2', dsn: ['VGR2'],
  },
  {
    id: 'new-horizons', horizons: -98, centre: 'sun', path: 'orbit', model: 'newhorizons', status: 'active',
    massKg: 478,
    name: 'New Horizons', short: 'New Horizons', aliases: ['new horizons', 'newhorizons', 'new horizon', 'pluto probe', 'pluto mission'],
    agency: 'NASA', launched: '2006-01-19', role: 'Pluto and Kuiper-belt probe',
    blurb: 'Flew past Pluto in 2015 and the small world Arrokoth in 2019, and is now crossing the Kuiper belt on its way out of the solar system.',
    wiki: 'New Horizons', dsn: ['NHPC'],
  },
  {
    id: 'pioneer-10', horizons: -23, centre: 'sun', path: 'orbit', model: 'pioneer', status: 'silent',
    ended: '2003-01-23', massKg: 258,
    name: 'Pioneer 10', short: 'Pioneer 10', aliases: ['pioneer', 'pioneer 10', 'pioneer10', 'pioneer ten', 'pioner 10'],
    agency: 'NASA', launched: '1972-03-03', role: 'First probe to Jupiter',
    blurb: 'The first craft through the asteroid belt and past Jupiter. Its last faint signal was heard in January 2003; it coasts on towards the star Aldebaran.',
    wiki: 'Pioneer 10', dsn: [],
  },
  {
    id: 'pioneer-11', horizons: -24, centre: 'sun', path: 'orbit', model: 'pioneer', status: 'silent',
    ended: '1995-11-24', massKg: 259,
    name: 'Pioneer 11', short: 'Pioneer 11', aliases: ['pioneer 11', 'pioneer11', 'pioneer eleven', 'pioner 11'],
    agency: 'NASA', launched: '1973-04-06', role: 'First probe to Saturn',
    blurb: 'Used Jupiter\'s gravity to become the first craft to reach Saturn, in 1979. Contact ended in 1995.',
    wiki: 'Pioneer 11', dsn: [],
  },
  // ── Retired, and still out there ──────────────────────────────────────────────────────
  {
    id: 'gaia', horizons: -139479, centre: 'sun', path: 'orbit', model: 'euclid', status: 'silent',
    ended: '2025-03-27', massKg: 2029,
    name: 'Gaia', short: 'Gaia', aliases: ['gaia', 'gaia telescope', 'gaia spacecraft', 'gaia mission'],
    agency: 'ESA', launched: '2013-12-19', role: 'Star-mapping telescope (retired)',
    blurb: 'Measured the positions and motions of nearly two billion stars from L2. Out of fuel, it was moved to an orbit round the Sun and switched off in March 2025.',
    wiki: 'Gaia (spacecraft)', dsn: ['GAIA'],
  },
  {
    id: 'kepler', horizons: -227, centre: 'sun', path: 'orbit', model: 'euclid', status: 'silent',
    ended: '2018-11-15', massKg: 1052,
    name: 'Kepler space telescope', short: 'Kepler', aliases: ['kepler', 'kepler telescope', 'kepler space telescope', 'keplar'],
    agency: 'NASA', launched: '2009-03-07', role: 'Planet-hunting telescope (retired)',
    blurb: 'Found more than 2,600 planets round other stars by staring at one patch of sky. It ran out of fuel in 2018 and trails the Earth round the Sun.',
    wiki: 'Kepler space telescope', dsn: ['KEPL'],
  },
  {
    id: 'spitzer', horizons: -79, centre: 'sun', path: 'orbit', model: 'euclid', status: 'silent',
    ended: '2020-01-30', massKg: 950,
    name: 'Spitzer Space Telescope', short: 'Spitzer', aliases: ['spitzer', 'spitzer telescope', 'spitzer space telescope', 'spitser'],
    agency: 'NASA', launched: '2003-08-25', role: 'Infrared telescope (retired)',
    blurb: 'NASA\'s infrared Great Observatory worked for sixteen years, drifting ever further behind the Earth, until it was switched off in January 2020.',
    wiki: 'Spitzer Space Telescope', dsn: ['STF'],
  },
  {
    id: 'ulysses', horizons: -55, centre: 'sun', path: 'orbit', model: 'probe', status: 'silent',
    ended: '2009-06-30', massKg: 370,
    name: 'Ulysses', short: 'Ulysses', aliases: ['ulysses', 'ulysses probe', 'ulyses'],
    agency: 'ESA / NASA', launched: '1990-10-06', role: 'Solar polar probe (retired)',
    blurb: 'Used Jupiter to swing out of the plane of the planets and pass over the Sun\'s poles three times; it fell silent in 2009 and is still on that tilted orbit.',
    wiki: 'Ulysses (spacecraft)', dsn: ['ULYS'],
  },
  {
    id: 'dawn', horizons: -203, centre: 'sun', path: 'orbit', model: 'probe', status: 'silent',
    arrived: '2015-03-06', ended: '2018-10-31', massKg: 1218,
    name: 'Dawn', short: 'Dawn', aliases: ['dawn', 'dawn spacecraft', 'dawn mission', 'ceres', 'vesta'],
    agency: 'NASA', launched: '2007-09-27', role: 'Asteroid-belt orbiter (retired)',
    blurb: 'The only craft to have orbited two worlds beyond the Earth, Vesta and then Ceres. Its fuel ran out in 2018; it will circle Ceres for decades yet.',
    wiki: 'Dawn (spacecraft)', dsn: ['DAWN'],
  },
  {
    id: 'roadster', horizons: -143205, centre: 'sun', path: 'orbit', model: 'roadster', status: 'silent',
    name: 'SpaceX Roadster ("Starman")', short: 'Roadster', aliases: ['tesla', 'tesla roadster', 'roadster', 'starman', 'spacex roadster', 'elon musk car', 'space car'],
    agency: 'SpaceX', launched: '2018-02-06', role: 'A car, launched as a test payload',
    blurb: 'The dummy cargo of the first Falcon Heavy: a sports car with a spacesuited mannequin at the wheel, on an orbit that reaches out past Mars. It was never able to send anything back.',
    wiki: 'Elon Musk\'s Tesla Roadster', dsn: [],
  },
];
