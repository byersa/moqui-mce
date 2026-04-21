(function (moqui) {
    const componentDef = {
        name: 'MoquiCanvasEditor',
        props: {
            screenData: { type: [Object, String], default: () => ({ name: 'Empty', children: [] }) },
            specPath: { type: String, default: '' }
        },
        computed: {
            resolvedData() {
                if (typeof this.screenData === 'string') {
                    try { return JSON.parse(this.screenData); } 
                    catch (e) { console.error("Error parsing screenData string", e); return { name: 'Error', children: [] }; }
                }
                return this.screenData || { name: 'Empty', children: [] };
            }
        },
        template: `
            <div class="moqui-canvas-wrapper q-pa-md relative-position" style="height: calc(100vh - 100px); border: 2px solid #2196f3; border-radius: 12px; background: white; overflow: hidden; display: flex; flex-direction: column;">
                <!-- DEBUG FLAG -->
                <div style="position: absolute; bottom: 0; left: 0; background: red; color: white; font-size: 10px; z-index: 10000; padding: 2px;">MCE_V4</div>

                <q-banner dense class="bg-primary text-white q-mb-md shadow-2" style="flex: 0 0 auto;">
                    <template v-slot:avatar><q-icon name="auto_graph" /></template>
                    Moqui {{ currentMode === 'service' ? 'Service Logic' : 'Screen Visualizer' }}
                    <template v-slot:action>
                        <q-btn-toggle
                            v-model="currentMode"
                            flat dense dark
                            toggle-color="amber"
                            :options="[
                                {label: 'Screen', value: 'screen', icon: 'wallpaper'},
                                {label: 'Service', value: 'service', icon: 'settings_suggest'}
                            ]"
                            class="q-mr-sm"
                        />
                        <q-btn flat color="white" label="Refresh" icon="refresh" @click="redraw" />
                    </template>
                </q-banner>

                <div class="center-pane-content relative-position flex-grow" style="flex: 1 1 auto; display: flex; flex-direction: column; position: relative;">
                    <!-- FLOATING PALETTE (FIXED POSITIONING FOR ABSOLUTE VISIBILITY) -->
                    <div style="position: fixed; top: 120px; right: 420px; z-index: 10000; width: 220px;">
                        <q-card class="palette-card shadow-24" style="background: white; border: 3px solid #ff0000; border-radius: 8px;">
                            <div class="bg-red-8 text-white q-pa-sm text-weight-bold row items-center">
                                <q-icon name="handyman" class="q-mr-sm" />
                                BLUEPRINT TOOLS
                            </div>
                            <q-list dense padding>
                                <q-item v-for="item in paletteItems" :key="item.label" clickable v-ripple @click="copyToChat(item)">
                                    <q-item-section avatar side><q-icon :name="item.icon" color="primary" /></q-item-section>
                                    <q-item-section class="text-weight-bold">{{ item.label }}</q-item-section>
                                    <q-item-section side><q-icon name="add" color="green" /></q-item-section>
                                </q-item>
                            </q-list>
                            <div class="q-pa-xs text-center text-caption bg-grey-3">
                                {{ modeLabel }}
                            </div>
                        </q-card>
                    </div>

                    <!-- CENTER PANE: CANVAS (SCREEN MODE) -->
                    <div v-if="currentMode === 'screen'" id="konva-holder" class="full-height" style="border: 1px solid #e0e0e0; border-radius: 8px; background: #ffffff; flex: 1 1 auto; overflow: hidden; position: relative;"></div>
                    
                    <!-- CENTER PANE: LOGIC STRIPS (SERVICE MODE) -->
                    <div v-else class="logic-strips-container scroll q-gutter-y-sm full-height" style="flex: 1 1 auto; border: 1px solid #e0e0e0; border-radius: 8px; background: #f1f3f4; padding: 24px;">
                        <div v-if="!logicActions.length" class="flex flex-center full-height column text-grey-5">
                            <q-icon name="auto_fix_normal" size="80px" class="opacity-10 q-mb-md" />
                            <div class="text-h6 text-weight-light">No Logic Blocks Detected</div>
                            <div class="text-caption">Select elements from the palette or use chat to generate Mantle logic.</div>
                            <q-btn outline color="primary" label="Add Entity Find" icon="search" class="q-mt-md" @click="copyToChat(palette.service[2])" />
                        </div>
                        <q-card v-for="(action, idx) in logicActions" :key="idx" class="logic-strip shadow-2 border-left-logic" style="border-left: 6px solid #3f51b5; border-radius: 4px;">
                            <q-item clickable>
                                <q-item-section avatar>
                                    <q-avatar color="indigo-1" text-color="indigo-9" size="md" icon="terminal" />
                                </q-item-section>
                                <q-item-section>
                                    <q-item-label class="text-weight-bold text-indigo-10" style="font-family: monospace;">&lt;{{ action.name || 'action' }}&gt;</q-item-label>
                                    <q-item-label caption v-if="action.attributes" class="row q-gutter-xs q-mt-xs">
                                        <q-badge v-for="(val, key) in action.attributes" :key="key" color="blue-grey-1" text-color="blue-grey-9" class="q-pa-xs">
                                            <span class="text-weight-bold q-mr-xs">{{ key }}:</span> {{ val }}
                                        </q-badge>
                                    </q-item-label>
                                </q-item-section>
                                <q-item-section side>
                                    <div class="row q-gutter-sm">
                                        <q-btn flat round dense icon="tune" size="sm" color="indigo-4" />
                                        <q-btn flat round dense icon="delete_outline" size="sm" color="red-4" />
                                    </div>
                                </q-item-section>
                            </q-item>
                        </q-card>
                    </div>
                </div>
                
                <div class="q-mt-md text-caption text-grey-7 flex items-center" style="flex: 0 0 auto;">
                    <q-icon name="info" class="q-mr-xs" />
                    Source: {{ specPath }} <span class="q-mx-sm">|</span> Elements: {{ ((resolvedData || {}).children || []).length }}
                </div>
            </div>
        `,
        data() {
            return {
                stage: null,
                layer: null,
                palette: {
                    screen: [
                        { label: 'entity-find', icon: 'search', command: 'Help me add an entity-find action for MedicalCondition' },
                        { label: 'form-single', icon: 'content_paste', command: 'Help me add a form-single for' },
                        { label: 'container', icon: 'crop_square', command: 'Help me add a container for' },
                        { label: 'link', icon: 'link', command: 'Help me add a link to' }
                    ],
                    service: [
                        { label: 'entity-one', icon: 'filter_1', command: 'Help me add an entity-one action for' },
                        { label: 'entity-update', icon: 'edit', command: 'Help me add an entity-update for' },
                        { label: 'entity-find', icon: 'search', command: 'Help me add an entity-find action for' },
                        { label: 'script', icon: 'description', command: 'Help me add a groovy script to' }
                    ]
                }
            }
        },
        computed: {
            resolvedData() {
                if (typeof this.screenData === 'string') {
                    try { return JSON.parse(this.screenData); } 
                    catch (e) { console.error("Error parsing screenData string", e); return { name: 'Error', children: [] }; }
                }
                return this.screenData || { name: 'Empty', children: [] };
            },
            currentMode: {
                get() { return this.$root.aiTreeStore?.currentMode || 'screen'; },
                set(v) { if (this.$root.aiTreeStore) this.$root.aiTreeStore.currentMode = v; }
            },
            modeLabel() {
                return (this.currentMode || 'screen').toUpperCase() + ' MODE';
            },
            paletteItems() {
                return this.palette[this.currentMode] || [];
            },
            logicActions() {
                const data = this.resolvedData;
                // If the root is screen-structure, look for actions child or use children if mode is service
                if (data.name === 'screen-structure' && data.children) {
                    const actionsNode = data.children.find(c => c.name === 'actions');
                    if (actionsNode) return actionsNode.children || [];
                    return data.children; // Fallback
                }
                return data.children || [];
            }
        },
        watch: {
            resolvedData: {
                deep: true,
                handler() { this.redraw(); }
            },
            currentMode(val) {
                if (val === 'screen') {
                    setTimeout(() => { this.initKonva(); this.redraw(); }, 100);
                }
            }
        },
        mounted() {
            console.info("MoquiCanvasEditor mounting... Vue version:", (typeof Vue !== 'undefined' ? Vue.version : 'NOT FOUND'));
            setTimeout(() => {
                this.initKonva();
                this.redraw();
            }, 500);
        },
        methods: {
            initKonva() {
                const holder = document.getElementById('konva-holder');
                if (!holder) return;

                this.stage = new Konva.Stage({
                    container: 'konva-holder',
                    width: holder.offsetWidth,
                    height: holder.offsetHeight,
                    draggable: true
                });

                // 1. Add Background Grid
                const bgLayer = new Konva.Layer();
                const gridStep = 50;
                for (let i = 0; i < holder.offsetWidth / gridStep; i++) {
                    bgLayer.add(new Konva.Line({ points: [i * gridStep, 0, i * gridStep, holder.offsetHeight], stroke: '#f5f5f5', strokeWidth: 1 }));
                }
                for (let j = 0; j < holder.offsetHeight / gridStep; j++) {
                    bgLayer.add(new Konva.Line({ points: [0, j * gridStep, holder.offsetWidth, j * gridStep], stroke: '#f5f5f5', strokeWidth: 1 }));
                }
                this.stage.add(bgLayer);

                // 2. Add zoom support
                this.stage.on('wheel', (e) => {
                    e.evt.preventDefault();
                    const oldScale = this.stage.scaleX();
                    const pointer = this.stage.getPointerPosition();
                    const mousePointTo = {
                        x: (pointer.x - this.stage.x()) / oldScale,
                        y: (pointer.y - this.stage.y()) / oldScale,
                    };
                    const newScale = e.evt.deltaY > 0 ? oldScale * 0.9 : oldScale * 1.1;
                    this.stage.scale({ x: newScale, y: newScale });
                    this.stage.position({
                        x: pointer.x - mousePointTo.x * newScale,
                        y: pointer.y - mousePointTo.y * newScale,
                    });
                });

                this.layer = new Konva.Layer();
                this.stage.add(this.layer);
            },
            redraw() {
                if (!this.layer) return;
                this.layer.destroyChildren();
                
                let data = this.resolvedData;
                
                // Transparency: Handle 'screen-structure' wrapper by just using its children
                if (data && data.name === 'screen-structure' && data.children) {
                    data = data; // use directly but iterate children
                } else {
                    data = { children: [data] }; // wrap single root
                }
                
                console.info("MoquiCanvasEditor redrawing...");
                
                let currentY = 50;
                const canvasWidth = this.stage.width();
                
                const children = data.children || [];
                children.forEach(node => {
                    currentY = this.drawNode(node, 50, currentY, canvasWidth - 100);
                    currentY += 20; 
                });
                
                this.layer.draw();
            },
            drawNode(node, x, y, width) {
                if (!node || !node.name) return y;
                const padding = 15;
                const headerHeight = 30;
                let contentHeight = 20; // Minimum content padding
                
                // Determine style based on node name
                let color = '#e3f2fd';
                let stroke = '#2196f3';
                let label = node.name;
                
                if (node.name.includes('form-')) { color = '#f1f8e9'; stroke = '#4caf50'; }
                else if (node.name.includes('container')) { color = '#fff3e0'; stroke = '#ff9800'; }
                else if (node.name === 'actions' || node.name === 'pre-actions' || node.name === 'script') { color = '#f3e5f5'; stroke = '#9c27b0'; }
                else if (node.name === 'link' || node.name === 'render-mode') { color = '#ede7f6'; stroke = '#673ab7'; }
                else if (node.name.includes('row') || node.name.includes('col')) { color = '#e0f2f1'; stroke = '#00897b'; }
                else if (node.name === 'screen-split') { color = '#fff8e1'; stroke = '#ffb300'; label = "ORCHESTRATOR: " + (node.attributes.name || 'Splitter'); }
                else if (node.name === 'Missing Blueprint') { color = '#ffebee'; stroke = '#f44336'; label = "ALERT: MOQUI BLUEPRINT MISSING"; }
                
                // Add attributes to label
                if (node.name === 'screen-split') {
                    if (node.attributes.component) label += "\n[Loads: " + node.attributes.component + "]";
                    if (node.attributes.list) label += "\n[List: " + node.attributes.list + "]";
                } else if (node.name === 'Missing Blueprint') {
                    if (node.attributes.text) label += "\n" + node.attributes.text;
                } else if (node.attributes && node.attributes.name) {
                    label += ': ' + node.attributes.name;
                } else if (node.attributes && node.attributes.text) {
                    label += ': ' + node.attributes.text;
                }

                // Override x,y if location attribute exists in [x: 123, y: 456] format
                let localX = x;
                let localY = y;
                if (node.attributes && node.attributes.location) {
                    const locStr = node.attributes.location;
                    const xMatch = locStr.match(/x:\s*(-?\d+)/);
                    const yMatch = locStr.match(/y:\s*(-?\d+)/);
                    if (xMatch && yMatch) {
                        localX = parseInt(xMatch[1]);
                        localY = parseInt(yMatch[1]);
                        // console.info(`Positioning ${node.name} from spec location: [${localX}, ${localY}]`);
                    }
                }

                const group = new Konva.Group({ x: localX, y: localY, draggable: true });
                
                // Draw children first to calculate height
                const lines = label.split('\n').length;
                const dynamicHeaderHeight = headerHeight + (lines > 1 ? (lines - 1) * 15 : 0);
                
                let childY = dynamicHeaderHeight + padding;
                const childWidth = width - (padding * 2);
                
                if (node.children) {
                    node.children.forEach(child => {
                        childY = this.drawNode(child, padding, childY, childWidth);
                        childY += 10;
                    });
                    contentHeight = childY;
                } else {
                    contentHeight = dynamicHeaderHeight + 40;
                }

                // Node background
                const rect = new Konva.Rect({
                    x: 0, y: 0, width: width, height: contentHeight,
                    fill: color, stroke: stroke, strokeWidth: 1, cornerRadius: 4,
                    shadowBlur: 2, shadowOpacity: 0.1
                });
                
                // Node header
                const text = new Konva.Text({
                    x: 10, y: 8, text: label, fontSize: 13, fontStyle: 'bold', fontFamily: 'monospace', fill: '#333',
                    lineHeight: 1.2
                });

                group.add(rect);
                group.add(text);
                
                group.on('dragend', (e) => {
                    const newX = Math.round(group.x());
                    const newY = Math.round(group.y());
                    const widgetId = node.attributes?.id || node.id || node.attributes?.name || node.name;
                    
                    if (this.specPath) {
                        const baseUrl = window.location.pathname.replace(/\/+$/, '');
                        $.ajax({
                            url: baseUrl + "/syncCanvas",
                            type: 'POST',
                            data: {
                                specPath: this.specPath,
                                widgetId: widgetId,
                                newX: newX,
                                newY: newY,
                                moquiSessionToken: window.moqui?.moquiSessionToken
                            },
                            success: (resp) => {
                                console.log("SyncCanvas response:", resp);
                                if (resp.status === "success") {
                                    window.dispatchEvent(new CustomEvent('canvas-synced', { detail: { widgetId, newX, newY } }));
                                } else {
                                    console.error("Canvas sync failed:", resp.message || resp.errors || "Unknown Error");
                                }
                            }
                        });
                    }
                });

                this.layer.add(group);
                
                return y + contentHeight;
            },
            copyToChat(item) {
                if (this.$root.aiTreeStore) {
                    this.$root.aiTreeStore.chatInput = item.command;
                    // Emit for parent components that might not be using the store for the input binding
                    window.dispatchEvent(new CustomEvent('palette-pasted', { detail: { command: item.command } }));
                }
            }
        }
    };

    // Register with Moqui SPA (with retry logic)
    function registerComponent() {
        if (typeof moqui !== 'undefined' && moqui.webrootVue && moqui.webrootVue.component) {
            moqui.webrootVue.component('moqui-canvas-editor', componentDef);
            console.info("MoquiCanvasEditor officially registered with moqui.webrootVue.");
        } else {
            console.warn("moqui.webrootVue not ready, retrying registration in 300ms...");
            setTimeout(registerComponent, 300);
        }
    }
    registerComponent();
    window.MoquiCanvasEditor = componentDef;

})(window.moqui);