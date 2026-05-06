/**
 * MCE Shell Component - Production Ready
 * Features: Three-State Contextual Sidecar, Editor Discovery, and WebMCP Bridge.
 */
window.MceShell = {
    name: 'MceShell',
    props: {
        connectionToken: String,
        isDesignMode: String
    },
    data() {
        return {
            leftDrawerOpen: false,
            rightDrawerOpen: true,
            rightDrawerMini: false,
            sidecarState: 'expanded', // 'hidden', 'mini', 'expanded'
            webMcpStatus: 'grey-7',
            dataStatus: 'grey-7',
            editors: [],
            activeEditor: null,
            messages: [
                { role: 'assistant', text: 'MCE Production Shell active. Discovery bridge initialized.' }
            ],
            userInput: '',
            isSocketConnected: false,
            mcpInitialized: false
        }
    },
    watch: {
        sidecarState(newVal) {
            if (newVal === 'hidden') {
                this.rightDrawerOpen = false;
            } else if (newVal === 'mini') {
                this.rightDrawerOpen = true;
                this.rightDrawerMini = true;
            } else if (newVal === 'expanded') {
                this.rightDrawerOpen = true;
                this.rightDrawerMini = false;
            }
        }
    },
    template: `
        <q-layout view="hHh lpR fFf" class="bg-grey-1 shadow-2">
            <!-- Header: Transplanted from aitree design -->
            <q-header elevated class="bg-primary text-white">
                <q-toolbar style="height: 70px;">
                    <q-btn flat round dense icon="menu" size="lg" @click="leftDrawerOpen = !leftDrawerOpen" class="q-mr-md" />
                    <q-toolbar-title class="text-h5">
                        <span class="text-weight-bold">Staff Meeting</span> 
                        <span class="text-weight-thin q-ml-sm">Production Shell</span>
                    </q-toolbar-title>
                    
                    <q-space />

                    <!-- Sidecar State Toggle -->
                    <q-btn-toggle
                        v-model="sidecarState"
                        flat
                        dense
                        toggle-color="secondary"
                        size="lg"
                        class="q-mr-md"
                        :options="[
                            { icon: 'visibility_off', value: 'hidden' },
                            { icon: 'vertical_split', value: 'mini' },
                            { icon: 'view_sidebar', value: 'expanded' }
                        ]"
                    />

                    <!-- Connectivity Indicators -->
                    <div class="row no-wrap items-center q-gutter-x-md">
                        <q-btn flat round dense size="lg" :color="isSocketConnected ? 'green-13' : 'red-9'" icon="cloud">
                            <q-tooltip>WebMCP Status</q-tooltip>
                        </q-btn>
                        <q-btn flat round dense size="lg" icon="chat" @click="toggleSidecar" />
                    </div>
                </q-toolbar>
            </q-header>

            <!-- Navigation Drawer (Left) -->
            <q-drawer v-model="leftDrawerOpen" side="left" bordered class="bg-white" :width="350">
                <q-scroll-area class="fit">
                    <q-list padding>
                        <q-item-label header class="text-h6 q-pa-lg">SYSTEM MENU</q-item-label>
                        <q-item clickable v-ripple class="q-pa-md" @click="activeEditor = null; renderToCanvas(null)">
                            <q-item-section avatar><q-icon name="home" size="md" /></q-item-section>
                            <q-item-section class="text-h5">Dashboard Home</q-item-section>
                        </q-item>
                        <q-separator q-my-lg />
                        <q-item clickable v-ripple class="q-pa-md">
                            <q-item-section avatar><q-icon name="settings" size="md" /></q-item-section>
                            <q-item-section class="text-h5">Preferences</q-item-section>
                        </q-item>
                    </q-list>
                </q-scroll-area>
            </q-drawer>

            <!-- Contextual Sidecar (Right Drawer) - HIGH VISIBILITY MODE -->
            <q-drawer v-model="rightDrawerOpen" side="right" :mini="rightDrawerMini" bordered class="bg-blue-grey-10 text-white" :width="550">
                <div v-if="!rightDrawerMini" class="column no-wrap fit">
                    <q-toolbar class="bg-blue-grey-9 text-white" style="height: 70px;">
                        <q-toolbar-title class="text-h5 text-uppercase letter-spacing-2">Discovery</q-toolbar-title>
                        <q-btn flat round dense size="lg" icon="chevron_right" @click="sidecarState = 'mini'" />
                    </q-toolbar>

                    <!-- Editor Discovery Section - JUMBO -->
                    <div class="q-pa-lg bg-blue-grey-9">
                        <div class="text-h5 text-blue-grey-4 q-mb-md font-weight-bold">Registered Editors</div>
                        <q-list dark padding class="bg-blue-grey-10 rounded-borders shadow-2">
                            <q-item v-for="editor in editors" :key="editor.value" 
                                    clickable v-ripple 
                                    class="q-py-md"
                                    :active="activeEditor === editor.value"
                                    active-class="bg-secondary text-white shadow-5"
                                    @click="loadEditor(editor)">
                                <q-item-section avatar>
                                    <q-icon :name="activeEditor === editor.value ? 'check_circle' : 'dashboard_customize'" size="md" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label class="text-h5">{{ editor.label }}</q-item-label>
                                    <q-item-label class="text-subtitle1 text-blue-grey-4 q-mt-xs">{{ editor.type }}</q-item-label>
                                </q-item-section>
                            </q-item>
                            <q-item v-if="editors.length === 0" class="text-h5 text-blue-grey-6 italic q-pa-lg">
                                <q-item-section avatar><q-spinner-dots color="blue-grey-6" size="md" /></q-item-section>
                                <q-item-section>Searching registry...</q-item-section>
                            </q-item>
                        </q-list>
                    </div>

                    <q-separator dark />

                    <!-- Messages Area - HIGH READABILITY -->
                    <q-scroll-area class="col q-pa-lg mce-chat-history">
                        <div v-for="(msg, idx) in messages" :key="idx" 
                             :class="['q-mb-xl rounded-borders q-pa-lg shadow-2', msg.role === 'user' ? 'bg-blue-grey-9 text-right' : 'bg-blue-grey-8']">
                            <div class="text-h6 text-blue-grey-4 uppercase q-mb-sm">{{ msg.role }}</div>
                            <div class="text-h5 white-pre-wrap line-height-1-5">{{ msg.text }}</div>
                        </div>
                    </q-scroll-area>

                    <!-- Input Area - JUMBO INPUT -->
                    <div id="mce-chat-input-area" class="q-pa-lg bg-blue-grey-9">
                        <q-input dark filled v-model="userInput" 
                                 placeholder="Ask AI Architect..." 
                                 @keyup.enter="sendMessage"
                                 input-class="text-h5"
                                 label-class="text-h5"
                                 style="font-size: 1.5rem">
                            <template v-slot:append>
                                <q-btn round dense flat icon="send" size="lg" @click="sendMessage" />
                            </template>
                        </q-input>
                    </div>
                </div>
                <div v-else class="column items-center q-py-lg q-gutter-y-lg">
                    <q-btn flat round icon="chevron_left" size="lg" @click="sidecarState = 'expanded'" />
                    <q-btn flat round icon="chat" size="lg" :color="isSocketConnected ? 'green-13' : 'grey-7'" @click="sidecarState = 'expanded'">
                         <q-badge v-if="editors.length > 0" color="secondary" floating rounded transparent />
                    </q-btn>
                </div>
            </q-drawer>

            <!-- Main Content Area -->
            <q-page-container>
                <q-page class="q-pa-none">
                    <div id="mce-canvas" class="full-width relative-position" style="height: calc(100vh - 70px);">
                         <div v-if="!activeEditor" class="absolute-center text-center text-grey-4">
                            <q-icon name="auto_awesome" size="180px" style="opacity: 0.1" />
                            <div class="text-h2 text-weight-thin">MCE2 CANVAS</div>
                            <div class="text-h4 text-weight-light q-mt-xl">Select a context to begin.</div>
                         </div>
                    </div>
                </q-page>
            </q-page-container>
        </q-layout>
    `,
    methods: {
        toggleSidecar() {
            this.sidecarState = (this.sidecarState === 'hidden') ? 'expanded' : 'hidden';
        },
        async loadEditors() {
            try {
                const resp = await fetch('/rest/s1/mce/AvailableEditors');
                const data = await resp.json();
                this.editors = data.editors || [];
                console.info("MCE Discovery: Registered editors synchronized.");
            } catch (e) { console.error("Discovery Failure", e); }
        },
        async loadEditor(editor) {
            console.log("Activating Editor Context:", editor.value);
            this.activeEditor = editor.value;
            if (editor.value === 'PRODUCTION_PREVIEW') {
                this.renderToCanvas('ProductionPreview');
            } else {
                this.renderToCanvas(null, `CONTEXT ACTIVE: ${editor.label}`);
            }
            this.messages.push({ role: 'assistant', text: `Context switched to: ${editor.label}` });
        },
        sendMessage() {
            const text = this.userInput.trim();
            if (!text) return;
            this.messages.push({ role: 'user', text: text });
            this.userInput = '';
            if (window.webmcp && window.webmcp.isConnected) {
                window.webmcp._sendMessage({ type: 'userMessage', text: text, token: this.connectionToken });
            }
        },
        renderToCanvas(componentName, placeholderText) {
            const target = document.getElementById('mce-canvas');
            if (!target) return;
            target.innerHTML = '';
            const mountPoint = document.createElement('div');
            target.appendChild(mountPoint);

            if (!componentName) {
                mountPoint.innerHTML = `<div class="flex flex-center text-white" style="height: 100vh">
                    <div class="text-h2 text-weight-thin opacity-50">${placeholderText || 'EMPTY CANVAS'}</div>
                </div>`;
                return;
            }

            try {
                const app = window.Vue.createApp(window[componentName]);
                app.use(window.Quasar);
                app.mount(mountPoint);
            } catch (e) { console.error("Mount Failure", e); }
        },
        tryAutoConnect() {
            if (window.webmcp && this.connectionToken) {
                console.info("MCE2 Shell: Initiating Auto-Connect with token...");
                // Use the standard connect method from the library
                window.webmcp.connect(this.connectionToken);
            } else {
                console.warn("MCE2 Shell: Cannot connect. Missing library or token.");
            }
        },
    },
    mounted() {
        this.loadEditors();
        const interval = setInterval(() => {
            if (window.webmcp && !this.mcpInitialized) {
                this.mcpInitialized = true;
                clearInterval(interval);
                window.addEventListener('webmcp-status', (e) => {
                    this.isSocketConnected = (e.detail === 'connected' || e.detail.state === 'connected');
                });
                if (window.webmcp.isConnected) this.isSocketConnected = true;

                // This MUST run after window.webmcp is initialized
                window.webmcp.registerTool(
                    'comm_send_huddle_alert',
                    'Sends an emergency or staff huddle alert',
                    {
                        type: "object",
                        properties: {
                            note: { type: "string" },
                            location: { type: "string" },
                            huddleType: { type: "string" }
                        }
                    },
                    (args) => {
                        console.warn("ACTUAL HUDDLE TRIGGERED:", args);

                        // Use the global Quasar instance to trigger a notification
                        if (window.Quasar && window.Quasar.Notify) {
                            window.Quasar.Notify.create({
                                type: 'warning',
                                message: `EMERGENCY: ${args.note}`,
                                caption: `Location: ${args.location}`,
                                position: 'top',
                                timeout: 5000,
                                actions: [{ label: 'Dismiss', color: 'white' }]
                            });
                        }

                        return { success: true, message: "Huddle alert displayed to staff." };
                    }
                );

                // Trigger the connection now that everything is ready
                this.tryAutoConnect();
            }
        }, 500);

    }
};
