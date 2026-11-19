#!/usr/bin/env python3
"""scripts/build-space-maps.py: how every file in public/textures/space/ was made.

    python3 -I scripts/build-space-maps.py <an empty folder for the downloads>

Run by hand, once (and again only to change a map); the results are committed. It needs Python
with Pillow, which is not a dependency of the project itself: nothing in `npm run build` calls
this. src/space/imagery.ts lists the results and where each came from.

Every map comes out the same way: 2:1 equirectangular, north up, longitude 0 in the middle,
east to the right, 2048 pixels wide (4096 for the four `-4k` files, 1024 for Enceladus), JPEG.

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
Saturn's rings are cut down to a thin strip.

Politeness: one request at a time with a pause, a generic User-Agent, and every download is
kept in the folder given so a second run asks for nothing again.
"""

import io
import os
import subprocess
import sys
import time

from PIL import Image

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
        save(trek(cache, 'Callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km', 'png', 2), 'callisto.jpg', 2048, 400)
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
        save(roll_half(commons(cache, 'a/ad/Pluto_color_mapmosaic.jpg')), 'pluto.jpg', 2048, 330)
    if want('charon'):
        # New Horizons global map of Charon (NASA / JHUAPL / SwRI); this one already has longitude 0
        # in the middle (checked against NASA's gridded copy of the same map).
        save(commons(cache, 'f/f8/Cpmap_cyl_PS717_HR_180.jpg'), 'charon.jpg', 2048, 250)
    if want('triton'):
        # Voyager 2 colour map by Paul Schenk (Lunar and Planetary Institute), from NASA images;
        # longitude 0 in the middle already. Only the hemisphere Voyager saw exists.
        save(commons(cache, 'thumb/6/61/Triton_map_no_grid.jpg/3840px-Triton_map_no_grid.jpg'), 'triton.jpg', 2048, 250)

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
