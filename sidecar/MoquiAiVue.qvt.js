window.moqui = Object.assign(window.moqui || {}, {
    urlExtensions: { js: 'qjs', vue: 'qvue', vuet: 'qvt', qvt: 'qvt' }
});
if (!window.moqui.webrootVue) {
    console.info("!!! MOQUI AI VUE INITIALIZING NEW APP !!!");
    console.log("QUASAR STATUS:", typeof Quasar);
    console.log("VUE STATUS:", typeof Vue);

    const app = Vue.createApp({
        // In MoquiAiVue.qvt.js
        setup() {
            const { onMounted } = Vue;
            const tryInit = () => {
                if (typeof window.moqui_shell_bridge === 'function') {
                    const bridge = window.moqui_shell_bridge();
                    console.log("MCE: Bridge Initialized Successfully via moqui_shell_bridge.");
                    return bridge;
                }
                console.warn("MCE: Waiting for moqui_shell_bridge...");
                return { data: {}, methods: {} };
            };

            const bridge = tryInit();

            onMounted(async () => {
                if (!bridge.data || !bridge.methods) return;
                const d = bridge.data;
                const m = bridge.methods;

                // 1. Setup SSE
                if (window.BlueprintClient && d.componentName && d.screenPath) {
                    window.BlueprintClient.setupSSE(
                        d.componentName.value,
                        d.screenPath.value,
                        (nb) => { if (d.blueprint) d.blueprint.value = nb; },
                        (cmd) => { if (window.BlueprintClient && d.blueprint) window.BlueprintClient.processCommand(d.blueprint.value, cmd); }
                    );
                }

                // 2. Initial Data Fetch
                if (m.fetchArtifacts) await m.fetchArtifacts();

                // 3. UI Mode Sync
                if (d.screenPath && d.ideMode) {
                    if (d.screenPath.value.startsWith('entity/')) d.ideMode.value = 'entity';
                    else if (d.screenPath.value.startsWith('service/')) d.ideMode.value = 'service';
                }

                // 4. AI-Init check
                if (d.blueprint && d.userInput && d.isSending && m.sendMessage) {
                    const b = d.blueprint.value;
                    if (!b.structure?.length && !b.actions?.length) {
                        setTimeout(() => {
                            if (!d.isSending.value) { d.userInput.value = 'INIT'; m.sendMessage(true); }
                        }, 1200);
                    }
                }
            });

            // Inside setup() in MoquiAiVue.qvt.js
            return {
                ...bridge.data, // Spreads ideMode, blueprint, etc.
                ...bridge.methods,
                // Explicitly override to ensure these REFS are used
                blueprint: bridge.data.blueprint,
                ideMode: bridge.data.ideMode,
                selectedComponent: bridge.data.selectedComponent
            };
        },
        data() {
            return {
                basePath: "", linkBasePath: "", currentPathList: [], extraPathList: [], currentParameters: {}, bodyParameters: null,
                activeSubscreens: [], navMenuList: [], navHistoryList: [], navPlugins: [], accountPlugins: [], notifyHistoryList: [],
                lastNavTime: Date.now(), loading: 0, loadingSubscreens: {}, loadingMenuUrl: null, currentLoadRequest: null, activeContainers: {}, urlListeners: [],
                moquiSessionToken: "", appHost: "", appRootPath: "", userId: "", username: "", locale: "en",
                reLoginShow: false, reLoginPassword: null, reLoginMfaData: null, reLoginOtp: null,
                notificationClient: null, sessionTokenBc: null, qzVue: null, leftOpen: false, moqui: moqui,
                isArchitectMode: false,
                targetPath: null,
                promptNewArtifact: null,
                promptNewProject: null,
                aiTreeStore: (window.moqui && window.moqui.useAiTreeStore) ? window.moqui.useAiTreeStore() : null
            }
        },
        watch: {
            'aiTreeStore.isArchitectMode': {
                handler: function (val) {
                    console.log('!!! isArchitectMode (VIA STORE) changed to:', val);
                    // Force a re-render of all subscreens when layout mode changes
                    this.reloadSubscreens();
                },
                deep: true
            }
        },
        methods: {
            // Manually proxy the bridge methods to the instance for legacy/external access
            //...((window.moqui && window.moqui._stableBridge) ? window.moqui._stableBridge.methods : {}),
            // CLEANER BRIDGE PROXY: 
            // Instead of spreading a static object, we define proxies that 
            // look up the method on window.moqui.rootSetup() at execution time.
            sendMessage(...args) {
                const m = window.moqui?.rootSetup?.()?.methods?.sendMessage;
                return m ? m(...args) : console.warn("MCE: sendMessage called before bridge ready");
            },
            saveProperty(...args) {
                const m = window.moqui?.rootSetup?.()?.methods?.saveProperty;
                return m ? m(...args) : null;
            },
            switchProject(...args) {
                const m = window.moqui?.rootSetup?.()?.methods?.switchProject;
                return m ? m(...args) : null;
            },

            async fetchAvailableApps() {
                try {
                    const response = await fetch('/rest/s1/moquiai/AvailableApps', {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            // ADD THIS LINE:
                            'X-CSRF-Token': this.moquiSessionToken || $("#confMoquiSessionToken").val()
                        }
                    });
                    const data = await response.json();
                    if (this.aiTreeStore) this.aiTreeStore.availableApps = data.apps || [];
                    else if (moqui.useAiTreeStore) {
                        const store = moqui.useAiTreeStore();
                        store.availableApps = data.apps || [];
                    }
                } catch (e) { console.warn("Failed to fetch available orchestrator apps:", e); }
            },
            toggleArchitectMode: function (val, targetPath) {
                console.log('!!! toggleArchitectMode METHOD CALLED:', val, 'for path:', targetPath);
                if (this.aiTreeStore) {
                    this.aiTreeStore.isArchitectMode = val;
                    if (targetPath) this.aiTreeStore.targetPath = targetPath;
                }
                this.isArchitectMode = val;

                // If turning ON, and we have a path, move to ScreenBuilder
                if (val && targetPath && targetPath !== '/ScreenBuilder') {
                    this.$router.push('/ScreenBuilder?targetPath=' + targetPath);
                } else if (!val && this.$router.currentRoute.value.path === '/ScreenBuilder') {
                    // If turning OFF and in ScreenBuilder, go back to the targetPath
                    const goBack = (this.aiTreeStore && this.aiTreeStore.targetPath) ? this.aiTreeStore.targetPath : '/Home';
                    this.$router.push(goBack);
                } else {
                    this.reloadSubscreens();
                }
            },
            setUrl: function (url, bodyParameters, onComplete, pushState = true) {
                url = this.getLinkPath(url);

                const normUrl = url.endsWith('/') && url.length > 1 ? url.slice(0, -1) : url;
                const normCur = this.currentLinkUrl.endsWith('/') && this.currentLinkUrl.length > 1 ? this.currentLinkUrl.slice(0, -1) : this.currentLinkUrl;

                // cancel current load if needed - but only if navigating to a DIFFERENT url
                if (this.currentLoadRequest && this.loadingUrl && this.getLinkPath(this.loadingUrl) !== url && normUrl !== normCur) {
                    console.log("Aborting load for " + this.loadingUrl + " because navigating to " + url);
                    this.currentLoadRequest.abort();
                    this.currentLoadRequest = null;
                    this.loading = 0;
                }
                this.loadingUrl = url;
                this.bodyParameters = bodyParameters;

                console.info('setting url ' + url + ', cur ' + this.currentLinkUrl);

                if (normUrl === normCur) {
                    this.reloadSubscreens();
                    if (onComplete) this.callOnComplete(onComplete, this.currentPath);
                } else {
                    var redirectedFrom = this.currentPath;
                    var urlInfo = moqui.parseHref(url);
                    // clear out extra path, to be set from nav menu data if needed
                    this.extraPathList = [];
                    // set currentSearch before currentPath so that it is available when path updates
                    this.currentSearch = urlInfo.search;
                    this.currentPath = urlInfo.path;

                    // Track current link URL immediately after setting path/search
                    this.committedUrl = this.currentLinkUrl;

                    // Construct the current screen URL for menu/JSON data
                    var srch = this.currentSearch;
                    var screenUrl = this.currentPath + (srch.length > 0 ? '?' + srch : '');
                    if (!screenUrl || screenUrl.length === 0) return;

                    // Track what we are currently "committing" to load
                    this.committedUrl = this.currentLinkUrl;

                    console.info("Current URL changing to " + screenUrl);
                    this.lastNavTime = Date.now();
                    // TODO: somehow only clear out activeContainers that are in subscreens actually reloaded? may cause issues if any but last screen have m-dynamic-container
                    this.activeContainers = {};

                    // update menu, which triggers update of screen/subscreen components
                    var vm = this;

                    // IF WE ARE IN A REST PATH (like the Blueprint shell), SKIP MENU LOADING
                    if (screenUrl.includes("/rest/")) {
                        console.info("MCE: Skipping menu loading for REST path:", screenUrl);
                        if (onComplete) vm.callOnComplete(onComplete, redirectedFrom);
                        return;
                    }

                    var purePath = this.appRootPath && this.appRootPath.length > 0 && screenUrl.indexOf(this.appRootPath) === 0 ?
                        screenUrl.slice(this.appRootPath.length).replace(/^\//, '') : screenUrl.replace(/^\//, '');
                    var rootPrefix = this.appRootPath && this.appRootPath !== '/' ? this.appRootPath : '';
                    var menuDataUrl = rootPrefix + "/menuDataQvt/" + purePath;

                    // Guard against redundant menu loads
                    if (this.loadingMenuUrl === menuDataUrl) return;
                    this.loadingMenuUrl = menuDataUrl;
                    if (this.currentMenuRequest) this.currentMenuRequest.abort();

                    this.currentMenuRequest = $.ajax({
                        type: "GET", url: menuDataUrl, dataType: "text", contentType: "application/json", error: function (jqXHR, textStatus, errorThrown) {
                            vm.loadingMenuUrl = null;
                            vm.currentMenuRequest = null;
                            if (textStatus === 'abort') return;
                            moqui.handleAjaxError(jqXHR, textStatus, errorThrown);
                        }, success: function (outerListText) {
                            vm.loadingMenuUrl = null;
                            vm.currentMenuRequest = null;
                            var outerList = null;
                            try { outerList = JSON.parse(outerListText); } catch (e) { console.info("Error parson menu list JSON: " + e); }
                            if (outerList && moqui.isArray(outerList)) {
                                vm.navMenuList = outerList;
                                if (onComplete) vm.callOnComplete(onComplete, redirectedFrom);
                            }
                        }
                    });

                    if (pushState) {
                        if (this.$router) {
                            var routerUrl = url;
                            if (this.appRootPath && routerUrl.indexOf(this.appRootPath) === 0) {
                                routerUrl = routerUrl.substring(this.appRootPath.length);
                                if (!routerUrl.startsWith('/')) routerUrl = '/' + routerUrl;
                            }
                            var pushResult = this.$router.push(routerUrl);
                            if (pushResult && typeof pushResult.catch === 'function') {
                                pushResult.catch(e => { console.error('Router push error', e); });
                            }
                        } else {
                            // set the window URL
                            window.history.pushState(null, this.ScreenTitle, url);
                        }
                    }                // notify url listeners
                    this.urlListeners.forEach(function (callback) { callback(url, this) }, this);
                    // scroll to top
                    document.documentElement.scrollTop = 0;
                    document.body.scrollTop = 0;
                }
            },
            callOnComplete: function (onComplete, redirectedFrom) {
                if (!onComplete) return;
                var route = this.getRoute();
                if (redirectedFrom) route.redirectedFrom = redirectedFrom;
                onComplete(route);
            },
            getRoute: function () {
                return {
                    name: this.currentPathList[this.currentPathList.length - 1], meta: {}, path: this.currentPath,
                    hash: '', query: this.currentParameters, params: this.bodyParameters || {}, fullPath: this.currentLinkUrl, matched: []
                };
            },
            setParameters: function (parmObj) {
                if (parmObj) {
                    this.$root.currentParameters = $.extend({}, this.$root.currentParameters, parmObj);
                    // no path change so just need to update parameters on most recent history item
                    var curUrl = this.currentLinkUrl;
                    var curHistoryItem = this.navHistoryList[0];
                    if (curHistoryItem) {
                        curHistoryItem.pathWithParams = curUrl;
                        window.history.pushState(null, curHistoryItem.title || '', curUrl);
                    } else {
                        window.history.pushState(null, '', curUrl);
                    }
                }
                this.$root.reloadSubscreens();
            },
            addSubscreen: function (saComp) {
                let pathIdx = saComp.activePathIndex;
                if (pathIdx === -1 || pathIdx === undefined) {
                    pathIdx = this.activeSubscreens.length;
                    saComp.activePathIndex = pathIdx;
                }

                // Replace existing component at the same index if it's different
                // CRITICAL: Ensure we don't replace a parent with its own child!
                const existingIdx = this.activeSubscreens.findIndex(s => s.activePathIndex === pathIdx);
                if (existingIdx !== -1) {
                    const existing = this.activeSubscreens[existingIdx];
                    if (existing !== saComp) {
                        // Check if existing is a parent of saComp
                        let isParent = false;
                        let p = saComp.$parent;
                        while (p) { if (p === existing) { isParent = true; break; } p = p.$parent; }

                        if (isParent) {
                            console.warn(`addSubscreen: Index collision! Child at index ${pathIdx} tried to replace parent. Adjusting child index.`);
                            saComp.activePathIndex++;
                            this.addSubscreen(saComp); // Recurse with new index
                            return;
                        }

                        console.info(`addSubscreen: Replacing stale component at index ${pathIdx}`);
                        this.activeSubscreens.splice(existingIdx, 1, saComp);
                    }
                } else {
                    this.activeSubscreens.push(saComp);
                }

                // Re-enable manual loading if path is already available
                if (this.currentPathList && this.currentPathList.length > pathIdx && this.currentPathList[pathIdx]) {
                    console.log(`addSubscreen triggering loadActive for index ${pathIdx} path: ${this.currentPathList[pathIdx]}`);
                    saComp.loadActive();
                }
            },
            removeSubscreen: function (saComp) {
                var idx = this.activeSubscreens.indexOf(saComp);
                if (idx >= 0) this.activeSubscreens.splice(idx, 1);
            },
            reloadSubscreens: function () {
                // console.info('reloadSubscreens path ' + JSON.stringify(this.currentPathList) + ' currentParameters ' + JSON.stringify(this.currentParameters) + ' currentSearch ' + this.currentSearch);
                var fullPathList = this.currentPathList;
                var activeSubscreens = this.activeSubscreens;
                console.info("reloadSubscreens currentPathList " + JSON.stringify(this.currentPathList));
                if (fullPathList.length === 0 && activeSubscreens.length > 0) {
                    activeSubscreens.splice(1);
                    activeSubscreens[0].loadActive();
                    return;
                }
                for (var i = 0; i < activeSubscreens.length; i++) {
                    if (i >= fullPathList.length) break;
                    // always try loading the active subscreen and see if actually loaded
                    var loaded = activeSubscreens[i].loadActive();
                    // clear out remaining activeSubscreens, after first changed loads its placeholders will register and load
                    if (loaded) activeSubscreens.splice(i + 1);
                }
            },
            goPreviousScreen: function () {
                var currentPath = this.currentPath;
                var navHistoryList = this.navHistoryList;
                var prevHist;
                for (var hi = 0; hi < navHistoryList.length; hi++) {
                    if (navHistoryList[hi].pathWithParams.indexOf(currentPath) < 0) { prevHist = navHistoryList[hi]; break; }
                }
                if (prevHist && prevHist.pathWithParams && prevHist.pathWithParams.length) this.setUrl(prevHist.pathWithParams)
            },
            // all container components added with this must have reload() and load(url) methods
            addContainer: function (contId, comp) { this.activeContainers[contId] = comp; },
            reloadContainer: function (contId) {
                var contComp = this.activeContainers[contId];
                if (contComp) { contComp.reload(); } else { console.error("Container with ID " + contId + " not found, not reloading"); }
            },
            loadContainer: function (contId, url) {
                var contComp = this.activeContainers[contId];
                if (contComp) { contComp.load(url); } else { console.error("Container with ID " + contId + " not found, not loading url " + url); }
            },
            hideContainer: function (contId) {
                var contComp = this.activeContainers[contId];
                if (contComp) { contComp.hide(); } else { console.error("Container with ID " + contId + " not found, not hidding"); }
            },

            addNavPlugin: function (url) { var vm = this; moqui.loadComponent(this.appRootPath + url, function (comp) { vm.navPlugins.push(comp); }) },
            addNavPluginsWait: function (urlList, urlIndex) {
                if (urlList && urlList.length > urlIndex) {
                    this.addNavPlugin(urlList[urlIndex]);
                    var vm = this;
                    if (urlList.length > (urlIndex + 1)) { setTimeout(function () { vm.addNavPluginsWait(urlList, urlIndex + 1); }, 500); }
                }
            },
            addAccountPlugin: function (url) { var vm = this; moqui.loadComponent(this.appRootPath + url, function (comp) { vm.accountPlugins.push(comp); }) },
            addAccountPluginsWait: function (urlList, urlIndex) {
                if (urlList && urlList.length > urlIndex) {
                    this.addAccountPlugin(urlList[urlIndex]);
                    var vm = this;
                    if (urlList.length > (urlIndex + 1)) { setTimeout(function () { vm.addAccountPluginsWait(urlList, urlIndex + 1); }, 500); }
                }
            },
            addUrlListener: function (urlListenerFunction) {
                if (this.urlListeners.indexOf(urlListenerFunction) >= 0) return;
                this.urlListeners.push(urlListenerFunction);
            },

            addNotify: function (message, type, link, icon) {
                var histList = this.notifyHistoryList.slice(0);
                var nowDate = new Date();
                var nh = nowDate.getHours(); if (nh < 10) nh = '0' + nh;
                var nm = nowDate.getMinutes(); if (nm < 10) nm = '0' + nm;
                // var ns = nowDate.getSeconds(); if (ns < 10) ns = '0' + ns;
                histList.unshift({ message: message, type: type, time: (nh + ':' + nm), link: link, icon: icon }); //  + ':' + ns
                while (histList.length > 25) { histList.pop(); }
                this.notifyHistoryList = histList;
            },
            switchDarkLight: function () {
                this.$q.dark.toggle();
                $.ajax({
                    type: 'POST', url: (this.appRootPath + '/apps/setPreference'), error: moqui.handleAjaxError,
                    data: { moquiSessionToken: this.moquiSessionToken, preferenceKey: 'QUASAR_DARK', preferenceValue: (this.$q.dark.isActive ? 'true' : 'false') }
                });
            },
            toggleLeftOpen: function () {
                this.leftOpen = !this.leftOpen;
                $.ajax({
                    type: 'POST', url: (this.appRootPath + '/apps/setPreference'), error: moqui.handleAjaxError,
                    data: { moquiSessionToken: this.moquiSessionToken, preferenceKey: 'QUASAR_LEFT_OPEN', preferenceValue: (this.leftOpen ? 'true' : 'false') }
                });
            },
            stopProp: function (e) { e.stopPropagation(); },
            getNavHref: function (navIndex) {
                if (!navIndex) navIndex = this.navMenuList.length - 1;
                var navMenu = this.navMenuList[navIndex];
                if (navMenu.extraPathList && navMenu.extraPathList.length) {
                    var href = navMenu.path + '/' + navMenu.extraPathList.join('/');
                    var questionIdx = navMenu.pathWithParams.indexOf("?");
                    if (questionIdx > 0) { href += navMenu.pathWithParams.slice(questionIdx); }
                    return href;
                } else {
                    return navMenu.pathWithParams || navMenu.path;
                }
            },
            getLinkPath: function (path) {
                if (moqui.isPlainObject(path)) path = moqui.makeHref(path);
                if (!path || path.length === 0) return path;

                // Strip origin if present to ensure consistent internal path comparison
                if (path.indexOf("http") === 0) {
                    try {
                        const urlObj = new URL(path);
                        path = urlObj.pathname + urlObj.search + urlObj.hash;
                    } catch (e) { console.warn("Invalid URL in getLinkPath:", path); }
                }

                // Normalize path to start with /
                if (!path.startsWith("/")) path = "/" + path;

                // In standalone mode (linkBasePath === appRootPath), the URL is already clean
                if (this.linkBasePath === this.appRootPath) return path;

                // For nested apps (e.g. /qapps2 mapped to /apps), handle prefix swapping
                if (this.appRootPath && this.appRootPath !== '/' && this.appRootPath !== this.linkBasePath) {
                    if (path.indexOf(this.appRootPath) === 0) {
                        var relPath = path.substring(this.appRootPath.length);
                        if (!relPath.startsWith("/")) relPath = "/" + relPath;
                        path = this.linkBasePath + relPath;
                    } else if (path.indexOf(this.linkBasePath) !== 0) {
                        path = this.linkBasePath + (path.startsWith('/') ? '' : '/') + path;
                    }
                }
                return path;
            },
            getQuasarColor: function (bootstrapColor) { return moqui.getQuasarColor(bootstrapColor); },
            // Re-Login Functions
            getCsrfToken: function (jqXHR) {
                // update the session token, new session after login (along with xhrFields:{withCredentials:true} for cookie)
                var sessionToken = jqXHR.getResponseHeader("X-CSRF-Token");
                if (sessionToken && sessionToken.length && sessionToken !== this.moquiSessionToken) {
                    this.moquiSessionToken = sessionToken;
                    this.sessionTokenBc.postMessage(sessionToken);
                }
            },
            receiveBcCsrfToken: function (event) {
                var sessionToken = event.data;
                if (sessionToken && sessionToken.length && this.moquiSessionToken !== sessionToken) {
                    this.moquiSessionToken = sessionToken;
                }
            },
            reLoginCheckShow: function () {
                this.reLoginShowDialog();
                /* NOTE DEJ-2022-12 removing use of the userInfo endpoint which is commented out for security reasons:
                // before showing the Re-Login dialog do a GET request without session token to see if there is a new one
                $.ajax({ type:'GET', url:(this.appRootPath + '/rest/userInfo'),
                    error:this.reLoginCheckResponseError, success:this.reLoginCheckResponseSuccess,
                    dataType:'json', headers:{Accept:'application/json'}, xhrFields:{withCredentials:true} });
    
                 */
            },
            /* NOTE DEJ-2022-12 removing use of the userInfo endpoint which is commented out for security reasons:
            reLoginCheckResponseSuccess: function(resp, status, jqXHR) {
                if (resp.username && resp.sessionToken) {
                    this.moquiSessionToken = resp.sessionToken;
                    // show success notification, add to notify history
                    var msg = 'Session refreshed after login in another tab, no changes made, please try again';
                    // show for 12 seconds because we want it to show longer than the no user authenticated notification which shows for 15 seconds (minus some password typing time)
                    this.$q.notify({ timeout:10000, type:'warning', message:msg });
                    this.addNotify(msg, 'warning');
                } else {
                    this.reLoginShowDialog();
                }
            },
            reLoginCheckResponseError: function(jqXHR, textStatus, errorThrown, responseText) {
                if (jqXHR.status === 401) {
                    this.reLoginShowDialog();
                } else {
                    var resp = responseText ? responseText : jqXHR.responseText;
                    var respObj;
                    try { respObj = JSON.parse(resp); } catch (e) { } // ignore error, don't always expect it to be JSON
                    if (respObj && moqui.isPlainObject(respObj)) {
                        moqui.notifyMessages(respObj.messageInfos, respObj.errors, respObj.validationErrors);
                    } else if (resp && moqui.isString(resp) && resp.length) {
                        moqui.notifyMessages(resp);
                    }
                }
            },
            */
            reLoginShowDialog: function () {
                // make sure there is no MFA Data (would skip the login with password step)
                this.reLoginMfaData = null;
                this.reLoginOtp = null;
                this.reLoginShow = true;
            },
            reLoginPostLogin: function () {
                // clear password/etc, hide relogin dialog
                this.reLoginShow = false;
                this.reLoginPassword = null;
                this.reLoginOtp = null;
                this.reLoginMfaData = null;
                // show success notification, add to notify history
                var msg = 'Background login successful';
                // show for 12 seconds because we want it to show longer than the no user authenticated notification which shows for 15 seconds (minus some password typing time)
                this.$q.notify({ timeout: 12000, type: 'positive', message: msg });
                this.addNotify(msg, 'positive');
            },
            reLoginSubmit: function () {
                $.ajax({
                    type: 'POST', url: (this.appRootPath + '/rest/login'), error: moqui.handleAjaxError, success: this.reLoginHandleResponse,
                    dataType: 'json', headers: { Accept: 'application/json' }, xhrFields: { withCredentials: true },
                    data: { username: this.username, password: this.reLoginPassword }
                });
            },
            reLoginHandleResponse: function (resp, status, jqXHR) {
                // console.warn("re-login response: " + JSON.stringify(resp));
                this.getCsrfToken(jqXHR);
                if (resp.secondFactorRequired) {
                    this.reLoginMfaData = resp;
                } else if (resp.loggedIn) {
                    this.reLoginPostLogin();
                }
            },
            reLoginReload: function () {
                if (confirm("Reload page? All changes will be lost."))
                    window.location.href = this.currentLinkUrl;
            },
            reLoginSendOtp: function (factorId) {
                $.ajax({
                    type: 'POST', url: (this.appRootPath + '/rest/sendOtp'), error: moqui.handleAjaxError, success: this.reLoginSendOtpResponse,
                    dataType: 'json', headers: { Accept: 'application/json' }, xhrFields: { withCredentials: true },
                    data: { moquiSessionToken: this.moquiSessionToken, factorId: factorId }
                });
            },
            reLoginSendOtpResponse: function (resp, status, jqXHR) {
                // console.warn("re-login send otp response: " + JSON.stringify(resp));
                if (resp) moqui.notifyMessages(resp.messages, resp.errors, resp.validationErrors);
            },
            reLoginVerifyOtp: function () {
                $.ajax({
                    type: 'POST', url: (this.appRootPath + '/rest/verifyOtp'), error: moqui.handleAjaxError, success: this.reLoginVerifyOtpResponse,
                    dataType: 'json', headers: { Accept: 'application/json' }, xhrFields: { withCredentials: true },
                    data: { moquiSessionToken: this.moquiSessionToken, code: this.reLoginOtp }
                });
            },
            reLoginVerifyOtpResponse: function (resp, status, jqXHR) {
                this.getCsrfToken(jqXHR);
                if (resp.loggedIn) {
                    this.reLoginPostLogin();
                }
            },
            qLayoutMinHeight: function (offset) {
                // "offset" is a Number (pixels) that refers to the total
                // height of header + footer that occupies on screen,
                // based on the QLayout "view" prop configuration

                // this is actually what the default style-fn does in Quasar
                return { minHeight: offset ? `calc(100vh - ${offset}px)` : '100vh' }
            }
        },
        watch: {
            '$route': function (to, from) {
                console.info('Route changed via router to ' + to.fullPath);
                const targetUrl = this.getLinkPath(this.appRootPath + (to.fullPath === '/' ? '' : to.fullPath));

                // AMB: Improved sync guard. Don't call setUrl if:
                // 1. We just committed this URL.
                // 2. OR it's a prefix of what we are currently loading (parents asserting themselves).
                if (targetUrl === this.committedUrl || targetUrl === this.currentLinkUrl || targetUrl === this.loadingUrl) return;

                if (this.loadingUrl && this.loadingUrl.startsWith(targetUrl)) {
                    console.info('Skipping setUrl for parent/prefix route assertion: ' + targetUrl);
                    return;
                }

                this.setUrl(targetUrl, null, null, false);
            },
            navMenuList: function (newList) {
                if (newList.length === 0) {
                    this.reloadSubscreens();
                } else if (newList.length > 0) {
                    var cur = newList[newList.length - 1];
                    var par = newList.length > 1 ? newList[newList.length - 2] : null;
                    // if there is an extraPathList set it now
                    if (cur.extraPathList) this.extraPathList = cur.extraPathList;
                    // make sure full currentPathList and activeSubscreens is populated (necessary for minimal path urls)
                    // fullPathList is the path after the base path, menu and link paths are in the screen tree context only so need to subtract off the appRootPath (Servlet Context Path)
                    var basePathSize = this.basePathSize;
                    var fullPathList = cur.path.split('/').slice(basePathSize + 1);
                    console.info('nav updated fullPath ' + JSON.stringify(fullPathList) + ' currentPathList ' + JSON.stringify(this.currentPathList) + ' cur.path ' + cur.path + ' basePathSize ' + basePathSize);
                    // Only sync if the new list is at least as long as current, or if navigating to a different root
                    if (fullPathList.length > 0) {
                        const cleanPathList = fullPathList.filter(s => s && s.length > 0);

                        // Only update currentPathList if:
                        // 1. The new list is longer (more specific)
                        // 2. OR the prefix changed (actual navigation away)
                        // 3. OR currentPathList is empty
                        const isPrefix = this.currentPathList.length > cleanPathList.length &&
                            JSON.stringify(this.currentPathList.slice(0, cleanPathList.length)) === JSON.stringify(cleanPathList);

                        if (!isPrefix && JSON.stringify(this.currentPathList) !== JSON.stringify(cleanPathList)) {
                            console.info('navMenuList syncing currentPathList to', cleanPathList);
                            this.currentPathList = cleanPathList;
                        }

                        // ALWAYS reload subscreens to ensure tabs and metadata are current
                        this.reloadSubscreens();
                    }

                    // update history and document.title
                    var newTitle = (par ? par.title + ' - ' : '') + cur.title;
                    var curUrl = cur.pathWithParams;
                    var questIdx = curUrl.indexOf("?");
                    if (questIdx > 0) {
                        var excludeKeys = ["pageIndex", "orderBySelect", "orderByField", "moquiSessionToken"];
                        var parmList = curUrl.substring(questIdx + 1).split("&");
                        curUrl = curUrl.substring(0, questIdx);
                        var dpCount = 0;
                        var titleParms = "";
                        for (var pi = 0; pi < parmList.length; pi++) {
                            var parm = parmList[pi];
                            if (curUrl.indexOf("?") === -1) { curUrl += "?"; } else { curUrl += "&"; }
                            curUrl += parm;
                            // from here down only add to title parms
                            if (dpCount > 3) continue; // add up to 4 parms to the title
                            var eqIdx = parm.indexOf("=");
                            if (eqIdx > 0) {
                                var key = parm.substring(0, eqIdx);
                                var value = parm.substring(eqIdx + 1);
                                if (key.indexOf("_op") > 0 || key.indexOf("_not") > 0 || key.indexOf("_ic") > 0 || excludeKeys.indexOf(key) >= 0 || key === value) continue;
                                if (titleParms.length > 0) titleParms += ", ";
                                titleParms += decodeURIComponent(value);
                                dpCount++;
                            }
                        }
                        if (titleParms.length > 0) {
                            if (titleParms.length > 70) titleParms = titleParms.substring(0, 70) + "...";
                            newTitle = newTitle + " (" + titleParms + ")";
                        }
                    }
                    var navHistoryList = this.navHistoryList;
                    for (var hi = 0; hi < navHistoryList.length;) {
                        if (navHistoryList[hi].pathWithParams === curUrl) { navHistoryList.splice(hi, 1); } else { hi++; }
                    }
                    navHistoryList.unshift({ title: newTitle, pathWithParams: curUrl, image: cur.image, imageType: cur.imageType });
                    while (navHistoryList.length > 25) { navHistoryList.pop(); }
                    document.title = newTitle;
                }
            },
            currentPathList: function (newList) {
                // console.info('set currentPathList to ' + JSON.stringify(newList) + ' activeSubscreens.length ' + this.activeSubscreens.length);
                var lastPath = newList[newList.length - 1];
                if (lastPath) { $(this.$el).removeClass().addClass(lastPath); }
            }
        },
        computed: {
            currentPath: {
                get: function () {
                    var curPath = this.currentPathList; var extraPath = this.extraPathList;
                    return this.basePath + (curPath && curPath.length > 0 ? '/' + curPath.join('/') : '') +
                        (extraPath && extraPath.length > 0 ? '/' + extraPath.join('/') : '');
                },
                set: function (newPath) {
                    if (!newPath || newPath.length === 0) { this.currentPathList = []; return; }
                    if (newPath.slice(newPath.length - 1) === '/') newPath = newPath.slice(0, newPath.length - 1);
                    if (newPath.indexOf(this.linkBasePath) === 0) { newPath = newPath.slice(this.linkBasePath.length + 1); }
                    else if (newPath.indexOf(this.basePath) === 0) { newPath = newPath.slice(this.basePath.length + 1); }
                    // AMB: Filter out empty segments to prevent double-slashes in API calls
                    this.currentPathList = newPath.split('/').filter(s => s && s.length > 0);
                }
            },
            currentLinkPath: function () {
                var curPath = this.currentPathList; var extraPath = this.extraPathList;
                return this.linkBasePath + (curPath && curPath.length > 0 ? '/' + curPath.join('/') : '') +
                    (extraPath && extraPath.length > 0 ? '/' + extraPath.join('/') : '');
            },
            currentSearch: {
                get: function () { return moqui.objToSearch(this.currentParameters); },
                set: function (newSearch) { this.currentParameters = moqui.searchToObj(newSearch); }
            },
            currentLinkUrl: function () {
                var search = this.currentSearch;
                var val = this.currentLinkPath + (search.length > 0 ? '?' + search : '');
                return val;
            },
            basePathSize: function () {
                // If linkBasePath and appRootPath are the same (standalone), the effective base is the whole linkBasePath
                if (this.linkBasePath === this.appRootPath) return this.linkBasePath.split('/').filter(Boolean).length;
                // Otherwise, it's the segments in linkBasePath beyond the appRootPath
                return this.linkBasePath.split('/').filter(Boolean).length - this.appRootPath.split('/').filter(Boolean).length;
            },
            ScreenTitle: function () { return this.navMenuList.length > 0 ? this.navMenuList[this.navMenuList.length - 1].title : ""; },
            documentMenuList: function () {
                var docList = [];
                for (var i = 0; i < this.navMenuList.length; i++) {
                    var screenDocList = this.navMenuList[i].screenDocList;
                    if (screenDocList && screenDocList.length) { screenDocList.forEach(function (el) { docList.push(el); }); }
                }
                return docList;
            }
        },
        created: function () {
            this.moquiSessionToken = $("#confMoquiSessionToken").val();
            this.appHost = $("#confAppHost").val();
            this.appRootPath = $("#confAppRootPath").val();
            this.basePath = $("#confBasePath").val();
            this.linkBasePath = $("#confLinkBasePath").val();
            // Moqui: fix for standalone apps where URL root differs from conf defaults
            var pathName = window.location.pathname;
            if (pathName && this.appRootPath.length < pathName.length && pathName.indexOf(this.linkBasePath) !== 0) {
                var relPath = pathName.slice(this.appRootPath.length);
                var firstSlash = relPath.indexOf('/', 1);
                var rootSegment = (firstSlash > 0) ? relPath.slice(0, firstSlash) : relPath;
                console.info("Adjusting base paths for standalone app: " + rootSegment);
                this.linkBasePath = this.appRootPath + rootSegment;
                this.basePath = this.appRootPath + rootSegment;
            }
            this.userId = $("#confUserId").val();
            this.username = $("#confUsername").val();
            this.locale = $("#confLocale").val(); if (moqui.localeMap[this.locale]) this.locale = moqui.localeMap[this.locale];
            this.leftOpen = $("#confLeftOpen").val() === 'true';

            var confDarkMode = $("#confDarkMode").val();
            //this.$q.dark.set(confDarkMode === "true");

            // WebSocket notifications disabled (notws)
            this.notificationClient = null;
            // open BroadcastChannel to share session token between tabs/windows on the same domain (see https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
            this.sessionTokenBc = new BroadcastChannel("SessionToken");
            this.sessionTokenBc.onmessage = this.receiveBcCsrfToken;

            var navPluginUrlList = [];
            $('.confNavPluginUrl').each(function (idx, el) { navPluginUrlList.push($(el).val()); });
            this.addNavPluginsWait(navPluginUrlList, 0);

            var accountPluginUrlList = [];
            $('.confAccountPluginUrl').each(function (idx, el) { accountPluginUrlList.push($(el).val()); });
            this.addAccountPluginsWait(accountPluginUrlList, 0);


        },
        mounted: function () {
            var jqEl = $(this.$el);
            jqEl.css("display", "initial");

            window.addEventListener('canvas-synced', (e) => {
                console.info("Blueprint sync detected: Refreshing subscreens...");
                this.reloadSubscreens();
            });

            // load the current screen - this is essential for SPA initialization
            var initialUrl = window.location.pathname + window.location.search;
            console.info("Initial setUrl to: " + initialUrl);
            this.setUrl(initialUrl, null, null, false);

            // Fetch available orchestrator projects (New MCE discovery)
            if (this.fetchAvailableApps) this.fetchAvailableApps();

            // init the NotificationClient and register 'displayNotify' as the default listener
            if (this.notificationClient) this.notificationClient.registerListener("ALL");

            // Systemic AJAX fix: Inject CSRF and Session tokens for all requests
            var vm = this;
            $.ajaxSetup({
                beforeSend: function (xhr, settings) {
                    if (vm.moquiSessionToken) {
                        xhr.setRequestHeader("X-CSRF-Token", vm.moquiSessionToken);
                        // For Moqui services, often moquiSessionToken is also expected in data or as a header
                        xhr.setRequestHeader("moquiSessionToken", vm.moquiSessionToken);
                    }
                }
            });

            // request Notification permission on load if not already granted or denied
            if (window.Notification && Notification.permission !== "granted" && Notification.permission !== "denied") {
                Notification.requestPermission(function (status) {
                    if (status === "granted") {
                        moqui.notifyMessages("Browser notifications enabled, if you don't want them use browser notification settings to block");
                    } else if (status === "denied") {
                        moqui.notifyMessages("Browser notifications disabled, if you want them use browser notification settings to allow");
                    }
                });
            }
        },
        beforeDestroy: function () {
        }
    });
    Object.assign(window.moqui, { webrootVue: app });
}

