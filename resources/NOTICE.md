# GeoNames reference data

`places.json` is a transformed extract of GeoNames `cities15000.zip`, downloaded 2026-09-16 from https://download.geonames.org/export/dump/cities15000.zip.

Attribution: **GeoNames, https://www.geonames.org/**. Licensed under **Creative Commons Attribution 4.0**, https://creativecommons.org/licenses/by/4.0/ . See https://download.geonames.org/export/dump/readme.txt . Data is provided as-is, without warranty of accuracy, timeliness or completeness.

Changes: selected ID, names, coordinates, country and population; retained at most 24 alternate names; converted TSV to JSON. Source archive SHA-256 and row count are recorded in `geonames-source.json`.

These are public reference-city coordinates, not paper-reported sample coordinates. SIE uses them only to approximate a transformation from user-supplied map imagery. Runtime lookup is local; no uploaded document is sent to GeoNames. Reference matching and image control-point locations still require review.
