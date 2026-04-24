import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Get the directory of the current file (mcp-host.js)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from the same folder as this script
dotenv.config({ path: path.join(__dirname, '.env') });

console.error("[MCE2-CHECK] Loading config from:", process.cwd());
console.error("[MCE2-CHECK] API Key Found:", process.env.GEMINI_API_KEY ? "YES" : "NO");

// Access your keys using process.env
const apiKey = process.env.GEMINI_API_KEY;
const moquiUrl = process.env.MOQUI_BASE_URL;

if (!apiKey) {
    console.error("[MCE2-HOST] FATAL: GEMINI_API_KEY is missing from .env");
    process.exit(1);
}
/**
 * 1. CONFIGURATION & IDENTITY
 */
const server = new McpServer({
    name: "nursing-home-management-host",
    version: "2.0.0",
});

// Note: In a real Orem setup, use process.env.GEMINI_API_KEY
const GEMINI_API_KEY = "YOUR_TIER_1_KEY_HERE";

/**
 * 2. TOOL REGISTRATION: WEBMCP (UI)
 * These tools send commands back to the Sidecar to update the browser.
 */
server.tool(
    "w_render_component",
    "Renders a Quasar/Vue component in the Nursing Home UI",
    {
        componentName: z.string().describe("The name of the component (e.g., PatientCard)"),
        props: z.record(z.any()).optional().describe("Data for the component"),
    },
    async ({ componentName, props }) => {
        // This log goes to stderr, so it won't break the JSON pipe!
        console.error(`[MCE2-HOST] AI requested render: ${componentName}`);

        return {
            content: [{
                type: "text",
                text: JSON.stringify({ action: "render", componentName, props })
            }]
        };
    }
);

/**
 * 3. TOOL REGISTRATION: MOQUI (DATA)
 * These tools talk directly to your Moqui server via REST.
 */
server.tool(
    "m_entity_find",
    "Queries the Moqui database for Nursing Home records (Mantle UDM)",
    {
        entityName: z.string().describe("The Mantle entity to query (e.g., mantle.party.Party)"),
        filter: z.record(z.any()).describe("The search criteria"),
    },
    async ({ entityName, filter }) => {
        try {
            console.error(`[MCE2-HOST] Querying Moqui entity: ${entityName}`);

            // Moqui Entity REST path: /entities/{entityName}
            const data = await callMoqui(`entities/${entityName}`, 'GET', filter);

            return {
                content: [{
                    type: "text",
                    text: `Found ${data.length || 0} records for ${entityName}: ${JSON.stringify(data)}`
                }]
            };
        } catch (error) {
            console.error(`[MCE2-HOST] Moqui Query Failed:`, error.message);
            return {
                content: [{ type: "text", text: `Error: Could not retrieve ${entityName}.` }],
                isError: true
            };
        }
    }
);

/**
 * MOQUI REST HELPER
 * Encapsulates authentication and path logic for Mantle UDM.
 */
async function callMoqui(endpoint, method = 'GET', body = null) {
    const auth = Buffer.from(`${process.env.MOQUI_USERNAME}:${process.env.MOQUI_PASSWORD}`).toString('base64');

    const url = `${process.env.MOQUI_BASE_URL}/rest/s1/${endpoint}`;

    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!response.ok) {
        throw new Error(`Moqui error ${response.status}: ${await response.text()}`);
    }

    return await response.json();
}

/**
 * 4. LIFECYCLE & TRANSPORT
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCE2-HOST] Modern Host is running. Stdin/Stdout reserved for MCP.");
}

// THE SELF-DESTRUCT: Kills the host if the Sidecar dies
process.stdin.on('close', () => {
    console.error("[MCE2-HOST] Sidecar connection lost. Self-destructing...");
    process.exit(0);
});

main().catch((err) => {
    console.error("[MCE2-HOST] Fatal Error:", err);
    process.exit(1);
});