if (window.MBlueprintNode) {
    moqui.webrootVue.component('m-blueprint-node', window.MBlueprintNode);
    console.info("MCE: m-blueprint-node registered.");
}
// ---------------------------------------------------------
// ALWAYS Register Moqui-AI UI Components
// ---------------------------------------------------------
moqui.webrootVue.use(Quasar, { config: { loadingBar: { color: 'amber' } } });
if (moqui.webrootRouter) moqui.webrootVue.use(moqui.webrootRouter);

// Custom Layout Components
moqui.webrootVue.component('m-screen-layout', {
    props: { view: { type: String, default: 'hHh lpR fFf' } },
    inject: { parentLayout: { default: null }, inSubscreensActive: { default: false } },
    provide() { return { parentLayout: this }; },
    template: `
        <div v-if="parentLayout || inSubscreensActive" class="column full-height overflow-hidden blueprint-nested-layout" v-bind="$attrs">
            <slot></slot>
        </div>
        <q-layout v-else :view="view" v-bind="$attrs">
            <slot></slot>
        </q-layout>
    `
});
moqui.webrootVue.component('m-screen-header', {
    props: { elevated: { type: Boolean, default: true } },
    inject: { parentLayout: { default: null }, inSubscreensActive: { default: false } },
    template: `
        <div v-if="parentLayout || inSubscreensActive" class="blueprint-nested-header" :class="{'sticky-top shadow-2': elevated}" v-bind="$attrs">
            <slot></slot>
        </div>
        <q-header v-else :elevated="elevated" class="bg-primary text-white" style="z-index: 2000;">
            <slot></slot>
        </q-header>
    `
});
moqui.webrootVue.component('screen-header', moqui.webrootVue.component('m-screen-header'));
moqui.webrootVue.component('m-screen-drawer', {
    props: { side: { type: String, default: 'left' }, modelValue: { type: Boolean, default: false }, behavior: { type: String, default: 'default' } },
    emits: ['update:modelValue'],
    template: '<q-drawer :side="side" :behavior="behavior" :model-value="modelValue" @update:model-value="$emit(\'update:modelValue\', $event)"><slot></slot></q-drawer>'
});
moqui.webrootVue.component('m-screen-toolbar', {
    template: '<q-toolbar><slot></slot></q-toolbar>'
});
moqui.webrootVue.component('screen-toolbar', moqui.webrootVue.component('m-screen-toolbar'));
moqui.webrootVue.component('m-screen-content', {
    inject: { parentLayout: { default: null }, inSubscreensActive: { default: false } },
    template: `
        <div v-if="parentLayout || inSubscreensActive" class="col-grow overflow-auto blueprint-nested-content" v-bind="$attrs">
            <slot></slot>
        </div>
        <q-page-container v-else v-bind="$attrs">
            <q-page class="q-pa-md">
                <slot></slot>
            </q-page>
        </q-page-container>
    `
});

moqui.webrootVue.component('m-architect-view-port', {
    name: "mArchitectViewPort",
    props: { screenData: [Object, String], specPath: String },
    template: `
<div class="architect-view-port">
            <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut" mode="out-in">
                <!-- ARCHITECT VIEW: The Visual Canvas -->
                <div :key="'architect'">
                        <blueprint-renderer 
                            :screen-data="parsedScreenData" 
                            :spec-path="specPath" 
                            @select-component="selectComponent" />
                </div>
                
                <!-- PRODUCTION VIEW: The Real App (Live Preview) -->
                <!--
                <div v-else :key="'production'" class="q-pa-md shadow-2 rounded-borders bg-white overflow-hidden" 
                     style="min-height: 400px; position: relative;">
                    <div class="text-h6 q-mb-md text-grey-7 flex items-center">
                        <q-icon name="visibility" class="q-mr-sm" />
                        Production Preview
                        <q-badge color="grey-4" text-color="black" label="LIVE" class="q-ml-sm" />
                    </div>
                    
                    <div v-if="isEmptyData" class="flex flex-center absolute-full bg-grey-1 text-grey-6 column">
                        <q-icon name="warning" size="48px" class="q-mb-md" />
                        <div class="text-subtitle1">Reading Blueprint Stream...</div>
                        <div class="text-caption text-italic">Initial data loading or no blocks detected in speculation file.</div>
                    </div>
                    <m-blueprint-node 
                        v-else-if="parsedScreenData" 
                        :node="parsedScreenData" 
                        :context="{}" />
                </div>
                -->
            </transition>
        </div>
    `,
    methods: {
        selectComponent(comp) {
            // Forward the event to the root instance
            if (this.$root.selectComponent) {
                this.$root.selectComponent(comp);
            }
        }
    },
    computed: {
        parsedScreenData() {
            let data = this.screenData;
            if (typeof data === 'string' && data.length > 0) {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    console.error("Failed to parse screenData string in m-architect-view-port", e);
                    return null;
                }
            }
            return data;
        },
        isEmptyData() {
            const data = this.parsedScreenData;
            if (!data) return true;
            if (data.name === 'No Blocks Found') return true;
            // Root 'screen-structure' with no actual children
            if (data.name === 'screen-structure' && (!data.children || data.children.length === 0)) return true;
            return false;
        }
    }
});
moqui.webrootVue.component('m-menu-item', {
    props: { name: String, href: String, text: String, label: String, icon: String, buttonClass: String },
    computed: {
        resolvedHref: function () {
            if (this.href) return this.href;
            if (this.name) {
                const rootSub = this.$root.navMenuList[0]?.subscreens;
                const sub = rootSub?.find(s => s.name === this.name);
                return sub?.pathWithParams || sub?.path;
            }
            return null;
        }
    },
    template: '<m-link :href="resolvedHref"><q-btn flat stretch no-caps :label="text || label" :icon="icon" :class="buttonClass" color="white"></q-btn></m-link>'
});
moqui.webrootVue.component('menu-item', moqui.webrootVue.component('m-menu-item'));
moqui.webrootVue.component('m-subscreens-menu', {
    props: {
        type: { type: String, default: 'drawer' },
        pathIndex: { type: [Number, String], default: null }
    },
    computed: {
        menuList: function () {
            const navList = this.$root.navMenuList;
            if (this.pathIndex !== null && this.pathIndex !== undefined) {
                const idx = parseInt(this.pathIndex);
                if (navList && navList.length > idx) {
                    const item = navList[idx];
                    // Verify structure: item should have 'subscreens' array
                    if (item && item.subscreens) return item.subscreens;
                }
                return []; // Index valid but no data yet or no subscreens
            }
            return navList; // Fallback to full list (breadcrumbs)
        }
    },
    template:
        // Toolbar Mode (Horizontal)
        '<div v-if="type === \'toolbar\'" class="row no-wrap items-center">' +
        '  <template v-for="(item, index) in menuList" :key="index">' +
        '    <q-btn v-if="item.subscreens && item.subscreens.length" flat stretch :label="item.title" :icon="item.image">' +
        '      <q-menu>' +
        '        <q-list>' +
        '          <q-item clickable v-close-popup v-for="(sub, subIndex) in item.subscreens" :key="subIndex" :to="sub.path" :active="sub.active" :class="sub.active ? \'text-primary bg-blue-1\' : \'text-grey-9\'">' +
        '            <q-item-section avatar v-if="sub.image"><q-icon :name="sub.image" /></q-item-section>' +
        '            <q-item-section>{{ sub.title }}</q-item-section>' +
        '          </q-item>' +
        '        </q-list>' +
        '      </q-menu>' +
        '    </q-btn>' +
        '    <q-btn v-else flat stretch :label="item.title" :icon="item.image" :to="item.path" :class="item.active ? \'bg-white text-primary\' : \'\'"/>' +
        '  </template>' +
        '</div>' +

        // Drawer Mode (Vertical List)
        '<q-list v-else class="text-grey-9">' +
        '  <template v-for="(item, index) in menuList" :key="index">' +
        '    <q-expansion-item v-if="item.subscreens && item.subscreens.length" :label="item.title" :icon="item.image" default-opened header-class="text-primary">' +
        '      <q-list class="q-pl-md">' +
        '        <q-item clickable v-ripple v-for="(sub, subIndex) in item.subscreens" :key="subIndex" :to="sub.path" :active="sub.active" :class="sub.active ? \'text-primary bg-blue-1\' : \'text-grey-8\'">' +
        '           <q-item-section avatar v-if="sub.image"><q-icon :name="sub.image" /></q-item-section>' +
        '           <q-item-section>{{ sub.title }}</q-item-section>' +
        '        </q-item>' +
        '      </q-list>' +
        '    </q-expansion-item>' +
        '    <q-item v-else clickable v-ripple :to="item.path" :active="item.active" :class="item.active ? \'text-primary bg-blue-1\' : \'text-grey-8\'">' +
        '      <q-item-section avatar v-if="item.image"><q-icon :name="item.image" /></q-item-section>' +
        '      <q-item-section>{{ item.title }}</q-item-section>' +
        '    </q-item>' +
        '  </template>' +
        '</q-list>'
});

moqui.webrootVue.component('m-menu-dropdown', {
    props: {
        text: String,
        label: String,
        icon: String,
        transitionUrl: String,
        piniaStore: String,
        piniaList: String,
        targetUrl: String,
        labelField: { type: String, default: 'label' },
        keyField: { type: String, default: 'id' },
        urlParameter: { type: String, default: 'id' }
    },
    data: function () {
        return {
            fetchedOptions: [],
            loading: false,
            loaded: false
        }
    },
    computed: {
        options: function () {
            // Bind to Pinia store if specified
            if (this.piniaStore && this.piniaList && window[this.piniaStore]) {
                var store = window[this.piniaStore]();
                return store[this.piniaList] || [];
            }
            return this.fetchedOptions;
        }
    },
    methods: {
        fetchOptions: function () {
            // Skip AJAX if binding to a Pinia store
            if (this.piniaStore && this.piniaList) return;

            if (this.loaded || this.loading || !this.transitionUrl) return;
            this.loading = true;
            var vm = this;
            $.ajax({
                type: 'GET',
                url: this.transitionUrl,
                dataType: 'json',
                headers: { 'moquiSessionToken': this.$root.moquiSessionToken },
                success: function (data) {
                    vm.fetchedOptions = data || [];
                    vm.loaded = true;
                    vm.loading = false;
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.error("Error fetching menu dropdown options", errorThrown);
                    vm.loading = false;
                }
            });
        },
        navigate: function (opt) {
            var target = opt.target || this.targetUrl;
            var paramName = opt.param || this.urlParameter;
            var value = opt.value !== undefined ? opt.value : opt[this.keyField];

            if (target) {
                if (!target.startsWith('/') && this.$root.appRootPath) {
                    target = this.$root.appRootPath + '/' + target;
                }
                var separator = target.indexOf('?') !== -1 ? '&' : '?';
                var finalUrl = target + separator + paramName + '=' + encodeURIComponent(value);
                this.$root.setUrl(finalUrl);
            }
        }
    },
    template: `
    <q-btn-dropdown flat stretch no-caps :label="text || label || 'MEETINGS'" :icon="icon || 'groups'" color="white" @show="fetchOptions">
        <q-list style="min-width: 200px">
            <q-item v-if="loading"><q-item-section class="flex flex-center"><q-spinner color="primary" /></q-item-section></q-item>
            <q-item v-else-if="options.length === 0"><q-item-section class="text-grey text-center">No options available</q-item-section></q-item>
            
            <template v-for="(opt, idx) in options" :key="idx">
                <q-item v-if="opt.children" clickable>
                    <q-item-section>{{ opt[labelField] || opt.label }}</q-item-section>
                    <q-item-section side><q-icon name="chevron_right" /></q-item-section>
                    <q-menu anchor="top end" self="top start">
                        <q-list>
                            <q-item v-for="(child, cIdx) in opt.children" :key="cIdx" clickable v-close-popup @click="navigate(child)">
                                <q-item-section>{{ child[labelField] || child.label }}</q-item-section>
                            </q-item>
                        </q-list>
                    </q-menu>
                </q-item>
                
                <q-item v-else clickable v-close-popup @click="navigate(opt)">
                    <q-item-section>{{ opt[labelField] || opt.label }}</q-item-section>
                </q-item>
            </template>
        </q-list>
    </q-btn-dropdown>
    `,
    mounted: function () {
        console.info("In m-menu-dropdown");
        return;
    },
});

