/**
 * MCE2 Alpha Shell Component
 * Minimal foundation for the MCE2 visual environment.
 */
window.MceShell = {
    name: 'MceShell',
    props: {
        connectionToken: String,
        isDesignMode: String
    },
    data() {
        return {
            webMcpStatus: 'grey-7',
            dataStatus: 'grey-7',
            leftDrawerOpen: true,
            rightDrawerOpen: true,
            apps: [],
            messages: [
                { role: 'assistant', text: 'MCE2 Shell active. Infrastructure bridge initialized.' }
            ],
            userInput: '',
            checkInterval: null,
            pendingMessages: [],
            isConnecting: false,
            isSocketConnected: false
        }
    },
    template: `
        <q-layout view="hHh Lpr lFf" class="shadow-2 rounded-borders">
            <!-- Header -->
            <q-header elevated class="bg-blue-grey-10 text-white">
                <q-toolbar>
                    <q-btn flat round dense icon="menu" @click="leftDrawerOpen = !leftDrawerOpen" class="q-mr-sm"></q-btn>
                    <q-toolbar-title class="text-uppercase letter-spacing-1">
                        MCE2 <span class="text-weight-thin">Alpha Shell</span>
                    </q-toolbar-title>
                    
                    <q-space></q-space>

                    <!-- Connectivity Indicators -->
                    <div class="row no-wrap items-center q-gutter-x-sm q-mr-md">
                        <q-btn flat round dense :color="webMcpStatus" icon="cloud" size="12px">
                            <q-tooltip>WebMCP Sidecar Status (Port 3000)</q-tooltip>
                        </q-btn>
                        <q-btn flat round dense :color="dataStatus" icon="storage" size="12px">
                            <q-tooltip>Moqui Registry Status (/rest/s1/mce2)</q-tooltip>
                        </q-btn>
                    </div>
                    
                    <q-separator dark vertical inset class="q-mx-sm"></q-separator>

                    <q-badge v-if="connectionToken" color="green-10" class="q-pa-sm q-ml-sm">
                        <q-icon name="key" class="q-mr-xs" size="14px"></q-icon>
                        {{ connectionToken.substring(0,8) }}...
                    </q-badge>
                    
                    <q-btn flat round dense icon="chat" @click="rightDrawerOpen = !rightDrawerOpen" class="q-ml-md" />
                </q-toolbar>
            </q-header>

            <!-- Navigation Drawer (Left) -->
            <q-drawer v-model="leftDrawerOpen" side="left" bordered class="bg-blue-grey-10 text-white">
                <q-scroll-area class="fit">
                    <q-list padding>
                        <q-item-label header class="text-blue-grey-4">AVAILABLE APPS</q-item-label>
                        <q-item v-for="app in apps" :key="app.value" clickable @click="loadApp(app.value)" v-ripple>
                            <q-item-section avatar><q-icon name="extension" /></q-item-section>
                            <q-item-section>{{ app.label }}</q-item-section>
                        </q-item>
                        <q-item v-if="apps.length === 0" class="text-caption text-blue-grey-6 q-pa-md">
                            No MCE apps discovered yet.
                        </q-item>
                    </q-list>
                </q-scroll-area>
            </q-drawer>

            <!-- AI Chat Drawer (Right) -->
            <q-drawer v-model="rightDrawerOpen" side="right" bordered class="bg-blue-grey-10 text-white" :width="350">
                <div class="column no-wrap fit">
                    <!-- Messages Area -->
                    <q-scroll-area class="col q-pa-md">
                        <div v-for="(msg, idx) in messages" :key="idx" 
                             :class="['q-mb-md rounded-borders q-pa-sm', msg.role === 'user' ? 'bg-blue-grey-9 text-right' : 'bg-blue-grey-8']">
                            <div class="text-caption text-blue-grey-4 uppercase">{{ msg.role }}</div>
                            <div class="text-body2 white-pre-wrap">{{ msg.text }}</div>
                        </div>
                    </q-scroll-area>

                    <!-- Input Area -->
                    <div id="mce-chat-input-area" class="col-1">
                        <div class="q-pa-md">
                            <q-input dark dense filled v-model="userInput" placeholder="Ask AI Architect..." @keyup.enter="sendMessage">
                                <template v-slot:append>
                                    <q-spinner v-if="!isSocketConnected" color="blue-grey-4" size="1.2em" class="q-mr-sm">
                                        <q-tooltip>Connecting to Architect...</q-tooltip>
                                    </q-spinner>
                                    <q-btn round dense flat icon="send" @click="sendMessage" />
                                </template>
                            </q-input>
                        </div>
                    </div>
                </div>
            </q-drawer>

            <!-- Main Content Area -->
            <q-page-container class="overflow-hidden">
                <q-page class="bg-blue-grey-11">
                    <div id="mce-canvas" class="full-width relative-position overflow-hidden" style="height: calc(100vh - 51px);">
                        <div class="absolute-center text-center">
                            <q-icon name="auto_awesome" size="120px" color="blue-grey-9" style="opacity: 0.3"></q-icon>
                            <div class="text-h4 text-blue-grey-9 text-weight-thin q-mt-md" style="opacity: 0.5">MCE2 CANVAS</div>
                            <div class="text-caption text-blue-grey-8 q-mt-sm">Bridge status: {{ webMcpStatus === 'green-13' ? 'CONNECTED' : 'DISCONNECTED' }}</div>
                        </div>
                    </div>
                </q-page>
            </q-page-container>
        </q-layout>
    `,
    computed: {
        canvasInjected() { return false; }
    },
    methods: {
        async loadApps() {
            try {
                const resp = await fetch('/rest/s1/mce2/AvailableApps');
                const data = await resp.json();
                this.apps = data.apps || [];
            } catch (e) { console.error("Failed to load apps", e); }
        },
        sendMessage() {
            const text = this.userInput.trim();
            if (!text) return;

            this.messages.push({ role: 'user', text: text });
            this.userInput = '';

            if (window.webmcp && window.webmcp.isConnected) {
                console.info("MCE2 Bridge: Relaying command to WebMCP...", text);
                window.webmcp._sendMessage({
                    type: 'userMessage',
                    text: text,
                    token: this.connectionToken
                });
                this.messages.push({ role: 'assistant', text: 'Command sent to Architect.' });
            } else {
                console.warn("MCE2 Bridge: WebMCP Offline. Queuing message.");
                this.pendingMessages.push(text);
                this.messages.push({ role: 'assistant', text: 'Bridge offline. Message queued. Connecting...' });
                this.tryAutoConnect();
            }
        },
        onWebMcpStatus(event) {
            const { status, message } = event.detail;
            console.log("MCE2 Shell: WebMCP Status Change", status, message);
            
            if (status === 'connected') {
                this.webMcpStatus = 'green-13';
                this.isSocketConnected = true;
                this.isConnecting = false;
                this.flushPendingMessages();
            } else if (status === 'connecting' || status === 'pending-auth') {
                this.webMcpStatus = 'yellow-9';
                this.isSocketConnected = false;
                this.isConnecting = true;
            } else {
                this.webMcpStatus = 'red-9';
                this.isSocketConnected = false;
                this.isConnecting = false;
            }
        },
        flushPendingMessages() {
            if (this.pendingMessages.length === 0) return;
            console.info(`MCE2 Bridge: Flushing ${this.pendingMessages.length} pending messages.`);
            
            while (this.pendingMessages.length > 0) {
                const text = this.pendingMessages.shift();
                window.webmcp._sendMessage({
                    type: 'userMessage',
                    text: text,
                    token: this.connectionToken
                });
            }
            this.messages.push({ role: 'assistant', text: 'Queued messages flushed to Architect.' });
        },
        onWebMcpMessage(event) {
            const msg = event.detail;
            console.log("MCE2 Shell: Received WebMCP message", msg);

            if (msg.type === 'render' && msg.component) {
                this.renderToCanvas(msg.component, msg.targetId || 'mce-canvas');
                this.messages.push({ role: 'assistant', text: 'Blueprint received and rendered to canvas.' });
            }
        },
        renderToCanvas(componentJson, targetId) {
            console.info("MCE2 Rendering Blueprint to:", targetId, componentJson);
            const target = document.getElementById(targetId);
            if (!target) return;
            target.innerHTML = '';
            const mountPoint = document.createElement('div');
            target.appendChild(mountPoint);

            try {
                const { createApp } = window.Vue;
                const componentApp = createApp({
                    template: `<div class="q-pa-xl text-center text-white">
                        <q-card dark bordered class="bg-blue-grey-9 q-pa-lg shadow-10">
                            <div class="text-h6 underline text-blue-grey-2">DYNAMIC ARCHITECTURAL PREVIEW</div>
                            <pre class="text-left q-mt-md bg-blue-grey-10 q-pa-md rounded-borders" style="font-size: 11px; overflow: auto">${JSON.stringify(componentJson, null, 2)}</pre>
                        </q-card>
                    </div>`
                });
                componentApp.use(window.Quasar);
                componentApp.mount(mountPoint);
            } catch (err) { console.error("Canvas Render Failure:", err); }
        },
        async checkHeartbeat() {
            try {
                // Heartbeat only checks service availability, not connection status
                const resp = await fetch('http://localhost:3000/webmcp.js', { mode: 'no-cors', cache: 'no-store' });
                // If socket is not connected, use heartbeat for basic status; if connected, keep green
                if (!this.isSocketConnected && !this.isConnecting) {
                    this.webMcpStatus = 'green-13';
                }
            } catch (e) { 
                if (!this.isSocketConnected) this.webMcpStatus = 'red-9'; 
            }
            try {
                const resp = await fetch('/rest/s1/mce2/Registry');
                this.dataStatus = resp.ok ? 'green-13' : 'red-9';
            } catch (e) { this.dataStatus = 'red-9'; }
        },
        tryAutoConnect() {
            if (window.webmcp && this.connectionToken) {
                console.info("MCE2 Bridge: Auto-connecting WebMCP with token...");
                window.webmcp.connect(this.connectionToken);
            }
        }
    },
    mounted() {
        console.log("MCE2 Shell Mounted. Infrastructure bridge active.");
        this.loadApps();
        this.checkHeartbeat();
        this.checkInterval = setInterval(() => this.checkHeartbeat(), 15000);

        // Listen for WebMCP events
        window.addEventListener('webmcp-message', this.onWebMcpMessage);
        window.addEventListener('webmcp-status', this.onWebMcpStatus);

        // Give webmcp.js a moment to initialize then auto-connect
        setTimeout(() => this.tryAutoConnect(), 1000);
    },
    beforeUnmount() {
        if (this.checkInterval) clearInterval(this.checkInterval);
        window.removeEventListener('webmcp-message', this.onWebMcpMessage);
        window.removeEventListener('webmcp-status', this.onWebMcpStatus);
    }
};
