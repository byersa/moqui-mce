import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
// Force immediate, unbuffered writes to the terminal
process.stderr.write("[MCE2-HOST] --- SYSTEM STARTING ---\n");

// Overwrite console.error to ensure it flushes immediately
const originalError = console.error;
console.error = (...args) => {
    process.stderr.write(args.join(' ') + '\n');
};


// Raw Debug: Listen to the pulse of the input stream
process.stdin.on('data', (data) => {
    try {
        const raw = data.toString().trim();
        const json = JSON.parse(raw);

        // INTERCEPT: If this is our UI message, act on it manually
        if (json.method === "notifications/message") {
            const userText = json.params.text;
            console.error(`[MCE2-HOST-RAW-IN] Intercepted Prompt: ${userText}`);

            // Manual Trigger for verification
            const tools = getTools();
            console.error(`[MCE2-HOST] Manual Process: AI Bridge confirmed with ${tools.length} tools.`);

            // Note: This is the exact entry point where we will later 
            // trigger the AI to choose get_available_apps or render_component.
        } else {
            // Log other traffic (like SDK handshakes) so we stay informed
            console.error(`[MCE2-HOST-RAW-IN] SDK Traffic: ${json.method}`);
        }
    } catch (e) {
        // Ignore parsing errors for non-JSON traffic
    }
});

// Force immediate log flushing
process.stderr.write("[MCE2-HOST] Stream logic initialized...\n");
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
            // This tells the SDK we intend to handle notifications
            notifications: {}
        },
    }
);

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_PATH = join(__dirname, "../config/mce2-tools.json");

const getTools = () => {
    try {
        return JSON.parse(readFileSync(TOOLS_PATH, "utf8"));
    } catch (e) {
        console.error("Failed to load tools manifest:", e.message);
        return [];
    }
};

/**
 * 1. Tell the AI what tools are available
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getTools();
    console.error(`[MCE2-HOST] AI Handshake: Reporting ${tools.length} tools from manifest.`);
    return { tools };
});

/**
 * 2. Handle the actual tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    console.error(`[MCE2-HOST] AI Executing Tool: ${name}`);

    try {
        if (name === "get_available_apps") {
            const url = `${MOQUI_BASE_URL}/AvailableApps`;
            console.error(`[MCE2-HOST] Fetching components from: ${url}`);
            const response = await axios.get(url);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(response.data, null, 2),
                }],
            };
        }

        if (name === "render_component") {
            const { componentJson, mcpToken, targetId = "mce-canvas" } = args;

            console.error(`[MCE2-HOST] Relaying render to Sidecar for target: ${targetId}`);

            // Corrected axios call
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
        console.error(`[MCE2-HOST] MCP Error (${name}):`, error.response?.data || error.message);
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
    console.error("[MCE2-HOST] Bootstrap Sequence Initiated...");
    const transport = new StdioServerTransport();

    // Explicitly log the Moqui URL we are targeting
    console.error(`[MCE2-HOST] Targeting Moqui at: ${MOQUI_BASE_URL}`);

    await server.connect(transport);
    console.error("[MCE2-HOST] MCP Server (Stdio) is officially LIFTED and CONNECTED.");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});