moqui.webrootVue.component('menu-dropdown', moqui.webrootVue.component('m-menu-dropdown'));

moqui.webrootVue.component('bp-tabbar', {
    props: { list: String, align: { type: String, default: 'left' }, noCaps: { type: Boolean, default: true } },
    computed: {
        resolvedList: function () {
            if (!this.list) return null;
            try {
                // Evaluate the list expression. Supporting both global variables and direct paths.
                let val = eval(this.list);
                return Array.isArray(val) ? val : null;
            } catch (e) { console.error("Error resolving bp-tabbar list: " + this.list, e); return []; }
        }
    },
    template: `
        <div v-if="!list || (resolvedList && resolvedList.length > 0)">
            <q-tabs :align="align" :no-caps="noCaps" active-color="primary" indicator-color="primary">
                <template v-if="resolvedList">
                    <bp-tab-provider v-for="(item, index) in resolvedList" :key="index" :item="item">
                        <slot></slot>
                    </bp-tab-provider>
                </template>
                <slot v-else></slot>
            </q-tabs>
        </div>
    `
});

// Internal helper to provide context to children without affecting layout
moqui.webrootVue.component('bp-tab-provider', {
    props: ['item'],
    provide() { return { bpItem: this.item }; },
    template: '<slot></slot>'
});

moqui.webrootVue.component('bp-tab', {
    inject: { bpItem: { default: null } },
    props: { name: String, label: String, icon: String, url: String, text: String },
    computed: {
        displayLabel() {
            // Priority: blueprint label/text, then injected item field, then fallback
            let val = this.label || this.text;
            if (this.bpItem && val) {
                // If the value is a field name on the item, use it
                if (this.bpItem[val] !== undefined) return this.bpItem[val];
            }
            return val;
        },
        displayUrl() {
            let url = this.url;
            if (this.bpItem && this.url) {
                if (this.url.includes('item.')) {
                    try { const item = this.bpItem; url = eval(this.url); } catch (e) { url = this.url; }
                } else if (this.bpItem[this.url] !== undefined) {
                    url = this.bpItem[this.url];
                }
            }
            if (url && this.$root.appRootPath && url.startsWith(this.$root.appRootPath)) {
                url = url.substring(this.$root.appRootPath.length);
                if (!url.startsWith('/')) url = '/' + url;
            }
            return url;
        }
    },
    methods: {
        navigate: function (e) {
            const targetUrl = this.displayUrl;
            if (targetUrl) this.$root.setUrl(targetUrl);
        }
    },
    template: '<q-route-tab :name="name" :label="displayLabel" :icon="icon" :to="displayUrl" @click="navigate"></q-route-tab>'
});

moqui.webrootVue.component('bp-parameter', {
    props: { name: String, value: [String, Number], piniaStore: String, piniaField: String },
    mounted: function () { this.sync(); },
    watch: { value: function () { this.sync(); } },
    methods: {
        sync: function () {
            if (this.piniaStore && this.piniaField && window[this.piniaStore]) {
                const store = window[this.piniaStore]();
                store[this.piniaField] = this.value;
            }
        }
    },
    template: '<template></template>'
});

moqui.webrootVue.component('m-banner', {
    template: '<q-banner><slot></slot></q-banner>'
});

moqui.webrootVue.component('discussion-tree', {

    props: {
        workEffortId: { type: String, required: true },
        readonly: { type: Boolean, default: false },
        encryptNotes: { type: Boolean, default: true },
        showPatientContext: { type: Boolean, default: false }
    },
    data: function () {
        return {
            topics: [],
            loading: false,
            error: null
        };
    },
    template: `
    <div class="q-pa-md">
        <div v-if="loading" class="row justify-center">
            <q-spinner color="primary" size="3em" />
        </div>
        <div v-else-if="error" class="text-negative">
            {{ error }}
        </div>
        <div v-else>
            <q-tree
                :nodes="topics"
                node-key="workEffortId"
                label-key="workEffortName"
                default-expand-all
            >
                <template v-slot:default-header="prop">
                    <slot name="node-header" v-bind:node="prop.node">
                        <div class="row items-center">
                            <div class="text-weight-bold">{{ prop.node.workEffortName }}</div>
                            <q-chip v-if="prop.node.statusDescription" size="sm" color="primary" text-color="white" class="q-ml-sm">
                                {{ prop.node.statusDescription }}
                            </q-chip>
                        </div>
                    </slot>
                </template>
                <template v-slot:default-body="prop">
                    <slot name="node-body" v-bind:node="prop.node">
                        <div v-if="prop.node.description" class="q-pa-sm text-grey-8">
                             {{ prop.node.description }}
                        </div>
                    </slot>
                    <div class="row q-gutter-sm q-mt-xs" v-if="!readonly">
                         <slot name="node-actions" v-bind:node="prop.node">
                             <q-btn size="sm" flat round color="primary" icon="add_comment" @click.stop="addChild(prop.node)">
                                <q-tooltip>Add Sub-topic</q-tooltip>
                             </q-btn>
                             <q-btn size="sm" flat round color="secondary" icon="post_add" @click.stop="injectTopic(prop.node)">
                                <q-tooltip>Inject Corporate Topic</q-tooltip>
                             </q-btn>
                         </slot>
                    </div>
                </template>
            </q-tree>
        </div>
    </div>
    `,
    mounted: function () {
        this.fetchTopics();
    },
    methods: {
        fetchTopics: function () {
            this.loading = true;
            this.error = null;
            var vm = this;

            // Call the service to get the tree
            $.ajax({
                type: 'POST',
                url: '/rest/s1/huddle/HuddleDiscussionTree',
                data: { workEffortId: this.workEffortId },
                dataType: 'json',
                headers: { 'moquiSessionToken': this.moqui.webrootVue.sessionToken },
                error: function (jqXHR, textStatus, errorThrown) {
                    vm.error = "Error loading topics: " + textStatus + " " + errorThrown;
                    vm.loading = false;
                },
                success: function (data) {
                    if (data && data.topicTree) {
                        // q-tree expects an array of root nodes
                        vm.topics = [data.topicTree];
                    } else {
                        // Empty or error response without topicTree
                        vm.topics = [];
                        console.warn("No topicTree found in response for workEffortId: " + vm.workEffortId);
                    }
                    vm.loading = false;
                }
            });
        },
        addChild: function (node) {
            var vm = this;
            this.$q.dialog({
                title: 'Add Sub-topic',
                message: 'Enter topic name for: ' + node.workEffortName,
                prompt: {
                    model: '',
                    type: 'text'
                },
                cancel: true,
                persistent: true
            }).onOk(function (data) {
                if (!data) return;

                vm.loading = true;
                $.ajax({
                    type: 'POST',
                    url: '/rest/s1/huddle/HuddleTopic',
                    data: {
                        parentWorkEffortId: node.workEffortId,
                        workEffortName: data
                    },
                    dataType: 'json',
                    headers: { 'moquiSessionToken': vm.moqui.webrootVue.sessionToken },
                    error: function (jqXHR, textStatus, errorThrown) {
                        vm.$q.notify({ type: 'negative', message: 'Error adding topic: ' + errorThrown });
                        vm.loading = false;
                    },
                    success: function () {
                        vm.$q.notify({ type: 'positive', message: 'Topic added successfully' });
                        vm.fetchTopics(); // Refresh the tree
                    }
                });
            });
        },
        injectTopic: function (node) {
            var vm = this;
            vm.loading = true;

            // 1. Fetch available topics
            $.ajax({
                type: 'GET',
                url: '/rest/s1/huddle/AvailableCorporateTopics',
                dataType: 'json',
                headers: { 'moquiSessionToken': vm.moqui.webrootVue.sessionToken },
                error: function (jqXHR, textStatus, errorThrown) {
                    vm.$q.notify({ type: 'negative', message: 'Error fetching corporate topics: ' + errorThrown });
                    vm.loading = false;
                },
                success: function (data) {
                    vm.loading = false;
                    if (!data || !data.topicList || data.topicList.length === 0) {
                        vm.$q.notify({ type: 'warning', message: 'No corporate topics available to inject.' });
                        return;
                    }

                    // 2. Show selection dialog
                    vm.$q.dialog({
                        title: 'Inject Corporate Topic',
                        message: 'Select a topic to inject into: ' + node.workEffortName,
                        options: {
                            type: 'radio',
                            model: '',
                            items: data.topicList.map(t => ({ label: t.workEffortName, value: t.workEffortId }))
                        },
                        cancel: true,
                        persistent: true
                    }).onOk(function (topicId) {
                        if (!topicId) return;

                        // 3. Call inject service
                        vm.loading = true;
                        $.ajax({
                            type: 'POST',
                            url: '/rest/s1/huddle/HuddleTopic/inject',
                            data: {
                                huddleWorkEffortId: node.workEffortId,
                                topicWorkEffortId: topicId
                            },
                            dataType: 'json',
                            headers: { 'moquiSessionToken': vm.moqui.webrootVue.sessionToken },
                            error: function (jqXHR, textStatus, errorThrown) {
                                vm.$q.notify({ type: 'negative', message: 'Error injecting topic: ' + errorThrown });
                                vm.loading = false;
                            },
                            success: function () {
                                vm.$q.notify({ type: 'positive', message: 'Corporate topic injected successfully' });
                                vm.fetchTopics(); // Refresh the tree
                            }
                        });
                    });
                }
            });
        }
    }
});
// some globals for all Vue components to directly use the moqui object (for methods, constants, etc) and the window object
/*
Vue.prototype.moqui = moqui;
Vue.prototype.moment = moment;
Vue.prototype.window = window;
*/
moqui.webrootVue.config.globalProperties.moqui = moqui;
moqui.webrootVue.config.globalProperties.moment = moment;
moqui.webrootVue.config.globalProperties.window = window;

moqui.webrootVue.config.compilerOptions.whitespace = 'preserve'
//moqui.webrootVue.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('q-')

moqui.urlExtensions = { js: 'qjs', vue: 'qvue', vuet: 'qvt', qvt: 'qvt' }

// simple stub for define if it doesn't exist (ie no require.js, etc); mimic pattern of require.js define()
if (!window.define) window.define = function (name, deps, callback) {
    if (!moqui.isString(name)) { callback = deps; deps = name; name = null; }
    if (!moqui.isArray(deps)) { callback = deps; deps = null; }
    if (moqui.isFunction(callback)) { return callback(); } else { return callback }
};
//Vue.filter('decodeHtml', moqui.htmlDecode);
//Vue.filter('format', moqui.format);
moqui.webrootVue.config.globalProperties.$filters = {
    format(value) {
        return moqui.format(value);
    }
}
moqui.getQuasarColor = function (bootstrapColor) {
    // Quasar colors (https://quasar.dev/style/color-palette): primary, secondary, accent, dark, positive, negative, info, warning
    // success => positive, danger => negative
    if (bootstrapColor === 'success') return 'positive';
    if (bootstrapColor === 'danger') return 'negative';
    return bootstrapColor;
};

/* ========== notify and error handling ========== */
moqui.notifyOpts = { timeout: 1500, type: 'positive' };
moqui.notifyOptsInfo = { timeout: 5000, type: 'info' };
moqui.notifyOptsError = { timeout: 15000, type: 'negative' };
moqui.notifyMessages = function (messages, errors, validationErrors) {
    var notify = (moqui.webrootVue && moqui.webrootVue.$q && Quasar.Notify.create) || (Quasar && Quasar.Notify ? Quasar.Notify.create : null);
    if (!notify) { console.error("Notify not available"); return false; }

    var notified = false;
    if (messages) {
        if (moqui.isArray(messages)) {
            for (var mi = 0; mi < messages.length; mi++) {
                var messageItem = messages[mi];
                if (moqui.isPlainObject(messageItem)) {
                    var msgType = moqui.getQuasarColor(messageItem.type);
                    if (!msgType || !msgType.length) msgType = 'info';
                    notify($.extend({}, moqui.notifyOptsInfo, { type: msgType, message: messageItem.message }));
                    if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(messageItem.message, msgType);
                } else {
                    notify($.extend({}, moqui.notifyOptsInfo, { message: messageItem }));
                    if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(messageItem, 'info');
                }
                notified = true;
            }
        } else {
            notify($.extend({}, moqui.notifyOptsInfo, { message: messages }));
            if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(messages, 'info');
            notified = true;
        }
    }
    if (errors) {
        if (moqui.isArray(errors)) {
            for (var ei = 0; ei < errors.length; ei++) {
                notify($.extend({}, moqui.notifyOptsError, { message: errors[ei] }));
                if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(errors[ei], 'negative');
                notified = true;
            }
        } else {
            notify($.extend({}, moqui.notifyOptsError, { message: errors }));
            if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(errors, 'negative');
            notified = true;
        }
    }
    if (validationErrors) {
        if (moqui.isArray(validationErrors)) {
            for (var vei = 0; vei < validationErrors.length; vei++) { moqui.notifyValidationError(validationErrors[vei]); notified = true; }
        } else { moqui.notifyValidationError(validationErrors); notified = true; }
    }
    return notified;
};
moqui.notifyValidationError = function (valError) {
    var notify = (moqui.webrootVue && moqui.webrootVue.$q && Quasar.Notify.create) || (Quasar && Quasar.Notify ? Quasar.Notify.create : null);
    if (!notify) return;

    var message = valError;
    if (moqui.isPlainObject(valError)) {
        message = valError.message;
        if (valError.fieldPretty && valError.fieldPretty.length) message = message + " (for field " + valError.fieldPretty + ")";
    }
    notify($.extend({}, moqui.notifyOptsError, { message: message }));
    if (moqui.webrootVue && moqui.webrootVue.addNotify) moqui.webrootVue.addNotify(message, 'negative');
};
moqui.handleAjaxError = function (jqXHR, textStatus, errorThrown, responseText) {
    var resp;
    if (responseText) {
        resp = responseText;
    } else if (jqXHR.responseType === 'blob') {
        var reader = new FileReader();
        reader.onload = function (evt) {
            var bodyText = evt.target.result;
            moqui.handleAjaxError(jqXHR, textStatus, errorThrown, bodyText);
        };
        reader.readAsText(jqXHR.response);
        return;
    } else {
        resp = jqXHR.responseText;
    }

    var respObj;
    try { respObj = JSON.parse(resp); } catch (e) { /* ignore error, don't always expect it to be JSON */ }
    console.warn('ajax ' + textStatus + ' (' + jqXHR.status + '), message ' + errorThrown /*+ '; response: ' + resp*/);
    // console.error('resp [' + resp + '] respObj: ' + JSON.stringify(respObj));
    var notified = false;
    if (jqXHR.status === 401) {
        notified = moqui.notifyMessages(null, "No user authenticated");
    } else {
        if (respObj && moqui.isPlainObject(respObj)) {
            notified = moqui.notifyMessages(respObj.messageInfos, respObj.errors, respObj.validationErrors);
        } else if (resp && moqui.isString(resp) && resp.length) {
            notified = moqui.notifyMessages(resp);
        }
    }

    // reload on 401 (Unauthorized) so server can remember current URL and redirect to login screen, or show re-login dialog to maintain the client app context
    if (jqXHR.status === 401) {
        if (moqui.webrootVue && moqui.webrootVue.reLoginCheckShow) {
            // window.location.href = moqui.webrootVue.currentLinkUrl;
            // instead of reloading the web page, show the Re-Login dialog
            moqui.webrootVue.reLoginCheckShow();
        } else {
            window.location.reload(true);
        }
    } else if (jqXHR.status === 0) {
        if (errorThrown.indexOf('abort') < 0) {
            var msg = 'Could not connect to server';
            Quasar.Notify.create($.extend({}, moqui.notifyOptsError, { message: msg }));
            moqui.webrootVue.addNotify(msg, 'negative');
        }
    } else {
        if (moqui.webrootVue && moqui.webrootVue.getCsrfToken) {
            // update the moqui session token if it has changed
            moqui.webrootVue.getCsrfToken(jqXHR);
        }
        if (!notified) {
            var errMsg = 'Error: ' + errorThrown + ' (' + textStatus + ')';
            Quasar.Notify.create($.extend({}, moqui.notifyOptsError, { message: errMsg }));
            moqui.webrootVue.addNotify(errMsg, 'negative');
        }
    }
};
/* Override moqui.notifyGrowl */
moqui.notifyGrowl = function (jsonObj) {
    if (!jsonObj) return;
    // TODO: jsonObj.icon
    Quasar.Notify.create($.extend({}, moqui.notifyOptsInfo, {
        type: jsonObj.type, message: jsonObj.title,
        actions: [
            { label: 'View', color: 'white', handler: function () { moqui.webrootVue.setUrl(jsonObj.link); } }
        ]
    }));
    moqui.webrootVue.addNotify(jsonObj.title, jsonObj.type, jsonObj.link, jsonObj.icon);
};

/* ========== component loading methods ========== */
moqui.componentCache = new moqui.LruMap(50);

