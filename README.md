# mcp-soilgrids

ISRIC SoilGrids MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `soil_properties` | Get soil property values at any coordinate from ISRIC SoilGrids (250m global grid) — clay/sand/silt %, pH, organic carbon, nitrogen, cation exchange, bulk density, water content. Values are returned in real units (scaled from raw map units). Keyless; the SoilGrids API may take several seconds to respond. |
| `soil_classification` | Get the World Reference Base (WRB) soil classification at a coordinate from ISRIC SoilGrids — the most probable soil class (e.g. Cambisols, Podzols) plus the top 5 classes with probabilities. Keyless; may take several seconds to respond. |
| `list_soil_properties` | List the soil properties available from ISRIC SoilGrids with their names and available depth intervals. Use this to discover valid property codes for soil_properties. Keyless; may take several seconds to respond. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "soilgrids": {
      "url": "https://gateway.pipeworx.io/soilgrids/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Soilgrids data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
