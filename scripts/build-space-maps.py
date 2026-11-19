#!/usr/bin/env python3
"""scripts/build-space-maps.py: how every file in public/textures/space/ was made.

    python3 -I scripts/build-space-maps.py <an empty folder for the downloads>

Run by hand, once (and again only to change a map); the results are committed. It needs Python
with Pillow, which is not a dependency of the project itself: nothing in `npm run build` calls
this. src/space/imagery.ts lists the results and where each came from.

Every map comes out the same way: 2:1 equirectangular, north up, longitude 0 in the middle,
east to the right, 2048 pixels wide (4096 for the four `-4k` files; 1024 for Enceladus, Phoebe
and Uranus's moons, whose sources are no finer), JPEG.

Two kinds of source, in the owner's order of preference:

  1. NASA / JPL / USGS mosaics, public domain. Most are read as map tiles from NASA's Solar
     System Treks (trek.nasa.gov), whose tile grid already has longitude -180 at the left edge
     for every body: level 2 is 8 x 4 tiles of 256 px, exactly a 2048 x 1024 map, level 3 a
     4096 x 2048 one. The Moon is NASA's own colour map (Scientific Visualization Studio, "CGI
     Moon Kit"); Pluto, Charon and Triton are NASA maps held on Wikimedia Commons. Pluto's
     is drawn with longitude 180 in the middle and is rolled half a turn here; the other two
     already have longitude 0 there (checked against the gridded copies of the same maps).
  2. The "Solar System Scope" textures (CC BY 4.0, confirmed per file through the Commons
     API), for what has no surface to map: the Sun, the four giant planets, Saturn's rings and
     the clouds of Venus. Read from Wikimedia Commons; their own site is not touched.

Changes made here, all recorded in IMAGE_CREDITS: resizing; the half-turn roll just mentioned;
Titan's map (one infrared wavelength, so grey) is given the orange-brown of the moon's haze;
Saturn's rings are cut down to a thin strip; the colour maps of Mimas and Rhea are used in
grey; and the parts of a world no camera has seen (black in the sources) are filled with the
flat average tone of the rest (fill_unseen below says which and why).

Beside every map a 256-pixel copy named <name>_s.jpg is written: the solar-system view draws
all the bodies at once from those.

Politeness: one request at a time with a pause, a generic User-Agent, and every download is
kept in the folder given so a second run asks for nothing again.
"""

import io
import os
import subprocess
import sys
import time

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

Image.MAX_IMAGE_PIXELS = 220_000_000  # the Triton original is 100 megapixels; these are known files

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'textures', 'space')
TREK = 'https://trek.nasa.gov/tiles/{body}/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}'
COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/'


def download(url, cache, name):
    """One file, kept in the cache folder; curl because it uses the system's certificates."""
    path = os.path.join(cache, name)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        subprocess.run(['curl', '-s', '-f', '-L', '-m', '300', '-A', 'orbit-viewer/1.0', '-o', path, url], check=True)
        time.sleep(0.2 if 'trek.nasa.gov' in url else 1.5)
    return path


def trek(cache, body, layer, ext, z):
    """Stitch one level of a Trek layer: 2^(z+1) x 2^z tiles of 256 px, longitude -180 at the left."""
    cols, rows = 2 << z, 1 << z
    sheet = Image.new('RGB', (cols * 256, rows * 256))
    for y in range(rows):
        for x in range(cols):
            path = download(TREK.format(body=body, layer=layer, ext=ext, z=z, y=y, x=x), cache, f'{body}_{layer}_{z}_{y}_{x}.{ext}')
            sheet.paste(Image.open(path).convert('RGB'), (x * 256, y * 256))
    return sheet


def commons(cache, path):
    return Image.open(download(COMMONS + path, cache, path.replace('/', '_')))


