#!/usr/bin/env node

/**
 * WebMCP MCP Bridge - Connects to WebMCP and exposes tools via MCP stdio protocol
 * 
 * This script connects to the WebMCP WebSocket server and bridges it to MCP stdio,
 * allowing MCP clients (like Claude Desktop) to access browser tools.
 * 
 * Usage: Put this in your MCP client config:
 * {
 *   "mcpServers": {
 *     "webmcp": {
 *       "command": "node",
 *       "args": ["/path/to/webmcp-mcp-bridge.js"]
 *     }
 *   }
 * }
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import WebSocket from 'ws';

const WEBSOCKET_URL = 'ws://localhost:4797/mcp';

class WebMCPBridge {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.requestId = 1;
        this.pendingRequests = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(WEBSOCKET_URL);

            this.ws.on('open', () => {
                console.error('Connected to WebMCP WebSocket server');
                this.connected = true;
                resolve();
            });

            this.ws.on('message', (data) => {
                this.handleWebSocketMessage(JSON.parse(data.toString()));
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error.message);
                reject(error);
            });

            this.ws.on('close', () => {
                console.error('Disconnected from WebMCP');
                this.connected = false;
            });

            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Connection timeout'));
                }
            }, 5000);
        });
    }

    handleWebSocketMessage(message) {
        console.error('Received from WS:', message.type);

        if (message.type === 'listToolsResponse') {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                pending.resolve(message.tools || []);
            }
        } else if (message.type === 'toolResponse') {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                pending.resolve(message.result);
            }
        } else if (message.type === 'error') {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                pending.reject(new Error(message.message));
            }
        }
    }

    async listTools() {
        if (!this.connected) {
            throw new Error('Not connected to WebMCP');
        }

        const id = String(this.requestId++);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            this.ws.send(JSON.stringify({
                type: 'listTools',
                id: id
            }));

            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Timeout'));
                }
            }, 10000);
        });
    }

    async callTool(name, args) {
        if (!this.connected) {
            throw new Error('Not connected to WebMCP');
        }

        const id = String(this.requestId++);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            this.ws.send(JSON.stringify({
                type: 'callTool',
                id: id,
                name: name,
                arguments: args
            }));

            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Timeout'));
                }
            }, 30000);
        });
    }
}

// Main - run as MCP stdio server
async function main() {
    const bridge = new WebMCPBridge();

    try {
        await bridge.connect();
        console.error('WebMCP Bridge ready');
    } catch (error) {
        console.error('Failed to connect:', error);
        process.exit(1);
    }

    // Read MCP requests from stdin
    process.stdin.on('data', async (data) => {
        try {
            const request = JSON.parse(data.toString());
            console.error('Received MCP request:', request.method);

            let response;

            if (request.method === 'initialize') {
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {}
                        },
                        serverInfo: {
                            name: 'webmcp-bridge',
                            version: '1.0.0'
                        }
                    }
                };
            } else if (request.method === 'tools/list') {
                const tools = await bridge.listTools();
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: {
                        tools: tools.map(tool => ({
                            name: tool.name,
                            description: tool.description,
                            inputSchema: tool.inputSchema
                        }))
                    }
                };
            } else if (request.method === 'tools/call') {
                const result = await bridge.callTool(request.params.name, request.params.arguments || {});
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: result
                };
            } else if (request.method === 'notifications/initialized') {
                // No response needed
                return;
            } else {
                response = {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${request.method}`
                    }
                };
            }

            process.stdout.write(JSON.stringify(response) + '\n');
        } catch (error) {
            console.error('Error:', error.message);
            const response = {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32603,
                    message: error.message
                }
            };
            process.stdout.write(JSON.stringify(response) + '\n');
        }
    });
}

main().catch(console.error);