moqui.handleLoadError = function (jqXHR, textStatus, errorThrown) {
    if (textStatus === 'abort') {
        console.warn('load aborted: ' + textStatus + ' (' + jqXHR.status + '), message ' + errorThrown);
        return;
    }
    moqui.webrootVue.loading = 0;
    moqui.handleAjaxError(jqXHR, textStatus, errorThrown);
};
// NOTE: this may eventually split to change the activeSubscreens only on currentPathList change (for screens that support it)
//     and if ever needed some sort of data refresh if currentParameters changes
moqui.loadComponent = function (urlInfo, callback, divId) {
    var jsExt = moqui.urlExtensions.js, vueExt = moqui.urlExtensions.vue, vuetExt = moqui.urlExtensions.vuet, qvtExt = moqui.urlExtensions.qvt, qjsonExt = 'qjson';

    var path, extraPath, search, bodyParameters, renderModes;
    if (typeof urlInfo === 'string') {
        var questIdx = urlInfo.indexOf('?');
        if (questIdx > 0) { path = urlInfo.slice(0, questIdx); search = urlInfo.slice(questIdx + 1); }
        else { path = urlInfo; }
        renderModes = ['qjson', 'qvt']; // Preferred Blueprint mode for string URLs
    } else {
        path = urlInfo.path; extraPath = urlInfo.extraPath; search = urlInfo.search;
        bodyParameters = urlInfo.bodyParameters; renderModes = urlInfo.renderModes;
        if (!renderModes) renderModes = ['qjson', 'qvt']; // Preferred Blueprint mode if missing in object
    }
    // ensure valid object for later checks
    if (!urlInfo.renderModes) urlInfo.renderModes = renderModes;
    // ensure lastStandalone/standalone are in search
    if (urlInfo.lastStandalone) { search = (search ? search + '&' : '') + 'lastStandalone=' + urlInfo.lastStandalone; }
    if (urlInfo.standalone) { search = (search ? search + '&' : '') + 'standalone=' + urlInfo.standalone; }
    // if Quasar says it's mobile then tell the server via _uiType parameter
    console.log("Load Component " + JSON.stringify(urlInfo) + " Window Width " + window.innerWidth + " Quasar Platform: " + JSON.stringify(Quasar.Platform.is) + " search: " + search);
    if ((window.innerWidth <= 600 || Quasar.Platform.is.mobile) && (!search || search.indexOf("_uiType") === -1)) {
        search = (search || '') + '&_uiType=mobile';
    }

    /* NOTE DEJ 20200718: uncommented componentCache but leaving comment in place in case remains an issue (makes user experience much smoother):
     * CACHE DISABLED: issue with more recent Vue JS where cached components don't re-render when assigned so screens don't load
     * to reproduce: make a screen like a dashboard slow loading with a Thread.sleep(5000), from another screen select it
     * in the menu and before it loads click on a link for another screen, won't load and gets into a bad state where
     * nothing in the same path will load, need to somehow force it to re-render;
     * note that vm.$forceUpdate() in m-subscreens-active component before return false did not work
    // check cache
    // console.info('component lru ' + JSON.stringify(moqui.componentCache.lruList));
    */
    var cachedComp = moqui.componentCache.get(path);
    if (cachedComp) {
        console.info('found cached component for path ' + path + ': ' + JSON.stringify(cachedComp));
        callback(cachedComp);
        return;
    }

    // prep url
    var url = path;

    // does the screen support vue? use http-vue-loader
    if (urlInfo.renderModes && urlInfo.renderModes.indexOf(vueExt) >= 0) url += ('.' + vueExt);
    if (url.slice(-vueExt.length) === vueExt) {
        console.info("loadComponent vue " + url + (divId ? " id " + divId : ''));
        var vueAjaxSettings = {
            type: "GET", url: url, error: moqui.handleLoadError, success: function (resp, status, jqXHR) {
                if (jqXHR.status === 205) {
                    var redirectTo = jqXHR.getResponseHeader("X-Redirect-To")
                    console.log("loading component vue redirectTo", redirectTo);
                    moqui.webrootVue.setUrl(redirectTo);
                    return;
                }
                // console.info(resp);
                if (!resp) { callback(moqui.NotFound); }
                var isServerStatic = (jqXHR.getResponseHeader("Cache-Control").indexOf("max-age") >= 0);
                if (moqui.isString(resp) && resp.length > 0) {
                    var vueCompObj = httpVueLoader.parse(resp, url.substr(0, url.lastIndexOf('/') + 1));
                    if (isServerStatic) { moqui.componentCache.put(path, vueCompObj); }
                    callback(vueCompObj);
                } else { callback(moqui.NotFound); }
            }
        };
        if (bodyParameters && !$.isEmptyObject(bodyParameters)) { vueAjaxSettings.type = "POST"; vueAjaxSettings.data = bodyParameters; }
        return $.ajax(vueAjaxSettings);
    }

    // look for JavaScript
    var isJsPath = (path.slice(-jsExt.length) === jsExt);
    if (!isJsPath && urlInfo.renderModes && urlInfo.renderModes.indexOf(jsExt) >= 0) {
        // screen supports js explicitly so do that
        url += ('.' + jsExt);
        isJsPath = true;
    }
    // Check for qjson request or general blueprint request
    var isBlueprint = !isJsPath; // Default to blueprint for all non-JS paths in MoquiAi

    if (isBlueprint) {
        if (!url.includes('.' + qjsonExt) && !url.includes('.' + qvtExt)) {
            url += ('.' + qjsonExt);
        }
    }

    if (extraPath && extraPath.length > 0) url += ('/' + extraPath);
    if (search && search.length > 0) url += ('?' + search);

    console.info("loadComponent " + url + (divId ? " id " + divId : ''));
    var ajaxSettings = {
        type: "GET", url: url, error: moqui.handleLoadError,
        headers: { Accept: isBlueprint ? 'application/json' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        success: function (resp, status, jqXHR) {
            if (jqXHR.status === 205) {
                var redirectTo = jqXHR.getResponseHeader("X-Redirect-To")
                console.log("loading component js redirectTo", redirectTo);
                moqui.webrootVue.setUrl(redirectTo);
                return;
            }
            // console.info(resp);
            if (!resp) { callback(moqui.NotFound); }
            var cacheControl = jqXHR.getResponseHeader("Cache-Control");
            var isServerStatic = (cacheControl && cacheControl.indexOf("max-age") >= 0);

            if (isBlueprint) {
                console.info("loaded Blueprint from " + url);
                callback(moqui.makeBlueprintComponent(resp, url));
                return;
            }

            if (moqui.isString(resp) && resp.length > 0) {
                if (isJsPath || resp.slice(0, 7) === 'define(') {
                    console.info("loaded JS from " + url + (divId ? " id " + divId : ""));
                    var jsCompObj = eval(resp);
                    if (jsCompObj.template) {
                        if (isServerStatic) { moqui.componentCache.put(path, jsCompObj); }
                        callback(jsCompObj);
                    } else {
                        var htmlUrl = (path.slice(-jsExt.length) === jsExt ? path.slice(0, -jsExt.length) : path) + '.' + vuetExt;
                        $.ajax({
                            type: "GET", url: htmlUrl, error: moqui.handleLoadError, success: function (htmlText) {
                                jsCompObj.template = htmlText;
                                if (isServerStatic) { moqui.componentCache.put(path, jsCompObj); }
                                callback(jsCompObj);
                            }
                        });
                    }
                } else {
                    var templateText = resp.replace(/<script/g, '<m-script').replace(/<\/script>/g, '</m-script>').replace(/<link/g, '<m-stylesheet');
                    console.info("loaded HTML template from " + url + (divId ? " id " + divId : "") /*+ ": " + templateText*/);
                    // using this fixes encoded values in attributes and such that Vue does not decode (but is decoded in plain HTML),
                    //     but causes many other problems as all needed encoding is lost too: moqui.decodeHtml(templateText)
                    var compObj = { template: '<div' + (divId && divId.length > 0 ? ' id="' + divId + '"' : '') + '>' + templateText + '</div>' };
                    if (isServerStatic) { moqui.componentCache.put(path, compObj); }
                    callback(compObj);
                }
            } else if (moqui.isPlainObject(resp)) {
                if (resp.screenUrl && resp.screenUrl.length) {
                    console.log("loading screenUrl", resp.screenUrl);
                    moqui.webrootVue.setUrl(resp.screenUrl);
                }
                else if (resp.redirectUrl && resp.redirectUrl.length) { window.location.replace(resp.redirectUrl); }
            } else { callback(moqui.NotFound); }
        }
    };
    if (bodyParameters && !$.isEmptyObject(bodyParameters)) { ajaxSettings.type = "POST"; ajaxSettings.data = bodyParameters; }
    return $.ajax(ajaxSettings);
};

/* ========== placeholder components ========== */
//moqui.NotFound = Vue.extend({ template: '<div id="current-page-root"><h4>Screen not found at {{this.$root.currentPath}}</h4></div>' });
//moqui.EmptyComponent = Vue.extend({ template: '<div id="current-page-root"><div class="spinner"><div>&nbsp;</div></div></div>' });
moqui.NotFound = Vue.defineComponent({ template: '<div id="current-page-root"><h4>Screen not found at {{this.$root.currentPath}}</h4></div>' });
moqui.EmptyComponent = Vue.defineComponent({ template: '<div id="current-page-root"><div class="spinner"><div>&nbsp;</div></div></div>' });
/* ========== inline components ========== */
moqui.webrootVue.component('m-link', {
    props: { href: { type: String, required: true }, loadId: String, confirmation: String },
    template: '<a :href="linkHref" @click.prevent="go" class="q-link" v-bind="$attrs" style="color: inherit; text-decoration: none;"><slot></slot></a>',
    methods: {
        go: function (event) {
            if (event.button !== 0) { return; }
            if (this.linkHref && this.linkHref.startsWith('javascript:')) {
                eval(this.linkHref.substring(11));
                return;
            }
            if (this.confirmation && this.confirmation.length) { if (!window.confirm(this.confirmation)) { return; } }
            if (this.loadId && this.loadId.length > 0) {
                this.$root.loadContainer(this.loadId, this.linkHref);
            } else {
                if (event.ctrlKey || event.metaKey) {
                    window.open(this.linkHref, "_blank");
                } else {
                    console.log("setting url", this.linkHref);
                    this.$root.setUrl(this.linkHref);
                }
            }
        }
    },
    computed: { linkHref: function () { return this.$root.getLinkPath(this.href); } }
});
// NOTE: router-link simulates the Vue Router RouterLink component (somewhat, at least enough for Quasar to use with its various 'to' attributes on q-btn, etc)
// moqui.webrootVue.component('router-link', {
//     props: { to:{type:String,required:true} },
//     template: '<a :href="linkHref" @click.prevent="go"><slot></slot></a>',
//     methods: {
//         go: function(event) {
//             if (event.button !== 0) { return; }
//             if (event.ctrlKey || event.metaKey) {
//                 window.open(this.linkHref, "_blank");
//             } else {
//                 this.$root.setUrl(this.linkHref);
//             }
//         }
//     },
//     computed: {
//         linkHref: function () { return this.$root.getLinkPath(this.to); },
//         isActive: function () {
//             var path = this.to;
//             var questIdx = path.indexOf('?');
//             if (questIdx > 0) { path = path.slice(0, questIdx); }
//             var activePath = this.$root.currentPath;
//             console.warn("router-link path [" + path + "] active path [" + activePath + "]");
//             return (activePath.startsWith(path));
//         },
//         // TODO: this should be equals instead of startsWith()
//         isExactActive: function () { return this.isActive; }
//     }
// });

moqui.webrootVue.component('m-script', {
    props: { src: String, type: { type: String, 'default': 'text/javascript' } },
    template: '<div :type="type" style="display:none;"><slot></slot></div>',
    created: function () { if (this.src && this.src.length > 0) { moqui.loadScript(this.src); } },
    mounted: function () {
        var innerText = this.$el.innerText;
        if (innerText && innerText.trim().length > 0) {
            // console.info('running: ' + innerText);
            moqui.retryInlineScript(innerText, 1);
            /* these don't work on initial load (with script elements that have @src followed by inline script)
            // eval(innerText);
            var parent = this.$el.parentElement; var s = document.createElement('script');
            s.appendChild(document.createTextNode(this.$el.innerText)); parent.appendChild(s);
            */
        }
        // maybe better not to, nice to see in dom: $(this.$el).remove();
    }
});
moqui.webrootVue.component('m-stylesheet', {
    name: "mStylesheet",
    props: { href: { type: String, required: true }, rel: { type: String, 'default': 'stylesheet' }, type: { type: String, 'default': 'text/css' } },
    template: '<div :type="type" style="display:none;"></div>',
    created: function () { moqui.loadStylesheet(this.href, this.rel, this.type); }
});
moqui.webrootVue.component('m-container-row', {
    name: "mContainerRow",
    template: '<div class="row" v-bind="$attrs"><slot></slot></div>'
});
moqui.webrootVue.component('container-row', {
    name: "mContainerRow",
    template: '<div class="row" v-bind="$attrs"><slot></slot></div>'
});
var rowColComp = {
    name: "mRowCol",
    props: { cols: String, xs: String, sm: String, md: String, lg: String, xl: String },
    computed: {
        colClass: function () {
            var cls = "";
            if (this.cols) cls += " col-" + this.cols;
            if (this.xs) cls += " col-xs-" + this.xs;
            if (this.sm) cls += " col-sm-" + this.sm;
            if (this.md) cls += " col-md-" + this.md;
            if (this.lg) cls += " col-lg-" + this.lg;
            if (this.xl) cls += " col-xl-" + this.xl;
            return (cls || "col") + " " + (this.$attrs.class || "");
        }
    },
    template: '<div :class="colClass" :style="$attrs.style" v-bind="$attrs"><slot></slot></div>'
};
moqui.webrootVue.component('m-row-col', rowColComp);
moqui.webrootVue.component('row-col', rowColComp);
/* ========== layout components ========== */
moqui.webrootVue.component('m-container-box', {
    name: "mContainerBox",
    props: { type: { type: String, 'default': 'default' }, title: String, initialOpen: { type: Boolean, 'default': true } },
    data: function () { return { isBodyOpen: this.initialOpen } },
    // TODO: handle type better, have text color (use text- additional styles instead of Bootstrap to Quasar mapping), can collor the border too?
    template:
        '<q-card flat bordered class="q-ma-sm m-container-box">' +
        '<q-card-actions @click.self="toggleBody">' +
        '<h5 v-if="title && title.length" @click="toggleBody" :class="\'text-\' + type">{{title}}</h5>' +
        '<slot name="header"></slot>' +
        '<q-space></q-space>' +
        '<slot name="toolbar"></slot>' +
        '  <q-btn color="grey"  round flat dense :icon="isBodyOpen ? \'keyboard_arrow_up\' : \'keyboard_arrow_down\'" @click="toggleBody" ></q-btn>' +
        '</q-card-actions>' +
        '  <div v-show="isBodyOpen">' +
        '<q-card-section :class="{in:isBodyOpen}"><slot></slot></q-card-section>' +
        '  </div>' +
        '</q-card>',
    methods: { toggleBody: function () { this.isBodyOpen = !this.isBodyOpen; } }
});
moqui.webrootVue.component('m-box-body', {
    name: "mBoxBody",
    props: { height: String },
    data: function () { return this.height ? { dialogStyle: { 'max-height': this.height + 'px', 'overflow-y': 'auto' } } : { dialogStyle: {} } },
    template: '<div class="q-pa-xs" :style="dialogStyle"><slot></slot></div>'
});
moqui.webrootVue.component('m-dialog', {
    name: "mDialog",
    props: {
        draggable: { type: Boolean, 'default': true },
        modelValue: { type: Boolean, 'default': false },
        id: String, color: String, width: { type: String }, title: { type: String }
    },
    emits: ['update:modelValue', 'onShow', 'onHide'],
    computed: {
        internalValue: {
            get: function () { return this.modelValue; },
            set: function (val) {
                this.$emit('update:modelValue', val);
            }
        }
    },
    template:
        '<q-dialog v-model="internalValue" :id="id" @show="onShow" @hide="onHide" :maximized="$q.platform.is.mobile">' +
        '<q-card ref="dialogCard" flat bordered :style="{width:((width||760)+\'px\'),\'max-width\':($q.platform.is.mobile?\'100vw\':\'90vw\')}">' +
        '<q-card-actions ref="dialogHeader" :style="{cursor:(draggable?\'move\':\'default\')}">' +
        '<h5 class="q-pl-sm non-selectable">{{title}}</h5><q-space></q-space>' +
        '<q-btn icon="close" flat round dense v-close-popup></q-btn>' +
        '</q-card-actions><q-separator></q-separator>' +
        '<q-card-section ref="dialogBody"><slot></slot></q-card-section>' +
        '</q-card>' +
        '</q-dialog>',
    methods: {
        onShow: function () {
            if (this.draggable) { this.$refs.dialogHeader.$el.addEventListener("mousedown", this.onGrab); }
            this.focusFirst();
            this.$emit("onShow");
        },
        onHide: function () {
            if (this.draggable) {
                document.removeEventListener("mousemove", this.onDrag);
                document.removeEventListener("mouseup", this.onLetGo);
                this.$refs.dialogHeader && this.$refs.dialogHeader.$el.removeEventListener("mousedown", this.onGrab);
            }
            this.$emit("onHide");
        },
        onDrag: function (e) {
            var targetEl = this.$refs.dialogCard.$el;
            var originalStyles = window.getComputedStyle(targetEl);
            var newLeft = parseInt(originalStyles.left) + e.movementX;
            var newTop = parseInt(originalStyles.top) + e.movementY;

            var windowWidth = window.innerWidth / 2; var windowHeight = window.innerHeight / 2;
            var elWidth = targetEl.offsetWidth / 2; var elHeight = targetEl.offsetHeight / 2;
            var minLeft = -(windowWidth - elWidth - 10);
            var maxLeft = (windowWidth - elWidth - 10);
            var minTop = -(windowHeight - elHeight - 10);
            var maxTop = (windowHeight - elHeight - 10);
            if (newLeft < minLeft) { newLeft = minLeft; } else if (newLeft > maxLeft) { newLeft = maxLeft; }
            if (newTop < minTop) { newTop = minTop; } else if (newTop > maxTop) { newTop = maxTop; }

            targetEl.style.left = newLeft + "px";
            targetEl.style.top = newTop + "px";
        },
        onLetGo: function () {
            document.removeEventListener("mousemove", this.onDrag);
            document.removeEventListener("mouseup", this.onLetGo);
        },
        onGrab: function () {
            document.addEventListener("mousemove", this.onDrag);
            document.addEventListener("mouseup", this.onLetGo);
        },
        focusFirst: function () {
            var jqEl = $(this.$refs.dialogBody.$el);
            var defFocus = jqEl.find(".default-focus");
            if (defFocus.length) { defFocus.focus(); } else { jqEl.find("form :input:visible:not([type='submit']):first").focus(); }
        }
    }
});
moqui.webrootVue.component('m-container-dialog', {
    name: "mContainerDialog",
    props: {
        id: String, color: String, buttonText: String, buttonClass: String, title: String, width: { type: String },
        openDialog: { type: Boolean, 'default': false }, buttonIcon: { type: String, 'default': 'open_in_new' }
    },
    data: function () { return { isShown: false } },
    template:
        '<span>' +
        '<span @click="show()"><slot name="button"><q-btn dense outline no-caps :icon="buttonIcon" :label="buttonText" :color="color" :class="buttonClass"></q-btn></slot></span>' +
        '<m-dialog v-model="isShown" :id="id" :title="title" :color="color" :width="width"><slot></slot></m-dialog>' +
        '</span>',
    methods: { show: function () { this.isShown = true; }, hide: function () { this.isShown = false; } },
    mounted: function () { if (this.openDialog) { this.isShown = true; } }
});
moqui.webrootVue.component('m-dynamic-container', {
    name: "mDynamicContainer",
    props: { id: { type: String, required: true }, url: { type: String } },
    data: function () { return { curComponent: moqui.EmptyComponent, curUrl: "" } },
    template: '<component :is="curComponent" v-bind="$attrs"></component>',
    methods: {
        reload: function () { var saveUrl = this.curUrl; this.curUrl = ""; var vm = this; setTimeout(function () { vm.curUrl = saveUrl; }, 20); },
        load: function (url) { if (this.curUrl === url) { this.reload(); } else { this.curUrl = url; } }
    },
    watch: {
        curUrl: function (newUrl) {
            if (!newUrl || newUrl.length === 0) { this.curComponent = moqui.EmptyComponent; return; }
            var vm = this; moqui.loadComponent(newUrl, function (comp) { vm.curComponent = comp; }, this.id);
        }
    },
    mounted: function () { this.$root.addContainer(this.id, this); this.curUrl = this.url; }
});


var dynamicDialogComp = {
    name: "mDynamicDialog",
    props: {
        id: { type: String }, url: { type: String, required: false }, color: String, buttonText: String, buttonClass: String, icon: String, title: String, width: { type: String },
        openDialog: { type: Boolean, 'default': false }, dynamicParams: { type: Object, 'default': null }
    },
    data: function () { return { isShown: false, curUrl: "", curComponent: Vue.markRaw(moqui.EmptyComponent) } },
    template:
        '<span>' +
        '<q-btn unelevated :icon="icon || \'add\'" :label="buttonText || \'Start Meeting\'" :color="color || \'primary\'" :class="buttonClass" @click="handleOpen"></q-btn>' +
        '<m-dialog ref="dialog" v-model="isShown" :id="id" :title="title" :color="color || \'primary\'" :width="width"><component :is="curComponent" v-if="curUrl"></component></m-dialog>' +
        '</span>',
    methods: {
        handleOpen: function () {
            console.info("Dynamic Dialog button clicked: " + this.id + " url: " + this.url);
            this.isShown = true;
        },
        reload: function () { if (this.isShown) { this.isShown = false; this.isShown = true; } }, // TODO: needs delay? needed at all?
        load: function (url) { this.curUrl = url; },
        hide: function () { this.isShown = false; }
    },
    watch: {
        curUrl: function (newUrl) {
            if (!newUrl || newUrl.length === 0) { this.curComponent = moqui.EmptyComponent; return; }
            var vm = this;
            if (moqui.isPlainObject(this.dynamicParams)) {
                var dpStr = '';
                $.each(this.dynamicParams, function (key, value) {
                    var dynVal = $("#" + value).val();
                    if (dynVal && dynVal.length) dpStr = dpStr + (dpStr.length > 0 ? '&' : '') + key + '=' + dynVal;
                });
                if (dpStr.length) newUrl = newUrl + (newUrl.indexOf("?") > 0 ? '&' : '?') + dpStr;
            }
            moqui.loadComponent(newUrl, function (comp) {
                comp.mounted = function () { this.$nextTick(function () { vm.$refs.dialog.focusFirst(); }); };
                vm.curComponent = comp;
            }, this.id);
        },
        isShown: function (newShown) {
            if (newShown) {
                this.curUrl = this.url;
            } else {
                this.curUrl = "";
            }
        }
    },
    mounted: function () {
        console.info("m-dynamic-dialog mounted", this.id, "buttonText:", this.buttonText, "url:", this.url);
        this.$root.addContainer(this.id, this);
        if (this.openDialog) { this.isShown = true; }
    }
};
moqui.webrootVue.component('m-dynamic-dialog', dynamicDialogComp);
moqui.webrootVue.component('dynamic-dialog', dynamicDialogComp);
moqui.webrootVue.component('m-tree-top', {
    name: "mTreeTop",
    template: '<ul :id="id" class="tree-list"><m-tree-item v-for="model in itemList" :key="model.id" :model="model" :top="top"></m-tree-item></ul>',
    props: { id: { type: String, required: true }, items: { type: [String, Array], required: true }, openPath: String, parameters: Object },
    data: function () { return { urlItems: null, currentPath: null, top: this } },
    computed: {
        itemList: function () { if (this.urlItems) { return this.urlItems; } return moqui.isArray(this.items) ? this.items : []; }
    },
    methods: {},
    mounted: function () {
        if (moqui.isString(this.items)) {
            this.currentPath = this.openPath;
            var allParms = $.extend({ moquiSessionToken: this.$root.moquiSessionToken, treeNodeId: '#', treeOpenPath: this.openPath }, this.parameters);
            var vm = this; $.ajax({
                type: 'POST', dataType: 'json', url: this.items, headers: { Accept: 'application/json' }, data: allParms,
                error: moqui.handleAjaxError, success: function (resp) { vm.urlItems = resp; /*console.info('m-tree-top response ' + JSON.stringify(resp));*/ }
            });
        }
    }
});
moqui.webrootVue.component('m-tree-item', {
    name: "mTreeItem",
    template:
        '<li :id="model.id">' +
        '<i v-if="isFolder" @click="toggle" class="fa" :class="{\'fa-chevron-right\':!open, \'fa-chevron-down\':open}"></i>' +
        '<i v-else class="fa fa-square-o"></i>' +
        ' <span @click="setSelected">' +
        '<m-link v-if="model.a_attr" :href="model.a_attr.urlText" :load-id="model.a_attr.loadId" :class="{\'text-success\':selected}">{{model.text}}</m-link>' +
        '<span v-if="!model.a_attr" :class="{\'text-success\':selected}">{{model.text}}</span>' +
        '</span>' +
        '<ul v-show="open" v-if="hasChildren"><m-tree-item v-for="model in model.children" :key="model.id" :model="model" :top="top"></m-tree-item></ul></li>',
    props: { model: Object, top: Object },
    data: function () { return { open: false } },
    computed: {
        isFolder: function () {
            var children = this.model.children; if (!children) { return false; }
            if (moqui.isArray(children)) { return children.length > 0 } return true;
        },
        hasChildren: function () { var children = this.model.children; return moqui.isArray(children) && children.length > 0; },
        selected: function () { return this.top.currentPath === this.model.id; }
    },
    watch: {
        open: function (newVal) {
            if (newVal) {
                var children = this.model.children;
                var url = this.top.items;
                if (this.open && children && moqui.isBoolean(children) && moqui.isString(url)) {
                    var li_attr = this.model.li_attr;
                    var allParms = $.extend({
                        moquiSessionToken: this.$root.moquiSessionToken, treeNodeId: this.model.id,
                        treeNodeName: (li_attr && li_attr.treeNodeName ? li_attr.treeNodeName : ''), treeOpenPath: this.top.currentPath
                    }, this.top.parameters);
                    var vm = this; $.ajax({
                        type: 'POST', dataType: 'json', url: url, headers: { Accept: 'application/json' }, data: allParms,
                        error: moqui.handleAjaxError, success: function (resp) { vm.model.children = resp; }
                    });
                }
            }
        }
    },
    methods: {
        toggle: function () { if (this.isFolder) { this.open = !this.open; } },
        setSelected: function () { this.top.currentPath = this.model.id; this.open = true; }
    },
    mounted: function () { if (this.model.state && this.model.state.opened) { this.open = true; } }
});
/* ========== general field components ========== */
moqui.webrootVue.component('m-editable', {
    name: "mEditable",
    props: {
        id: { type: String, required: true }, labelType: { type: String, 'default': 'span' }, labelValue: { type: String, required: true },
        url: { type: String, required: true }, urlParameters: { type: Object, 'default': {} },
        parameterName: { type: String, 'default': 'value' }, widgetType: { type: String, 'default': 'textarea' },
        loadUrl: String, loadParameters: Object, indicator: { type: String, 'default': 'Saving' }, tooltip: { type: String, 'default': 'Click to edit' },
        cancel: { type: String, 'default': 'Cancel' }, submit: { type: String, 'default': 'Save' }
    },
    mounted: function () {
        var reqData = $.extend({ moquiSessionToken: this.$root.moquiSessionToken, parameterName: this.parameterName }, this.urlParameters);
        var edConfig = {
            indicator: this.indicator, tooltip: this.tooltip, cancel: this.cancel, submit: this.submit,
            name: this.parameterName, type: this.widgetType, cssclass: 'editable-form', submitdata: reqData
        };
        if (this.loadUrl && this.loadUrl.length > 0) {
            var vm = this; edConfig.loadurl = this.loadUrl; edConfig.loadtype = "POST";
            edConfig.loaddata = function (value) { return $.extend({ currentValue: value, moquiSessionToken: vm.$root.moquiSessionToken }, vm.loadParameters); };
        }
        // TODO, replace with something in quasar: $(this.$el).editable(this.url, edConfig);
    },
    render: function (createEl) { return createEl(this.labelType, { attrs: { id: this.id, 'class': 'editable-label' }, domProps: { innerHTML: this.labelValue } }); }
});

/* ========== form components ========== */

moqui.checkboxSetMixin = {
    // NOTE: checkboxCount is used to init the checkbox state array, defaults to 100 and must be greater than or equal to the actual number of checkboxes (not including the All checkbox)
    props: { checkboxCount: { type: Number, 'default': 100 }, checkboxParameter: String, checkboxListMode: Boolean, checkboxValues: Array },
    data: function () {
        var checkboxStates = [];
        for (var i = 0; i < this.checkboxCount; i++) checkboxStates[i] = false;
        return { checkboxAllState: false, checkboxStates: checkboxStates }
    },
    methods: {
        setCheckboxAllState: function (newState) {
            this.checkboxAllState = newState;
            var csSize = this.checkboxStates.length;
            for (var i = 0; i < csSize; i++) this.checkboxStates[i] = newState;
        },
        getCheckboxValueArray: function () {
            if (!this.checkboxValues) return [];
            var valueArray = [];
            var csSize = this.checkboxStates.length;
            for (var i = 0; i < csSize; i++) if (this.checkboxStates[i] && this.checkboxValues[i]) valueArray.push(this.checkboxValues[i]);
            return valueArray;
        },
        addCheckboxParameters: function (formData, parameter, listMode) {
            var parmName = parameter || this.checkboxParameter;
            var useList = (listMode !== null && listMode !== undefined && listMode) ? listMode : this.checkboxListMode;
            // NOTE: formData must be a FormData object, or at least have a set(name, value) method
            var valueArray = this.getCheckboxValueArray();
            if (!valueArray.length) return false;
            if (useList) {
                formData.set(parmName, valueArray.join(','));
            } else {
                for (var i = 0; i < valueArray.length; i++)
                    formData.set(parmName + '_' + i, valueArray[i]);
                formData.set('_isMulti', 'true');
            }
            return true;
        }
    },
    watch: {
        checkboxStates: {
            deep: true, handler: function (newArray) {
                var allTrue = true;
                for (var i = 0; i < newArray.length; i++) {
                    var curState = newArray[i];
                    if (!curState) allTrue = false;
                    if (!allTrue) break;
                }
                this.checkboxAllState = allTrue;
            }
        }
    }
}
moqui.webrootVue.component('m-checkbox-set', {
    name: "mCheckboxSet",
    mixins: [moqui.checkboxSetMixin],
    template: '<span class="checkbox-set"><slot :checkboxAllState="checkboxAllState" :setCheckboxAllState="setCheckboxAllState"' +
        ' :checkboxStates="checkboxStates" :addCheckboxParameters="addCheckboxParameters"></slot></span>'
});

moqui.webrootVue.component('m-form', {
    name: "mForm",
    mixins: [moqui.checkboxSetMixin],
    props: {
        fieldsInitial: Object, action: { type: String, required: true }, method: { type: String, 'default': 'POST' },
        submitMessage: String, submitReloadId: String, submitHideId: String, focusField: String, noValidate: Boolean,
        excludeEmptyFields: Boolean, parentCheckboxSet: Object
    },
    data: function () {
        return {
            fields: Object.assign({}, this.fieldsInitial),
            fieldsOriginal: Object.assign({}, this.fieldsInitial), buttonClicked: null
        }
    },
    // NOTE: <slot v-bind:fields="fields"> also requires prefix from caller, using <m-form v-slot:default="formProps"> in qvt.ftl macro
    // see https://vuejs.org/v2/guide/components-slots.html
    template:
        '<q-form ref="qForm" @submit.prevent="submitForm" @reset.prevent="resetForm" autocapitalize="off" autocomplete="off">' +
        '<slot :fields="fields" :checkboxAllState="checkboxAllState" :setCheckboxAllState="setCheckboxAllState"' +
        ' :checkboxStates="checkboxStates" :addCheckboxParameters="addCheckboxParameters"' +
        ' :blurSubmitForm="blurSubmitForm" :hasFieldsChanged="hasFieldsChanged" :fieldChanged="fieldChanged"></slot>' +
        '</q-form>',
    methods: {
        submitForm: function () {
            if (this.noValidate) {
                this.submitGo();
            } else {
                var jqEl = $(this.$el);
                var vm = this;
                this.$refs.qForm.validate().then(function (success) {
                    if (success) {
                        vm.submitGo();
                    } else {
                        /*
                        // For convenience, attempt to focus the first invalid element.
                        // Begin by finding the first invalid input
                        var invEle = jqEl.find('div.has-error input, div.has-error select, div.has-error textarea').first();
                        if (invEle.length) {
                            // TODO remove this or change to handle Quasar flavor of accordian/panel
                            // If the element is inside a collapsed panel, attempt to open it.
                            // Find parent (if it exists) with class .panel-collapse.collapse (works for accordion and regular panels)
                            var nearestPanel = invEle.parents('div.panel-collapse.collapse').last();
                            if (nearestPanel.length) {
                                // Only bother if the panel is not currently open
                                if (!nearestPanel.hasClass('in')) {
                                    // From there find sibling with class panel-heading
                                    var panelHeader = nearestPanel.prevAll('div.panel-heading').last();
                                    if (panelHeader.length) {
                                        // Here is where accordion and regular panels diverge.
                                        var panelLink = panelHeader.find('a[data-toggle="collapse"]').first();
                                        if (panelLink.length) panelLink.click();
                                        else panelHeader.click();
                                        setTimeout(function() { invEle.focus(); }, 250);
                                    } else invEle.focus();
                                } else invEle.focus();
                            } else invEle.focus();
                        }
                        */
                    }
                })
            }
        },
        resetForm: function () {
            this.fields = Object.assign({}, this.fieldsOriginal);
        },
        blurSubmitForm: function (event) {
            // add to vue template form fields, like in DefaultScreenMacros.qvt.ftl: @blur="formProps.blurSubmitForm($event)"
            // TODO MAYBE only send value for field changed (plus all hidden fields), where applicable will help with multi-user conflicts?
            // FUTURE: do more than just submit the form: support submit without reload screen and only reload form data
            if (this.hasFieldsChanged) {
                this.submitForm();
            }
            return true;
        },
        submitGo: function () {
            var vm = this;
            var jqEl = $(this.$el);
            // get button pressed value and disable ASAP to avoid double submit
            var btnName = null, btnValue = null;
            var $btn = $(this.buttonClicked || document.activeElement);
            if ($btn.length && jqEl.has($btn) && $btn.is('button[type="submit"], input[type="submit"], input[type="image"]')) {
                if ($btn.is('[name]')) { btnName = $btn.attr('name'); btnValue = $btn.val(); }
                $btn.prop('disabled', true);
                setTimeout(function () { $btn.prop('disabled', false); }, 3000);
            }
            var formData = Object.keys(this.fields).length ? new FormData() : new FormData(this.$refs.qForm.$el);
            $.each(this.fields, function (key, value) {
                if (moqui.isArray(value)) {
                    value.forEach(function (v) { formData.append(key, v); });
                } else { formData.set(key, value || ""); }
            });

            var fieldsToRemove = [];
            // NOTE: using iterator directly to avoid using 'for of' which requires more recent ES version (for minify, browser compatibility)
            var formDataIterator = formData.entries()[Symbol.iterator]();
            while (true) {
                var iterEntry = formDataIterator.next();
                if (iterEntry.done) break;
                var pair = iterEntry.value;
                var fieldName = pair[0];
                var fieldValue = pair[1];
                // NOTE: this shouldn't happen as when not getting from FormData q-input with mask should have null value when empty, but just in case skip String values that are unfilled masks
                // NOTE: with q-input mask place holder is underscore, look for 2; this will cause issues if a valid user input starts with 2 underscores, may need better approach here and in m-form-link
                if (moqui.isString(fieldValue) && fieldValue.startsWith("__")) {
                    // instead of delete set to empty string, otherwise can't clear masked fields: formData["delete"](fieldName);
                    formData.set(fieldName, "");
                }
                if (this.excludeEmptyFields && (!fieldValue || !fieldValue.length)) fieldsToRemove.push(fieldName);
            }
            for (var ftrIdx = 0; ftrIdx < fieldsToRemove.length; ftrIdx++) formData['delete'](fieldsToRemove[ftrIdx]);

            formData.set('moquiSessionToken', this.$root.moquiSessionToken);
            if (btnName) { formData.set(btnName, btnValue); }

            // add ID parameters for selected rows, add _isMulti=true
            if (this.parentCheckboxSet && this.parentCheckboxSet.addCheckboxParameters) {
                var addedParms = this.parentCheckboxSet.addCheckboxParameters(formData);
                // TODO: if no addedParms should this blow up or just wait for the server for a missing parameter?
                // maybe best to leave it to the server, some forms might make sense without any rows selected...
            }

            // console.info('m-form parameters ' + JSON.stringify(formData));
            // for (var key of formData.keys()) { console.log('m-form key ' + key + ' val ' + JSON.stringify(formData.get(key))); }
            this.$root.loading++;

            /* this didn't work, JS console error: Failed to execute 'createObjectURL' on 'URL': Overload resolution failed
            $.ajax({ type:this.method, url:(this.$root.appRootPath + this.action), data:formData, contentType:false, processData:false, dataType:'text',
                xhrFields:{responseType:'blob'}, headers:{Accept:'application/json'}, error:moqui.handleLoadError, success:this.handleResponse });
             */

            var xhr = new XMLHttpRequest();
            xhr.open(this.method, (this.$root.appRootPath + this.action), true);
            xhr.responseType = 'blob';
            xhr.withCredentials = true;
            xhr.onload = function () {
                if (this.status === 200) {
                    // decrement loading counter
                    vm.$root.loading--;

                    var disposition = xhr.getResponseHeader('Content-Disposition');
                    if (disposition && (disposition.indexOf('attachment') !== -1 || disposition.indexOf('inline') !== -1)) {
                        // download code here thanks to Jonathan Amend, see: https://stackoverflow.com/questions/16086162/handle-file-download-from-ajax-post/23797348#23797348
                        var blob = this.response;
                        var filename = "";
                        if (disposition && disposition.indexOf('attachment') !== -1) {
                            var filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                            var matches = filenameRegex.exec(disposition);
                            if (matches != null && matches[1]) filename = matches[1].replace(/['"]/g, '');
                        }

                        if (typeof window.navigator.msSaveBlob !== 'undefined') {
                            window.navigator.msSaveBlob(blob, filename);
                        } else {
                            var URL = window.URL || window.webkitURL;
                            var downloadUrl = URL.createObjectURL(blob);

                            if (filename) {
                                var a = document.createElement("a");
                                if (typeof a.download === 'undefined') {
                                    window.location.href = downloadUrl;
                                } else {
                                    a.href = downloadUrl;
                                    a.download = filename;
                                    document.body.appendChild(a);
                                    a.click();
                                }
                            } else {
                                window.location.href = downloadUrl;
                            }

                            setTimeout(function () { URL.revokeObjectURL(downloadUrl); }, 100); // cleanup
                        }
                    } else {
                        var reader = new FileReader();
                        reader.onload = function (evt) {
                            var bodyText = evt.target.result;
                            try {
                                vm.handleResponse(JSON.parse(bodyText));
                            } catch (e) {
                                vm.handleResponse(bodyText);
                            }

                        };
                        reader.readAsText(this.response);
                    }
                } else {
                    moqui.handleLoadError(this, this.statusText, "");
                }
            };
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.send(formData);
        },
        handleResponse: function (resp) {
            var notified = false;
            // console.info('m-form response ' + JSON.stringify(resp));
            if (resp && moqui.isPlainObject(resp)) {
                notified = moqui.notifyMessages(resp.messageInfos, resp.errors);
                if (resp.screenUrl && resp.screenUrl.length > 0) { this.$root.setUrl(resp.screenUrl); }
                else if (resp.redirectUrl && resp.redirectUrl.length > 0) { window.location.href = resp.redirectUrl; }
            } else { console.warn('m-form no response or non-JSON response: ' + JSON.stringify(resp)) }
            var hideId = this.submitHideId; if (hideId && hideId.length > 0) { this.$root.hideContainer(hideId); }
            var reloadId = this.submitReloadId; if (reloadId && reloadId.length > 0) { this.$root.reloadContainer(reloadId); }
            var subMsg = this.submitMessage;
            if (subMsg && subMsg.length) {
                var responseText = resp; // this is set for backward compatibility in case message relies on responseText as in old JS
                var message = eval('"' + subMsg + '"');
                Quasar.Notify.create($.extend({}, moqui.notifyOpts, { message: message }));
                moqui.webrootVue.addNotify(message, 'success');
            } else if (!notified) {
                Quasar.Notify.create($.extend({}, moqui.notifyOpts, { message: "Submit successful" }));
            }
        },
        fieldChanged: function (name) {
            var curValue = this.fields[name];
            var originalValue = this.fieldsOriginal[name];
            return moqui.isArray(curValue) ? !moqui.arraysEqual(curValue, originalValue, true) :
                !moqui.equalsOrPlaceholder(curValue, originalValue);
        }
    },
    computed: {
        hasFieldsChanged: function () {
            return moqui.fieldValuesDiff(this.fields, this.fieldsOriginal);
        }
    },
    mounted: function () {
        var vm = this;
        var jqEl = $(this.$el);
        if (this.focusField && this.focusField.length) jqEl.find('[name^="' + this.focusField + '"]').addClass('default-focus').focus();

        // TODO: find other way to get button clicked (Vue event?)
        // watch button clicked
        jqEl.find('button[type="submit"], input[type="submit"], input[type="image"]').on('click', function () { vm.buttonClicked = this; });
    }
});
moqui.webrootVue.component('m-form-link', {
    name: "mFormLink",
    props: { fieldsInitial: Object, action: { type: String, required: true }, focusField: String, noValidate: Boolean, bodyParameterNames: Array },
    data: function () { return { fields: Object.assign({}, this.fieldsInitial), fieldsOriginal: Object.assign({}, this.fieldsInitial) } },
    template:
        '<q-form ref="qForm" @submit.prevent="submitForm" @reset.prevent="resetForm" autocapitalize="off" autocomplete="off">' +
        '<slot :clearForm="clearForm" :fields="fields" :hasFieldsChanged="hasFieldsChanged" :fieldChanged="fieldChanged"></slot></q-form>',
    methods: {
        submitForm: function () {
            if (this.noValidate) {
                this.submitGo();
            } else {
                var vm = this;
                this.$refs.qForm.validate().then(function (success) {
                    if (success) {
                        vm.submitGo();
                    } else {
                        // oh no, user has filled in at least one invalid value
                    }
                })
            }
        },
        submitGo: function () {
            // get button pressed value and disable ASAP to avoid double submit
            var btnName = null, btnValue = null;
            var $btn = $(document.activeElement);
            if ($btn.length && $btn.is('button[type="submit"], input[type="submit"], input[type="image"]')) {
                if ($btn.is('[name]')) { btnName = $btn.attr('name'); btnValue = $btn.val(); }
                $btn.prop('disabled', true);
                setTimeout(function () { $btn.prop('disabled', false); }, 3000);
            }

            var formData = Object.keys(this.fields).length ? new FormData() : new FormData(this.$refs.qForm.$el);
            /*
            formData.forEach(function(value, key, parent) {
                console.warn("m-form-link submit FormData key " + key + " value " + value + " is mask placeholder " + (moqui.isString(value) && value.startsWith("__")));
            });
             */
            $.each(this.fields, function (key, value) {
                if (value) {
                    // NOTE: this shouldn't happen as when not getting from FormData q-input with mask should have null value when empty, but just in case skip String values that are unfilled masks
                    // NOTE: with q-input mask place holder is underscore, look for 2; this will cause issues if a valid user input starts with 2 underscores, may need better approach here and in m-form
                    // console.warn("m-form-link submit fields key " + key + " value " + value + " is mask placeholder " + (moqui.isString(value) && value.startsWith("__")));
                    if (moqui.isString(value) && value.startsWith("__")) return;
                    if (moqui.isArray(value)) {
                        value.forEach(function (v) { formData.append(key, v); });
                    } else { formData.set(key, value); }
                }
            });

            var extraList = [];
            var plainKeyList = [];
            var parmStr = "";
            var bodyParameters = null;
            // NOTE: using iterator directly to avoid using 'for of' which requires more recent ES version (for minify, browser compatibility)
            var formDataIterator = formData.entries()[Symbol.iterator]();
            while (true) {
                var iterEntry = formDataIterator.next();
                if (iterEntry.done) break;
                var pair = iterEntry.value;
                var key = pair[0];
                var value = pair[1];

                if (value.trim().length === 0 || key === "moquiSessionToken" || key === "moquiFormName" || key.indexOf('[]') > 0) continue;
                if (key.indexOf("_op") > 0 || key.indexOf("_not") > 0 || key.indexOf("_ic") > 0) {
                    extraList.push({ name: key, value: value });
                } else {
                    plainKeyList.push(key);
                    if (this.bodyParameterNames && this.bodyParameterNames.indexOf(key) >= 0) {
                        if (!bodyParameters) bodyParameters = {};
                        bodyParameters[key] = value;
                    } else {
                        if (parmStr.length > 0) { parmStr += '&'; }
                        parmStr += (encodeURIComponent(key) + '=' + encodeURIComponent(value));
                    }
                }
            }
            for (var ei = 0; ei < extraList.length; ei++) {
                var eparm = extraList[ei];
                var keyName = eparm.name.substring(0, eparm.name.indexOf('_'));
                if (plainKeyList.indexOf(keyName) >= 0) {
                    if (parmStr.length > 0) { parmStr += '&'; }
                    parmStr += (encodeURIComponent(eparm.name) + '=' + encodeURIComponent(eparm.value));
                }
            }
            if (btnName && btnValue && btnValue.trim().length) {
                if (parmStr.length > 0) { parmStr += '&'; }
                parmStr += (encodeURIComponent(btnName) + '=' + encodeURIComponent(btnValue));
            }
            var url = this.action;
            if (url.indexOf('?') > 0) { url = url + '&' + parmStr; } else { url = url + '?' + parmStr; }
            // console.log("form-link url " + url + " bodyParameters " + JSON.stringify(bodyParameters));
            this.$root.setUrl(url, bodyParameters);

        },
        resetForm: function () {
            this.fields = Object.assign({}, this.fieldsInitial);
        },
        clearForm: function () {
            // TODO: probably need to iterate over object and clear each value
            this.fields = {};
        },
        fieldChanged: function (name) {
            var curValue = this.fields[name];
            var originalValue = this.fieldsOriginal[name];
            return moqui.isArray(curValue) ? !moqui.arraysEqual(curValue, originalValue, true) :
                !moqui.equalsOrPlaceholder(curValue, originalValue);
        }
    },
    computed: {
        hasFieldsChanged: function () {
            return moqui.fieldValuesDiff(this.fields, this.fieldsOriginal);
        }
    },
    mounted: function () {
        var jqEl = $(this.$el);
        /* TODO if (!this.noValidate) jqEl.validate({ errorClass: 'help-block', errorElement: 'span',
            highlight: function(element, errorClass, validClass) { $(element).parents('.form-group').removeClass('has-success').addClass('has-error'); },
            unhighlight: function(element, errorClass, validClass) { $(element).parents('.form-group').removeClass('has-error').addClass('has-success'); }
        });*/
        // TODO jqEl.find('[data-toggle="tooltip"]').tooltip({placement:'auto top'});
        if (this.focusField && this.focusField.length > 0) jqEl.find('[name=' + this.focusField + ']').addClass('default-focus').focus();
    }
});

moqui.webrootVue.component('m-form-paginate', {
    name: "mFormPaginate",
    props: { paginate: Object, formList: Object },
    template:
        '<div v-if="paginate &amp;&amp; paginate.count > 1" class="q-pagination row no-wrap items-center">' +
        '<template v-if="paginate.pageIndex > 0">' +
        '<q-btn dense flat no-caps @click.prevent="setIndex(0)" icon="skip_previous"></q-btn>' +
        '<q-btn dense flat no-caps @click.prevent="setIndex(paginate.pageIndex-1)" icon="fast_rewind"></q-btn></template>' +
        '<template v-else><q-btn dense flat no-caps disabled icon="skip_previous"></q-btn><q-btn dense flat no-caps disabled icon="fast_rewind"></q-btn></template>' +
        '<q-btn v-for="prevIndex in prevArray" :key="prevIndex" dense flat no-caps @click.prevent="setIndex(prevIndex)" :label="prevIndex+1" color="primary"></q-btn>' +
        '<q-btn dense flat no-caps disabled>{{paginate.pageIndex+1}} / {{paginate.pageMaxIndex+1}} ({{paginate.pageRangeLow}}-{{paginate.pageRangeHigh}} / {{paginate.count}})</q-btn>' +
        '<q-btn v-for="nextIndex in nextArray" :key="nextIndex" dense flat no-caps @click.prevent="setIndex(nextIndex)" :label="nextIndex+1" color="primary"></q-btn>' +
        '<template v-if="paginate.pageIndex < paginate.pageMaxIndex">' +
        '<q-btn dense flat no-caps @click.prevent="setIndex(paginate.pageIndex+1)" icon="fast_forward"></q-btn>' +
        '<q-btn dense flat no-caps @click.prevent="setIndex(paginate.pageMaxIndex)" icon="skip_next"></q-btn></template>' +
        '<template v-else><q-btn dense flat no-caps disabled icon="fast_forward"></q-btn><q-btn dense flat no-caps disabled icon="skip_next"></q-btn></template>' +
        '</div>',
    computed: {
        prevArray: function () {
            var pag = this.paginate; var arr = []; if (!pag || pag.pageIndex < 1) return arr;
            var pageIndex = pag.pageIndex; var indexMin = pageIndex - 3; if (indexMin < 0) { indexMin = 0; } var indexMax = pageIndex - 1;
            while (indexMin <= indexMax) { arr.push(indexMin++); } return arr;
        },
        nextArray: function () {
            var pag = this.paginate; var arr = []; if (!pag || pag.pageIndex >= pag.pageMaxIndex) return arr;
            var pageIndex = pag.pageIndex; var pageMaxIndex = pag.pageMaxIndex;
            var indexMin = pageIndex + 1; var indexMax = pageIndex + 3; if (indexMax > pageMaxIndex) { indexMax = pageMaxIndex; }
            while (indexMin <= indexMax) { arr.push(indexMin++); } return arr;
        }
    },
    methods: {
        setIndex: function (newIndex) {
            if (this.formList) { this.formList.setPageIndex(newIndex); } else { this.$root.setParameters({ pageIndex: newIndex }); }
        }
    }
});
moqui.webrootVue.component('m-form-go-page', {
    name: "mFormGoPage",
    props: { idVal: { type: String, required: true }, maxIndex: Number, formList: Object },
    data: function () { return { pageIndex: "" } },
    template:
        '<q-form v-if="!formList || (formList.paginate && formList.paginate.pageMaxIndex > 4)" @submit.prevent="goPage">' +
        '<q-input dense v-model="pageIndex" type="text" size="4" name="pageIndex" placeholder="Page #"' +
        '   :rules="[val => /^\\d*$/.test(val) || \'digits only\', val => ((formList && +val <= formList.paginate.pageMaxIndex) || (maxIndex && +val < maxIndex)) || \'higher than max\']">' +
        '<template v-slot:append><q-btn dense flat no-caps type="submit" icon="redo" @click="goPage"></q-btn></template>' +
        '</q-input>' +
        '</q-form>',
    methods: {
        goPage: function () {
            var formList = this.formList;
            var newIndex = +this.pageIndex - 1;
            if (formList) { formList.setPageIndex(newIndex); } else { this.$root.setParameters({ pageIndex: newIndex }); }
            var vm = this;
            this.$nextTick(function () { vm.pageIndex = ""; });
        }
    }
});
moqui.webrootVue.component('m-form-column-config', {
    name: "mFormColumnConfig",
    // column entry Object fields: id, label, children[]
    props: { id: String, action: String, columnsInitial: { type: Array, required: true }, formLocation: { type: String, required: true }, findParameters: Object },
    data: function () { return { columns: moqui.deepCopy(this.columnsInitial) } },
    template:
        '<m-form ref="mForm" :id="id" :action="action">' +
        '<q-list v-for="(column, columnIdx) in columns" :key="column.id" bordered dense>' +
        '<q-item-label header>{{column.label}}</q-item-label>' +
        '<q-item v-for="(field, fieldIdx) in column.children" :key="field.id">' +
        '<q-item-section side v-if="columnIdx !== 0">' +
        '<q-btn dense flat icon="cancel" @click="hideField(columnIdx, fieldIdx)"><q-tooltip>Hide</q-tooltip></q-btn>' +
        '</q-item-section>' +
        '<q-item-section><q-item-label>{{field.label}}</q-item-label></q-item-section>' +
        '<q-item-section v-if="columnIdx === 0" side>' +
        '<q-btn-dropdown dense outline no-caps label="Display"><q-list dense>' +
        '<q-item v-for="(toColumn, toColumnIdx) in columns.slice(1)" :key="toColumn.id" clickable>' +
        '<q-item-section @click="moveToCol(columnIdx, fieldIdx, toColumnIdx+1)">{{toColumn.label}}</q-item-section></q-item>' +
        '<q-item clickable>' +
        '<q-item-section @click="moveToCol(columnIdx, fieldIdx, columns.length+1)">New Column</q-item-section></q-item>' +
        '</q-list></q-btn-dropdown>' +
        '</q-item-section>' +
        '<q-item-section v-else side><q-btn-group flat>' +
        '<q-btn :disabled="columnIdx <= 1" dense flat icon="north" @click="moveToCol(columnIdx, fieldIdx, columnIdx-1)"></q-btn>' +
        '<q-btn :disabled="fieldIdx === 0" dense flat icon="expand_less" @click="moveInCol(columnIdx, fieldIdx, fieldIdx-1)"></q-btn>' +
        '<q-btn :disabled="(fieldIdx + 1) === column.children.length" dense flat icon="expand_more" @click="moveInCol(columnIdx, fieldIdx, fieldIdx+1)"></q-btn>' +
        '<q-btn dense flat icon="south" @click="moveToCol(columnIdx, fieldIdx, columnIdx+1)"></q-btn>' +
        '</q-btn-group></q-item-section>' +
        '</q-item>' +
        '</q-list>' +
        '<div class="q-my-md">' +
        '<q-btn dense outline no-caps @click.prevent="saveColumns()" label="Save Changes"></q-btn>' +
        '<q-btn dense outline no-caps @click.prevent="resetColumns()" label="Undo Changes"></q-btn>' +
        '<q-btn dense outline no-caps @click.prevent="resetToDefault()" label="Reset to Default"></q-btn>' +
        '</div>' +
        '</m-form>',
    methods: {
        moveInCol: function (columnIdx, fieldIdx, newFieldIdx) {
            var children = this.columns[columnIdx].children;
            var fieldObj = children.splice(fieldIdx, 1)[0];
            children.splice(newFieldIdx, 0, fieldObj);
        },
        moveToCol: function (columnIdx, fieldIdx, newColumnIdx) {
            var columnObj = this.columns[columnIdx];
            var newColumnObj = newColumnIdx >= this.columns.length ? this.addColumn() : this.columns[newColumnIdx];
            var fieldObj = columnObj.children.splice(fieldIdx, 1)[0];
            newColumnObj.children.push(fieldObj);
        },
        addColumn: function () {
            var oldLength = this.columns.length;
            var lastCol = this.columns[oldLength - 1];
            var newId = lastCol.id.split("_")[0] + "_" + oldLength;
            var newLabel = lastCol.label.split(" ")[0] + " " + oldLength;
            // NOTE: push and get so reactive
            this.columns.push({ id: newId, label: newLabel, children: [] });
            return this.columns[oldLength];
        },
        hideField: function (columnIdx, fieldIdx) {
            if (columnIdx === 0) return;
            var hiddenObj = this.columns[0];
            var columnObj = this.columns[columnIdx];
            var fieldObj = columnObj.children.splice(fieldIdx, 1)[0];
            hiddenObj.children.push(fieldObj);
        },
        resetColumns: function () { this.columns = moqui.deepCopy(this.columnsInitial); },
        saveColumns: function () {
            this.generalFormFields();
            var fields = this.$refs.mForm.fields;
            fields.SaveColumns = "SaveColumns";
            fields.columnsTree = JSON.stringify(this.columns);
            this.$refs.mForm.submitGo();
        },
        resetToDefault: function () {
            this.generalFormFields();
            this.$refs.mForm.fields.ResetColumns = "ResetColumns";
            this.$refs.mForm.submitGo();
        },
        generalFormFields: function () {
            var fields = this.$refs.mForm.fields;
            fields.formLocation = this.formLocation;
            if (this.findParameters) {
                var findParmKeys = Object.keys(this.findParameters);
                for (var keyIdx = 0; keyIdx < findParmKeys.length; keyIdx++) {
                    var curKey = findParmKeys[keyIdx];
                    fields[curKey] = this.findParameters[curKey];
                }
            }
            console.log("Save column config " + this.formLocation + " Window Width " + window.innerWidth + " Quasar Platform: " + JSON.stringify(Quasar.Platform.is));
            if (window.innerWidth <= 600 || Quasar.Platform.is.mobile) fields._uiType = 'mobile';
        }
    }
});

// m-form-query macro implementation
moqui.webrootVue.component('m-form-query', {
    name: "mFormQuery",
    props: {
        id: { type: String, required: false },
        formEventString: { type: String, default: "" },
        searchObj: { type: Object, default: () => ({}) }
    },
    provide: function () {
        return {
            formQueryState: this.searchState
        }
    },
    data: function () {
        return {
            searchState: Object.assign({}, this.searchObj),
            loading: false
        }
    },
    template:
        '<q-card flat bordered class="q-mb-md q-pa-sm">' +
        '  <q-form ref="qForm" @submit.prevent="submitQuery" @reset.prevent="resetQuery">' +
        '    <div class="row q-col-gutter-sm">' +
        '      <slot :searchState="searchState" :loading="loading"></slot>' +
        '      <div class="col-12 flex items-center q-mt-sm">' +
        '        <q-btn type="submit" color="primary" label="Search" class="q-mr-sm" :loading="loading" />' +
        '        <q-btn type="reset" color="secondary" label="Clear" outline :disable="loading" />' +
        '      </div>' +
        '    </div>' +
        '  </q-form>' +
        '</q-card>',
    methods: {
        submitQuery: function () {
            // Update routing parameters with current form state
            var newParams = {};
            for (var key in this.searchState) {
                if (this.searchState[key] !== null && this.searchState[key] !== undefined && this.searchState[key] !== '') {
                    newParams[key] = this.searchState[key];
                }
            }

            // Execute custom event logic if provided in the blueprint
            if (this.formEventString) {
                try {
                    var formEventFn = new Function('searchState', 'moqui', this.formEventString);
                    formEventFn.call(this, this.searchState, moqui);
                } catch (e) {
                    console.error("Error executing form-query event logic: ", e);
                }
            }

            // Always update root parameters to trigger m-form-list reload
            this.$root.setParameters(newParams);
        },
        resetQuery: function () {
            this.searchState = {};
            this.submitQuery();
            this.$emit('reset');
        }
    },
    watch: {
        searchObj: {
            deep: true,
            handler: function (newVal) {
                this.searchState = Object.assign({}, newVal);
            }
        }
    }
});

moqui.webrootVue.component('m-form-query-field', {
    name: "mFormQueryField",
    inject: ['formQueryState'],
    props: {
        name: { type: String, required: true },
        label: { type: String, default: "" },
        type: { type: String, default: "text" },
        operator: { type: String, default: "" },
        options: { type: Array, default: () => [] },
        optionsUrl: String,
        optionsParameters: Object,
        optionsLoadInit: { type: Boolean, default: false }
    },
    created: function () {
        if (this.operator && this.formQueryState && !this.formQueryState[this.name + '_op']) {
            this.formQueryState[this.name + '_op'] = this.operator;
        }
    },
    template:
        '<div class="col-6 q-pb-sm q-pr-md" style="min-width: 200px;">' +
        '  <q-input v-if="type === \'text\'" v-model="formQueryState[name]" :name="name" :label="label" dense outlined clearable>' +
        '    <template v-slot:append>' +
        '      <q-btn flat round dense :icon="formQueryState[name + \'_op\'] === \'begins\' ? \'start\' : \'search\'" @click="toggleOp" size="sm" color="grey-7">' +
        '        <q-tooltip>Search: {{ formQueryState[name + \'_op\'] === \'begins\' ? \'Starts With\' : \'Contains\' }}</q-tooltip>' +
        '      </q-btn>' +
        '    </template>' +
        '  </q-input>' +
        '  <m-date-time v-else-if="type === \'date\' || type === \'date-time\'" :model-value="formQueryState[name]" @update:model-value="formQueryState[name] = $event" :name="name" :label="label" :type="type" dense outlined />' +
        '  <m-drop-down v-else-if="type === \'drop-down\'" :model-value="formQueryState[name]" @update:model-value="formQueryState[name] = $event" :name="name" :label="label" :options="options" :options-url="optionsUrl" :options-parameters="optionsParameters" :options-load-init="optionsLoadInit" allow-empty dense outlined />' +
        '  <q-input v-else v-model="formQueryState[name]" :name="name" :label="label" dense outlined clearable />' +
        '</div>',
    methods: {
        toggleOp: function () {
            var current = this.formQueryState[this.name + '_op'];
            this.formQueryState[this.name + '_op'] = (current === 'begins' ? 'contains' : 'begins');
            // If we have text and changed op, we might want to trigger search, but maybe better to let user click Search button
        }
    }
});

// TODO: m-form-list still needs a LOT of work, full re-implementation of form-list FTL macros for full client rendering so that component is fully static and data driven
moqui.webrootVue.component('m-form-list', {
    name: "mFormList",
    // rows can be a full path to a REST service or transition, a plain form name on the current screen, or a JS Array with the actual rows
    props: {
        name: { type: String, required: true }, id: String, rows: { type: [String, Array], required: true }, search: { type: Object },
        action: String, multi: Boolean, skipForm: Boolean, skipHeader: Boolean, headerForm: Boolean, headerDialog: Boolean,
        savedFinds: Boolean, selectColumns: Boolean, allButton: Boolean, csvButton: Boolean, textButton: Boolean, pdfButton: Boolean,
        columns: [String, Number]
    },
    data: function () { return { rowList: [], paginate: null, searchObj: null, moqui: moqui } },
    // slots (props): headerForm (search), header (search), nav (), rowForm (fields), row (fields)
    // TODO: QuickSavedFind drop-down
    // TODO: change find options form to update searchObj and run fetchRows instead of changing main page and reloading
    // TODO: update window url on paginate and other searchObj update?
    // TODO: review for actual static (no server side rendering, cachable)
    template:
        '<div>' +
        '<template v-if="!multi && !skipForm">' +
        '<m-form v-for="(fields, rowIndex) in rowList" :key="rowIndex" :name="idVal+\'_\'+rowIndex" :id="idVal+\'_\'+rowIndex" :action="action">' +
        '<slot name="rowForm" :fields="fields"></slot></m-form></template>' +
        '<m-form v-if="multi && !skipForm" :name="idVal" :id="idVal" :action="action">' +
        '<input type="hidden" name="moquiFormName" :value="name"><input type="hidden" name="_isMulti" value="true">' +
        '<template v-for="(fields, rowIndex) in rowList" :key="rowIndex"><slot name="rowForm" :fields="fields"></slot></template></m-form>' +
        '<m-form-link v-if="!skipHeader && headerForm && !headerDialog" :name="idVal+\'_header\'" :id="idVal+\'_header\'" :action="$root.currentLinkPath">' +
        '<input v-if="searchObj && searchObj.orderByField" type="hidden" name="orderByField" :value="searchObj.orderByField">' +
        '<slot name="headerForm" :search="searchObj"></slot></m-form-link>' +
        '<div class="q-table__container q-table__card q-table--horizontal-separator q-table--dense q-table--flat"><table class="q-table" :id="idVal+\'_table\'"><thead>' +
        '<tr class="form-list-nav-row"><th :colspan="columns?columns:\'100\'"><q-bar>' +
        '<button v-if="savedFinds || headerDialog" :id="idVal+\'_hdialog_button\'" type="button" data-toggle="modal" :data-target="\'#\'+idVal+\'_hdialog\'" data-original-title="Find Options" data-placement="bottom" class="btn btn-default"><i class="fa fa-share"></i> Find Options</button>' +
        '<button v-if="selectColumns" :id="idVal+\'_SelColsDialog_button\'" type="button" data-toggle="modal" :data-target="\'#\'+idVal+\'_SelColsDialog\'" data-original-title="Columns" data-placement="bottom" class="btn btn-default"><i class="fa fa-share"></i> Columns</button>' +
        '<m-form-paginate :paginate="paginate" :form-list="this"></m-form-paginate>' +
        '<m-form-go-page :id-val="idVal" :form-list="this"></m-form-go-page>' +
        '<a v-if="csvButton" :href="csvUrl" class="btn btn-default">CSV</a>' +
        '<button v-if="textButton" :id="idVal+\'_TextDialog_button\'" type="button" data-toggle="modal" :data-target="\'#\'+idVal+\'_TextDialog\'" data-original-title="Text" data-placement="bottom" class="btn btn-default"><i class="fa fa-share"></i> Text</button>' +
        '<button v-if="pdfButton" :id="idVal+\'_PdfDialog_button\'" type="button" data-toggle="modal" :data-target="\'#\'+idVal+\'_PdfDialog\'" data-original-title="PDF" data-placement="bottom" class="btn btn-default"><i class="fa fa-share"></i> PDF</button>' +
        '<slot name="nav"></slot>' +
        '</q-bar></th></tr>' +
        '<slot name="header" :search="searchObj"></slot>' +
        '</thead><tbody><tr v-for="(fields, rowIndex) in rowList" :key="rowIndex"><slot name="row" :fields="fields" :row-index="rowIndex" :moqui="moqui"></slot></tr>' +
        '</tbody></table></div>' +
        '</div>',
    computed: {
        idVal: function () { if (this.id && this.id.length > 0) { return this.id; } else { return this.name; } },
        csvUrl: function () {
            return this.$root.currentPath + '?' + moqui.objToSearch($.extend({}, this.searchObj,
                { renderMode: 'csv', pageNoLimit: 'true', lastStandalone: 'true', saveFilename: (this.name + '.csv') }));
        }
    },
    methods: {
        fetchRows: function () {
            if (moqui.isArray(this.rows)) { console.warn('Tried to fetch form-list-body rows but rows prop is an array'); return; }
            var vm = this;
            var searchObj = this.search; if (!searchObj) { searchObj = this.$root.currentParameters; }
            var url = this.rows; if (url.indexOf('/') === -1) { url = this.$root.currentPath + '/actions/' + url; }
            console.info("Fetching rows with url " + url + " searchObj " + JSON.stringify(searchObj));
            $.ajax({
                type: "GET", url: url, data: searchObj, dataType: "json", headers: { Accept: 'application/json' },
                error: moqui.handleAjaxError, success: function (list, status, jqXHR) {
                    if (list && moqui.isArray(list)) {
                        var getHeader = jqXHR.getResponseHeader;
                        var count = Number(getHeader("X-Total-Count"));
                        if (count && !isNaN(count)) {
                            vm.paginate = {
                                count: Number(count), pageIndex: Number(getHeader("X-Page-Index")),
                                pageSize: Number(getHeader("X-Page-Size")), pageMaxIndex: Number(getHeader("X-Page-Max-Index")),
                                pageRangeLow: Number(getHeader("X-Page-Range-Low")), pageRangeHigh: Number(getHeader("X-Page-Range-High"))
                            };
                        }
                        vm.rowList = list;
                        console.info("Fetched " + list.length + " rows, paginate: " + JSON.stringify(vm.paginate));
                    }
                }
            });
        },
        setPageIndex: function (newIndex) {
            if (!this.searchObj) { this.searchObj = { pageIndex: newIndex } } else { this.searchObj.pageIndex = newIndex; }
            this.fetchRows();
        }
    },
    watch: {
        rows: function (newRows) { if (moqui.isArray(newRows)) { this.rowList = newRows; } else { this.fetchRows(); } },
        search: function () { this.fetchRows(); }
    },
    mounted: function () {
        if (this.search) { this.searchObj = this.search; } else { this.searchObj = this.$root.currentParameters; }
        if (moqui.isArray(this.rows)) { this.rowList = this.rows; } else { this.fetchRows(); }
    }
});

/* ========== form field widget components ========== */
moqui.webrootVue.component('m-date-time', {
    name: "mDateTime",
    props: {
        id: String, name: { type: String, required: true }, modelValue: String, type: { type: String, 'default': 'date-time' }, label: String,
        size: String, format: String, tooltip: String, form: String, required: String, rules: Array, disable: Boolean, autoYear: String,
        minuteStep: { type: Number, 'default': 5 }, bgColor: String
    },
    template:
        '<q-input dense outlined stack-label :label="label" :model-value="modelValue" @update:model-value="$emit(\'update:modelValue\', $event)" @focus="focusDate" @blur="blurDate" :rules="rules"' +
        ' :mask="inputMask" fill-mask :id="id" :name="name" :form="form" :disable="disable" :size="sizeVal"' +
        ' style="max-width:max-content;" :bg-color="bgColor">' +
        '<template v-slot:prepend v-if="type==\'date\' || type==\'date-time\' || !type">' +
        '<q-icon name="event" class="cursor-pointer">' +
        '<q-popup-proxy ref="qDateProxy" transition-show="scale" transition-hide="scale">' +
        '<q-date :model-value="dateModel" @update:model-value="val => { dateModel = val; $refs.qDateProxy.hide(); } " :mask="formatVal"></q-date>' +
        '</q-popup-proxy>' +
        '</q-icon>' +
        '</template>' +
        '<template v-slot:append v-if="type==\'time\' || type==\'date-time\' || !type">' +
        '<q-icon name="access_time" class="cursor-pointer">' +
        '<q-popup-proxy ref="qTimeProxy" transition-show="scale" transition-hide="scale">' +
        '<q-time :model-value="dateModel" @update:model-value="val => { dateModel = val; $refs.qTimeProxy.hide(); }" :mask="formatVal" format24h></q-time>' +
        '</q-popup-proxy>' +
        '</q-icon>' +
        '</template>' +
        '<template v-slot:after><slot name="after"></slot></template>' +
        '</q-input>',
    // TODO: how to add before slot pass through without the small left margin when nothing in the slot? <template v-slot:before><slot name="before"></slot></template>
    // TODO handle required (:required="required == 'required' ? true : false")
    methods: {
        focusDate: function (event) {
            if (this.type === 'time' || this.autoYear === 'false') return;
            var curVal = this.modelValue;
            if (!curVal || !curVal.length) {
                var startYear = (this.autoYear && this.autoYear.match(/^[12]\d\d\d$/)) ? this.autoYear : new Date().getFullYear()
                this.$emit('update:modelValue', startYear);
            }
        },
        blurDate: function (event) {
            if (this.type === 'time') return;
            var curVal = this.modelValue;
            // console.log("date/time unfocus val " + curVal);
            // if contains 'd ' (month/day missing, or month specified but date missing or partial) clear input
            // Sufficient to check for just 'd', since the mask handles any scenario where there would only be a single 'd'
            if (curVal.indexOf('d') > 0) { this.$emit('update:modelValue', ''); return; }
            // default time to noon, or minutes to 00
            if (curVal.indexOf('hh:mm') > 0) { this.$emit('update:modelValue', curVal.replace('hh:mm', '12:00')); return; }
            if (curVal.indexOf(':mm') > 0) { this.$emit('update:modelValue', curVal.replace(':mm', ':00')); return; }
        }
    },
    computed: {
        dateModel: {
            get: function () { return this.modelValue || null; },
            set: function (val) { this.$emit('update:modelValue', val); }
        },
        formatVal: function () {
            var format = this.format; if (format && format.length) { return format; }
            return this.type === 'time' ? 'HH:mm' : (this.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm');
        },
        inputMask: function () { var formatMask = this.formatVal; return formatMask.replace(/\w/g, '#') },
        extraFormatsVal: function () {
            return this.type === 'time' ? ['LT', 'LTS', 'HH:mm'] :
                (this.type === 'date' ? ['l', 'L', 'YYYY-MM-DD'] : ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD HH:mm:ss', 'MM/DD/YYYY HH:mm']);
        },
        sizeVal: function () {
            var size = this.size; if (size && size.length) { return size; }
            return this.type === 'time' ? '9' : (this.type === 'date' ? '10' : '16');
        },
        timePattern: function () { return '^(?:(?:([01]?\\d|2[0-3]):)?([0-5]?\\d):)?([0-5]?\\d)$'; }
    },
    mounted: function () {
        var vm = this;
        var value = this.modelValue;
        var format = this.formatVal;
        var jqEl = $(this.$el);
        /* TODO
        if (this.type === "time") {
            jqEl.datetimepicker({toolbarPlacement:'top', debug:false, showClose:true, showClear:true, showTodayButton:true, useStrict:true,
                defaultDate:(value && value.length ? moment(value,this.formatVal) : null), format:format,
                extraFormats:this.extraFormatsVal, stepping:this.minuteStep, locale:this.$root.locale,
                keyBinds: {up: function () { if(this.date()) this.date(this.date().clone().add(1, 'H')); },
                           down: function () { if(this.date()) this.date(this.date().clone().subtract(1, 'H')); },
                           'control up': null, 'control down': null,
                           'shift up': function () { if(this.date()) this.date(this.date().clone().add(this.stepping(), 'm')); },
                           'shift down': function () { if(this.date()) this.date(this.date().clone().subtract(this.stepping(), 'm')); }}});
            jqEl.on("dp.change", function() { jqEl.val(jqEl.find("input").first().val()); jqEl.trigger("change"); vm.$emit('update:modelValue', this.value); })
 
            jqEl.val(jqEl.find("input").first().val());
 
            // TODO if (this.tooltip && this.tooltip.length) jqEl.tooltip({ title: this.tooltip, placement: "auto" });
        } else {
            jqEl.datetimepicker({toolbarPlacement:'top', debug:false, showClose:true, showClear:true, showTodayButton:true, useStrict:true,
                defaultDate:(value && value.length ? moment(value,this.formatVal) : null), format:format,
                extraFormats:this.extraFormatsVal, stepping:this.minuteStep, locale:this.$root.locale,
                keyBinds: {up: function () { if(this.date()) this.date(this.date().clone().add(1, 'd')); },
                           down: function () { if(this.date()) this.date(this.date().clone().subtract(1, 'd')); },
                           'alt up': function () { if(this.date()) this.date(this.date().clone().add(1, 'M')); },
                           'alt down': function () { if(this.date()) this.date(this.date().clone().subtract(1, 'M')); },
                           'control up': null, 'control down': null,
                           'shift up': function () { if(this.date()) this.date(this.date().clone().add(1, 'y')); },
                           'shift down': function () { if(this.date()) this.date(this.date().clone().subtract(1, 'y')); } }});
            jqEl.on("dp.change", function() { jqEl.val(jqEl.find("input").first().val()); jqEl.trigger("change"); vm.$emit('update:modelValue', this.value); })
 
            jqEl.val(jqEl.find("input").first().val());
 
            // TODO if (this.tooltip && this.tooltip.length) jqEl.tooltip({ title: this.tooltip, placement: "auto" });
        }
        */
        // TODO if (format === "YYYY-MM-DD") { jqEl.find('input').inputmask("yyyy-mm-dd", { clearIncomplete:false, clearMaskOnLostFocus:true, showMaskOnFocus:true, showMaskOnHover:false, removeMaskOnSubmit:false }); }
        // TODO if (format === "YYYY-MM-DD HH:mm") { jqEl.find('input').inputmask("yyyy-mm-dd hh:mm", { clearIncomplete:false, clearMaskOnLostFocus:true, showMaskOnFocus:true, showMaskOnHover:false, removeMaskOnSubmit:false }); }
    }
});

moqui.dateOffsets = [{ value: '0', label: 'This' }, { value: '-1', label: 'Last' }, { value: '1', label: 'Next' },
{ value: '-2', label: '-2' }, { value: '2', label: '+2' }, { value: '-3', label: '-3' }, { value: '-4', label: '-4' }, { value: '-6', label: '-6' }, { value: '-12', label: '-12' }];
moqui.datePeriods = [{ value: 'day', label: 'Day' }, { value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' }, { value: 'week', label: 'Week' }, { value: 'weeks', label: 'Weeks' },
{ value: 'month', label: 'Month' }, { value: 'months', label: 'Months' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }, { value: '7r', label: '+/-7d' }, { value: '30r', label: '+/-30d' }];
moqui.emptyOpt = { value: '', label: '' };
moqui.webrootVue.component('m-date-period', {
    name: "mDatePeriod",
    props: {
        fields: { type: Object, required: true }, name: { type: String, required: true }, id: String,
        allowEmpty: Boolean, fromThruType: { type: String, 'default': 'date' }, form: String, tooltip: String, label: String
    },
    data: function () {
        return {
            fromThruMode: false, dateOffsets: moqui.dateOffsets.slice(),
            datePeriods: moqui.datePeriods.slice(), fieldsOriginal: Object.assign({}, this.fields)
        }
    },
    template:
        '<div v-if="fromThruMode" class="row">' +
        '<m-date-time :name="name+\'_from\'" :id="id+\'_from\'" :label="label+\' From\'" :form="form" :type="fromThruType"' +
        ' :model-value="fields[name+\'_from\']" @update:model-value="fields[name+\'_from\'] = $event" :bg-color="fieldChanged(name+\'_from\')?\'blue-1\':\'\'"></m-date-time>' +
        '<q-icon class="q-my-auto" name="remove"></q-icon>' +
        '<m-date-time :name="name+\'_thru\'" :id="id+\'_thru\'" :label="label+\' Thru\'" :form="form" :type="fromThruType"' +
        ' :model-value="fields[name+\'_thru\']" @update:model-value="fields[name+\'_thru\'] = $event" :bg-color="fieldChanged(name+\'_thru\')?\'blue-1\':\'\'">' +
        '<template v-slot:after>' +
        '<q-btn dense flat icon="calendar_view_day" @click="toggleMode"><q-tooltip>Period Select Mode</q-tooltip></q-btn>' +
        '<q-btn dense flat icon="clear" @click="clearAll"><q-tooltip>Clear</q-tooltip></q-btn>' +
        '</template>' +
        '</m-date-time>' +
        '</div>' +
        '<div v-else class="row"><q-input dense outlined stack-label :label="label" v-model="fields[name+\'_pdate\']"' +
        ' mask="####-##-##" fill-mask :id="id" :name="name+\'_pdate\'" :form="form" style="max-width:max-content;"' +
        ' :bg-color="fieldChanged(name+\'_pdate\')?\'blue-1\':\'\'">' +
        '<q-tooltip v-if="tooltip">{{tooltip}}</q-tooltip>' +
        '<template v-slot:before>' +
        '<q-select class="q-pr-xs" dense outlined options-dense emit-value map-options v-model="fields[name+\'_poffset\']"' +
        ' :name="name+\'_poffset\'" :bg-color="fieldChanged(name+\'_poffset\')?\'blue-1\':\'\'"' +
        ' stack-label label="Offset" :options="dateOffsets" :form="form" behavior="menu"></q-select>' +
        '<q-select dense outlined options-dense emit-value map-options v-model="fields[name+\'_period\']"' +
        ' :name="name+\'_period\'" :bg-color="fieldChanged(name+\'_period\')?\'blue-1\':\'\'"' +
        ' stack-label label="Period" :options="datePeriods" :form="form" behavior="menu"></q-select>' +
        '</template>' +
        '<template v-slot:prepend>' +
        '<q-icon name="event" class="cursor-pointer">' +
        '<q-popup-proxy ref="qDateProxy" transition-show="scale" transition-hide="scale">' +
        '<q-date v-model="fields[name+\'_pdate\']" mask="YYYY-MM-DD" @update:model-value="function(){$refs.qDateProxy.hide()}"></q-date>' +
        '</q-popup-proxy>' +
        '</q-icon>' +
        '</template>' +
        '<template v-slot:after>' +
        '<q-btn dense flat icon="date_range" @click="toggleMode"><q-tooltip>Date Range Mode</q-tooltip></q-btn>' +
        '<q-btn dense flat icon="clear" @click="clearAll"><q-tooltip>Clear</q-tooltip></q-btn>' +
        '</template>' +
        '</q-input></div>',
    methods: {
        toggleMode: function () { this.fromThruMode = !this.fromThruMode; },
        clearAll: function () {
            this.fields[this.name + '_pdate'] = null; this.fields[this.name + '_poffset'] = null; this.fields[this.name + '_period'] = null;
            this.fields[this.name + '_from'] = null; this.fields[this.name + '_thru'] = null;
        },
        fieldChanged: function (name) {
            return !moqui.equalsOrPlaceholder(this.fields[name], this.fieldsOriginal[name]);
        }
    },
    mounted: function () {
        var fromDate = this.fields[this.name + '_from'];
        var thruDate = this.fields[this.name + '_thru'];
        if (((fromDate && fromDate.length) || (thruDate && thruDate.length))) this.fromThruMode = true;
    }
});

moqui.webrootVue.component('m-display', {
    name: "mDisplay",
    props: {
        modelValue: String, display: String, valueUrl: String, valueParameters: Object, dependsOn: Object, dependsOptional: Boolean, valueLoadInit: Boolean,
        fields: { type: Object }, tooltip: String, label: String, labelWrapper: Boolean, name: String, id: String
    },
    data: function () { return { curDisplay: this.display, loading: false } },
    template:
        '<q-input v-if="labelWrapper" dense outlined readonly stack-label autogrow :model-value="displayValue" :label="label" :id="id" :name="name" :loading="loading">' +
        '<q-tooltip v-if="tooltip">{{tooltip}}</q-tooltip>' +
        '</q-input>' +
        '<span v-else :id="id">' +
        '<q-tooltip v-if="tooltip">{{tooltip}}</q-tooltip><slot></slot>' +
        '{{displayValue}}' +
        '</span>',
    methods: {
        serverData: function (params) {
            var hasAllParms = true;
            var dependsOnMap = this.dependsOn;
            var parmMap = this.valueParameters;
            var reqData = { moquiSessionToken: this.$root.moquiSessionToken };
            for (var parmName in parmMap) { if (parmMap.hasOwnProperty(parmName)) reqData[parmName] = parmMap[parmName]; }
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    var doValue;
                    if (this.fields) {
                        doValue = this.fields[dependsOnMap[doParm]];
                    } else {
                        var doParmJqEl = $('#' + dependsOnMap[doParm]);
                        doValue = doParmJqEl.val();
                        if (!doValue) doValue = doParmJqEl.find('select').val();
                    }
                    if (!doValue) { hasAllParms = false; } else { reqData[doParm] = doValue; }
                }
            }
            reqData.hasAllParms = hasAllParms;
            return reqData;
        },
        populateFromUrl: function (params) {
            var reqData = this.serverData(params);
            // console.log("m-display populateFromUrl 1 " + this.valueUrl + " reqData.hasAllParms " + reqData.hasAllParms + " dependsOptional " + this.dependsOptional);
            // console.log(reqData);
            if (!this.valueUrl || !this.valueUrl.length) {
                console.warn("In m-display for " + this.name + " tried to populateFromUrl but no valueUrl");
                return;
            }
            if (!reqData.hasAllParms && !this.dependsOptional) {
                console.warn("In m-display for " + this.name + "  tried to populateFromUrl but not hasAllParms and not dependsOptional");
                this.$emit('update:modelValue', null);
                this.curDisplay = null;
                return;
            }
            var vm = this;
            this.loading = true;
            $.ajax({
                type: "POST", url: this.valueUrl, data: reqData, dataType: "text", headers: { Accept: 'text/plain' },
                error: function (jqXHR, textStatus, errorThrown) {
                    vm.loading = false;
                    moqui.handleAjaxError(jqXHR, textStatus, errorThrown);
                },
                success: function (defaultText) {
                    vm.loading = false;

                    var newLabel = '', newValue = '';
                    try {
                        var response = JSON.parse(defaultText);
                        if ($.isArray(response) && response.length) { response = response[0]; }
                        else if ($.isPlainObject(response) && response.hasOwnProperty('options') && response.options.length) { response = response.options[0]; }
                        if (response.hasOwnProperty('label')) { newLabel = response.label; }
                        if (response.hasOwnProperty('value')) { newValue = response.value; }
                    } catch (e) { }
                    if (!newLabel || !newLabel.length) newLabel = defaultText;
                    if (!newValue || !newValue.length) newValue = defaultText;

                    if (moqui.isNumber(newValue)) { newValue = newValue.toString(); }

                    vm.$emit('update:modelValue', newValue);
                    if (vm.fields && vm.fields.length && vm.name && vm.name.length) { vm.fields[vm.name + "_display"] = newLabel; }
                    vm.curDisplay = newLabel;
                }
            });
        }
    },
    computed: {
        displayValue: function () { return this.curDisplay && this.curDisplay.length ? this.curDisplay : this.modelValue; }
    },
    mounted: function () {
        if (this.valueUrl && this.valueUrl.length) {
            var dependsOnMap = this.dependsOn;
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    if (this.fields) {
                        this.$watch('fields.' + doParm, function () { this.populateFromUrl({ term: this.modelValue }); });
                    } else {
                        // TODO: if no fields passed, use some sort of DOM-based value like jQuery val()?
                    }
                }
            }
            // do initial populate if not a serverSearch or for serverSearch if we have an initial value do the search so we don't display the ID
            if (this.valueLoadInit) { this.populateFromUrl(); }
        }
    }
});

moqui.webrootVue.component('m-drop-down', {
    name: "mDropDown",
    props: {
        modelValue: [Array, String], options: { type: Array, 'default': function () { return []; } }, combo: Boolean,
        allowEmpty: Boolean, multiple: Boolean, requiredManualSelect: Boolean, submitOnSelect: Boolean,
        optionsUrl: String, optionsParameters: Object, optionsLoadInit: Boolean,
        serverSearch: Boolean, serverDelay: { type: Number, 'default': 300 }, serverMinLength: { type: Number, 'default': 1 },
        labelField: { type: String, 'default': 'label' }, valueField: { type: String, 'default': 'value' },
        dependsOn: Object, dependsOptional: Boolean, form: String, fields: { type: Object },
        tooltip: String, label: String, name: String, id: String, disable: Boolean, bgColor: String, onSelectGoTo: String
    },
    data: function () { return { curOptions: this.options, allOptions: this.options, lastVal: null, lastSearch: null, loading: false } },
    template:
        // was: ':fill-input="!multiple" hide-selected' changed to ':hide-selected="multiple"' to show selected to the left of input,
        //     fixes issues with fill-input where set values would sometimes not be displayed
        '<q-select ref="qSelect" :model-value="modelValue" @update:model-value="handleInput($event)"' +
        ' dense outlined options-dense use-input :hide-selected="multiple" :name="name" :id="id" :form="form"' +
        ' input-debounce="500" @filter="filterFn" :clearable="allowEmpty||multiple" :disable="disable"' +
        ' :multiple="multiple" :emit-value="!onSelectGoTo" map-options behavior="menu"' +
        ' :rules="[val => allowEmpty||multiple||val===\'\'||(val&&val.length)||\'Please select an option\']"' +
        ' stack-label :label="label" :loading="loading" :bg-color="bgColor" :options="curOptions">' +
        '<q-tooltip v-if="tooltip">{{tooltip}}</q-tooltip>' +
        '<template v-slot:no-option><q-item><q-item-section class="text-grey">No results</q-item-section></q-item></template>' +
        '<template v-if="multiple" v-slot:prepend><div>' +
        '<q-chip v-for="valueEntry in modelValue" :key="valueEntry" dense size="md" class="q-my-xs" removable @remove="removeValue(valueEntry)">{{optionLabel(valueEntry)}}</q-chip>' +
        '</div></template>' +
        '<template v-slot:append><slot name="append"></slot></template>' +
        '<template v-slot:after>' +
        '<slot name="after"></slot>' +
        '</template>' +
        '</q-select>',
    // TODO: how to add before slot pass through without the small left margin when nothing in the slot? <template v-slot:before><slot name="before"></slot></template>
    methods: {
        handleInput: function ($event) {
            // console.warn(this.onSelectGoTo + ": " + JSON.stringify($event));
            if (this.onSelectGoTo && this.onSelectGoTo.length) {
                if ($event[this.onSelectGoTo]) this.$root.setUrl($event[this.onSelectGoTo]);
            } else {
                this.$emit('update:modelValue', $event);
            }
            if (this.submitOnSelect) {
                var vm = this;
                // this doesn't work, even alternative of custom-event with event handler in DefaultScreenMacros.qvt.ftl in the drop-down macro that explicitly calls the q-form submit() method: vm.$nextTick(function() { console.log("emitting submit"); vm.$emit('submit'); });
                // doesn't work, q-form submit() method blows up without an even, in spite of what docs say: vm.$nextTick(function() { console.log("calling parent submit"); console.log(vm.$parent); vm.$parent.submit(); });
                // doesn't work, q-form submit() doesn't like this event for whatever reason, method missing on it: vm.$nextTick(function() { console.log("calling parent submit with event"); console.log(vm.$parent); vm.$parent.submit($event); });

                // TODO: find a better approach, perhaps pass down a reference to m-form or something so can refer to it more explicitly and handle Vue components in between
                // TODO: if found a better approach change the removeValue method below
                // this assumes the grandparent is m-form, if not it will blow up... alternatives are tricky
                vm.$nextTick(function () { vm.$parent.$parent.submitForm(); });
            }
        },
        filterFn: function (search, doneFn, abortFn) {
            if (this.serverSearch) {
                if ((this.lastSearch === search) || (this.serverMinLength && ((search ? search.length : 0) < this.serverMinLength))) {
                    doneFn();
                } else {
                    this.lastSearch = search;
                    this.populateFromUrl({ term: search }, doneFn, abortFn);
                }
            } else if (this.allOptions && this.allOptions.length) {
                var vm = this;
                if (search && search.length) {
                    doneFn(function () {
                        var needle = search.toLowerCase();
                        vm.curOptions = vm.allOptions.filter(function (v) {
                            return v.label && v.label.toLowerCase().indexOf(needle) > -1;
                        });
                    });
                } else {
                    if ((vm.curOptions ? vm.curOptions.length : 0) === (vm.allOptions ? vm.allOptions.length : 0)) {
                        doneFn();
                    } else {
                        doneFn(function () { vm.curOptions = vm.allOptions; });
                    }
                }
            } else if (this.optionsUrl && this.optionsUrl.length) {
                // no current options, get from server
                this.populateFromUrl({}, doneFn, abortFn);
            } else {
                console.error("m-drop-down " + this.name + " has no options and no options-url");
                abortFn();
            }
        },
        processOptionList: function (list, page, term) {
            var newData = [];
            var labelField = this.labelField;
            var valueField = this.valueField;
            $.each(list, function (idx, curObj) {
                var valueVal = curObj[valueField];
                var labelVal = curObj[labelField];
                newData.push(Object.assign(curObj, { value: valueVal || labelVal, label: labelVal || valueVal }));
            });
            return newData;
        },
        serverData: function (params) {
            var hasAllParms = true;
            var dependsOnMap = this.dependsOn;
            var parmMap = this.optionsParameters;
            var reqData = { moquiSessionToken: this.$root.moquiSessionToken };
            for (var parmName in parmMap) { if (parmMap.hasOwnProperty(parmName)) reqData[parmName] = parmMap[parmName]; }
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    var doValue;
                    if (this.fields) {
                        doValue = this.fields[dependsOnMap[doParm]];
                    } else {
                        var doParmJqEl = $('#' + dependsOnMap[doParm]);
                        doValue = doParmJqEl.val();
                        if (!doValue) doValue = doParmJqEl.find('select').val();
                    }
                    if (!doValue) { hasAllParms = false; } else { reqData[doParm] = doValue; }
                }
            }
            if (params) { reqData.term = params.term || ''; reqData.pageIndex = (params.page || 1) - 1; }
            else if (this.serverSearch) { reqData.term = ''; reqData.pageIndex = 0; }
            reqData.hasAllParms = hasAllParms;

            // AMB Trace: Diagnosing missing options list
            // console.log('m-drop-down serverData resolved parameters for', this.optionsUrl, reqData);
            return reqData;
        },
        processResponse: function (data, params) {
            if (moqui.isArray(data)) {
                return { results: this.processOptionList(data, null, params.term) };
            } else {
                params.page = params.page || 1; // NOTE: 1 based index, is 0 based on server side
                var pageSize = data.pageSize || 20;
                return {
                    results: this.processOptionList(data.options, params.page, params.term),
                    pagination: { more: (data.count ? (params.page * pageSize) < data.count : false) }
                };
            }
        },
        populateFromUrl: function (params, doneFn, abortFn) {
            var reqData = this.serverData(params);
            console.log("m-drop-down populateFromUrl: name=" + this.name + ", optionsUrl=" + this.optionsUrl + ", reqData=", reqData);
            if (!this.optionsUrl || !this.optionsUrl.length) {
                console.warn("In m-drop-down tried to populateFromUrl but no optionsUrl");
                if (abortFn) abortFn();
                return;
            }
            if (!reqData.hasAllParms && !this.dependsOptional) {
                console.warn("In m-drop-down tried to populateFromUrl but not hasAllParms and not dependsOptional");
                this.curOptions = [];
                this.allOptions = [];
                if (abortFn) abortFn();
                return;
            }
            var vm = this;
            this.loading = true;
            $.ajax({
                type: "POST", url: this.optionsUrl, data: reqData, dataType: "json", headers: { Accept: 'application/json' },
                error: function (jqXHR, textStatus, errorThrown) {
                    vm.loading = false;
                    console.error("m-drop-down " + vm.name + " AJAX error: " + textStatus, errorThrown);
                    moqui.handleAjaxError(jqXHR, textStatus, errorThrown);
                    if (abortFn) abortFn();
                },
                success: function (data) {
                    vm.loading = false;
                    console.log("m-drop-down " + vm.name + " AJAX success, data=", data);
                    var list = moqui.isArray(data) ? data : data.options;
                    var procList = vm.processOptionList(list, null, (params ? params.term : null));
                    if (list) {
                        if (doneFn) {
                            doneFn(function () {
                                vm.setNewOptions(procList);
                            });
                        } else {
                            vm.setNewOptions(procList);
                            if (vm.$refs.qSelect) vm.$refs.qSelect.refresh();
                        }
                    }
                }
            });
        },
        setNewOptions: function (options) {
            this.curOptions = options;
            if (this.multiple && this.allOptions && this.allOptions.length && this.modelValue && this.modelValue.length && moqui.isArray(this.modelValue)) {
                // for multiple retain current value(s) in allOptions, at end of Array, so that in most cases already selected values are retained
                var newAllOptions = options.slice();
                for (var vi = 0; vi < this.modelValue.length; vi++) {
                    var curValue = this.modelValue[vi];
                    for (var oi = 0; oi < this.allOptions.length; oi++) {
                        var curOption = this.allOptions[oi];
                        if (curValue === curOption.value) newAllOptions.push(curOption);
                    }
                }
                this.allOptions = newAllOptions;
            } else {
                this.allOptions = options;
                this.checkCurrentValue(this.allOptions);
            }
        },
        checkCurrentValue: function (options) {
            // if cur value not in new options either clear it or set it to the new first option in list if !allowEmpty
            var isInNewOptions = false;
            var valIsArray = moqui.isArray(this.modelValue);
            if (this.modelValue && this.modelValue.length && options) for (var i = 0; i < options.length; i++) {
                var curObj = options[i];
                // console.warn("option val " + curObj.value + " cur value " + JSON.stringify(this.modelValue) + " valIsArray " + valIsArray + " is in value " + (valIsArray ? this.modelValue.includes(curObj.value) : curObj.value === this.modelValue));
                if (valIsArray ? this.modelValue.includes(curObj.value) : curObj.value === this.modelValue) {
                    isInNewOptions = true;
                    break;
                }
            }

            // console.warn("curOptions updated " + this.name + " allowEmpty " + this.allowEmpty + " modelValue '" + this.modelValue + "' " + " isInNewOptions " + isInNewOptions + ": " + JSON.stringify(options));
            if (!isInNewOptions) {
                if (!this.allowEmpty && !this.multiple && options && options.length && options[0].value && (!this.requiredManualSelect || (!this.submitOnSelect && options.length === 1))) {
                    // simulate normal select behavior with no empty option (not allowEmpty) where first value is selected by default
                    // console.warn("checkCurrentValue setting " + this.name + " to " + options[0].value + " options " + options.length);
                    this.$emit('update:modelValue', options[0].value);
                } else {
                    // console.warn("setting " + this.name + " to null");
                    this.$emit('update:modelValue', null);
                }
            }
        },
        optionLabel: function (value) {
            var options = this.allOptions;
            if (!options || !options.length) return "";
            for (var i = 0; i < options.length; i++) {
                var curOption = options[i];
                if (value === curOption.value) return curOption.label;
            }
            return "";
        },
        removeValue: function (value) {
            var curValueArr = this.modelValue;
            if (!moqui.isArray(curValueArr)) { console.warn("Tried to remove value from m-drop-down multiple " + this.name + " but value is not an Array"); return; }
            var newValueArr = [];
            for (var i = 0; i < curValueArr.length; i++) {
                var valueEntry = curValueArr[i];
                if (valueEntry !== value) newValueArr.push(valueEntry);
            }
            if (curValueArr.length !== newValueArr.length) this.$emit('update:modelValue', newValueArr);
            // copied from handleInput method above
            if (this.submitOnSelect) {
                var vm = this;
                // this doesn't work, even alternative of custom-event with event handler in DefaultScreenMacros.qvt.ftl in the drop-down macro that explicitly calls the q-form submit() method: vm.$nextTick(function() { console.log("emitting submit"); vm.$emit('submit'); });
                // doesn't work, q-form submit() method blows up without an even, in spite of what docs say: vm.$nextTick(function() { console.log("calling parent submit"); console.log(vm.$parent); vm.$parent.submit(); });
                // doesn't work, q-form submit() doesn't like this event for whatever reason, method missing on it: vm.$nextTick(function() { console.log("calling parent submit with event"); console.log(vm.$parent); vm.$parent.submit($event); });

                // TODO: find a better approach, perhaps pass down a reference to m-form or something so can refer to it more explicitly and handle Vue components in between
                // TODO: if found a better approach change the handleInput method above
                // this assumes the grandparent is m-form, if not it will blow up... alternatives are tricky
                vm.$nextTick(function () { vm.$parent.$parent.submitForm(); });
            }
        },
        clearAll: function () { this.$emit('update:modelValue', null); }
    },
    mounted: function () {
        // TODO: handle combo somehow: if (this.combo) { opts.tags = true; opts.tokenSeparators = [',',' ']; }

        if (this.serverSearch) {
            if (!this.optionsUrl) console.error("m-drop-down in form " + this.form + " has no options-url but has server-search=true");
        }
        if (this.optionsUrl && this.optionsUrl.length) {
            var dependsOnMap = this.dependsOn;
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    if (this.fields) {
                        var vm = this;
                        this.$watch('fields.' + dependsOnMap[doParm], function () {
                            // in the case of dependency change clear current value
                            vm.$emit('update:modelValue', null);
                            vm.populateFromUrl({ term: vm.lastSearch });
                        });
                    } else {
                        // TODO: if no fields passed, use some sort of DOM-based value like jQuery val()?
                    }
                }
            }
            // do initial populate if not a serverSearch or for serverSearch if we have an initial value do the search so we don't display the ID
            console.log("m-drop-down mounted: name=" + this.name + ", optionsLoadInit=" + this.optionsLoadInit + ", optionsUrl=" + this.optionsUrl + ", serverSearch=" + this.serverSearch);
            if (this.optionsLoadInit) {
                console.log("m-drop-down " + this.name + " calling populateFromUrl with optionsUrl=" + this.optionsUrl);
                if (!this.serverSearch) { this.populateFromUrl(); }
                else if (this.modelValue && this.modelValue.length && moqui.isString(this.modelValue)) { this.populateFromUrl({ term: this.modelValue }); }
            }
        }
        // simulate normal select behavior with no empty option (not allowEmpty) where first value is selected by default - but only do for 1 option to force user to think and choose from multiple
        if (!this.multiple && !this.allowEmpty && (!this.modelValue || !this.modelValue.length) && this.options && this.options.length && (!this.requiredManualSelect || (!this.submitOnSelect && options.length === 1))) {
            this.$emit('update:modelValue', this.options[0].value);
        }
    }
    /* probably don't need, remove sometime:
    watch: {
        // need to watch for change to options prop? options: function(options) { this.curOptions = options; },
        curOptionsFoo: function(options) {
            // save the lastVal if there is one to remember what was selected even if new options don't have it, just in case options change again
            if (this.value && this.value.length) this.lastVal = this.value;
 
        }
    }
     */
});

