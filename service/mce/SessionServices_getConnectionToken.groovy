import org.moqui.context.ExecutionContext

ExecutionContext ec = context.ec

// 1. Generate fresh UUID for this interaction
String token = java.util.UUID.randomUUID().toString()

// Check for MCE_DESIGN_ADMIN permission for design-time privileges
String isDesignMode = ec.user.hasPermission("MCE_DESIGN_ADMIN") ? "Y" : "N"

// Update the session token cache
def tokenCache = ec.cache.getCache("mcp-connection-tokens") ?: ec.cache.makeCache("mcp-connection-tokens")
tokenCache.put(ec.web.session.getId(), token)

// 2. Create LayerInteraction record using the auto-create service
ec.service.sync().name("create#mce.layer.LayerInteraction")
    .parameters([
        mcpToken: token, 
        userId: ec.user.userId ?: '_NA_', 
        statusId: 'MceActive', 
        fromDate: ec.user.nowTimestamp,
        isDesignMode: isDesignMode
    ])
    .disableAuthz().call()

context.connectionToken = token
context.isDesignMode = isDesignMode
ec.logger.info("In getConnectionToken, token:" + token)
return context
