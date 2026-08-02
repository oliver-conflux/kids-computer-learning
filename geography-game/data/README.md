# Committed source data

Both sources were license-checked before adoption. Neither is fetched at
play time: the game runs at anchor with no connectivity, which is the
whole reason these are committed rather than depended on.

## ne_110m_admin_0_countries.geojson

Natural Earth, **public domain**. Their terms: "All versions of Natural
Earth raster + vector map data found on this website are in the public
domain." No attribution is required — "Crediting the authors is
unnecessary."

From https://github.com/nvkelso/natural-earth-vector, path
`geojson/ne_110m_admin_0_countries.geojson`. 177 features.

Consumed by `tools/build-countries.js`, which emits
`geography-game/js/countries.js`. Nothing reads this file at play time.

## vendor/flag-icons/

https://github.com/lipis/flag-icons, **MIT**. 271 SVGs keyed by ISO
3166-1 alpha-2. `LICENSE` sits beside them and must stay there — keeping
that notice is the whole of what MIT asks.

Wikimedia Commons was rejected as a flag source. Most flag SVGs there are
public domain, but licensing is per-file and some renderings are CC-BY-SA
even where the flag design is not copyrightable. Auditing 200 files
individually is the kind of chore that gets half-done.
