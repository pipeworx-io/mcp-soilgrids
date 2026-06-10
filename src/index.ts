interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * ISRIC SoilGrids MCP.
 *
 * Global soil property data at 250m resolution for any coordinate on Earth —
 * clay/sand/silt fractions, pH, organic carbon, nitrogen, bulk density, water
 * content, and World Reference Base soil classification. Keyless. Raw values
 * are scaled by each layer's d_factor to real units (e.g. clay g/kg → %).
 */


const BASE = 'https://rest.isric.org/soilgrids/v2.0';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const PROPERTY_CODES = [
  'clay',
  'sand',
  'silt',
  'phh2o',
  'soc',
  'nitrogen',
  'cec',
  'bdod',
  'cfvo',
  'ocd',
  'wv0010',
  'wv0033',
  'wv1500',
] as const;

const DEPTHS = ['0-5cm', '5-15cm', '15-30cm', '30-60cm', '60-100cm', '100-200cm'] as const;

/** Human-readable names for known property codes (the layers endpoint returns codes only). */
const PROPERTY_NAMES: Record<string, string> = {
  bdod: 'Bulk density of the fine earth fraction',
  cec: 'Cation exchange capacity (at pH 7)',
  cfvo: 'Volumetric fraction of coarse fragments (>2mm)',
  clay: 'Clay content (<0.002mm) in the fine earth fraction',
  nitrogen: 'Total nitrogen',
  ocd: 'Organic carbon density',
  ocs: 'Organic carbon stocks (0-30cm only)',
  phh2o: 'Soil pH (in H2O)',
  sand: 'Sand content (0.05-2mm) in the fine earth fraction',
  silt: 'Silt content (0.002-0.05mm) in the fine earth fraction',
  soc: 'Soil organic carbon in the fine earth fraction',
  wv0010: 'Volumetric water content at 10 kPa (field capacity, sandy)',
  wv0033: 'Volumetric water content at 33 kPa (field capacity)',
  wv1500: 'Volumetric water content at 1500 kPa (wilting point)',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'soil_properties',
    description:
      'Get soil property values at any coordinate from ISRIC SoilGrids (250m global grid) — clay/sand/silt %, pH, organic carbon, nitrogen, cation exchange, bulk density, water content. Values are returned in real units (scaled from raw map units). Keyless; the SoilGrids API may take several seconds to respond.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees (-90 to 90).' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees (-180 to 180).' },
        properties: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Soil property codes to query (default ["clay","sand","silt","phh2o","soc"]). Valid codes: clay, sand, silt (texture %), phh2o (pH in water), soc (soil organic carbon), nitrogen, cec (cation exchange capacity), bdod (bulk density), cfvo (coarse fragments), ocd (organic carbon density), wv0010/wv0033/wv1500 (volumetric water content at 10/33/1500 kPa).',
        },
        depth: {
          type: 'string',
          description:
            'Depth interval (default "0-5cm"). Valid: "0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm".',
        },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'soil_classification',
    description:
      'Get the World Reference Base (WRB) soil classification at a coordinate from ISRIC SoilGrids — the most probable soil class (e.g. Cambisols, Podzols) plus the top 5 classes with probabilities. Keyless; may take several seconds to respond.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Latitude in decimal degrees (-90 to 90).' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees (-180 to 180).' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'list_soil_properties',
    description:
      'List the soil properties available from ISRIC SoilGrids with their names and available depth intervals. Use this to discover valid property codes for soil_properties. Keyless; may take several seconds to respond.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'soil_properties':
        return soilProperties(args);
      case 'soil_classification':
        return soilClassification(args);
      case 'list_soil_properties':
        return listSoilProperties();
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Divide a raw mapped value by its d_factor to get target units. Null-safe. */
function scaled(v: unknown, dFactor: unknown): number | null {
  if (typeof v !== 'number') return null;
  const d = typeof dFactor === 'number' && dFactor !== 0 ? dFactor : 1;
  return Math.round((v / d) * 100) / 100;
}