moqui.webrootVue.component('m-text-line', {
    name: "mTextLine",
    props: {
        modelValue: String, type: { type: String, 'default': 'text' }, id: String, name: String, size: String, fields: { type: Object },
        dense: Boolean, outlined: Boolean, bgColor: String,
        label: String, tooltip: String, prefix: String, disable: Boolean, mask: String, fillMask: String, reverseFillMask: Boolean, rules: Array,
        defaultUrl: String, defaultParameters: Object, dependsOn: Object, dependsOptional: Boolean, defaultLoadInit: Boolean
    },
    data: function () { return { loading: false } },
    template:
        '<q-input :dense="dense" :outlined="outlined" :bg-color="bgColor" stack-label :label="label" :prefix="prefix"' +
        ' :model-value="modelValue" @update:model-value="$emit(\'update:modelValue\', $event)" :type="type"' +
        ' :id="id" :name="name" :size="size" :loading="loading" :rules="rules" :disable="disable"' +
        ' :mask="mask" :fill-mask="fillMask" :reverse-fill-mask="reverseFillMask"' +
        ' autocapitalize="off" autocomplete="off">' +
        '<q-tooltip v-if="tooltip">{{tooltip}}</q-tooltip>' +
        '</q-input>',
    methods: {
        serverData: function () {
            var hasAllParms = true;
            var dependsOnMap = this.dependsOn;
            var parmMap = this.defaultParameters;
            var reqData = { moquiSessionToken: this.$root.moquiSessionToken };
            for (var parmName in parmMap) { if (parmMap.hasOwnProperty(parmName)) reqData[parmName] = parmMap[parmName]; }
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    var doValue;
                    if (this.fields) {
                        doValue = this.fields[dependsOnMap[doParm]];
                    } else {
                        var doParmJqEl = $('#' + dependsOnMap[doParm]);
                        doValue = doParmJqEl.val();
                        if (!doValue) doValue = doParmJqEl.find('select').val();
                    }
                    if (!doValue) { hasAllParms = false; } else { reqData[doParm] = doValue; }
                }
            }
            reqData.hasAllParms = hasAllParms;
            return reqData;
        },
        populateFromUrl: function (params) {
            var reqData = this.serverData(params);
            // console.log("m-text-line populateFromUrl 1 " + this.defaultUrl + " reqData.hasAllParms " + reqData.hasAllParms + " dependsOptional " + this.dependsOptional);
            // console.log(reqData);
            if (!this.defaultUrl || !this.defaultUrl.length) {
                console.warn("In m-text-line tried to populateFromUrl but no defaultUrl");
                return;
            }
            if (!reqData.hasAllParms && !this.dependsOptional) {
                console.warn("In m-text-line tried to populateFromUrl but not hasAllParms and not dependsOptional");
                return;
            }
            var vm = this;
            this.loading = true;
            $.ajax({
                type: "POST", url: this.defaultUrl, data: reqData, dataType: "text",
                error: function (jqXHR, textStatus, errorThrown) {
                    vm.loading = false;
                    moqui.handleAjaxError(jqXHR, textStatus, errorThrown);
                },
                success: function (defaultText) {
                    vm.loading = false;
                    if (defaultText && defaultText.length) vm.$emit('update:modelValue', defaultText);
                }
            });
        }
    },
    mounted: function () {
        if (this.defaultUrl && this.defaultUrl.length) {
            var dependsOnMap = this.dependsOn;
            for (var doParm in dependsOnMap) {
                if (dependsOnMap.hasOwnProperty(doParm)) {
                    if (this.fields) {
                        this.$watch('fields.' + doParm, function () { this.populateFromUrl({ term: this.modelValue }); });
                    } else {
                        // TODO: if no fields passed, use some sort of DOM-based value like jQuery val()?
                    }
                }
            }
            // do initial populate if not a serverSearch or for serverSearch if we have an initial value do the search so we don't display the ID
            if (this.defaultLoadInit) { this.populateFromUrl(); }
        }
    }
});

