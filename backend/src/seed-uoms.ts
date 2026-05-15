/**
 * Seed a comprehensive UOM catalog for all tenants.
 *
 * Source of truth: docs/UNIT_CONVERSIONS_SUPPORT.md
 *
 * Usage:
 *   npm run seed:uoms
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Tenant } from './entities/tenant.entity';
import { Uom } from './entities/uom.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

type UomDef = {
    code: string;
    name: string;
    kind: string;
    baseCode?: string;
    multiplierToBase?: number;
};

const UOM_DEFS: UomDef[] = [
    // Mass (base: g)
    { code: 'g', name: 'Gram', kind: 'mass' },
    {
        code: 'ug',
        name: 'Microgram',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 0.000001,
    },
    {
        code: 'mg',
        name: 'Milligram',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 0.001,
    },
    {
        code: 'kg',
        name: 'Kilogram',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 1000,
    },
    {
        code: 'q',
        name: 'Quintal',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 100000,
    },
    {
        code: 't',
        name: 'Metric Tonne',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 1000000,
    },
    {
        code: 'gr',
        name: 'Grain',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 0.06479891,
    },
    {
        code: 'dr',
        name: 'Dram',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 1.7718451953125,
    },
    {
        code: 'oz',
        name: 'Ounce',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 28.349523125,
    },
    {
        code: 'lb',
        name: 'Pound',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 453.59237,
    },
    {
        code: 'st',
        name: 'Stone',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 6350.29318,
    },
    {
        code: 'cwt',
        name: 'Hundredweight',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 50802.34544,
    },
    {
        code: 'ton_us',
        name: 'Short Ton (US)',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 907184.74,
    },
    {
        code: 'ton_uk',
        name: 'Long Ton (UK)',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 1016046.9088,
    },
    {
        code: 'ct',
        name: 'Carat',
        kind: 'mass',
        baseCode: 'g',
        multiplierToBase: 0.2,
    },

    // Volume (base: ml)
    { code: 'ml', name: 'Milliliter', kind: 'volume' },
    {
        code: 'ul',
        name: 'Microliter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 0.001,
    },
    {
        code: 'cl',
        name: 'Centiliter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 10,
    },
    {
        code: 'dl',
        name: 'Deciliter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 100,
    },
    {
        code: 'l',
        name: 'Liter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 1000,
    },
    {
        code: 'dal',
        name: 'Dekaliter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 10000,
    },
    {
        code: 'hl',
        name: 'Hectoliter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 100000,
    },
    {
        code: 'm3',
        name: 'Cubic Meter',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 1000000,
    },
    {
        code: 'tsp',
        name: 'Teaspoon (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 4.92892159375,
    },
    {
        code: 'tbsp',
        name: 'Tablespoon (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 14.78676478125,
    },
    {
        code: 'floz_us',
        name: 'Fluid Ounce (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 29.5735295625,
    },
    {
        code: 'floz_uk',
        name: 'Fluid Ounce (UK)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 28.4130625,
    },
    {
        code: 'cup_us',
        name: 'Cup (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 236.5882365,
    },
    {
        code: 'cup_metric',
        name: 'Cup (Metric)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 250,
    },
    {
        code: 'pt_us',
        name: 'Pint (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 473.176473,
    },
    {
        code: 'pt_uk',
        name: 'Pint (UK)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 568.26125,
    },
    {
        code: 'qt_us',
        name: 'Quart (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 946.352946,
    },
    {
        code: 'qt_uk',
        name: 'Quart (UK)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 1136.5225,
    },
    {
        code: 'gal_us',
        name: 'Gallon (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 3785.411784,
    },
    {
        code: 'gal_uk',
        name: 'Gallon (UK)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 4546.09,
    },
    {
        code: 'bbl_us',
        name: 'Barrel (US)',
        kind: 'volume',
        baseCode: 'ml',
        multiplierToBase: 119240.471196,
    },

    // Length (base: m)
    { code: 'm', name: 'Meter', kind: 'length' },
    {
        code: 'nm',
        name: 'Nanometer',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.000000001,
    },
    {
        code: 'um',
        name: 'Micrometer',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.000001,
    },
    {
        code: 'mm',
        name: 'Millimeter',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.001,
    },
    {
        code: 'cm',
        name: 'Centimeter',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.01,
    },
    {
        code: 'dm',
        name: 'Decimeter',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.1,
    },
    {
        code: 'dam',
        name: 'Decameter',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 10,
    },
    {
        code: 'hm',
        name: 'Hectometer',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 100,
    },
    {
        code: 'km',
        name: 'Kilometer',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 1000,
    },
    {
        code: 'in',
        name: 'Inch',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.0254,
    },
    {
        code: 'ft',
        name: 'Foot',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.3048,
    },
    {
        code: 'yd',
        name: 'Yard',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 0.9144,
    },
    {
        code: 'mi',
        name: 'Mile',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 1609.344,
    },
    {
        code: 'nmi',
        name: 'Nautical Mile',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 1852,
    },
    {
        code: 'furlong',
        name: 'Furlong',
        kind: 'length',
        baseCode: 'm',
        multiplierToBase: 201.168,
    },

    // Area (base: m2)
    { code: 'm2', name: 'Square Meter', kind: 'area' },
    {
        code: 'mm2',
        name: 'Square Millimeter',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 0.000001,
    },
    {
        code: 'cm2',
        name: 'Square Centimeter',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 0.0001,
    },
    {
        code: 'ha',
        name: 'Hectare',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 10000,
    },
    {
        code: 'km2',
        name: 'Square Kilometer',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 1000000,
    },
    {
        code: 'in2',
        name: 'Square Inch',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 0.00064516,
    },
    {
        code: 'ft2',
        name: 'Square Foot',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 0.09290304,
    },
    {
        code: 'yd2',
        name: 'Square Yard',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 0.83612736,
    },
    {
        code: 'acre',
        name: 'Acre',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 4046.8564224,
    },
    {
        code: 'mi2',
        name: 'Square Mile',
        kind: 'area',
        baseCode: 'm2',
        multiplierToBase: 2589988.110336,
    },

    // Count / Packaging (base: pcs)
    { code: 'pcs', name: 'Pieces', kind: 'count' },
    {
        code: 'unit',
        name: 'Unit',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'ea',
        name: 'Each',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'pair',
        name: 'Pair',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 2,
    },
    {
        code: 'dozen',
        name: 'Dozen',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 12,
    },
    {
        code: 'score',
        name: 'Score',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 20,
    },
    {
        code: 'gross',
        name: 'Gross',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 144,
    },
    {
        code: 'pack',
        name: 'Pack',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'box',
        name: 'Box',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'carton',
        name: 'Carton',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'tray',
        name: 'Tray',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'bundle',
        name: 'Bundle',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'bag',
        name: 'Bag',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'bottle',
        name: 'Bottle',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'can',
        name: 'Can',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'jar',
        name: 'Jar',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'roll',
        name: 'Roll',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'case',
        name: 'Case',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'pallet',
        name: 'Pallet',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },
    {
        code: 'crate',
        name: 'Crate',
        kind: 'count',
        baseCode: 'pcs',
        multiplierToBase: 1,
    },

    // Time (base: s)
    { code: 's', name: 'Second', kind: 'time' },
    {
        code: 'ms',
        name: 'Millisecond',
        kind: 'time',
        baseCode: 's',
        multiplierToBase: 0.001,
    },
    {
        code: 'min',
        name: 'Minute',
        kind: 'time',
        baseCode: 's',
        multiplierToBase: 60,
    },
    {
        code: 'h',
        name: 'Hour',
        kind: 'time',
        baseCode: 's',
        multiplierToBase: 3600,
    },
    {
        code: 'day',
        name: 'Day',
        kind: 'time',
        baseCode: 's',
        multiplierToBase: 86400,
    },
    {
        code: 'week',
        name: 'Week',
        kind: 'time',
        baseCode: 's',
        multiplierToBase: 604800,
    },

    // Energy (base: J)
    { code: 'J', name: 'Joule', kind: 'energy' },
    {
        code: 'kJ',
        name: 'Kilojoule',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 1000,
    },
    {
        code: 'MJ',
        name: 'Megajoule',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 1000000,
    },
    {
        code: 'Wh',
        name: 'Watt-hour',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 3600,
    },
    {
        code: 'kWh',
        name: 'Kilowatt-hour',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 3600000,
    },
    {
        code: 'MWh',
        name: 'Megawatt-hour',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 3600000000,
    },
    {
        code: 'cal',
        name: 'Calorie',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 4.184,
    },
    {
        code: 'kcal',
        name: 'Kilocalorie',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 4184,
    },
    {
        code: 'BTU',
        name: 'BTU',
        kind: 'energy',
        baseCode: 'J',
        multiplierToBase: 1055.05585262,
    },

    // Pressure (base: Pa)
    { code: 'Pa', name: 'Pascal', kind: 'pressure' },
    {
        code: 'kPa',
        name: 'Kilopascal',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 1000,
    },
    {
        code: 'MPa',
        name: 'Megapascal',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 1000000,
    },
    {
        code: 'bar',
        name: 'Bar',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 100000,
    },
    {
        code: 'mbar',
        name: 'Millibar',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 100,
    },
    {
        code: 'psi',
        name: 'Pound-force per Square Inch',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 6894.757293168,
    },
    {
        code: 'atm',
        name: 'Standard Atmosphere',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 101325,
    },
    {
        code: 'mmHg',
        name: 'Millimeter of Mercury',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 133.322387415,
    },
    {
        code: 'inHg',
        name: 'Inch of Mercury',
        kind: 'pressure',
        baseCode: 'Pa',
        multiplierToBase: 3386.38815789,
    },

    // Power (base: W)
    { code: 'W', name: 'Watt', kind: 'power' },
    {
        code: 'kW',
        name: 'Kilowatt',
        kind: 'power',
        baseCode: 'W',
        multiplierToBase: 1000,
    },
    {
        code: 'MW',
        name: 'Megawatt',
        kind: 'power',
        baseCode: 'W',
        multiplierToBase: 1000000,
    },
    {
        code: 'hp',
        name: 'Horsepower',
        kind: 'power',
        baseCode: 'W',
        multiplierToBase: 745.69987158227,
    },

    // Frequency (base: Hz)
    { code: 'Hz', name: 'Hertz', kind: 'frequency' },
    {
        code: 'kHz',
        name: 'Kilohertz',
        kind: 'frequency',
        baseCode: 'Hz',
        multiplierToBase: 1000,
    },
    {
        code: 'MHz',
        name: 'Megahertz',
        kind: 'frequency',
        baseCode: 'Hz',
        multiplierToBase: 1000000,
    },
    {
        code: 'GHz',
        name: 'Gigahertz',
        kind: 'frequency',
        baseCode: 'Hz',
        multiplierToBase: 1000000000,
    },
];

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

async function upsertForTenant(tenantId: number) {
    const repo = dataSource.getRepository(Uom);
    const existing = await repo.find({ where: { tenantId } });
    const byCode = new Map(existing.map((u) => [String(u.code), u]));

    // Pass 1: ensure all units exist with code/name/kind
    for (const def of UOM_DEFS) {
        const found = byCode.get(def.code);
        if (!found) {
            const created = await repo.save(
                repo.create({
                    tenantId,
                    code: def.code,
                    name: def.name,
                    kind: def.kind,
                    baseUomId: null,
                    multiplierToBase: null,
                    isActive: true,
                }),
            );
            byCode.set(def.code, created);
            continue;
        }
        let dirty = false;
        if (String(found.name) !== def.name) {
            found.name = def.name;
            dirty = true;
        }
        if (String(found.kind) !== def.kind) {
            found.kind = def.kind;
            dirty = true;
        }
        if (found.isActive !== true) {
            found.isActive = true;
            dirty = true;
        }
        if (dirty) {
            const saved = await repo.save(found);
            byCode.set(def.code, saved);
        }
    }

    // Pass 2: set conversion links
    for (const def of UOM_DEFS) {
        const row = byCode.get(def.code);
        if (!row) continue;
        const targetBaseId =
            def.baseCode == null
                ? null
                : (byCode.get(def.baseCode)?.id ?? null);
        const targetMultiplier =
            def.baseCode == null ? null : Number(def.multiplierToBase);
        const needsUpdate =
            Number(row.baseUomId ?? 0) !== Number(targetBaseId ?? 0) ||
            Number(row.multiplierToBase ?? NaN) !==
                Number(targetMultiplier ?? NaN);
        if (needsUpdate) {
            row.baseUomId = targetBaseId;
            row.multiplierToBase = targetMultiplier;
            const saved = await repo.save(row);
            byCode.set(def.code, saved);
        }
    }
}

async function main() {
    await dataSource.initialize();
    const tenantRepo = dataSource.getRepository(Tenant);
    const tenants = await tenantRepo.find({ order: { id: 'ASC' } });
    if (tenants.length === 0) {
        throw new Error('No tenants found. Seed base data first.');
    }
    for (const tenant of tenants) {
        await upsertForTenant(tenant.id);

        console.log(
            `UOM catalog seeded for tenant ${tenant.id} (${tenant.slug})`,
        );
    }
    await dataSource.destroy();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
