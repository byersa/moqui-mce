/**
 * MCP-HOST DEBUG VERSION (ESM)
 * Location: runtime/component/moqui-mce/mcp-host/mcp-host.js
 */
import fs from 'fs'; // Use import instead of require
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { wss } from './websocket-server.js'; // Import the pipe
import { assembleSuperSet } from './getArtifactJSON.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.error("[MCE2-HOST] __filename:" + __filename);
console.error("[MCE2-HOST] __dirname:" + __dirname);

// Now this will work
const envPath = join(__dirname, '.env');
console.error("[MCE2-HOST] envPath:" + envPath);
dotenv.config({ path: envPath, quiet: true });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("[MCE2-HOST] ERROR: GEMINI_API_KEY not found in .env file");
    // Don't exit yet, so we can still see logs, but the AI won't work
}

function log(msg) {
    const timestamp = new Date().toISOString();
    // Logging to stderr so it pipes to our new log file
    console.error(`[MCE2-HOST DEBUG ${timestamp}] ${msg}`);
}

/**
 * Sends a pulse command to the browser to highlight a UI element.
 *
 */
function sendPulse(wss, componentId, color = 'amber-6') {
    const command = {
        action: 'updateProperty', // Matches BlueprintClient logic
        payload: {
            id: componentId,
            properties: {
                // Using Quasar colors or CSS border for the pulse effect
                style: `outline: 3px solid ${color}; outline-offset: 2px; transition: all 0.3s ease;`
            }
        }
    };

    const message = JSON.stringify({ type: 'command', data: command });

    wss.clients.forEach(client => {
        if (client.readyState === 1) { // 1 = OPEN
            client.send(message);
        }
    });
}

// The Pulse Logic
export function firePulse(componentId, color = 'amber-7') {
    const message = JSON.stringify({
        type: 'command',
        data: {
            action: 'updateProperty',
            payload: {
                id: componentId,
                properties: {
                    style: `outline: 4px solid ${color}; outline-offset: 2px; transition: all 0.3s;`
                }
            }
        }
    });

    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(message);
    });
}
log("Host process started successfully in ESM mode.");
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// RUGGED: Switching to the specialized tool-calling model
const model = genAI.getGenerativeModel({
    model: "gemini-3.1-pro-preview-customtools",
    tools: [{
        functionDeclarations: [{
            name: "comm_send_huddle_alert",
            description: "Triggers a high-priority staff alert for resident safety or facility emergencies.",
            parameters: {
                type: "object",
                properties: {
                    huddleType: {
                        type: "string",
                        enum: ["Emergency", "Clinical", "Administrative"], // RUGGED: Restrict to valid types
                        description: "The category of the huddle alert."
                    },
                    location: {
                        type: "string",
                        description: "The specific wing or room (e.g., 'North Wing', 'Dining Hall')."
                    },
                    note: {
                        type: "string",
                        description: "Brief details about the resident or incident."
                    }
                },
                required: ["huddleType", "location"] //
            }
        },
        {
            name: "get_artifact",
            description: "Loads a Moqui XML artifact and its Blueprint into a MARIA-Superset JSON.",
            inputSchema: {
                type: "object",
                properties: {
                    component: { type: "string", description: "e.g., nursing-home" },
                    path: { type: "string", description: "e.g., screen/nursinghome/ResidentAlert.xml" }
                },
                required: ["component", "path"]
            },
            handler: async (args) => {
                // 1. Logic to read the XML from the disk
                // 2. Logic to parse it using fast-xml-parser
                // 3. Logic to return the JSON to the MceShell
                const jsonSuperset = await assembleSuperSet(args.component, args.path);
                return {
                    content: [{ type: "text", text: JSON.stringify(jsonSuperset) }]
                };
            }
        },
        ]
    }]
});

process.stdin.on('data', async (data) => {
    const input = data.toString().trim();
    const request = JSON.parse(input);

    if (request.method === "notifications/message") {
        log(`REAL AI PROCESSING: ${request.params.text}`);

        // 1. Send to Gemini
        const chat = model.startChat();
        const result = await chat.sendMessage(request.params.text);
        const response = result.response;

        // 2. Check for Tool Calls
        const calls = response.functionCalls();
        if (calls) {
            log(`[TRACING-v2] GEMINI DECIDED TO CALL: ${calls[0].name}`);

            // 3. RUGGED: Format the response back to the Sidecar
            const toolCall = JSON.stringify({
                jsonrpc: "2.0",
                method: "callTool",
                params: {
                    tool: calls[0].name,
                    arguments: calls[0].args
                }
            }) + "\n";

            process.stdout.write(toolCall); // Send back up the pipe to websocket, which receives it on !

            // 2. Send an Acknowledgement (The Feedback)
            // We send this as a standard message so the UI can display it
            const ack = JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/message",
                params: {
                    text: `⚠️ Emergency Alert Triggered: I have notified the staff at ${calls[0].args.location} regarding ${calls[0].args.note || 'the incident'}.`
                }
            }) + "\n";
            process.stdout.write(ack);
        }
    }
});


process.stdin.resume();