function parseCoords(args: Record<string, unknown>): { lat: number; lon: number } | { error: string } {
  const lat = typeof args.latitude === 'number' ? args.latitude : NaN;
  const lon = typeof args.longitude === 'number' ? args.longitude : NaN;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90)
    return { error: 'latitude must be a number between -90 and 90' };
  if (!Number.isFinite(lon) || lon < -180 || lon > 180)
    return { error: 'longitude must be a number between -180 and 180' };
  return { lat, lon };
}

interface SoilGridsDepth {
  label?: string;
  values?: Record<string, number | null>;
}

interface SoilGridsLayer {
  name?: string;
  unit_measure?: { d_factor?: number; mapped_units?: string; target_units?: string };
  depths?: SoilGridsDepth[];
}

async function soilProperties(args: Record<string, unknown>): Promise<unknown> {
  const coords = parseCoords(args);
  if ('error' in coords) return coords;

  const props =
    Array.isArray(args.properties) && args.properties.length > 0
      ? args.properties.map((p) => String(p).trim().toLowerCase())
      : ['clay', 'sand', 'silt', 'phh2o', 'soc'];
  const invalid = props.filter((p) => !(PROPERTY_CODES as readonly string[]).includes(p));
  if (invalid.length > 0)
    return {
      error: `unknown property code(s): ${invalid.join(', ')}. Valid codes: ${PROPERTY_CODES.join(', ')}`,
    };

  const depth = (typeof args.depth === 'string' && args.depth.trim()) || '0-5cm';
  if (!(DEPTHS as readonly string[]).includes(depth))
    return { error: `invalid depth "${depth}". Valid depths: ${DEPTHS.join(', ')}` };

  const qs = [
    `lon=${coords.lon}`,
    `lat=${coords.lat}`,
    ...props.map((p) => `property=${encodeURIComponent(p)}`),
    `depth=${encodeURIComponent(depth)}`,
    'value=mean',
    'value=Q0.5',
  ].join('&');
  const res = await fetch(`${BASE}/properties/query?${qs}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `SoilGrids: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as { properties?: { layers?: SoilGridsLayer[] } };
  const layers = data.properties?.layers ?? [];
  return {
    latitude: coords.lat,
    longitude: coords.lon,
    depth,
    count: layers.length,
    properties: layers.map((l) => {
      const d = (l.depths ?? []).find((x) => x.label === depth) ?? l.depths?.[0];
      const dFactor = l.unit_measure?.d_factor;
      return {
        property: l.name,
        unit: l.unit_measure?.target_units,
        depth: d?.label ?? depth,
        mean: scaled(d?.values?.mean, dFactor),
        median: scaled(d?.values?.['Q0.5'], dFactor),
      };
    }),
  };
}

async function soilClassification(args: Record<string, unknown>): Promise<unknown> {
  const coords = parseCoords(args);
  if ('error' in coords) return coords;

  const res = await fetch(
    `${BASE}/classification/query?lon=${coords.lon}&lat=${coords.lat}&number_classes=5`,
    { headers: { Accept: 'application/json', 'User-Agent': UA } },
  );
  if (!res.ok) return { error: `SoilGrids: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as {
    wrb_class_name?: string;
    wrb_class_probability?: Array<[string, number]>;
  };
  return {
    latitude: coords.lat,
    longitude: coords.lon,
    most_probable: data.wrb_class_name ?? null,
    classes: (data.wrb_class_probability ?? []).map(([name, probability]) => ({
      name,
      probability,
    })),
  };
}

async function listSoilProperties(): Promise<unknown> {
  const res = await fetch(`${BASE}/properties/layers`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) return { error: `SoilGrids: ${res.status} ${(await res.text()).slice(0, 200)}` };

  const data = (await res.json()) as {
    layers?: Array<{ property?: string; layer_structure?: Array<{ range?: string }> }>;
  };
  const layers = data.layers ?? [];
  return {
    count: layers.length,
    properties: layers.map((l) => ({
      code: l.property,
      name: (l.property && PROPERTY_NAMES[l.property]) || undefined,
      depths: (l.layer_structure ?? []).map((s) => s.range).filter(Boolean),
    })),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
