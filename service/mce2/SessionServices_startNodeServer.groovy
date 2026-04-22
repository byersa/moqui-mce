import org.moqui.context.ExecutionContext

ExecutionContext ec = context.ec
String componentName = "moqui-mce"

// High-level check: If port 3000 is already active, we assume the infrastructure is healthy.
// This prevents multiple async triggers (e.g. from rapid page reloads) from spawning duplicate processes.
boolean alreadyRunning = false
try {
    def socket = new java.net.Socket("localhost", 3000)
    socket.close()
    alreadyRunning = true
} catch (Exception e) {
    // Port is available, proceed with startup
}

if (alreadyRunning) {
    ec.logger.info("MCE2 Infrastructure is already active on port 3000. Skipping redundant startup.")
    return
}

// Get all component locations from the factory
Map<String, String> componentLocations = ec.factory.getComponentBaseLocations()
String location = componentLocations.get(componentName)

if (!location) {
    ec.logger.error("Could not find base location for component: ${componentName}")
    return
}

// Normalize the file path (stripping 'file:' prefix if present)
String path = location.startsWith("file:") ? location.substring(5) : location
File componentDir = new File(path)

// 1. The WebMCP Sidecar (WebSocket/HTTP on port 3000)
File webmcpSidecarDir = new File(componentDir, "sidecar")
    ec.logger.info("In startNodeServer, webmcpSidecarDir:" + webmcpSidecarDir);
File mcpHostDir = new File(componentDir, "mcp-host")
    ec.logger.info("In startNodeServer, mcpHostDir:" + mcpHostDir);

if (!webmcpSidecarDir.exists()) {
    ec.logger.warn("WebMCP sidecar directory not found at: ${webmcpSidecarDir.absolutePath}")
} else {
    try {
        ec.logger.info("Starting MCE2 WebMCP Sidecar in ${webmcpSidecarDir.absolutePath}...")
        // Explicitly using --foreground to help debugging and ensure Moqui captures output
        File sidecarLog = new File(webmcpSidecarDir, "mcp-sidecar.log")
        ProcessBuilder pb = new ProcessBuilder("node", "websocket-server.js", "--port", "3000", "--host", "0.0.0.0", "--mcp", "--foreground")
        pb.directory(webmcpSidecarDir)
        //pb.inheritIO()
        
        // Redirect both output and errors to this file
        pb.redirectErrorStream(true)
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(sidecarLog))
        Process proc = pb.start()
        
        if (proc.isAlive()) {
            ec.logger.info("MCE2 WebMCP sidecar process started successfully (PID: ${proc.pid()}).")
        } else {
            ec.logger.error("MCE2 WebMCP sidecar process exited immediately with code: ${proc.exitValue()}")
        }
    } catch (Exception e) {
        ec.logger.error("Failed to start MCE2 WebMCP sidecar", e)
    }
}

// 2. The Primary MCP Host (Stdio protocol for AI agents)
if (mcpHostDir.exists()) {
     try {
        ec.logger.info("Starting MCE2 primary MCP Host in ${mcpHostDir.absolutePath}...")
        File hostLog = new File(mcpHostDir, "mcp-host.log")
        ProcessBuilder pb = new ProcessBuilder("node", "mcp-host.js")
        pb.directory(mcpHostDir)
        pb.redirectErrorStream(true)
        pb.redirectOutput(ProcessBuilder.Redirect.appendTo(hostLog))
        //pb.inheritIO()
        Process proc = pb.start()
        
        if (proc.isAlive()) {
            ec.logger.info("MCE2 primary MCP Host process started successfully (PID: ${proc.pid()}).")
        }
    } catch (Exception e) {
        ec.logger.error("Failed to start MCE2 primary MCP Host", e)
    }
}

return context
