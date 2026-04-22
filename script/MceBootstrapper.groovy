import org.moqui.context.ExecutionContext

ExecutionContext ec = context.ec
long ts = System.currentTimeMillis()

// Initialize standard Moqui lists if they are null
if (context.html_stylesheets == null) context.html_stylesheets = []
if (context.footer_scripts == null) context.footer_scripts = []

// 1. Core External Libraries (Quasar 2 / Vue 3)
html_stylesheets.add("https://unpkg.com/quasar@2.12.6/dist/quasar.prod.css")
html_stylesheets.add("https://fonts.googleapis.com/css?family=Roboto:100,300,400,500,700,900")
html_stylesheets.add("https://fonts.googleapis.com/icon?family=Material+Icons")
html_stylesheets.add("https://fonts.googleapis.com/icon?family=Material+Icons+Outlined")

// Add to your stylesheet links if MceBootstrapper handles them
//html_stylesheets.add("https://unpkg.com/@codesandbox/sandpack-client@2.13.0/dist/styles.css")

footer_scripts.add("https://unpkg.com/vue@3.3.4/dist/vue.global.prod.js")
footer_scripts.add("https://unpkg.com/quasar@2.12.6/dist/quasar.umd.prod.js")
// Add the WebMCP Client Relay with cache buster to ensure the latest bridge fixes are loaded
footer_scripts.add("http://localhost:3000/webmcp.js?v=" + ts)
//footer_scripts.add("https://unpkg.com/@codesandbox/sandpack-client@2.13.0/dist/index.browser.js")

// 2. Resolve and include the MceShell component asset
// We use the 'asset' transition defined in MceShell.xml
String appUrl = sri.makeUrlByType("asset/MceShell.qvt.js", "transition", null, "false").pathWithParams
footer_scripts.add(appUrl + (appUrl.contains("?") ? "&" : "?") + "v=" + ts)

// 3. Validation: Verify MCE2 Node Infrastructure
boolean isNodeUp = false
try {
    // Check if port 3000 is listening
    def socket = new java.net.Socket("localhost", 3000)
    socket.close()
    isNodeUp = true
} catch (Exception e) {
    ec.logger.warn("MCE2 Script Validation: Node Server NOT detected on port 3000.")
}

if (!isNodeUp) {
    // Log a warning directly to the browser console if the infrastructure is missing
    footer_scripts.add("data:text/javascript,console.warn('MCE2 INFRASTRUCTURE WARNING: Local Node server on port 3000 is not responding. WebMCP tools and AI interactions will be disabled.')")
}

return context