/* Lazy loading Chart JS wrapper component */
moqui.webrootVue.component('m-chart', {
    name: 'mChart',
    props: { config: { type: Object, required: true }, height: { type: String, 'default': '400px' }, width: { type: String, 'default': '100%' } },
    template: '<div class="chart-container" style="position:relative;" :style="{height:height,width:width}"><canvas ref="canvas"></canvas></div>',
    data: function () { return { instance: null } },
    mounted: function () {
        var vm = this;
        moqui.loadScript('https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.3/Chart.min.js', function (err) {
            if (err) {
                console.error("Error loading m-chart script: " + err);
                return;
            }
            vm.instance = new Chart(vm.$refs.canvas, vm.config);
        }, function () { return !!window.Chart; });
    },
    watch: {
        config: function (val) {
            if (this.instance) {
                // console.info("updating m-chart")
                if (val.type) this.instance.type = val.type;
                if (val.labels) this.instance.labels = val.labels;
                if (val.data) this.instance.data = val.data;
                if (val.options) this.instance.options = val.options;
                this.instance.update();
            }
        }
    }
});
/* Lazy loading Mermaid JS wrapper component; for config options see https://mermaid.js.org/config/usage.html */
moqui.webrootVue.component('m-mermaid', {
    name: 'mMermaid',
    props: {
        config: { type: Object, 'default': function () { return { startOnLoad: true, securityLevel: 'loose' } } },
        height: { type: String, 'default': '400px' }, width: { type: String, 'default': '100%' }
    },
    template: '<pre ref="mermaid" class="mermaid" :style="{height:height,width:width}"><slot></slot></pre>',
    mounted: function () {
        var vm = this;
        moqui.loadScript('https://cdnjs.cloudflare.com/ajax/libs/mermaid/9.3.0/mermaid.min.js', function (err) {
            if (err) return;
            mermaid.init(vm.config, vm.$refs.mermaid);
        }, function () { return !!window.mermaid; });
    }
});
/* Lazy loading CK Editor wrapper component, based on https://github.com/ckeditor/ckeditor4-vue */
/* see https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_config.html */
moqui.webrootVue.component('m-ck-editor', {
    name: 'mCkEditor',
    template: '<div><textarea ref="area"></textarea></div>',
    props: { modelValue: { type: String, 'default': '' }, useInline: Boolean, config: Object, readOnly: { type: Boolean, 'default': null } },
    data: function () { return { destroyed: false, ckeditor: null } },
    mounted: function () {
        var vm = this;
        moqui.loadScript('https://cdn.ckeditor.com/4.14.1/standard-all/ckeditor.js', function (err) {
            if (err) return;
            if (vm.destroyed) return;
            var config = vm.config || {};
            if (vm.readOnly !== null) config.readOnly = vm.readOnly;

            CKEDITOR.dtd.$removeEmpty['i'] = false;
            var method = vm.useInline ? 'inline' : 'replace';
            var editor = vm.ckeditor = CKEDITOR[method](vm.$refs.area, config);
            editor.on('instanceReady', function () {
                var data = vm.modelValue;
                editor.fire('lockSnapshot');
                editor.setData(data, {
                    callback: function () {
                        editor.on('change', function (evt) {
                            var curData = editor.getData();
                            if (vm.modelValue !== curData) vm.$emit('update:modelValue', curData, evt, editor);
                        });
                        editor.on('focus', function (evt) { vm.$emit('focus', evt, editor); });
                        editor.on('blur', function (evt) { vm.$emit('blur', evt, editor); });

                        var newData = editor.getData();
                        // Locking the snapshot prevents the 'change' event. Trigger it manually to update the bound data.
                        if (data !== newData) {
                            vm.$once('update:modelValue', function () { vm.$emit('ready', editor); });
                            vm.$emit('update:modelValue', newData);
                        } else {
                            vm.$emit('ready', editor);
                        }
                        editor.fire('unlockSnapshot');
                    }
                });
            });
        }, function () { return !!window.CKEDITOR; });
    },
    beforeDestroy: function () {
        if (this.ckeditor) { this.ckeditor.destroy(); }
        this.destroyed = true;
    },
    watch: {
        modelValue: function (val) { if (this.ckeditor && this.ckeditor.getData() !== val) this.ckeditor.setData(val); },
        readOnly: function (val) { if (this.ckeditor) this.ckeditor.setReadOnly(val); }
    }
});
/* Lazy loading Simple MDE wrapper component */
moqui.webrootVue.component('m-simple-mde', {
    name: 'mSimpleMde',
    template: '<div><textarea ref="area"></textarea></div>',
    props: { modelValue: { type: String, 'default': '' }, config: Object },
    data: function () { return { simplemde: null } },
    mounted: function () {
        var vm = this;
        moqui.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/simplemde/1.11.2/simplemde.min.css');
        moqui.loadScript('https://cdnjs.cloudflare.com/ajax/libs/simplemde/1.11.2/simplemde.min.js', function (err) {
            if (err) return;
            // needed? forceSync:true
            var fullConfig = Object.assign({
                element: vm.$refs.area,
                initialValue: vm.modelValue
            }, vm.config);
            var editor = vm.simplemde = new SimpleMDE(fullConfig);

            editor.codemirror.on('change', function (instance, changeObj) {
                if (changeObj.origin === 'setValue') return;
                var val = editor.value();
                vm.$emit('update:modelValue', val);
            });
            editor.codemirror.on('blur', function () {
                var val = editor.value();
                vm.$emit('blur', val);
            });

            vm.$nextTick(function () { vm.$emit('initialized', editor); });
        }, function () { return !!window.SimpleMDE; });
    },
    watch: { modelValue: function (val) { if (this.simplemde && this.simplemde.value() !== val) this.simplemde.value(val); } }
});

