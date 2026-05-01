/**
 * MCP-HOST DEBUG VERSION
 * Location: runtime/component/moqui-mce/mcp-host/mcp-host.js
 */
const fs = require('fs');

function log(msg) {
    const timestamp = new Date().toISOString();
    // We log to stderr so it gets picked up by the Sidecar's pipe
    console.error(`[MCE2-HOST DEBUG ${timestamp}] ${msg}`);
}

log("Host process started and waiting for input...");

process.stdin.on('data', (data) => {
    try {
        const input = data.toString();
        log(`INBOUND RAW: ${input}`);

        // Check if this is a valid JSON-RPC request (standard for MCP)
        const request = JSON.parse(input);
        log(`PARSED REQUEST: ${request.method || 'userMessage'}`);

        // Logic to simulate AI/Gemini response
        handleRequest(request);

    } catch (err) {
        log(`CRITICAL ERROR parsing stdin: ${err.message}`);
    }
});

function handleRequest(request) {
    // If the message is a "userMessage" (the prompt from the browser)
    if (request.type === 'userMessage' || request.method === 'userMessage') {
        log(`HANDLING PROMPT: ${request.text}`);

        // STUB: Simulate the AI generating a tool call
        // In a real scenario, this is where you'd call Gemini
        log("AI DECISION: Attempting to call comm_send_huddle_alert...");
    }
}

// Prevent the process from exiting immediately
process.stdin.resume();

process.on('SIGTERM', () => {
    log("Received SIGTERM, shutting down.");
    process.exit(0);
});