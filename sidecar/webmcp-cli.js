#!/usr/bin/env node

/**
 * WebMCP CLI Bridge - Allows calling WebMCP tools from command line
 * 
 * Usage:
 *   node webmcp-cli.js list-tools
 *   node webmcp-cli.js call-tool ping_browser
 *   node webmcp-cli.js call-tool click_element '{"mariaId": "some-id"}'
 *   node webmcp-cli.js call-tool navigate '{"path": "/aitree/Home"}'
 */

import WebSocket from 'ws';

// Connect to MCP path which doesn't require auth
// The MCP server bridges requests to the browser channel
const WEBSOCKET_URL = 'ws://localhost:4797/mcp';

async function listTools() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WEBSOCKET_URL);
        
        ws.on('open', () => {
            console.error('Connected to WebMCP server');
            // Send list tools request using WebMCP protocol (not JSON-RPC)
            ws.send(JSON.stringify({
                type: 'listTools',
                id: 'cli-1'
            }));
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            console.error('Received:', message.type);
            
            if (message.type === 'listToolsResponse') {
                const tools = message.tools || [];
                console.log(JSON.stringify(tools, null, 2));
                ws.close();
                resolve(tools);
            } else if (message.type === 'error') {
                console.error('Error from server:', message.message);
                ws.close();
                reject(new Error(message.message));
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
            reject(error);
        });
        
        ws.on('close', () => {
            console.error('Disconnected from WebMCP server');
        });
        
        // Timeout after 5 seconds
        setTimeout(() => {
            ws.close();
            reject(new Error('Timeout waiting for response'));
        }, 5000);
    });
}

async function callTool(toolName, args = {}) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WEBSOCKET_URL);
        
        ws.on('open', () => {
            console.error('Connected to WebMCP server');
            // When calling from MCP path, use the full tool name as returned by listTools
            // Send call tool request using WebMCP protocol
            ws.send(JSON.stringify({
                type: 'callTool',
                tool: toolName,  // Use 'tool' not 'name'
                arguments: args,
                id: 'cli-call-1'
            }));
        });
        
        ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            console.error('Received:', message.type);
            
            if (message.type === 'toolResponse') {
                const result = message.result || message;
                console.log(JSON.stringify(result, null, 2));
                ws.close();
                resolve(result);
            } else if (message.type === 'error') {
                console.error('Error from server:', message.message);
                ws.close();
                reject(new Error(message.message));
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
            reject(error);
        });
        
        ws.on('close', () => {
            console.error('Disconnected from WebMCP server');
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            ws.close();
            reject(new Error('Timeout waiting for response'));
        }, 10000);
    });
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    if (!command) {
        console.error('Usage:');
        console.error('  node webmcp-cli.js list-tools');
        console.error('  node webmcp-cli.js call-tool <tool-name> [json-args]');
        console.error('');
        console.error('Examples:');
        console.error('  node webmcp-cli.js list-tools');
        console.error('  node webmcp-cli.js call-tool ping_browser');
        console.error('  node webmcp-cli.js call-tool click_element \'{"mariaId": "btn-submit"}\'');
        console.error('  node webmcp-cli.js call-tool navigate \'{"path": "/aitree/Home"}\'');
        console.error('  node webmcp-cli.js call-tool set_field_value \'{"mariaId": "name", "value": "John"}\'');
        process.exit(1);
    }
    
    try {
        if (command === 'list-tools') {
            await listTools();
        } else if (command === 'call-tool') {
            const toolName = args[1];
            const argsJson = args[2] || '{}';
            
            if (!toolName) {
                console.error('Error: tool-name is required');
                process.exit(1);
            }
            
            let toolArgs;
            try {
                toolArgs = JSON.parse(argsJson);
            } catch (e) {
                console.error('Error: Invalid JSON for arguments:', e.message);
                process.exit(1);
            }
            
            await callTool(toolName, toolArgs);
        } else {
            console.error(`Unknown command: ${command}`);
            process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