/* ========== webrootVue - root Vue component with router ========== */
moqui.webrootVue.component('m-subscreens-tabs', {
    name: "mSubscreensTabs",
    data: function () { return { pathIndex: -1 } },
    /* NOTE DEJ 20200729 In theory could use q-route-tab and show active automatically, attempted to mimic Vue Router sufficiently for this to work but no luck yet:
    '<div v-if="subscreens.length > 0"><q-tabs dense no-caps align="left" active-color="primary" indicator-color="primary">' +
        '<q-route-tab v-for="tab in subscreens" :key="tab.name" :name="tab.name" :label="tab.title" :disable="tab.disableLink" :to="tab.pathWithParams"></q-route-tab>' +
    '</q-tabs><q-separator class="q-mb-md"></q-separator></div>',
     */
    template:
        '<div v-if="subscreens.length > 1"><q-tabs dense no-caps align="left" active-color="primary" indicator-color="primary" :value="activeTab">' +
        '<q-tab v-for="tab in subscreens" :key="tab.name" :name="tab.name" :label="tab.title" :disable="tab.disableLink" @click.prevent="goTo(tab.pathWithParams)"></q-tab>' +
        '</q-tabs><q-separator class="q-mb-md"></q-separator></div>',
    props: { passedPathIndex: { type: [Number, String], default: -1 } },
    methods: {
        goTo: function (pathWithParams) { this.$root.setUrl(this.$root.getLinkPath(pathWithParams)); }
    },
    watch: {
        "$root.navMenuList": function (menuList) {
            return;
        },

    },
    computed: {
        subscreens: function () {
            if (this.pathIndex === undefined || this.pathIndex === null || this.pathIndex < 0) return []; //AMB, 2026-02-11
            var navMenu = this.$root.navMenuList[this.pathIndex];
            if (!navMenu || !navMenu.subscreens) return [];
            return navMenu.subscreens;
        },
        activeTab: function () {
            if (this.pathIndex === undefined || this.pathIndex === null || this.pathIndex < 0) return null; //AMB, 2026-02-11
            var navMenu = this.$root.navMenuList[this.pathIndex];
            if (!navMenu || !navMenu.subscreens) return null;
            var activeName = null;
            $.each(navMenu.subscreens, function (idx, tab) { if (tab.active) activeName = tab.name; });
            return activeName;
        }
    },
    // this approach to get pathIndex won't work if the m-subscreens-active tag comes before m-subscreens-tabs
    mounted: function () {
        if (this.passedPathIndex !== -1 && this.passedPathIndex !== undefined && this.passedPathIndex !== "-1") {
            this.pathIndex = parseInt(this.passedPathIndex);
        } else {
            // Walk up parents to find depth
            let depth = -1;
            let p = this.$parent;
            while (p) {
                if (p.$options.name === 'mSubscreensActive' || p.activePathIndex !== undefined) {
                    depth = p.activePathIndex;
                    break;
                }
                p = p.$parent;
            }
            this.pathIndex = depth + 1;
        }
    },
});
moqui.webrootVue.component('m-subscreens-active', {
    name: "mSubscreensActive",
    props: { pathIndex: { type: [Number, String], default: -1 }, itemName: String },
    data: function () { return { activeComponent: Vue.markRaw(moqui.EmptyComponent), activePathIndex: -1, pathName: null } },
    template: '<component :is="activeComponent" style="height:100%;width:100%;"></component>',
    methods: {
        loadActive: function () {
            var vm = this;
            var root = vm.$root;
            var pathIndex = vm.activePathIndex;
            var curPathList = root.currentPathList;
            if (!curPathList) return false;
            var newPath = curPathList[pathIndex];

            // AMB: RECURSION GUARD - Check if any parent is already showing this path
            // Sequential guard: If the parent is showing the same path, it's a loop.
            let parent = vm.$parent;
            while (parent) {
                if (parent.pathName === newPath) {
                    console.error(`m-subscreens-active: Blocked recursive load of ${newPath} at index ${pathIndex}`);
                    this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                    return true;
                }
                parent = parent.$parent;
            }

            // If we are at index 0 and have no path, we are the root. 
            // If something tries to render another index-0 inside itself, it leads to infinite recursion.
            if (pathIndex === 0 && (!newPath || newPath === "")) {
                console.warn("m-subscreens-active: Blocked shell-in-shell recursion at index 0.");
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }

            // Construct fullPath early for comparison
            var fullPath = root.basePath + '/' + curPathList.slice(0, pathIndex + 1).join('/');
            console.info(`m-subscreens-active [${this.itemName || 'leaf'}] index ${pathIndex}: Checking ${fullPath} (cur: ${this.pathName})`);

            // HARD ROOT RECURSION GUARD: If index 0 is loading exactly its own base shell path
            if (pathIndex === 0 && (fullPath === root.basePath || (fullPath + '/') === root.basePath)) {
                console.error("m-subscreens-active: Blocked Index-0 root loop for " + fullPath);
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }

            // AMB 2026-03-13: HARD DEBUGGER BREAKPOINT
            // USER: When the page freezes, look at the "Sources" tab. 
            // Check 'pathIndex' vs 'curPathList' in the scope.
            if (pathIndex > 0 && (!newPath || pathIndex >= curPathList.length)) {
                console.warn(`m-subscreens-active [${this.itemName || 'leaf'}]: Blocked potential recursion at index ${pathIndex}. Path segment is missing.`);
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }

            var pathChanged = (this.pathName !== newPath);
            this.pathName = newPath;

            if (pathIndex > 0 && (!newPath || newPath.length === 0)) {
                console.info("in m-subscreens-active newPath is empty, loading EmptyComponent and returning true");
                return true;
            }

            var fullPath = root.basePath + '/' + curPathList.slice(0, pathIndex + 1).join('/');

            // AMB 2026-03-13: Handle explicit itemName for static subscreen loading (e.g. splitters)
            if (this.itemName) {
                // Find subscreen item by name at this level
                const parentNavIdx = pathIndex + root.basePathSize - 1;
                const parentNav = root.navMenuList[parentNavIdx];
                const subItem = parentNav?.subscreens?.find(s => s.name === this.itemName);

                if (subItem) {
                    console.info(`m-subscreens-active: Using static itemName [${this.itemName}] instead of path segment [${newPath}]`);
                    fullPath = subItem.pathWithParams;
                    newPath = this.itemName;
                    pathChanged = (this.pathName !== newPath);
                    this.pathName = newPath;
                } else {
                    console.warn(`m-subscreens-active: itemName [${this.itemName}] not found in parent subscreens at index ${parentNavIdx}. Rendering empty.`);
                    this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                    return true;
                }
            }

            // AMB 2026-03-13: GLOBAL RECURSION KILL SWITCH
            window.SubscreenLoadStack = window.SubscreenLoadStack || {};
            const stackKey = pathIndex + ':' + fullPath;

            // Guard against redundant in-flight requests for the same path
            if (root.loadingSubscreens[fullPath]) {
                console.info("m-subscreens-active: Already loading " + fullPath + " (component index " + pathIndex + "), skipping.");
                return false;
            }

            if (window.SubscreenLoadStack[stackKey]) {
                console.error(`m-subscreens-active: RECURSION BLOCKED for ${fullPath} at index ${pathIndex}`);
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }
            if (pathIndex > 10) {
                console.error(`m-subscreens-active: DEPTH LIMIT EXCEEDED at index ${pathIndex}`);
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }

            // Normal path match guard
            const currentPath = root.basePath + '/' + curPathList.slice(0, pathIndex).join('/');
            const normFullPath = fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
            const normCurrentPath = currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath;

            if (normFullPath === normCurrentPath && !this.itemName) {
                console.error(`m-subscreens-active: Prevented parent/self recursive loop for path ${normFullPath} at index ${pathIndex}`);
                this.activeComponent = Vue.markRaw(moqui.EmptyComponent);
                return true;
            }

            if (!pathChanged && moqui.componentCache.containsKey(fullPath)) {
                return false;
            }

            var urlInfo = { path: fullPath, lastStandalone: -(pathIndex + root.basePathSize + 1) };
            if (pathIndex === (curPathList.length - 1)) {
                var extra = root.extraPathList;
                if (extra && extra.length > 0) { urlInfo.extraPath = extra.join('/'); }
            }

            var search = root.currentSearch;
            if (search && search.length > 0) { urlInfo.search = search; }
            urlInfo.bodyParameters = root.bodyParameters;
            var navMenuItem = root.navMenuList[pathIndex + root.basePathSize];
            if (navMenuItem && navMenuItem.renderModes) urlInfo.renderModes = navMenuItem.renderModes;

            // AMB 2026-03-02: Normalize fullPath for Vue Router.
            var qvtFullPath = fullPath;
            if (root.linkBasePath && root.linkBasePath !== '/' && qvtFullPath.startsWith(root.linkBasePath)) {
                qvtFullPath = qvtFullPath.substring(root.linkBasePath.length);
            }
            if (!qvtFullPath.startsWith('/')) qvtFullPath = '/' + qvtFullPath;
            qvtFullPath = qvtFullPath.replace(/\/+/g, '/');

            // AMB 2026-03-10: Consolidation Guard - Disabled to prevent recursive router hand-off
            /*
            if (!this.itemName && vm.$router && vm.$router.currentRoute && vm.$router.currentRoute.value) {
                const routerPath = vm.$router.currentRoute.value.path;
                const normRouterPath = (routerPath.endsWith('/') && routerPath.length > 1) ? routerPath.slice(0, -1) : routerPath;
                const normFullPathComp = (qvtFullPath.endsWith('/') && qvtFullPath.length > 1) ? qvtFullPath.slice(0, -1) : qvtFullPath;
 
                if (normRouterPath === normFullPathComp && moqui.componentCache.containsKey(fullPath)) {
                    console.info('m-subscreens-active: Handing off leaf rendering to router-view at ' + normRouterPath + ' (index ' + pathIndex + ')');
                    this.activeComponent = null; 
                    return true;
                }
            }
            */

            console.info('m-subscreens-active loadActive pathIndex ' + pathIndex + ' pathName ' + vm.pathName + ' urlInfo ' + JSON.stringify(urlInfo));

            window.SubscreenLoadStack[stackKey] = true;
            root.loadingSubscreens[fullPath] = true;
            root.loading++;
            root.currentLoadRequest = moqui.loadComponent(urlInfo, function (comp) {
                delete window.SubscreenLoadStack[stackKey];
                delete root.loadingSubscreens[fullPath];
                root.currentLoadRequest = null;
                vm.activeComponent = Vue.markRaw(comp);

                // Add route dynamically if not present
                if (!vm.itemName && vm.$router) {
                    const resolved = vm.$router.resolve(qvtFullPath);
                    if (!resolved || resolved.matched.length === 0 || resolved.name === '404') {
                        vm.$router.addRoute({ path: qvtFullPath, name: qvtFullPath, component: comp });
                    }
                    // AMB: Only replace the URL if this is the terminal segment of the path
                    // This prevents parents from truncating the URL if a child is also loading.
                    if (pathIndex === (root.currentPathList.length - 1)) {
                        console.info('m-subscreens-active: asserting terminal route ' + qvtFullPath);
                        vm.$router.replace(qvtFullPath);
                    }
                }
                root.loading--;
            });
            return true;
        }
    },
    created: function () {
        const pIdx = this.pathIndex;
        // Walk up parents to find depth first
        let depth = -1;
        let p = this.$parent;
        while (p) {
            if (p.activePathIndex !== undefined || p.$options?.name === 'mSubscreensActive' || p.$options?.name === 'm-subscreens-active') {
                if (p.activePathIndex !== undefined && p.activePathIndex !== -1) {
                    depth = p.activePathIndex;
                    break;
                }
            }
            p = p.$parent;
        }

        // Only trust pathIndex prop if it's not -1 and doesn't conflict with parent depth
        // If we have a parent at index 0, and we are told index 0, we MUST be index 1 instead.
        if (pIdx !== -1 && pIdx !== undefined && pIdx !== "-1") {
            const requestedIdx = parseInt(pIdx);
            if (depth !== -1 && requestedIdx <= depth) {
                console.warn(`m-subscreens-active child index ${requestedIdx} <= parent depth ${depth}. Overriding to ${depth + 1}`);
                this.activePathIndex = depth + 1;
            } else {
                this.activePathIndex = requestedIdx;
            }
        } else {
            this.activePathIndex = depth + 1;
        }
        console.log(`m-subscreens-active [${this.itemName || 'leaf'}] created at index ${this.activePathIndex} (prop: ${this.pathIndex}, depth: ${depth})`);
    },
    mounted: function () {
        if (this.activePathIndex === -1) {
            console.error("m-subscreens-active mounted with index -1. Calculating now.");
            this.$options.created.call(this);
        }
        console.log(`m-subscreens-active [${this.itemName || 'leaf'}] mounted at index ${this.activePathIndex}`);
        this.$root.addSubscreen(this);
    },
    unmounted: function () {
        this.$root.removeSubscreen(this);
    }
});

