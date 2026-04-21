/**
 * BlueprintClient.js - A standalone library for rendering Aitree Blueprints using Quasar 2.
 */
const BlueprintClient = {
    install(app) {
        app.component('BlueprintRenderer', {
            props: ['blueprint'],
            setup(props) {
                const dataStore = Vue.inject('clientStore', Vue.ref({}));
                const isReady = Vue.computed(() => dataStore.blueprintReady || true);

                const parentSelectedComp = Vue.inject('selectedComponent', null);
                const parentSelectComp = Vue.inject('selectComponent', null);

                const selectedComponent = parentSelectedComp || Vue.ref(null);
                const selectComponent = parentSelectComp || ((comp) => {
                    selectedComponent.value = comp;
                    console.log("Component selected:", comp);
                });

                if (!parentSelectedComp) Vue.provide('selectedComponent', selectedComponent);
                if (!parentSelectComp) Vue.provide('selectComponent', selectComponent);

                const sourceJson = Vue.ref(JSON.stringify(props.blueprint, null, 2));
                const renderMode = Vue.ref('visual');
                const isService = Vue.computed(() => ideMode.value === 'service');
                const toggleOptions = Vue.computed(() => [
                    { icon: 'account_tree', value: 'visual', label: isService.value ? 'Flow' : 'Layout' },
                    { icon: 'code', value: 'source', label: 'Source' }
                ]);

                const saveSource = () => {
                    try {
                        const parsed = JSON.parse(sourceJson.value);
                        const event = new CustomEvent('blueprint-source-save', { detail: parsed });
                        window.dispatchEvent(event);
                    } catch (e) {
                        console.error("Manual JSON Parse Error", e);
                        alert("Invalid JSON format. Please correct it before saving.");
                    }
                };

                const ideMode = Vue.inject('ideMode', Vue.ref('screen'));
                const userInput = Vue.inject('userInput', null);

                const palettePosition = Vue.ref({ top: 120, left: window.innerWidth - 650 });
                const handlePan = (details) => {
                    palettePosition.value.top += details.delta.y;
                    palettePosition.value.left += details.delta.x;
                };

                const uiRegistry = Vue.ref({ categories: [] });
                const serviceRegistry = Vue.ref({ categories: [] });

                const fetchRegistries = async () => {
                    try {
                        const uiResp = await fetch('/rest/s1/moquiai/getRegistry?type=ui-macro');
                        if (uiResp.ok) {
                            const uiData = await uiResp.json();
                            uiRegistry.value = uiData.registry || { categories: [] };
                        }

                        const serviceResp = await fetch('/rest/s1/moquiai/getRegistry?type=service-macro');
                        if (serviceResp.ok) {
                            const serviceData = await serviceResp.json();
                            serviceRegistry.value = serviceData.registry || { categories: [] };
                        }
                    } catch (e) {
                        console.error("Failed to fetch registries", e);
                    }
                };

                Vue.onMounted(fetchRegistries);

                const copyToChat = (item) => {
                    if (userInput && userInput.value !== undefined) {
                        userInput.value = item.command;
                        setTimeout(() => {
                            const inputEl = document.getElementById('ai-chat-input');
                            if (inputEl) inputEl.focus();
                        }, 100);
                    }
                };

                const currentPalette = Vue.computed(() => {
                    const registry = ideMode.value === 'service' ? serviceRegistry.value : uiRegistry.value;
                    return (registry && registry.categories) ? registry.categories : [];
                });

                const modeLabel = Vue.computed(() => (ideMode.value || 'screen').toUpperCase() + ' MODE');

                return { dataStore, isReady, selectedComponent, isService, renderMode, sourceJson, saveSource, toggleOptions, currentPalette, copyToChat, palettePosition, handlePan, modeLabel, ideMode };
            },
            template: `
                <div class="blueprint-container q-pa-md full-height relative-position" v-if="blueprint">
                    <!-- FLOATING TOOLS PALETTE (DRAGGABLE & DYNAMIC) -->
                    <div v-touch-pan.prevent.mouse="handlePan" 
                         :style="{ position: 'fixed', top: palettePosition.top + 'px', left: palettePosition.left + 'px', zIndex: 10000, width: '240px', cursor: 'grab' }">
                        <q-card class="palette-card shadow-24 overflow-hidden" style="background: white; border: 2px solid #3f51b5; border-radius: 8px;">
                            <div class="bg-indigo-10 text-white q-pa-sm text-weight-bold row items-center" style="font-size: 0.8rem;">
                                <q-icon name="drag_indicator" class="q-mr-sm" size="18px" />
                                <div class="col">TOOL PALETTE</div>
                                <q-icon name="construction" color="amber" size="xs" />
                            </div>
                            
                            <q-list dense bordered separator class="bg-white scroll" style="max-height: 400px;">
                                <q-expansion-item v-for="cat in currentPalette" :key="cat.name"
                                                 dense expand-separator :icon="cat.name === 'Layout' ? 'grid_view' : 'category'"
                                                 :label="cat.name" 
                                                 header-class="text-indigo-10 text-weight-bold bg-indigo-1"
                                                 style="font-size: 0.75rem;">
                                    <q-list dense>
                                        <q-item v-for="item in cat.items" :key="item.label" clickable v-ripple @click="copyToChat(item)" class="q-pl-lg">
                                            <q-item-section avatar side><q-icon :name="item.icon" color="indigo-7" size="16px" /></q-item-section>
                                            <q-item-section class="text-caption text-weight-medium" style="color: #1a237e;">{{ item.label }}</q-item-section>
                                            <q-item-section side><q-icon name="add_circle" color="green-7" size="12px" /></q-item-section>
                                            <q-tooltip anchor="center left" self="center right">{{ item.description }}</q-tooltip>
                                        </q-item>
                                    </q-list>
                                </q-expansion-item>
                            </q-list>

                            <div class="q-pa-xs text-center text-caption bg-indigo-1 text-indigo-10 text-uppercase text-weight-bold" style="font-size: 10px; border-top: 1px solid #ddd;">
                                {{ modeLabel }}
                            </div>
                        </q-card>
                    </div>

                    <!-- Mode Header & Toggle -->
                    <div class="row items-center q-mb-md">
                        <q-icon :name="isService ? 'settings' : 'web'" color="indigo" size="md" class="q-mr-sm"></q-icon>
                        <div class="col">
                            <div class="text-h5 text-weight-bold text-indigo-10">{{ blueprint.meta?.title || 'Untitled Blueprint' }}</div>
                            <div class="text-overline text-indigo-4" style="line-height: 1.2;">{{ isService ? 'Service Logic Pipeline' : 'User Interface Layout' }}</div>
                        </div>
                        <q-btn-toggle
                            v-model="renderMode"
                            flat dense
                            toggle-color="indigo"
                            color="grey-4"
                            :options="toggleOptions"
                        />
                    </div>

                    <q-separator class="q-my-md"></q-separator>
                    
                    <div v-if="renderMode === 'visual'" class="col scroll">
                         <div class="q-mt-sm" v-if="ideMode === 'screen' && blueprint.structure && isReady">
                            <component-factory :components="blueprint.structure" />
                        </div>
                        <div class="q-mt-md" v-if="ideMode === 'service' && isReady">
                            <logic-renderer :actions="blueprint.actions || []" />
                        </div>
                    </div>

                    <!-- SOURCE EDITOR -->
                    <div v-else class="col column bg-grey-10 rounded-borders overflow-hidden" style="border: 1px solid #333;">
                        <div class="row items-center q-pa-sm bg-grey-9 text-grey-4">
                            <q-icon name="edit_note" class="q-mr-xs"></q-icon>
                            <div class="text-caption text-weight-bold">MANUAL SOURCE OVERRIDE</div>
                            <q-space />
                            <q-btn flat dense size="sm" color="amber" icon="save" label="Push Artifact" @click="saveSource"></q-btn>
                        </div>
                        <q-input
                            v-model="sourceJson"
                            type="textarea"
                            filled dark square
                            class="col"
                            input-style="font-family: 'Fira Code', 'Courier New', monospace; font-size: 13px; line-height: 1.5; height: 100%;"
                            spellcheck="false"
                        />
                    </div>
                </div>
            `
        });

        app.component('ComponentFactory', {
            props: ['components'],
            render() {
                if (!this.components || !Array.isArray(this.components)) return null;
                const BlueprintComponent = Vue.resolveComponent('BlueprintComponent');
                return Vue.h('div', { class: 'column q-gutter-md' },
                    this.components.map((comp, i) => Vue.h(BlueprintComponent, { component: comp, key: comp.id || comp.component || i }))
                );
            }
        });

        app.component('BlueprintComponent', {
            props: ['component'],
            setup() {
                const dataStore = Vue.inject('blueprintDataStore', Vue.ref({}));
                const selectComponent = Vue.inject('selectComponent', () => { });
                const selectedComponent = Vue.inject('selectedComponent', Vue.ref(null));
                return { dataStore, selectComponent, selectedComponent };
            },
            render() {
                const comp = this.component;
                if (!comp) return null;

                const isSelected = this.selectedComponent && this.selectedComponent.id === comp.id;

                let type = comp.component ? comp.component.toLowerCase() : 'div';
                const props = comp.properties || {};
                const children = comp.children || [];

                // Check global macros first
                let macroDef = BlueprintClient.macros[type];
                let resolvedComponent = type;
                let resolvedProps = { ...props };
                let resolvedChildren = [...children];
                let isQuasar = false;

                if (macroDef) {
                    resolvedComponent = macroDef.component || 'div';
                    resolvedProps = { ...macroDef.properties, ...resolvedProps };
                    if (macroDef.children) {
                        // Deep copy macro children and potentially merge original children?
                        // For now, let's keep it simple and just use macro children.
                        resolvedChildren = [...(macroDef.children || []), ...resolvedChildren];
                    }
                    type = resolvedComponent.toLowerCase();
                }

                // Apply Auto-Binding from DataStore if ID matches a field
                let boundValue = this.dataStore[comp.id]; // Access it so Vue tracks it
                if (comp.id && boundValue !== undefined) {
                    resolvedProps.value = boundValue;
                }

                if (type.startsWith('q-')) {
                    isQuasar = true;

                    // Validation Rule Injection
                    if (resolvedProps.required === true && !resolvedProps.rules) {
                        const labelText = resolvedProps.label || "Field";
                        resolvedProps.rules = [(val) => {
                            console.info("PROMPT VALIDATION for " + labelText, val);
                            return (!!val && val.toString().trim().length > 0) || (labelText + " is required");
                        }];
                        resolvedProps['lazy-rules'] = false;
                        console.info("Attaching Rules to " + comp.id, resolvedProps.rules);
                    }

                    // Automatically normalize 'value' to 'modelValue' for Quasar
                    const currentVal = (this.dataStore[comp.id] !== undefined) ? this.dataStore[comp.id] : (resolvedProps.modelValue || (resolvedProps.value || ""));
                    resolvedProps.modelValue = currentVal;
                    resolvedProps['onUpdate:modelValue'] = (val) => {
                        this.dataStore[comp.id] = val;
                    };
                    delete resolvedProps.value;
                }

                // Simple Factory Mapping Fallback
                let quasarCompName = resolvedComponent;
                let quasarProps = { ...resolvedProps };

                if (!isQuasar) {
                    switch (type) {
                        case 'displayfield':
                        case 'text-field':
                            quasarCompName = 'q-input';
                            quasarProps = {
                                outlined: true,
                                label: resolvedProps.label || resolvedProps.name,
                                modelValue: resolvedProps.value || '',
                                readonly: type === 'displayfield',
                                ...resolvedProps
                            };
                            isQuasar = true;
                            break;
                        case 'container':
                            quasarCompName = 'div';
                            quasarProps = { class: 'q-pa-sm bg-grey-2 rounded-borders', ...resolvedProps };
                            break;
                        case 'header':
                            quasarCompName = 'div';
                            quasarProps = { class: 'text-h6 q-mb-sm', ...resolvedProps };
                            return Vue.h(quasarCompName, quasarProps, resolvedProps.text || 'Header');
                        default:
                            quasarCompName = 'div';
                            quasarProps = { ...resolvedProps, class: 'q-pa-sm border-dashed text-caption text-grey', style: 'border: 1px dashed #ccc' };
                    }
                }

                const QuasarComp = (quasarCompName.startsWith('q-')) ? Vue.resolveComponent(quasarCompName) : quasarCompName;
                const ComponentFactory = Vue.resolveComponent('ComponentFactory');

                // Pass children definitively via Vue 3 slot objects
                let childNodes = undefined;
                if (resolvedChildren.length > 0) {
                    childNodes = { default: () => Vue.h(ComponentFactory, { components: resolvedChildren }) };
                } else if (resolvedProps.text && !isQuasar) {
                    childNodes = { default: () => resolvedProps.text };
                }

                // Add selection highlighting and click handler
                const finalQuasarProps = {
                    ...quasarProps,
                    onClick: (e) => {
                        e.stopPropagation();
                        this.selectComponent(comp);
                    },
                    style: (quasarProps.style || '') + (isSelected ? '; border: 2px solid #1976D2 !important; box-shadow: 0 0 10px rgba(25,118,210,0.5)' : '')
                };

                return childNodes ? Vue.h(QuasarComp, finalQuasarProps, childNodes) : Vue.h(QuasarComp, finalQuasarProps);
            }
        });

        app.component('LogicRenderer', {
            props: ['actions'],
            template: `
                <div class="column items-center q-gutter-y-lg q-py-xl" style="position: relative;">
                    <!-- Vertical Connector Line -->
                    <div style="position: absolute; top: 0; bottom: 0; left: 50%; width: 4px; background: rgba(63, 81, 181, 0.1); transform: translateX(-50%); z-index: 0;"></div>
                    
                    <template v-for="(action, i) in actions" :key="action.id || i">
                        <logic-action :action="action" :index="i" />
                    </template>
                    
                    <div class="q-pa-lg bg-indigo-1 rounded-borders border-dashed text-center" style="width: 300px; border: 2px dashed rgba(63, 81, 181, 0.3); color: #3f51b5; cursor: pointer; z-index: 1;">
                         <q-icon name="add_circle" size="md" class="q-mb-xs"></q-icon>
                         <div class="text-weight-bold">Append Action</div>
                    </div>
                </div>
            `
        });

        app.component('LogicAction', {
            props: ['action', 'index'],
            setup(props) {
                const selectComponent = Vue.inject('selectComponent', () => { });
                const selectedComponent = Vue.inject('selectedComponent', Vue.ref(null));
                const isSelected = Vue.computed(() => selectedComponent.value && selectedComponent.value.id === props.action.id);
                return { selectComponent, isSelected };
            },
            template: `
                <q-card class="logic-action-card shadow-10 cursor-pointer" 
                        :class="isSelected ? 'bg-indigo-10 text-white' : 'bg-white text-indigo-10'"
                        style="width: 450px; z-index: 10; border-radius: 12px; transition: all 0.3s ease;"
                        @click="selectComponent(action)">
                    <q-card-section class="q-pa-md">
                        <div class="row no-wrap items-center">
                            <div class="bg-indigo-1 text-indigo-10 q-pa-sm rounded-borders q-mr-md shadow-inner text-weight-bold" style="min-width: 35px; text-align: center;">
                                {{ index + 1 }}
                            </div>
                            <div class="col">
                                <div class="text-overline opacity-60" style="line-height: 1;">LOGIC STEP</div>
                                <div class="text-h6 text-weight-bold truncate" style="line-height: 1.2;">{{ action.type || 'Action' }}</div>
                            </div>
                            <q-icon name="bolt" :color="isSelected ? 'amber' : 'indigo-4'" size="md" />
                        </div>
                    </q-card-section>
                    
                    <q-separator :dark="isSelected"></q-separator>
                    
                    <q-card-section v-if="action.id" class="q-py-sm q-px-md opacity-80 italic text-caption">
                         id: {{ action.id }}
                    </q-card-section>
                </q-card>
            `
        });
    },

    macros: {},

    async loadMacros() {
        try {
            const response = await fetch('/rest/s1/moquiai/getUiMacros');
            const data = await response.json();
            this.macros = data.macros || {};
            console.log("Aitree UI Macros Loaded:", this.macros);
        } catch (e) {
            console.error("Failed to load macros", e);
        }
    },

    async fetchBlueprint(componentName, screenPath) {
        // Fetch from the getBlueprint REST GET endpoint
        debugger;
        const response = await fetch(`/rest/s1/moquiai/getBlueprint?componentName=${componentName}&screenPath=${screenPath}`);
        const data = await response.json();
        return data.blueprint;
    },

    setupSSE(componentName, screenPath, onUpdate, onCommand) {
        // Setup SSE listener for hot-reload
        const url = `/rest/s1/moquiai/registerClient?componentName=${componentName}&screenPath=${screenPath}`;
        const eventSource = new EventSource(url);

        eventSource.addEventListener('update', (event) => {
            console.log("Blueprint Update Received:", event.data);
            const data = JSON.parse(event.data);
            debugger;
            if (data.screen === screenPath) {
                this.fetchBlueprint(componentName, screenPath).then(onUpdate);
            }
        });

        eventSource.addEventListener('connected', (event) => {
            console.log("SSE Connected:", JSON.parse(event.data));
        });

        eventSource.addEventListener('command', (event) => {
            console.log("Blueprint Command Received:", event.data);
            if (onCommand) {
                onCommand(JSON.parse(event.data));
            }
        });

        eventSource.onerror = (err) => {
            console.error("SSE Error:", err);
            // eventSource.close();
        };

        return eventSource;
    },

    /**
     * Process an incoming AI or System command against a reactive blueprint object.
     * Avoids full-page reloads for incremental property or structure changes.
     */
    processCommand(blueprint, cmd) {
        if (!blueprint || !cmd) return;

        const findCompById = (structure, id) => {
            if (!structure) return null;
            for (let comp of structure) {
                if (comp.id === id) return comp;
                if (comp.children) {
                    const found = findCompById(comp.children, id);
                    if (found) return found;
                }
            }
            return null;
        };

        switch (cmd.action) {
            case 'updateProperty':
                const target = findCompById(blueprint.structure, cmd.payload.id);
                if (target) {
                    target.properties = { ...(target.properties || {}), ...(cmd.payload.properties || {}) };
                    console.log(`[Flash-Safe] Property updated for ${cmd.payload.id}`);
                }
                break;
            case 'addComponent':
                if (!blueprint.structure) blueprint.structure = [];
                blueprint.structure.push(cmd.payload);
                console.log(`[Flash-Safe] Component added: ${cmd.payload.id}`);
                break;
            case 'addMultipleComponents':
                if (!blueprint.structure) blueprint.structure = [];
                if (cmd.payload && Array.isArray(cmd.payload.components)) {
                    cmd.payload.components.forEach(c => blueprint.structure.push(c));
                    console.log(`[Flash-Safe] Bulk injection complete: \${cmd.payload.components.length} components`);
                }
                break;
            case 'updateField':
                console.log("[Flash-Safe] Field updated", cmd.payload);
                break;
            case 'clear':
                blueprint.structure = [];
                console.log("[Flash-Safe] Blueprint cleared");
                break;
            default:
                console.warn("[Flash-Safe] Unknown command action:", cmd.action);
        }
    }
};

window.BlueprintClient = BlueprintClient;
