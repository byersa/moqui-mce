(function () {
    /**
     * MceApp.qvt.js
     * The unified MCE2 shell orchestrator.
     * Transitions from moqui-ai to MCE2 Pluggable Layer Architecture.
     */
    const componentDef = {
        name: 'MceApp',
        props: {
            connectionToken: String,
            isDesignMode: String
        },
        data() {
            return {
                leftDrawerOpen: true,
                rightDrawerOpen: true,
                activeTab: 'chat',
                messages: [
                    { role: 'ai', text: 'MCE2 Unified Architect initialized. How can I help you design your application today?' }
                ],
                userInput: '',
                isSending: false,
                currentBlueprint: null,
                isSyncing: false
            }
        },
        template: `
            <q-layout view="hHh Lpr fFf" class="bg-blue-grey-1 shadow-4" style="height: 100vh;">
                <!-- Header -->
                <q-header elevated class="bg-blue-grey-10 text-white" style="height: 64px;">
                    <q-toolbar class="full-height px-lg shadow-10">
                        <q-btn flat dense round icon="menu" @click="leftDrawerOpen = !leftDrawerOpen" />
                        <q-toolbar-title class="text-weight-light q-ml-sm">
                            <div class="row items-center no-wrap">
                                <q-icon name="architecture" size="sm" class="q-mr-sm text-amber-5" v-if="isDesignMode === 'Y'" />
                                <span class="text-weight-bold letter-spacing-1">
                                    MCE2 <span class="text-weight-light opacity-60">| {{ isDesignMode === 'Y' ? 'Architect Mode' : 'Production View' }}</span>
                                </span>
                            </div>
                        </q-toolbar-title>

                        <q-chip v-if="isDesignMode === 'Y'" icon="design_services" color="amber-10" text-color="black" label="Admin Privileges" size="sm" />
                        <q-space />

                        <q-btn flat round dense icon="history" class="q-mr-sm" />
                        <q-btn flat round dense icon="chat" @click="rightDrawerOpen = !rightDrawerOpen">
                            <q-badge floating color="red" v-if="!rightDrawerOpen" rounded />
                        </q-btn>
                    </q-toolbar>
                </q-header>

                <!-- LEFT DRAWER: Navigator -->
                <q-drawer v-model="leftDrawerOpen" side="left" bordered :width="300" class="bg-blue-grey-10 text-white shadow-10">
                    <div class="column full-height">
                        <div class="bg-blue-grey-11 text-blue-grey-2 q-pa-md row items-center justify-between">
                            <div class="text-subtitle2 text-weight-bold row items-center uppercase">
                                <q-icon name="explore" class="q-mr-sm" color="amber-7"></q-icon>
                                Navigator
                            </div>
                        </div>
                        <q-scroll-area class="col q-pa-md">
                            <div class="text-overline text-grey-6 q-mb-sm">Layers & Artifacts</div>
                            <q-list dense padding>
                                <q-item clickable class="rounded-borders q-mb-xs opacity-60">
                                    <q-item-section avatar class="min-width-auto q-pr-sm">
                                        <q-icon name="layers" size="16px" color="grey-5" />
                                    </q-item-section>
                                    <q-item-section class="text-caption">Default UDM Layer</q-item-section>
                                </q-item>
                            </q-list>
                        </q-scroll-area>
                        <q-separator dark />
                        <div class="q-pa-md text-center text-grey-8 text-overline">MCE2 CORE</div>
                    </div>
                </q-drawer>

                <!-- RIGHT DRAWER: Architect Control Plane -->
                <q-drawer v-model="rightDrawerOpen" side="right" bordered :width="400" class="bg-white shadow-2">
                    <div class="column full-height overflow-hidden">
                        <div class="bg-blue-grey-10 text-white q-pa-md shadow-2">
                            <div class="row items-center no-wrap">
                                <q-icon name="auto_awesome" size="sm" class="q-mr-sm text-amber-9" />
                                <div class="text-h6 text-weight-bold no-wrap">AI Architect</div>
                            </div>
                            <div class="text-caption opacity-70">Neural Handshake Active: [{{ connectionToken.substring(0,8) }}...]</div>
                        </div>

                        <q-tabs v-model="activeTab" dense class="bg-grey-1 text-grey-7" active-color="blue-grey-10" indicator-color="amber-9" align="justify" narrow-indicator style="height: 48px;">
                            <q-tab name="chat" icon="chat" label="Chat" />
                            <q-tab name="inspector" icon="settings_input_component" label="Inspector" v-if="isDesignMode === 'Y'" />
                        </q-tabs>

                        <q-separator />

                        <q-tab-panels v-model="activeTab" animated class="col bg-grey-2 overflow-hidden">
                            <!-- CHAT PANEL -->
                            <q-tab-panel name="chat" class="q-pa-none column full-height">
                                <q-scroll-area class="col q-pa-md chat-container" style="background: linear-gradient(to bottom, #f0f2f5, #ffffff);">
                                    <div v-for="(msg, i) in messages" :key="i" class="q-mb-md flex" :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
                                        <div :class="msg.role === 'user' ? 'bg-blue-grey-9 text-white shadow-3' : 'bg-white text-grey-9 shadow-1'" 
                                             class="q-pa-md rounded-borders text-body2 relative-position" style="max-width: 85%; border-radius: 12px;">
                                            <q-icon v-if="msg.role === 'ai'" name="auto_awesome" size="14px" class="absolute-top-left q-ma-xs opacity-50" />
                                            {{ msg.text }}
                                        </div>
                                    </div>
                                    <q-inner-loading :showing="isSending">
                                        <q-spinner-dots size="40px" color="blue-grey-10" />
                                    </q-inner-loading>
                                </q-scroll-area>
                                <q-separator />
                                <div class="q-pa-md bg-white">
                                    <q-input v-model="userInput" dense standout placeholder="Request architectural change..." @keyup.enter="sendMessage" :disable="isSending">
                                        <template v-slot:append>
                                            <q-btn round dense flat icon="send" color="blue-grey-10" @click="sendMessage" />
                                        </template>
                                    </q-input>
                                </div>
                            </q-tab-panel>

                            <!-- INSPECTOR PANEL -->
                            <q-tab-panel name="inspector" class="q-pa-none column">
                                <div class="full-height flex flex-center column text-grey-5 q-pa-xl">
                                    <q-icon name="ads_click" size="120px" class="q-mb-lg opacity-20" />
                                    <div class="text-h6 text-weight-light text-center">Architectural Selection Active</div>
                                    <div class="text-caption text-center q-mt-sm">Select an element to sync its properties here.</div>
                                </div>
                            </q-tab-panel>
                        </q-tab-panels>
                    </div>
                </q-drawer>

                <!-- MAIN CANVAS -->
                <q-page-container>
                    <q-page class="q-pa-lg">
                        <div class="row justify-between items-center q-mb-md">
                            <div class="text-h5 text-blue-grey-10 text-weight-light">Live Layer Canvas</div>
                            <q-btn v-if="isDesignMode === 'Y'" label="Save Blueprint" color="blue-grey-10" icon="save" unelevated dense class="q-px-md" />
                        </div>
                        
                        <div class="bg-white shadow-2 q-pa-xl rounded-borders text-center relative-position" style="min-height: 70vh; border: 1px dashed #ccc;">
                            <div class="absolute-center">
                                <q-icon name="layers_clear" size="100px" color="grey-3" />
                                <div class="text-h6 text-grey-4">No Active Layer Content</div>
                                <div class="text-caption text-grey-5">Use the Navigator to select a Mapped Artifact.</div>
                            </div>
                        </div>
                    </q-page>
                </q-page-container>
            </q-layout>
        `,
        methods: {
            async sendMessage() {
                if (!this.userInput.trim() || this.isSending) return;
                const text = this.userInput;
                this.userInput = '';
                this.messages.push({ role: 'user', text });
                this.isSending = true;

                try {
                    // Handshake with McpRest
                    console.log("Sending prompt via MCP handshake...");
                    // Placeholder for actual fetch logic moved from moqui-ai
                    setTimeout(() => {
                        this.messages.push({ role: 'ai', text: 'MCE2 Layer mapping updated based on your request.' });
                        this.isSending = false;
                    }, 1000);
                } catch (e) {
                    this.messages.push({ role: 'ai', text: 'MCP Communication Error.' });
                    this.isSending = false;
                }
            }
        },
        mounted() {
            console.info("MCE2 Shell Orchestrator Mounted. Token:", this.connectionToken);
        }
    };

    window.MceApp = componentDef;
})();
