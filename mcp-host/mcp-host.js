import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { z } from "zod";
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { EventSource } from "eventsource";

// 1. ENVIRONMENT & CONFIG
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const MOQUI_BASE_URL = process.env.MOQUI_BASE_URL || 'http://localhost:8080';
const MOQUI_USERNAME = process.env.MOQUI_USERNAME || 'john.sales';
const MOQUI_PASSWORD = process.env.MOQUI_PASSWORD || 'moqui';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

global.EventSource = EventSource; // Polyfill for SSE transport in Node.js

const server = new McpServer({
    name: "moqui-mce-host",
    version: "2.1.0",
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 2. REMOTE MCP CLIENT (Moqui-MCP)
const remoteClient = new Client(
    { name: "mce-host-connector", version: "2.1.0" },
    { capabilities: { tools: {} } }
);

async function connectToMoquiMcp() {
    try {
        const mcpUrl = new URL(`${MOQUI_BASE_URL}/mcp/sse`);
        console.error(`[MCE2-HOST] Connecting to Moqui-MCP at ${mcpUrl}`);

        const transport = new SSEClientTransport(mcpUrl, {
            eventSourceInit: {
                headers: {
                    'Authorization': `Basic ${Buffer.from(`${MOQUI_USERNAME}:${MOQUI_PASSWORD}`).toString('base64')}`
                }
            }
        });
        const authHeader = `Basic ${Buffer.from(`${MOQUI_USERNAME}:${MOQUI_PASSWORD}`).toString('base64')}`;
        console.error(`[DEBUG] Auth Header: ${authHeader}`);
        const authHeader2 = `Basic ${Buffer.from(`${MOQUI_USERNAME}:${MOQUI_PASSWORD}`)}`;
        console.error(`[DEBUG] Auth Header2: ${authHeader2}`);

        await remoteClient.connect(transport);
        console.error(`[MCE2-HOST] Successfully connected to Moqui-MCP.`);
    } catch (error) {
        console.error(`[MCE2-HOST] Failed to connect to Moqui-MCP: ${error.message}`);
    }
}

// 3. MOQUI REST HELPER
async function callMoquiRest(endpoint, method = 'GET', body = null) {
    const auth = Buffer.from(`${MOQUI_USERNAME}:${MOQUI_PASSWORD}`).toString('base64');
    let url = `${MOQUI_BASE_URL}/rest/s1/${endpoint}`;

    if (method === 'GET' && body) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(body)) {
            params.append(key, value);
        }
        const queryString = params.toString();
        if (queryString) url += `?${queryString}`;
    }

    const options = {
        method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    if (method !== 'GET' && method !== 'HEAD' && body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Moqui REST error ${response.status}: ${await response.text()}`);
    return await response.json();
}

// 4. TOOL REGISTRATION
// Local implementation for m_entity_find (Nursing Home records focus)
//server.tool(
//    "m_entity_find",
//    "Queries the Moqui Mantle database for records. Use this for general data retrieval.",
//    {
//        entityName: z.string().describe("The Mantle entity to query (e.g., mantle.party.Party)"),
//        filter: z.record(z.any()).describe("The search criteria (e.g., { partyId: '100' })"),
//    },
//    async ({ entityName, filter }) => {
//        console.error(`[MCE2-HOST] Executing m_entity_find: ${entityName}`);
//        const data = await callMoquiRest(`entities/${entityName}`, 'GET', filter);
//        return { content: [{ type: "text", text: JSON.stringify(data) }] };
//    }
//);

// Local implementation for get_available_apps
server.tool(
    "get_available_apps",
    "List all AI-ready components (apps) available in the Moqui instance.",
    {},
    async () => {
        console.error(`[MCE2-HOST] Fetching available apps...`);
        // We can use the REST API to discover components or hardcode based on system knowledge
        const data = await callMoquiRest('master/components', 'GET');
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
    }
);

// MCE specific render tool
server.tool(
    "w_render_component",
    "Renders a Quasar/Vue component in the MCE2 user interface canvas.",
    {
        componentName: z.string().describe("The name of the component (e.g., PatientCard)"),
        props: z.record(z.any()).optional().describe("Data for the component"),
    },
    async ({ componentName, props }) => {
        return { content: [{ type: "text", text: JSON.stringify({ action: "render", componentName, props }) }] };
    }
);

// 5. GEMINI AI BRIDGE
async function listAllToolsForGemini() {
    // 1. Get remote tools from Moqui-MCP
    let remoteTools = [];
    try {
        const listResult = await remoteClient.listTools();
        remoteTools = listResult.tools || [];
    } catch (e) {
        console.error(`[MCE2-HOST] Could not list remote tools: ${e.message}`);
    }

    // 2. Map remote tools to Gemini format
    const geminiTools = remoteTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema // MCP Schema matches Gemini Function Declaration schema
    }));

    // 3. Add local tools (already defined in server above, but we need them in Gemini's tool list)
    const localToolsDeclarations = [
        //        {
        //            name: "m_entity_find",
        //            description: "Queries Moqui entities.",
        //            parameters: {
        //                type: "object",
        //                properties: {
        //                    entityName: { type: "string" },
        //                    filter: { type: "object" }
        //                },
        //                required: ["entityName", "filter"]
        //            }
        //        },
        {
            name: "get_available_apps",
            description: "Lists Moqui apps.",
            parameters: { type: "object", properties: {} }
        },
        {
            name: "w_render_component",
            description: "Renders UI components.",
            parameters: {
                type: "object",
                properties: {
                    componentName: { type: "string" },
                    props: { type: "object" }
                },
                required: ["componentName"]
            }
        }
    ];

    return [...geminiTools, ...localToolsDeclarations];
}

async function callGemini(prompt) {
    try {
        const tools = await listAllToolsForGemini();
        const model = genAI.getGenerativeModel({
            model: "gemini-3.1-pro-preview", // High reliability version of Gemini Pro
            systemInstruction: "You are an AI Architect for the Moqui MCE2 ecosystem. Use available tools to discover apps, query data, and render components. Respond concisely.",
            tools: [{ functionDeclarations: tools }]
        });

        const chat = model.startChat();
        let result = await chat.sendMessage(prompt);
        let response = result.response;

        // Handle tool calls loop
        let iterations = 0;
        while (response.functionCalls()?.length > 0 && iterations < 5) {
            const calls = response.functionCalls();
            const results = [];

            for (const call of calls) {
                console.error(`[MCE2-HOST] AI calling tool: ${call.name}`);
                let output;

                // Check if it's a local tool
                if (["m_entity_find", "get_available_apps", "w_render_component"].includes(call.name)) {
                    // Manual dispatch for local tools (or we could use the server.callTool internal API)
                    if (call.name === "m_entity_find") {
                        output = await callMoquiRest(`entities/${call.args.entityName}`, 'GET', call.args.filter);
                    } else if (call.name === "get_available_apps") {
                        output = await callMoquiRest('master/components', 'GET');
                    } else if (call.name === "w_render_component") {
                        output = { action: "render", componentName: call.args.componentName, props: call.args.props };
                    }
                } else {
                    // It's a remote tool from moqui-mcp
                    try {
                        const mcpResponse = await remoteClient.callTool({
                            name: call.name,
                            arguments: call.args
                        });
                        output = mcpResponse.content?.[0]?.text || mcpResponse;
                    } catch (e) {
                        output = { error: e.message };
                    }
                }

                results.push({
                    functionResponse: {
                        name: call.name,
                        response: { content: output }
                    }
                });
            }

            result = await chat.sendMessage(results);
            response = result.response;
            iterations++;
        }

        return response.text();
    } catch (err) {
        return `Error in AI processing: ${err.message}`;
    }
}

// 6. MAIN COMMUNICATION LOOP (STDIO)
process.stdin.on('data', async (data) => {
    const raw = data.toString();
    try {
        const parsed = JSON.parse(raw);
        if (parsed.method === "notifications/message" || parsed.method === "chat/message") {
            const userPrompt = parsed.params.text || parsed.params.message;
            console.error(`[MCE2-HOST] User: ${userPrompt}`);

            const aiText = await callGemini(userPrompt);

            process.stdout.write(JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/message",
                params: { text: aiText }
            }) + "\n");
        }
    } catch (e) {
        console.error(`[MCE2-HOST-ERROR] ${e.message}`);
    }
});

// 7. LIFECYCLE
async function run() {
    // 1. Connect to Moqui-MCP
    await connectToMoquiMcp();

    // 2. Start this host's MCP server (for external clients)
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error("[MCE2-HOST] Modern MCP Host is online and bridged to Moqui-MCP.");
}

run().catch(err => {
    console.error("[MCE2-HOST] Fatal Error:", err);
    process.exit(1);
});