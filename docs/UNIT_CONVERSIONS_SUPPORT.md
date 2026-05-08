# Unit Conversion Support Matrix

This document defines what unit conversions the current Foodies UOM engine supports.

## 1) How the conversion engine works

The system supports conversion when all of the following are true:

1. Source and target units are in the same `kind`.
2. Source unit can reach target base through `base_uom_id` chain.
3. Every step has a positive `multiplier_to_base`.
4. The item is configured with those units in `baseUomIds` (or `baseUomId`).

Conversion model:

- `qty_in_target_base = qty * multiplier_chain`
- Item base conversion: `qty_in_item_base = qty * multiplier_to_item_base`

This is a **multiplicative linear conversion model**.

## 2) What this means for global coverage

The engine can support **all globally used linear units** as long as they are added to UOM master data with:

- `kind`
- `base_uom_id`
- `multiplier_to_base`

So in practice, we can cover worldwide units for:

- Mass
- Volume
- Length
- Area
- Count/packaging
- Time
- Energy
- Pressure
- Power
- Frequency
- Speed/flow (if modeled as dedicated kinds)

## 3) Seeded units available now

From current seed/setup, these are present:

- `pcs` (count)
- `g`, `kg` (mass; `1 kg = 1000 g`)
- `ml`, `l` (volume; `1 l = 1000 ml`)

## 4) Extensive linear unit list we support

Below is a comprehensive catalog of units that are compatible with the current model.
All entries can be represented via base-link + multiplier.

### 4.1 Mass (`kind = mass`)

Metric:

- `ug` (microgram)
- `mg` (milligram)
- `g` (gram)
- `kg` (kilogram)
- `q` (quintal)
- `t` (metric tonne)

Imperial/US:

- `gr` (grain)
- `dr` (dram)
- `oz` (ounce)
- `lb` (pound)
- `st` (stone)
- `cwt` (hundredweight)
- `ton_us` (short ton)
- `ton_uk` (long ton)

Other:

- `ct` (carat)

### 4.2 Volume (`kind = volume`)

Metric:

- `ul` (microliter)
- `ml` (milliliter)
- `cl` (centiliter)
- `dl` (deciliter)
- `l` (liter)
- `dal` (dekaliter)
- `hl` (hectoliter)
- `m3` (cubic meter)

US/Imperial liquid:

- `tsp`
- `tbsp`
- `floz_us`
- `floz_uk`
- `cup_us`
- `cup_metric`
- `pt_us`
- `pt_uk`
- `qt_us`
- `qt_uk`
- `gal_us`
- `gal_uk`
- `bbl_us` (barrel)

### 4.3 Length (`kind = length`)

Metric:

- `nm`, `um`, `mm`, `cm`, `dm`, `m`, `dam`, `hm`, `km`

Imperial/US:

- `in` (inch)
- `ft` (foot)
- `yd` (yard)
- `mi` (mile)
- `nmi` (nautical mile)
- `furlong`

### 4.4 Area (`kind = area`)

Metric:

- `mm2`, `cm2`, `m2`, `ha`, `km2`

Imperial/US:

- `in2`, `ft2`, `yd2`, `acre`, `mi2`

### 4.5 Count / Packaging (`kind = count`)

Base and pack-style:

- `pcs`, `unit`, `ea`
- `pair` (2 pcs)
- `dozen` (12 pcs)
- `score` (20 pcs)
- `gross` (144 pcs)
- `pack`
- `box`
- `carton`
- `tray`
- `bundle`
- `bag`
- `bottle`
- `can`
- `jar`
- `roll`
- `case`
- `pallet`
- `crate`

These are fully supported when multiplier mapping to base (`pcs`) is provided per tenant/business.

### 4.6 Time (`kind = time`)

- `ms`, `s`, `min`, `h`, `day`, `week`

### 4.7 Energy (`kind = energy`)

- `J`, `kJ`, `MJ`
- `Wh`, `kWh`, `MWh`
- `cal`, `kcal`, `BTU`

### 4.8 Pressure (`kind = pressure`)

- `Pa`, `kPa`, `MPa`
- `bar`, `mbar`
- `psi`
- `atm`
- `mmHg`, `inHg`

### 4.9 Power (`kind = power`)

- `W`, `kW`, `MW`
- `hp`

### 4.10 Frequency (`kind = frequency`)

- `Hz`, `kHz`, `MHz`, `GHz`

## 5) SI prefix coverage (automatic pattern)

For any SI unit base, the model supports all prefix-scaled forms because they are linear multipliers:

- quecto, ronto, yocto, zepto, atto, femto, pico, nano, micro, milli, centi, deci
- deca, hecto, kilo, mega, giga, tera, peta, exa, zetta, yotta, ronna, quetta

Example:

- `mg -> g -> kg` works by multiplier chain.
- `ml -> l -> m3` works by multiplier chain.

## 6) Known scope boundary

The current model does **not** natively support non-linear/offset conversions in one step (example: `C <-> F`), because those need formulas, not only multipliers.

So this document covers all units that are representable with linear multipliers.

## 7) Practical note for inventory/procurement

For PR/PO/GRN item quantities, conversion only applies between units configured on that item (`baseUomIds`) and compatible with the item primary base unit.
This prevents cross-family errors like mass vs volume unless explicitly modeled as separate items.

