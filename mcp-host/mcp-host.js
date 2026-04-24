import 'dotenv/config';
import { GoogleGenAI } from "@google/genai"; // Fix: Changed from @google/generative-ai
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import { createWriteStream } from 'fs';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// Force an immediate write to the log file to prove connectivity
process.stderr.write("[MCE2-HOST] --- LOG PIPE ESTABLISHED ---\n");

// Resolve the absolute path to the .env file in the same folder as this script
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
const TOOLS_PATH = join(__dirname, "../config/mce2-tools.json");

const apiKey = process.env.GEMINI_API_KEY;

// --- ROBUST LOGGING SETUP ---
const logFilePath = join(__dirname, "mcp-host.log");
const logStream = createWriteStream(logFilePath, { flags: 'a' });

// This sends ALL logs to BOTH the terminal AND the file
console.error = (...args) => {
    const message = args.join(' ') + '\n';
    process.stderr.write(message); // Write to Terminal
    logStream.write(message);      // Write to Log File
};

console.error(`[MCE2-HOST] API Key Status: ${apiKey ? `LOADED (Starts with: ${apiKey.substring(0, 4)}...)` : 'NOT FOUND'}`);


// The new SDK automatically detects GEMINI_API_KEY from your .env
// The 2026 SDK requires explicit versioning for Gemini 3.1 models
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { timeout: 120000 }
});

const modelName = "gemini-2.0-flash-lite";

// Force immediate, unbuffered writes to the terminal
process.stderr.write("[MCE2-HOST] --- SYSTEM STARTING ---\n");

// Overwrite console.error to ensure it flushes immediately
const originalError = console.error;

process.stderr.write("[MCE2-HOST] --- LOGGING HANDSHAKE ESTABLISHED ---\n");
console.error("[MCE2-HOST] --- LOGGING HANDSHAKE ESTABLISHED (console.error) ---\n");

// --- 1. GLOBAL STATE ---
const CACHE_TTL_SECONDS = 3600; // 1 Hour (Standard for a coding session)

const getTools = () => {
    try {
        return JSON.parse(readFileSync(TOOLS_PATH, "utf8"));
    } catch (e) {
        console.error("Failed to load tools manifest:", e.message);
        return [];
    }
};


// Raw Debug: Listen to the pulse of the input stream
// At the top of your file, ensure the 120s timeout is set
process.stdin.on('data', async (data) => {
    let userText = "";
    try {
        const raw = data.toString().trim();
        const json = JSON.parse(raw);

        // 1. LOUD PULSE: Print every single byte received to the log
        console.error(`[RAW-INBOUND] Received ${raw.length} bytes.`);

        // 2. Content Peek: See the first 50 characters
        console.error(`[RAW-CONTENT] ${raw.substring(0, 50)}...`);

        if (json.method === "notifications/message") {
            userText = json.params?.text || "";
            console.error(`[MCE2-HOST] Routing to Gemini (v1beta): ${userText}`);
            try {
                const rawTools = getTools();
                const currentGeminiTools = rawTools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema // Renaming for Gemini
                }));

                const result = await ai.models.generateContent({
                    model: modelName,
                    systemInstruction: "You are the AI UI Controller for the Nursing Home Management System. Call tools immediately.",
                    tools: [{ functionDeclarations: currentGeminiTools }],
                    contents: [{
                        role: 'user',
                        parts: [{ text: userText }]
                    }],
                    toolConfig: { functionCallingConfig: { mode: "ANY" } }
                });

                const functionCalls = result.response.functionCalls();

                if (functionCalls && functionCalls.length > 0) {
                    for (const call of functionCalls) {
                        console.error(`[MCE2-HOST] SUCCESS: AI triggered Tool: ${call.name}`);
                        // This log MUST appear in your mcp-sidecar.log if the AI actually called the tool
                    }
                } else {
                    // If this log appears, the AI didn't feel it needed a tool
                    console.error("[MCE2-HOST] AI responded with text instead of a tool call.");
                    console.error(`[MCE2-HOST] AI Text: ${result.response.text()}`);
                }

            } catch (err) {
                if (err.message.includes("404")) {
                    console.error(`[MCE2-HOST] Model ID ${modelName} rejected by v1beta. Please check mcp-host.js line 15.`);
                } else if (err.message.includes("429")) {
                    console.error("[MCE2-HOST] Quota exhausted. Switch to gemini-2.0-flash-lite or gemini-pro-latest.");
                } else {
                    console.error(`[MCE2-HOST] Gemini SDK Error: ${err.message}`);
                }
            }
        }
    } catch (e) {
        // Keep the stdin pipe open for Moqui traffic
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
