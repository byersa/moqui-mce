/**
 * MCE Bootstrapper
 * Configures the shell environment, loads dependencies, and prepares the SPA foundation.
 * Pattern matched to AitreePreActions.groovy.
 */
import org.moqui.context.ExecutionContext
import java.net.Socket

ExecutionContext ec = context.ec
long ts = System.currentTimeMillis()

// 1. Set App Constants
ec.context.put("appRootPath", "/mce")
ec.context.put("basePath", "/mce")

// 2. Defensively remove standard WebrootVue
footer_scripts.remove('/js/WebrootVue.qvt.js')

// Helper to add unique assets
def addUniqueStyle = { url -> if (!html_stylesheets.contains(url)) html_stylesheets.add(url) }
def addUniqueScript = { url -> if (!footer_scripts.contains(url)) footer_scripts.add(url) }

// 3. Load Base Libraries (Material Icons, Roboto, Quasar CSS)
addUniqueStyle("https://fonts.googleapis.com/css?family=Roboto:100,300,400,500,700,900|Material+Icons|Material+Icons+Outlined")
addUniqueStyle("https://unpkg.com/quasar@2.12.6/dist/quasar.prod.css")

// 4. Load MCE Shell Styles
addUniqueStyle("/mce/include/MceShell.css?v=" + ts)

// 5. Load JavaScript Dependencies
String instancePurpose = System.getProperty("instance_purpose")
boolean isProd = !instancePurpose || instancePurpose == 'production'

if (isProd) {
    addUniqueScript("https://unpkg.com/vue@3.3.4/dist/vue.global.prod.js")
    addUniqueScript("https://unpkg.com/quasar@2.12.6/dist/quasar.umd.prod.js")
} else {
    addUniqueScript("https://unpkg.com/vue@3.3.4/dist/vue.global.js")
    addUniqueScript("https://unpkg.com/quasar@2.12.6/dist/quasar.umd.js")
}

// Additional SPA / MCE Libraries
addUniqueScript("/mce/js/webmcp.js?v=" + ts)

// 6. Load MceShell Component Script
addUniqueScript("/assets/MceShell.qvt.js?v=" + ts)

// 7. Load Modular Components (Production Preview, etc.)
addUniqueScript("/assets/ProductionPreview.qvt.js?v=" + ts)

// 8. Infrastructure Heartbeat Check
if (ec.web.requestAttributes.MceNodeChecked == null) {
    boolean isNodeUp = false
    try {
        def socket = new java.net.Socket("127.0.0.1", 3000)
        socket.close()
        isNodeUp = true
    } catch (Exception e) {
        ec.logger.warn("MCE Shell: WebMCP Node Server (port 3000) not detected.")
    }

    if (!isNodeUp) {
        addUniqueScript("data:text/javascript,console.warn('MCE Shell: Local WebMCP Node server (3000) is offline.')")
    }
    ec.web.requestAttributes.MceNodeChecked = true
}

// --- Sidecar Auto-Start Logic ---
def sidecarPort = 3000
def sidecarHost = "127.0.0.1"
def isRunning = false

// 1. Check if the port is already occupied
try {
    new Socket("127.0.0.1", sidecarPort).withCloseable { isRunning = true }
} catch (Exception e) {
    ec.logger.info("MCE: Sidecar  Port is free, we need to spawn")
}

if (!isRunning) {
    ec.logger.info("MCE: Sidecar not detected on port ${sidecarPort}. Spawning process...")
    
    // 2. Define the command and working directory
    // We use the absolute path from the component location
    def componentBase = "runtime/component/moqui-mce"
    def command = [
        "node", 
        "sidecar/websocket-server.js", 
        "--port", sidecarPort.toString(), 
        "--host", sidecarHost, 
        "-f"
    ]

    try {
        ProcessBuilder pb = new ProcessBuilder(command)
        pb.directory(new File(ec.factory.moquiHome, componentBase))
        
        // Redirect logs to a dedicated file in the moqui log directory
        def logFile = new File(ec.factory.moquiHome, "runtime/log/mce-sidecar.log")
        pb.redirectOutput(ProcessBuilder.Redirect.append(logFile))
        pb.redirectError(ProcessBuilder.Redirect.append(logFile))

        // 3. Start the process in the background
        pb.start()
        ec.logger.info("MCE: Sidecar process spawned. Logs: runtime/log/mce-sidecar.log")
    } catch (Exception e) {
        ec.logger.error("MCE: Failed to spawn Sidecar: ${e.message}")
    }
} else {
    ec.logger.info("MCE: Sidecar already active on port ${sidecarPort}.")
}

return context