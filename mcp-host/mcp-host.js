import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// Standardize: MOQUI_BASE_URL now points directly to the isolated REST namespace
const MOQUI_BASE_URL = process.env.MOQUI_BASE_URL || "http://localhost:8080/rest/s1/mce2";
// WebMCP sidecar is typically on port 3000
const WEBMCP_RELAY_URL = process.env.WEBMCP_RELAY_URL || "http://localhost:3000/relay";

const server = new Server(
    {
        name: "mce2-mcp-host",
        version: "1.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * 1. Tell the AI what tools are available
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_available_apps",
                description: "List all AI-ready components (apps) available in the Moqui instance.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "render_component",
                description: "Renders a Quasar/Vue component in the MCE2 user interface canvas.",
                inputSchema: {
                    type: "object",
                    properties: {
                        targetId: {
                            type: "string",
                            description: "The CSS ID of the target container (default: mce-canvas)"
                        },
                        componentJson: {
                            type: "object",
                            description: "The reactive JSON blueprint of the component to render."
                        },
                        mcpToken: {
                            type: "string",
                            description: "The security token for the WebMCP session."
                        }
                    },
                    required: ["componentJson"]
                },
            },
        ],
    };
});

/**
 * 2. Handle the actual tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_available_apps") {
            const response = await axios.get(`${MOQUI_BASE_URL}/AvailableApps`);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(response.data, null, 2),
                }],
            };
        }

        if (name === "render_component") {
            const { componentJson, mcpToken, targetId = "mce-canvas" } = args;
            
            // Relay the component data to the WebMCP sidecar (WebSocket forwarder)
            const relayResponse = await axios.post(WEBMCP_RELAY_URL, {
                type: "render",
                targetId: targetId,
                component: componentJson,
                mcpToken: mcpToken
            });

            return {
                content: [{
                    type: "text",
                    text: `Successfully relayed component to MCE2 Canvas. Sidecar response: ${relayResponse.statusText}`,
                }],
            };
        }

        throw new Error(`Tool not found: ${name}`);
    } catch (error) {
        console.error(`MCP Error (${name}):`, error.response?.data || error.message);
        return {
            content: [{
                type: "text",
                text: `Error: ${error.message}`,
            }],
            isError: true,
        };
    }
});

/**
 * 3. Start using Stdio (Standard Input/Output)
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCE2 MCP Host (Stdio) is running and grounded in mce2 namespace.");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});