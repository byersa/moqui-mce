import org.moqui.context.ExecutionContext

ExecutionContext ec = context.ec
String componentName = "moqui-ai" // Node server currently lives in moqui-ai/mcp-host

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
File nodeAppDir = new File(componentDir, "mcp-host")

if (!nodeAppDir.exists()) {
    ec.logger.error("Node server directory not found at: ${nodeAppDir.absolutePath}")
    return
}

// Execute the Node process in the background
try {
    ec.logger.info("Starting Node.js server for MCP in ${nodeAppDir.absolutePath}...")
    
    // Using ProcessBuilder to run in background without blocking Moqui startup
    ProcessBuilder pb = new ProcessBuilder("npm", "start")
    pb.directory(nodeAppDir)
    pb.redirectErrorStream(true)
    pb.inheritIO() // Redirects output to Moqui's console for debugging
    pb.start()
    
    ec.logger.info("Node.js server process initiated.")
} catch (Exception e) {
    ec.logger.error("Failed to start Node.js server", e)
}
