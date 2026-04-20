import org.moqui.context.ExecutionContext

ExecutionContext ec = context.ec
String sessionId = ec.web.session.getId()
def tokenCache = ec.cache.getCache("mcp-connection-tokens")
if (tokenCache == null) {
    tokenCache = ec.cache.makeCache("mcp-connection-tokens")
}

String token = tokenCache.get(sessionId)
// Check for MCE_DESIGN_ADMIN permission for design-time privileges
String isDesignMode = ec.user.hasPermission("MCE_DESIGN_ADMIN") ? "Y" : "N"

if (!token) {
    // 1. Generate UUID
    token = java.util.UUID.randomUUID().toString()
    tokenCache.put(sessionId, token)

    // 2. Create LayerInteraction record using the auto-create service
    ec.service.sync().name("create#mce2.layer.LayerInteraction")
        .parameters([
            mcpToken: token, 
            userId: ec.user.userId, 
            statusId: 'MceActive', 
            fromDate: ec.user.nowTimestamp,
            isDesignMode: isDesignMode
        ])
        .disableAuthz().call()
}

context.connectionToken = token
context.isDesignMode = isDesignMode
return context