moqui.webrootVue.component('m-menu-nav-item', {
    name: "mMenuNavItem",
    props: { menuIndex: Number },
    template:
        '<q-expansion-item v-if="navMenuItem && navMenuItem.subscreens && navMenuItem.subscreens.length" :value="true" :content-inset-level="0.3"' +
        ' switch-toggle-side dense dense-toggle expanded-icon="arrow_drop_down" :to="navMenuItem.pathWithParams" @input="go" @created="logPath">' +
        '<template v-slot:header><m-menu-item-content :menu-item="navMenuItem" active></m-menu-item-content></template>' +
        '<template v-slot:default><m-menu-subscreen-item v-for="(subscreen, ssIndex) in navMenuItem.subscreens" :key="subscreen.name" :menu-index="menuIndex" :subscreen-index="ssIndex"></m-menu-subscreen-item></template>' +
        '</q-expansion-item>' +
        '<q-expansion-item v-else-if="navMenuItem && navMenuItem.savedFinds && navMenuItem.savedFinds.length" :value="true" :content-inset-level="0.3"' +
        ' switch-toggle-side dense dense-toggle expanded-icon="arrow_drop_down" :to="navMenuItem.pathWithParams" @input="go">' +
        '<template v-slot:header><m-menu-item-content :menu-item="navMenuItem" active></m-menu-item-content></template>' +
        '<template v-slot:default><q-expansion-item v-for="(savedFind, ssIndex) in navMenuItem.savedFinds" :key="savedFind.name"' +
        ' :value="false" switch-toggle-side dense dense-toggle expand-icon="chevron_right" :to="savedFind.pathWithParams" @input="goPath(savedFind.pathWithParams)">' +
        '<template v-slot:header><m-menu-item-content :menu-item="savedFind" :active="savedFind.active"></m-menu-item-content></template>' +
        '</q-expansion-item></template>' +
        '</q-expansion-item>' +
        '<q-expansion-item v-else-if="menuIndex < (navMenuLength - 1)" :value="true" :content-inset-level="0.3"' +
        ' switch-toggle-side dense dense-toggle expanded-icon="arrow_drop_down" :to="navMenuItem.pathWithParams" @input="go">' +
        '<template v-slot:header><m-menu-item-content :menu-item="navMenuItem" active></m-menu-item-content></template>' +
        '<template v-slot:default><m-menu-nav-item :menu-index="menuIndex + 1"></m-menu-nav-item></template>' +
        '</q-expansion-item>' +
        '<q-expansion-item v-else-if="navMenuItem" :value="false" switch-toggle-side dense dense-toggle expand-icon="arrow_right" :to="navMenuItem.pathWithParams" @input="go">' +
        '<template v-slot:header><m-menu-item-content :menu-item="navMenuItem" active></m-menu-item-content></template>' +
        '</q-expansion-item>',
    methods: {
        go: function go() { this.$root.setUrl(this.navMenuItem.pathWithParams); },
        goPath: function goPath(path) { this.$root.setUrl(path); },
        logPath: function logPath() { console.log('navMenuItem.pathWithParams:', this.navMenuItem.pathWithParams); }
    },
    computed: {
        navMenuItem: function () { return this.$root.navMenuList[this.menuIndex]; },
        navMenuLength: function () { return this.$root.navMenuList.length; }
    }
});
moqui.webrootVue.component('m-menu-subscreen-item', {
    name: "mMenuSubscreenItem",
    props: { menuIndex: Number, subscreenIndex: Number },
    template:
        '<m-menu-nav-item v-if="subscreen.active" :menu-index="menuIndex + 1"></m-menu-nav-item>' +
        '<q-expansion-item v-else :value="false" switch-toggle-side dense dense-toggle expand-icon="arrow_right" :to="subscreen.pathWithParams" @input="go">' +
        '<template v-slot:header><m-menu-item-content :menu-item="subscreen"></m-menu-item-content></template>' +
        '</q-expansion-item>',
    methods: { go: function go() { this.$root.setUrl(this.subscreen.pathWithParams); } },
    computed: { subscreen: function () { return this.$root.navMenuList[this.menuIndex].subscreens[this.subscreenIndex]; } }
});
moqui.webrootVue.component('m-menu-item-content', {
    name: "mMenuItemContent",
    props: { menuItem: Object, active: Boolean },
    template:
        '<div class="q-item__section column q-item__section--main justify-center"><div class="q-item__label">' +
        '<i v-if="menuItem.image && menuItem.imageType === \'icon\'" :class="menuItem.image" style="padding-right: 8px;"></i>' +
        /* TODO: images don't line up vertically, padding-top and margin-top do nothing, very annoying layout stuff, for another time... */
        '<span v-else-if="menuItem.image" style="padding-right:8px;"><img :src="menuItem.image" :alt="menuItem.title" height="14" class="invertible"></span>' +
        '<span :class="{\'text-primary\':active}">{{menuItem.title}}</span>' +
        '</div></div>'
});

// Basic components already registered, now use plugins
if (!moqui.quasarInstalled) {
    moqui.webrootVue.use(Quasar, { config: { loadingBar: { color: 'amber' } } });
    moqui.quasarInstalled = true;
}
if (window.BlueprintClient && !moqui.blueprintInstalled) {
    moqui.webrootVue.use(window.BlueprintClient);
    moqui.blueprintInstalled = true;
    console.info("MCE: BlueprintClient plugin registered");
}
if (typeof Pinia !== 'undefined' && !moqui.piniaInstalled) {
    const pinia = Pinia.createPinia();
    moqui.webrootVue.use(pinia);
    moqui.pinia = pinia;
    moqui.piniaInstalled = true;
    console.info("Attached Pinia to app");
}
if (moqui.webrootRouter && !moqui.routerInstalled) {
    // moqui.webrootVue.use(moqui.webrootRouter); // Already handled in createApp().use()
    moqui.routerInstalled = true;
    console.info("Attached moqui.webrootRouter to app");
}

// Capture configuration from hidden inputs
// Capture Config from Hidden Inputs
var conf = {};
$('input[id^="conf"]').each(function () {
    var key = this.id.substring(4);
    key = key.charAt(0).toLowerCase() + key.slice(1);
    conf[key] = this.value;
});
console.info("Captured Moqui configuration:", conf);

if (window.MoquiCanvasEditor) {
    // Change 'moqui-canvas-editor' to 'blueprint-renderer' to match your shell tag
    moqui.webrootVue.component('blueprint-renderer', window.MoquiCanvasEditor);
    console.info("MCE: Blueprint Renderer manually registered.");
}
document.addEventListener('DOMContentLoaded', () => {
    const finalizeApp = (appInstance) => {
        if (!appInstance) return;
        // Populate root instance with captured config
        for (var key in conf) { if (conf.hasOwnProperty(key) && key in appInstance) appInstance[key] = conf[key]; }

        window.moquiApp = appInstance; // Make it global for debugging
        // Map Vue 3 root component methods back to the app instance for backwards compatibility
        ['addNotify', 'reLoginCheckShow', 'getCsrfToken', 'setUrl', 'getRoute'].forEach(function (fn) {
            if (typeof appInstance[fn] === 'function') {
                window.moqui.webrootVue[fn] = appInstance[fn].bind(appInstance);
            }
        });
        // Shim router push/replace for compatibility with Quasar/Vue 2 expectations
        if (appInstance.$router) {
            const originalPush = appInstance.$router.push;
            appInstance.$router.push = function () {
                const res = originalPush.apply(this, arguments);
                return (res && typeof res.catch === 'function') ? res : Promise.resolve(res);
            };
            const originalReplace = appInstance.$router.replace;
            appInstance.$router.replace = function () {
                const res = originalReplace.apply(this, arguments);
                return (res && typeof res.catch === 'function') ? res : Promise.resolve(res);
            };
        }
        window.addEventListener('popstate', function () { appInstance.setUrl(window.location.pathname + window.location.search, null, null, false); });
    };

    const appTarget = document.querySelector('#q-app');;
    if (appTarget && !appTarget.__vue_app__) {
        console.info("MCE: Auto-mounting moqui.webrootVue...");
        const moquiApp = window.moqui.webrootVue.mount('#q-app');
        finalizeApp(moquiApp);
    } else {
        console.info("MCE: App already mounted or target missing, skipping auto-mount.");
    }
});