def roll_half(image):
    """A map drawn with longitude 180 in the middle -> longitude 0 in the middle."""
    w, h = image.size
    out = Image.new(image.mode, (w, h))
    out.paste(image.crop((w // 2, 0, w, h)), (0, 0))
    out.paste(image.crop((0, 0, w // 2, h)), (w - w // 2, 0))
    return out


def tint(image, dark, light):
    """A one-filter (grey) map coloured along a line from `dark` to `light`."""
    grey = image.convert('L')
    table = [[round(dark[c] + (light[c] - dark[c]) * v / 255) for v in range(256)] for c in range(3)]
    return Image.merge('RGB', [grey.point(table[c]) for c in range(3)])


def save(image, name, width, limit_kb):
    """Resize to `width` x `width/2` and save as JPEG, lowering the quality until it fits."""
    image = image.convert('RGB')
    if image.size != (width, width // 2):
        image = image.resize((width, width // 2), Image.LANCZOS)
    path = os.path.join(OUT, name)
    for quality in range(92, 59, -2):
        buffer = io.BytesIO()
        image.save(buffer, 'JPEG', quality=quality, optimize=True, progressive=True)
        if buffer.tell() <= limit_kb * 1024 or quality <= 60:
            break
    with open(path, 'wb') as f:
        f.write(buffer.getvalue())
    print(f'  {name}: {width} x {width // 2}, quality {quality}, {buffer.tell() / 1024:.0f} kB')
    if not name.endswith('-4k.jpg'):
        small(image, name)


def small(image, name):
    """The 256-pixel copy the solar-system view draws every body from: <name>_s.jpg beside the map."""
    stem, ext = os.path.splitext(name)
    image.convert('RGB').resize((256, 128), Image.LANCZOS).save(os.path.join(OUT, f'{stem}_s.jpg'), 'JPEG', quality=72, optimize=True)


def fill_unseen(image, name):
    """Parts of a world no camera has seen are black in the source maps: Pluto's and Charon's
    south (in darkness for the one fly-by), the northern halves of Triton and of Uranus's moons
    (the same), gaps at Callisto's poles. Black reads as a hole in a globe, so those parts are
    given the plain average tone of the mapped part: one flat colour, no invented terrain, with
    a soft edge. Only black that reaches the top or bottom edge of the map is treated: shadows
    inside the mapped area are left alone."""
    image = image.convert('RGB')
    w, h = image.size
    # Work at a quarter of the size: the flood fill below visits every pixel in pure Python.
    sw, sh = w // 4, h // 4
    brightest = image.resize((sw, sh), Image.BILINEAR).convert('L')
    dark = brightest.point(lambda v: 255 if v < 14 else 0)
    px = dark.load()
    for y in (0, sh - 1):
        for x in range(sw):
            if px[x, y] == 255:
                ImageDraw.floodfill(dark, (x, y), 128)
    unseen = dark.point(lambda v: 255 if v == 128 else 0)
    share = ImageStat.Stat(unseen).mean[0] / 255
    if share < 0.002:
        return image
    seen = unseen.point(lambda v: 255 - v).resize((w, h), Image.NEAREST)
    tone = tuple(round(v) for v in ImageStat.Stat(image, seen).mean)
    # Grow the unseen area a little (the source fades to black over a few pixels), then soften its edge.
    mask = unseen.filter(ImageFilter.MaxFilter(3)).resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(w / 400))
    print(f'    {name}: {share * 100:.0f} % of the map was never seen; filled with its average tone {tone}')
    return Image.composite(Image.new('RGB', (w, h), tone), image, mask)


def fine_detail(image, w):
    """A small grey copy with the broad light and dark taken out, leaving craters and ridges: what two maps of one world share whatever their colours."""
    h = w // 2
    grey = image.convert('L').resize((w, h), Image.LANCZOS)
    detail = ImageChops.subtract(grey.filter(ImageFilter.GaussianBlur(w / 256)), grey.filter(ImageFilter.GaussianBlur(w / 40)), scale=1, offset=128)
    data = detail.tobytes()
    # The middle latitudes only (near the poles a cylindrical map is stretched beyond recognition), every second row.
    return [[v - 128 for v in data[r * w:(r + 1) * w]] for r in range(h // 5, 4 * h // 5, 2)]


def line_up(image, reference, name):
    """Which way round is this map? Slide it sideways against a map of the same world whose
    layout is known (a NASA Trek layer: longitude -180 at the left) and see where the craters
    coincide. Returns the map moved so that they do, which puts longitude 0 in the middle.

    Two things can be found: a map drawn with longitude 180 in the middle (half a turn out),
    and a map made before the moon's zero of longitude was last redefined (a few degrees out:
    Mimas's moved by four degrees in 2009). Anything else, or a map that matches better
    mirrored, is refused."""
    def scores(a, b, shifts):
        w = len(a[0])
        return [sum(ra[(x + shift) % w] * rb[x] for ra, rb in zip(a, b) for x in range(0, w, 2)) for shift in shifts]

    # Coarsely, every position round the whole turn; and the same for the mirror image.
    w = 512
    a, b = fine_detail(image, w), fine_detail(reference, w)
    plain = scores(a, b, range(w))
    coarse = max(range(w), key=lambda k: plain[k])
    mirrored = max(scores([row[::-1] for row in a], b, range(0, w, 4)))
    away = [v for k, v in enumerate(plain) if min((k - coarse) % w, (coarse - k) % w) > w // 16]
    chance = (sum(v * v for v in away) / len(away)) ** 0.5 or 1
    # Finely, round the best position.
    fine = 2048
    a, b = fine_detail(image, fine), fine_detail(reference, fine)
    near = [coarse * (fine // w) + k for k in range(-8, 9)]
    best = near[max(range(len(near)), key=lambda k: scores(a, b, [near[k]])[0])] % fine
    turn = best / fine
    # How far from a clean match (0) or a clean half turn (0.5), whichever is nearer; None if it is near neither.
    off = min(((turn - target + 0.5) % 1 - 0.5 for target in (0.0, 0.5)), key=abs)
    if abs(off) > 0.03:
        off = None
    print(f'    {name}: its craters coincide with the reference when it is moved {turn:.4f} of a turn ({plain[coarse] / chance:.0f} times the chance level; mirrored {mirrored / chance:.0f})')
    if plain[coarse] < 5 * chance or mirrored > 0.7 * plain[coarse] or off is None:
        raise SystemExit(f'{name}: cannot tell which way round this map is')
    if abs(off) > 0.002:
        print(f'    {name}: that is {off * 360:+.1f} degrees from a clean {"half turn" if abs(turn - 0.5) < 0.03 else "match"}: an older zero of longitude, corrected')
    return ImageChops.offset(image, -round(turn * image.width), 0)


def match_tone(image, reference):
    """A grey map given the average brightness and contrast of another (so that sharper tiles of the other can take over from it without a jump)."""
    image, reference = image.convert('L'), reference.convert('L')
    a, b = ImageStat.Stat(image), ImageStat.Stat(reference)
    gain, lift = b.stddev[0] / max(a.stddev[0], 1e-6), b.mean[0]
    centre = a.mean[0]
    return image.point(lambda v: max(0, min(255, round((v - centre) * gain + lift))))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    cache = sys.argv[1]
    os.makedirs(cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
    want = lambda name: only is None or name in only

    # ---- NASA / USGS mosaics through Solar System Treks ---------------------------------
    if want('mercury'):
        # MESSENGER MDIS global basemap (BDR), 166 m. One filter, so grey: left as it is, so the
        # streamed tiles of the same layer continue it without a change of tone.
        save(trek(cache, 'Mercury', 'Mercury_MESSENGER_MDIS_Basemap_BDR_Mosaic_Global_166m', 'jpg', 2), 'mercury.jpg', 2048, 470)
    if want('venus'):
        # Magellan radar mosaic (C3-MDIR), coloured by the Magellan project after the Venera landers' pictures.
        save(trek(cache, 'Venus', 'Venus_Magellan_C3-MDIR_Colorized_Global_Mosaic_4641m', 'png', 2), 'venus.jpg', 2048, 470)
    if want('mars'):
        # Viking Orbiter MDIM 2.1 colour mosaic, 232 m.
        mars = trek(cache, 'Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', 3)
        save(mars, 'mars-4k.jpg', 4096, 1250)
        save(mars, 'mars.jpg', 2048, 430)
    if want('io'):
        # Galileo SSI + Voyager colour merge, 1 km.
        save(trek(cache, 'Io', 'Io_GalileoSSI_Voyager_Global_Mosaic_ClrMerge_1km', 'png', 2), 'io.jpg', 2048, 400)
    if want('europa'):
        # Voyager + Galileo SSI colour blend (the 20000 x 10000 global map of 2015).
        save(trek(cache, 'Europa', '20150218_europa_global_map_20000x10000', 'png', 2), 'europa.jpg', 2048, 400)
    if want('ganymede'):
        # Voyager + Galileo SSI colour mosaic, 1.4 km.
        save(trek(cache, 'Ganymede', 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m', 'png', 2), 'ganymede.jpg', 2048, 400)
    if want('callisto'):
        # Voyager + Galileo SSI mosaic, 1 km (no colour mosaic of Callisto exists).
        save(fill_unseen(trek(cache, 'Callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km', 'png', 2), 'callisto'), 'callisto.jpg', 2048, 400)
    if want('phobos'):
        # Viking Orbiter mosaic by Philip Stooke, on DLR's control network (USGS Astrogeology, PDS).
        save(trek(cache, 'Phobos', 'Phobos_Viking_Mosaic_40ppd_DLRcontrol', 'jpg', 2), 'phobos.jpg', 2048, 300)
    if want('tethys'):
        # Cassini ISS global mosaic, 293 m (USGS Astrogeology).
        save(trek(cache, 'Tethys', 'Tethys_Cassini_mosaic_global_293m', 'jpg', 2), 'tethys.jpg', 2048, 420)
    if want('dione'):
        # Cassini ISS and Voyager global mosaic, 154 m (USGS Astrogeology).
        save(trek(cache, 'Dione', 'Dione_Cassini_Voyageglobal_154m', 'jpg', 2), 'dione.jpg', 2048, 420)

    # ---- Saturn's other mid-sized moons: NASA's maps held on Wikimedia Commons -----------
    # The Trek layers for Mimas and Rhea were assembled by DLR, whose terms could not be
    # confirmed as public domain, so those two are bundled from NASA's own colour maps
    # (PIA18437, PIA18438: Cassini images mosaicked by Paul Schenk, Lunar and Planetary
    # Institute). Those maps exaggerate colour (infrared, green and ultraviolet shown as red,
    # green and blue), which gives the moons yellow-green patches no eye would see; they are
    # used in grey, which is how these ice moons look, and given the brightness and contrast of
    # the Trek layer so that its sharper tiles can take over without a jump. They are drawn
    # with longitude 180 in the middle: line_up() finds that out and turns them.
    for body, layer, source in (('mimas', 'MI_170630_DLR_basemap', '4/4f/Map_of_Mimas_colorized_2014-04_PIA18437.jpg'), ('rhea', 'RH_120803_DLR_basemap', '2/21/Rhea_Color_Map.jpg')):
        if want(body):
            reference = trek(cache, body.capitalize(), layer, 'jpg', 1)
            name = source.rsplit('/', 1)[1]
            turned = line_up(commons(cache, f'thumb/{source}/3840px-{name}'), reference, body)
            save(match_tone(turned, reference), f'{body}.jpg', 2048, 300)
    if want('iapetus'):
        # Iapetus is the exception: its colour map (PIA18436) is kept in colour, because the
        # one thing everybody should see is real, the coal-dark leading half against the bright
        # trailing one, and the grey Trek mosaic evens that contrast out.
        reference = trek(cache, 'Iapetus', 'Iapetus_Cassini_Voyager_mosaic_global_783m', 'jpg', 1)
        save(line_up(commons(cache, 'thumb/5/53/Iapetus_Color_Map.jpg/3840px-Iapetus_Color_Map.jpg'), reference, 'iapetus'), 'iapetus.jpg', 2048, 300)
    if want('phoebe'):
        # Cassini ISS map from the one fly-by, June 2004 (PIA07775). Half the usual width: the pictures are coarse.
        reference = trek(cache, 'Phoebe', 'PH_060315_DLR_basemap', 'jpg', 1)
        save(fill_unseen(line_up(commons(cache, 'd/d0/Phoebe_map_PIA07775_cropped.jpg'), reference, 'phoebe'), 'phoebe'), 'phoebe.jpg', 1024, 150)

    # ---- The five large moons of Uranus: Voyager 2 mosaics by the USGS (JPL's map set) ----
    # Voyager passed in January 1986 with the moons' south poles to the Sun, so only the
    # southern halves exist. 1440 pixels wide at the source, so 1024 here. Longitude 0 is in the
    # middle already: checked by where named features fall (Wunda on Umbriel at 274 deg E, the
    # coronae Elsinore and Arden on Miranda at 257 and 74 deg E, Ursula on Titania at 45 deg E,
    # Hamlet on Oberon at 44 deg E).
    for body, source in (('miranda', '8/81/Miranda_map_JPL_USGS.jpg'), ('ariel', '7/74/Ariel_map_JPL_USGS.jpg'), ('umbriel', '4/42/Umbriel_map_JPL_USGS.jpg'), ('titania', '8/85/Titania_map_JPL_USGS.jpg'), ('oberon', '1/1d/Oberon_map_JPL_USGS.jpg')):
        if want(body):
            save(fill_unseen(commons(cache, source), body), f'{body}.jpg', 1024, 110)
    if want('titan'):
        # Cassini ISS mosaic at 938 nm (PIA19658): the surface seen through the haze in one
        # infrared colour, so grey. Tinted with the orange-brown the moon really shows.
        save(tint(trek(cache, 'Titan', 'Titan_ISS_P19658_Mosaic_Global_4km', 'png', 2), (58, 30, 8), (246, 196, 118)), 'titan.jpg', 2048, 330)
    if want('enceladus'):
        # Cassini ISS global colour mosaic, 100 m. Half the usual width: it is only ever drawn
        # as a small moon beside Saturn, and its fine fractures cost a lot of bytes.
        save(trek(cache, 'Enceladus', 'Enceladus_cyl_KH', 'jpg', 2), 'enceladus.jpg', 1024, 180)

    # ---- NASA's colour map of the Moon ---------------------------------------------------
    if want('moon'):
        # LRO camera colour mosaic prepared by the Scientific Visualization Studio (CGI Moon Kit).
        moon = Image.open(download('https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif', cache, 'lroc_color_poles_4k.tif'))
        save(moon, 'moon-4k.jpg', 4096, 1250)
        save(moon, 'moon.jpg', 2048, 430)

    # ---- NASA maps held on Wikimedia Commons ---------------------------------------------
    if want('pluto'):
        # New Horizons global colour map (NASA / JHUAPL / SwRI), drawn with longitude 180 in the middle.
        save(fill_unseen(roll_half(commons(cache, 'a/ad/Pluto_color_mapmosaic.jpg')), 'pluto'), 'pluto.jpg', 2048, 330)
    if want('charon'):
        # New Horizons global map of Charon (NASA / JHUAPL / SwRI); this one already has longitude 0
        # in the middle (checked against NASA's gridded copy of the same map).
        save(fill_unseen(commons(cache, 'f/f8/Cpmap_cyl_PS717_HR_180.jpg'), 'charon'), 'charon.jpg', 2048, 250)
    if want('triton'):
        # Voyager 2 colour map by Paul Schenk (Lunar and Planetary Institute), from NASA images;
        # longitude 0 in the middle already. Only the hemisphere Voyager saw exists.
        save(fill_unseen(commons(cache, 'thumb/6/61/Triton_map_no_grid.jpg/3840px-Triton_map_no_grid.jpg'), 'triton'), 'triton.jpg', 2048, 250)

    # ---- Solar System Scope (CC BY 4.0), from Wikimedia Commons --------------------------
    if want('sun'):
        save(commons(cache, 'a/a4/Solarsystemscope_texture_8k_sun.jpg'), 'sun.jpg', 2048, 420)
    if want('venus-clouds'):
        save(commons(cache, '5/57/Solarsystemscope_texture_4k_venus_atmosphere.jpg'), 'venus-clouds.jpg', 2048, 250)
    if want('jupiter'):
        jupiter = commons(cache, '5/5e/Solarsystemscope_texture_8k_jupiter.jpg')
        save(jupiter, 'jupiter-4k.jpg', 4096, 1000)
        save(jupiter, 'jupiter.jpg', 2048, 380)
    if want('saturn'):
        saturn = commons(cache, '1/1e/Solarsystemscope_texture_8k_saturn.jpg')
        save(saturn, 'saturn-4k.jpg', 4096, 500)
        save(saturn, 'saturn.jpg', 2048, 200)
    if want('uranus'):
        save(commons(cache, '9/95/Solarsystemscope_texture_2k_uranus.jpg'), 'uranus.jpg', 2048, 120)
    if want('neptune'):
        save(commons(cache, '1/1e/Solarsystemscope_texture_2k_neptune.jpg'), 'neptune.jpg', 2048, 200)
    if want('rings'):
        # A radial slice of the rings, 8192 x 500 with transparency: every row is the same, so
        # a strip a few pixels high holds everything. Inner edge at the left.
        rings = commons(cache, '2/29/Solarsystemscope_texture_8k_saturn_ring_alpha.png').convert('RGBA')
        strip = rings.crop((0, rings.height // 2 - 8, rings.width, rings.height // 2 + 8)).resize((2048, 8), Image.LANCZOS)
        strip.save(os.path.join(OUT, 'saturn-rings.png'), optimize=True)
        print(f'  saturn-rings.png: 2048 x 8, {os.path.getsize(os.path.join(OUT, "saturn-rings.png")) / 1024:.0f} kB')


if __name__ == '__main__':
    main()
