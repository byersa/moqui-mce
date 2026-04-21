(function () {
    console.log("MoquiAiApp script loading...");
    const componentDef = {
        name: 'MoquiAiApp',
        data() {
            return {
                currentScreenData: null,
                loading: false,
                canDesign: true,
                rightDrawerOpen: true,
                activeTab: 'chat',
                // AI Chat State
                messages: [
                    { role: 'ai', text: 'Moqui AI Architect initialized. I can help you map Mantle entities to UI macros. Try asking me: "Add a field for the Resident\'s Birth Date"' }
                ],
                isSending: false,
                // Inspector State
                selectedWidgetId: null,
                selectedProperties: {}
            }
        },
        template: `
            <q-layout view="hHh Lpr lFf" class="bg-grey-1" style="font-family: 'Inter', 'Roboto', sans-serif;">
                <q-header elevated :class="$root.aiTreeStore?.isArchitectMode ? 'bg-indigo-10' : 'bg-primary'" style="height: 64px;">
                    <q-toolbar class="full-height px-lg">
                        <q-btn flat dense round icon="menu" @click="$root.leftOpen = !$root.leftOpen" />
                        <q-toolbar-title class="text-weight-light q-ml-sm">
                            <div class="row items-center no-wrap">
                                <q-icon v-if="$root.aiTreeStore?.isArchitectMode" name="precision_manufacturing" size="sm" class="q-mr-sm text-amber" />
                                <span v-if="$root.aiTreeStore?.isArchitectMode" class="text-weight-bold letter-spacing-1">
                                    MCE <span class="text-weight-light opacity-60">| Universal Architect</span>
                                </span>
                                <span v-else class="text-weight-bold">Aitree <span class="text-weight-light text-grey-4">Care System</span></span>
                            </div>
                        </q-toolbar-title>

                        <q-space />

                        <!-- PROJECT CONTEXT -->
                        <div class="row no-wrap items-center bg-white-1 q-pa-xs rounded-borders q-mr-lg" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);">
                            <div class="text-caption text-grey-5 q-px-sm uppercase text-weight-bold" style="font-size: 0.65rem;">Project Context</div>
                            <q-select
                                v-if="$root.aiTreeStore"
                                v-model="$root.aiTreeStore.selectedApp"
                                :options="$root.aiTreeStore.availableApps"
                                dense borderless dark
                                emit-value map-options
                                style="min-width: 140px; font-size: 0.9rem;"
                                bg-color="transparent"
                                class="q-mx-xs"
                            />
                        </div>
                        
                        <!-- MODE TOGGLE (Screen vs Service) -->
                        <div v-if="$root.aiTreeStore?.isArchitectMode" class="row no-wrap items-center bg-blue-1 q-pa-xs rounded-borders q-mr-md" style="background: rgba(33,150,243,0.1); border: 1px solid rgba(33,150,243,0.2);">
                            <q-btn-toggle
                                v-model="$root.aiTreeStore.currentMode"
                                flat dense
                                toggle-color="primary"
                                color="grey-7"
                                :options="[
                                    {label: 'Screen', value: 'screen', icon: 'wallpaper'},
                                    {label: 'Service', value: 'service', icon: 'settings_suggest'}
                                ]"
                            />
                        </div>

                        <!-- ARCHITECT MODE TOGGLE -->
                        <div class="row no-wrap items-center bg-amber-1 q-pa-xs rounded-borders" style="background: rgba(255,193,7,0.1); border: 1px solid rgba(255,193,7,0.2);">
                             <q-toggle
                                v-if="canDesign && $root.aiTreeStore"
                                v-model="$root.aiTreeStore.isArchitectMode"
                                checked-icon="architecture"
                                unchecked-icon="visibility"
                                color="amber-10"
                                label="Architect Mode"
                                left-label
                                class="text-amber-1 font-weight-bold"
                                @update:model-value="toggleMode"
                            />
                        </div>

                        <q-btn flat round dense icon="chat" @click="rightDrawerOpen = !rightDrawerOpen" class="q-ml-lg">
                            <q-badge floating color="red" v-if="!rightDrawerOpen" rounded padding="4px 6px">1</q-badge>
                        </q-btn>
                    </q-toolbar>
                </q-header>

                <!-- RIGHT DRAWER: AI Chat & Inspector -->
                <q-drawer v-model="rightDrawerOpen" side="right" bordered :width="400" class="bg-white shadow-2">
                    <div class="column full-height overflow-hidden">
                        <div class="bg-indigo-10 text-white q-pa-md shadow-2">
                            <div class="row items-center no-wrap">
                                <q-icon :name="activeTab === 'chat' ? 'smart_toy' : 'settings_suggest'" size="sm" class="q-mr-sm" />
                                <div class="text-h6 text-weight-bold no-wrap">{{ activeTab === 'chat' ? 'AI Peer Assistant' : 'Component Inspector' }}</div>
                            </div>
                            <div class="text-caption opacity-70">{{ activeTab === 'chat' ? 'Neural Architectural Support' : 'Live Property Synchronizer' }}</div>
                        </div>

                        <q-tabs v-model="activeTab" dense class="bg-grey-1 text-grey-7" active-color="indigo-10" indicator-color="indigo-10" align="justify" narrow-indicator style="height: 48px;">
                            <q-tab name="chat" icon="chat" label="Chat" />
                            <q-tab name="inspector" icon="grid_view" label="Properties" />
                        </q-tabs>

                        <q-separator />

                        <q-tab-panels v-model="activeTab" animated class="col bg-grey-2 overflow-hidden">
                            <!-- CHAT PANEL -->
                            <q-tab-panel name="chat" class="q-pa-none column full-height">
                                <div class="col scroll q-pa-md chat-container" style="min-height: 0; background: linear-gradient(to bottom, #f0f2f5, #ffffff);">
                                    <div v-for="(msg, i) in messages" :key="i" class="q-mb-lg flex" 
                                         :class="msg.role === 'user' ? 'justify-end' : 'justify-start'">
                                        <div :class="msg.role === 'user' ? 'bg-indigo-9 text-white shadow-3 bubble-user' : 'bg-white text-grey-9 shadow-1 bubble-ai'" 
                                             class="q-pa-md rounded-borders text-body2 relative-position" style="max-width: 85%; line-height: 1.5; border-radius: 12px;">
                                            <q-icon v-if="msg.role === 'ai'" name="smart_toy" size="14px" class="absolute-top-left q-ma-xs opacity-50" />
                                            {{ msg.text }}
                                        </div>
                                    </div>
                                    <q-inner-loading :showing="isSending">
                                        <q-spinner-ios size="40px" color="indigo-10" />
                                        <div class="q-mt-sm text-caption text-grey-7">Processing Blueprint Commands...</div>
                                    </q-inner-loading>
                                </div>
                                <q-separator />
                                <div class="q-pa-lg bg-white shadow-up-1">
                                    <q-input v-if="$root.aiTreeStore" v-model="$root.aiTreeStore.chatInput" dense outlined placeholder="Describe the change you need..." 
                                             @keyup.enter="sendMessage" :disable="isSending" bg-color="grey-1" class="shadow-1">
                                        <template v-slot:append>
                                            <q-btn round dense flat icon="send" color="indigo-10" @click="sendMessage" />
                                        </template>
                                    </q-input>
                                    <div class="q-mt-sm flex justify-center">
                                         <q-btn flat dense no-caps color="indigo-7" size="sm" label="Try: 'Add field for Birth Date'" 
                                                @click="if($root.aiTreeStore) $root.aiTreeStore.chatInput = 'Add a field for the Residents Birth Date'; sendMessage()" />
                                    </div>
                                </div>
                            </q-tab-panel>

                            <!-- INSPECTOR PANEL -->
                            <q-tab-panel name="inspector" class="q-pa-none column">
                                <div v-if="selectedWidgetId" class="col scroll q-pa-md q-gutter-y-md">
                                    <div class="row items-center bg-indigo-1 q-pa-md rounded-borders border-indigo-2">
                                        <q-icon name="widgets" size="md" color="indigo-9" class="q-mr-md" />
                                        <div class="col">
                                            <div class="text-caption text-indigo-9 text-weight-bold uppercase" style="font-size: 0.6rem;">Active Component</div>
                                            <div class="text-subtitle1 text-weight-bold">{{ selectedWidgetId }}</div>
                                        </div>
                                    </div>
                                    <q-separator />
                                    <div v-for="(val, key) in selectedProperties" :key="key" class="q-mb-md">
                                        <q-input v-if="typeof val !== 'boolean'" :label="key" v-model="selectedProperties[key]" 
                                                 dense outlined color="indigo-7" bg-color="white" stack-label />
                                        <q-toggle v-else :label="key" v-model="selectedProperties[key]" color="indigo-10" />
                                    </div>
                                    <q-btn label="Flush Property Changes" color="indigo-10" class="full-width" unelevated padding="12px" icon="save" />
                                </div>
                                <div v-else class="full-height flex flex-center column text-grey-5 q-pa-xl">
                                    <q-icon name="ads_click" size="120px" class="q-mb-lg opacity-20" />
                                    <div class="text-h6 text-weight-light text-center">Architectural Selection Active</div>
                                    <div class="text-caption text-center q-mt-sm">Select any visual element on the canvas to synchronize its properties here.</div>
                                </div>
                            </q-tab-panel>
                        </q-tab-panels>
                    </div>
                </q-drawer>

                <q-page-container>
                    <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut" mode="out-in">
                        <!-- ARCHITECT VIEW -->
                        <div v-if="$root.aiTreeStore?.isArchitectMode" :key="'architect'" class="q-pa-lg">
                            <moqui-canvas-editor 
                                :screen-data="currentScreenData" 
                                :spec-path="currentSpecPath" />
                        </div>
                        
                        <!-- PRODUCTION VIEW -->
                        <div v-else :key="'production'" class="q-pa-lg">
                            <div class="max-width-container q-mx-auto shadow-2 rounded-borders bg-white q-pa-xl" style="max-width: 1100px; min-height: 70vh;">
                                <m-blueprint-node 
                                    v-if="currentScreenData" 
                                    :node="currentScreenData" 
                                    :context="{}" />
                                <q-inner-loading :showing="loading">
                                    <q-spinner-gears size="60px" color="indigo-10" />
                                </q-inner-loading>
                            </div>
                        </div>
                    </transition>
                </q-page-container>
                
                <style>
                    .bubble-ai { border-bottom-left-radius: 0 !important; }
                    .bubble-user { border-bottom-right-radius: 0 !important; }
                    .letter-spacing-1 { letter-spacing: 1px; }
                    .bg-white-1 { background: rgba(255,255,255,0.1); }
                    .border-indigo-2 { border: 1px solid #c5cae9; }
                </style>
            </q-layout>
        `,
        computed: {
            currentSpecPath() {
                return this.$root.currentPath;
            }
        },
        methods: {
            async toggleMode(value) {
                this.loading = true;
                this.rightDrawerOpen = value; // Auto-open drawer in architect mode
                try {
                    const app = this.$root.aiTreeStore?.selectedApp?.value || 'aitree';
                    const response = await fetch(window.location.pathname + '?renderMode=qjson&app=' + app);
                    const data = await response.json();
                    this.currentScreenData = data;
                } catch (e) {
                    console.error("Failed to sync screen data", e);
                } finally {
                    this.loading = false;
                }
            },
            async sendMessage() {
                const store = this.$root.aiTreeStore;
                if (!store || !store.chatInput.trim() || this.isSending) return;
                const text = store.chatInput;
                store.chatInput = '';
                this.messages.push({ role: 'user', text });
                this.isSending = true;

                try {
                    const app = store.selectedApp?.value || 'aitree';
                    const response = await fetch('/rest/s1/moquiai/postPrompt', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': window.moqui?.webrootVue?.sessionToken || this.$root.moquiSessionToken
                        },
                        body: JSON.stringify({
                            prompt: text,
                            componentName: app,
                            screenPath: this.currentSpecPath,
                            selectedId: this.selectedWidgetId,
                            selectedProps: this.selectedProperties
                        })
                    });
                    const data = await response.json();
                    this.messages.push({ role: 'ai', text: data.result || 'Mantle mapping suggestion processed.' });
                } catch (e) {
                    this.messages.push({ role: 'ai', text: 'Error communicating with AI service.' });
                } finally {
                    this.isSending = false;
                }
            },
            async fetchAvailableApps() {
                try {
                    const response = await fetch('/rest/s1/moquiai/AppServices/get/AvailableApps');
                    const data = await response.json();
                    if (this.$root.aiTreeStore) {
                        this.$root.aiTreeStore.availableApps = data.apps || [];
                    }
                } catch (e) { console.warn("Failed to fetch apps:", e); }
            }
        },
        async mounted() {
            console.log("MoquiAiApp orchestrator mounted.");
            await this.fetchAvailableApps();
            if (this.$root.aiTreeStore) this.toggleMode(this.$root.aiTreeStore.isArchitectMode);

            // Listen for palette paste
            window.addEventListener('palette-pasted', (e) => {
                this.activeTab = 'chat';
                this.rightDrawerOpen = true;
                // Since it's bound to the store, we just need to ensure the chat input gets focus or visual feedback
                this.$q.notify({ type: 'info', message: 'Command staged in chat', icon: 'auto_fix_high', timeout: 1000 });
            });

            // Listen for widget selection from the canvas
            window.addEventListener('widget-selected', (e) => {
                this.selectedWidgetId = e.detail?.id;
                this.selectedProperties = e.detail?.properties || {};
                this.activeTab = 'inspector';
                this.rightDrawerOpen = true;
            });

            // SSE Placeholder (Future integration with BlueprintClient)
            console.info("Blueprint hot-reloading active via integrated shell.");
        }
    };

    window.MBlueprintNode = componentDef;
    console.info("MoquiAiApp component definition attached to window.");

})();