targetScope = 'resourceGroup'

@description('Short lowercase product prefix, for example agenticthat.')
@minLength(5)
@maxLength(20)
param prefix string = 'agenticthat'

@allowed([
  'staging'
  'production'
])
param environmentName string
param location string = resourceGroup().location
param websiteImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
param automationImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'
param websitePlanSku string = 'B1'
param automationPlanSku string = 'P1v3'
param backupsConfigured bool = false
@description('Optional operations email. When set, Azure Monitor creates HTTP 5xx alerts for both apps.')
param alertEmail string = ''

@secure()
param websiteDatabaseUrl string

@secure()
param automationDatabaseUrl string

@secure()
param automationInternalToken string

@secure()
param websiteSecretSettings object = {}

param websiteAppSettings object = {}

var suffix = substring(uniqueString(resourceGroup().id, environmentName), 0, 8)
var resourceBase = '${prefix}-${environmentName}-${suffix}'
var compactBase = toLower(replace(resourceBase, '-', ''))
var storageName = substring('${compactBase}store', 0, min(length('${compactBase}store'), 24))
var vaultName = substring('${resourceBase}-kv', 0, min(length('${resourceBase}-kv'), 24))
var registryName = substring('agt${compactBase}acr', 0, min(length('agt${compactBase}acr'), 50))
var websiteName = '${resourceBase}-web'
var automationName = '${resourceBase}-automation'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${resourceBase}-logs'
  location: location
  properties: {
    retentionInDays: 30
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourceBase}-insights'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_GRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    encryption: {
      keySource: 'Microsoft.Storage'
      requireInfrastructureEncryption: true
      services: { blob: { enabled: true } }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource profilesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'browser-profiles'
  properties: { publicAccess: 'None' }
}
resource mediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'publishing-media'
  properties: { publicAccess: 'None' }
}
resource artifactsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'automation-artifacts'
  properties: { publicAccess: 'None' }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

resource profileKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  parent: vault
  name: 'automation-profile-key'
  properties: {
    kty: 'RSA'
    keySize: 3072
    keyOps: [ 'wrapKey', 'unwrapKey' ]
  }
}

resource websiteDatabaseSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'website-database-url'
  properties: { value: websiteDatabaseUrl }
}
resource automationDatabaseSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'automation-database-url'
  properties: { value: automationDatabaseUrl }
}
resource automationTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'automation-internal-token'
  properties: { value: automationInternalToken }
}

resource websitePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${resourceBase}-web-plan'
  location: location
  sku: { name: websitePlanSku, capacity: 1 }
  kind: 'linux'
  properties: { reserved: true }
}

resource automationPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${resourceBase}-automation-plan'
  location: location
  sku: { name: automationPlanSku, capacity: 1 }
  kind: 'linux'
  properties: { reserved: true }
}

var mergedWebsiteExtraSettings = union(websiteAppSettings, websiteSecretSettings)
var websiteExtraSettingsArray = [for setting in items(mergedWebsiteExtraSettings): {
  name: setting.key
  value: string(setting.value)
}]

resource website 'Microsoft.Web/sites@2023-12-01' = {
  name: websiteName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: websitePlan.id
    httpsOnly: true
    siteConfig: {
      alwaysOn: websitePlanSku != 'F1'
      acrUseManagedIdentityCreds: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'DOCKER|${websiteImage}'
      minTlsVersion: '1.2'
      healthCheckPath: '/api/health'
      appSettings: concat(
        [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'PORT', value: '3000' }
          { name: 'WEBSITES_PORT', value: '3000' }
          { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
          { name: 'SUPABASE_DB_URL', value: '@Microsoft.KeyVault(SecretUri=${websiteDatabaseSecret.properties.secretUriWithVersion})' }
          { name: 'SERVER_AUTOMATION_DASHBOARD_ENABLED', value: 'true' }
          { name: 'SERVER_AUTOMATION_ORIGIN', value: 'https://${automationName}.azurewebsites.net' }
          { name: 'SERVER_AUTOMATION_INTERNAL_TOKEN', value: '@Microsoft.KeyVault(SecretUri=${automationTokenSecret.properties.secretUriWithVersion})' }
        ],
        websiteExtraSettingsArray
      )
    }
  }
}

resource automation 'Microsoft.Web/sites@2023-12-01' = {
  name: automationName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: automationPlan.id
    httpsOnly: true
    siteConfig: {
      alwaysOn: true
      acrUseManagedIdentityCreds: true
      ftpsState: 'Disabled'
      http20Enabled: true
      webSocketsEnabled: true
      linuxFxVersion: 'DOCKER|${automationImage}'
      minTlsVersion: '1.2'
      healthCheckPath: '/ready'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WEBSITES_PORT', value: '8800' }
        { name: 'WEBSITES_CONTAINER_START_TIME_LIMIT', value: '1800' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'SERVER_ARCHITECTURE_DEPLOYMENT', value: environmentName }
        { name: 'SERVER_ARCHITECTURE_HOST', value: '0.0.0.0' }
        { name: 'SERVER_ARCHITECTURE_PORT', value: '8800' }
        { name: 'SERVER_ARCHITECTURE_ALLOW_PUBLIC_BIND', value: 'true' }
        { name: 'SERVER_ARCHITECTURE_DATA_DIR', value: '/var/lib/agenticthat-automation' }
        { name: 'SERVER_ARCHITECTURE_AUTO_MIGRATE', value: 'false' }
        { name: 'SERVER_DATABASE_ENGINE', value: 'postgres' }
        { name: 'SERVER_AUTOMATION_DATABASE_URL', value: '@Microsoft.KeyVault(SecretUri=${automationDatabaseSecret.properties.secretUriWithVersion})' }
        { name: 'SERVER_DATABASE_POOL_MAX', value: '8' }
        { name: 'SERVER_STORAGE_BACKEND', value: 'azure' }
        { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
        { name: 'AZURE_PROFILES_CONTAINER', value: profilesContainer.name }
        { name: 'AZURE_MEDIA_CONTAINER', value: mediaContainer.name }
        { name: 'AZURE_ARTIFACTS_CONTAINER', value: artifactsContainer.name }
        { name: 'AZURE_KEY_VAULT_URL', value: vault.properties.vaultUri }
        { name: 'AZURE_PROFILE_KEY_NAME', value: profileKey.name }
        { name: 'SERVER_ARCHITECTURE_INTERNAL_TOKEN', value: '@Microsoft.KeyVault(SecretUri=${automationTokenSecret.properties.secretUriWithVersion})' }
        { name: 'SERVER_PROFILE_STORAGE_ENCRYPTED', value: 'true' }
        { name: 'SERVER_BACKUPS_CONFIGURED', value: string(backupsConfigured) }
        { name: 'SERVER_SINGLE_HOST_ACKNOWLEDGED', value: 'true' }
        { name: 'SERVER_WORKER_POLL_MS', value: '2000' }
        { name: 'SERVER_LIVE_WORKER_COUNT', value: '1' }
        { name: 'SERVER_JOB_TIMEOUT_MS', value: '900000' }
        { name: 'SERVER_SHUTDOWN_GRACE_MS', value: '120000' }
        { name: 'SERVER_LOGIN_MAX_CONCURRENT', value: '1' }
        { name: 'SERVER_LOGIN_ENABLED', value: 'false' }
        { name: 'SERVER_EXECUTION_ENABLED', value: 'false' }
        { name: 'SERVER_INSTAGRAM_PUBLISHING_ENABLED', value: 'false' }
        { name: 'SERVER_FACEBOOK_PUBLISHING_ENABLED', value: 'false' }
        { name: 'SERVER_X_PUBLISHING_ENABLED', value: 'false' }
        { name: 'SERVER_LINKEDIN_PUBLISHING_ENABLED', value: 'false' }
        { name: 'SERVER_YOUTUBE_PUBLISHING_ENABLED', value: 'false' }
        { name: 'SERVER_PUBLISHING_DRY_RUN_ENABLED', value: 'false' }
        { name: 'SERVER_PUBLISHING_PREVIEW_ENABLED', value: 'false' }
        { name: 'SERVER_SCRAPING_ENABLED', value: 'false' }
      ]
    }
  }
}

resource websiteDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'agenticthat-to-log-analytics'
  scope: website
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
    ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

resource automationDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'agenticthat-to-log-analytics'
  scope: automation
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
    ]
    metrics: [ { category: 'AllMetrics', enabled: true } ]
  }
}

resource operationsActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmail)) {
  name: '${resourceBase}-operations'
  location: 'global'
  properties: {
    groupShortName: 'agenticthat'
    enabled: true
    emailReceivers: [
      {
        name: 'operations'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource websiteHttp5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(alertEmail)) {
  name: '${resourceBase}-website-http5xx'
  location: 'global'
  properties: {
    description: 'AgenticThat website returned more than five HTTP 5xx responses in five minutes.'
    severity: 2
    enabled: true
    scopes: [ website.id ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'WebsiteHttp5xx'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          skipMetricValidation: false
        }
      ]
    }
    actions: [ { actionGroupId: operationsActionGroup.id } ]
  }
}

resource automationHttp5xxAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (!empty(alertEmail)) {
  name: '${resourceBase}-automation-http5xx'
  location: 'global'
  properties: {
    description: 'AgenticThat automation returned more than five HTTP 5xx responses in five minutes.'
    severity: 1
    enabled: true
    scopes: [ automation.id ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'AutomationHttp5xx'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          skipMetricValidation: false
        }
      ]
    }
    actions: [ { actionGroupId: operationsActionGroup.id } ]
  }
}

var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var keyVaultCryptoUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')

resource websiteAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, website.id, acrPullRole)
  scope: registry
  properties: { principalId: website.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: acrPullRole }
}
resource automationAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, automation.id, acrPullRole)
  scope: registry
  properties: { principalId: automation.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: acrPullRole }
}
resource automationBlobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, automation.id, blobContributorRole)
  scope: storage
  properties: { principalId: automation.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobContributorRole }
}
resource websiteSecretsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, website.id, keyVaultSecretsUserRole)
  scope: vault
  properties: { principalId: website.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: keyVaultSecretsUserRole }
}
resource automationSecretsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, automation.id, keyVaultSecretsUserRole)
  scope: vault
  properties: { principalId: automation.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: keyVaultSecretsUserRole }
}
resource automationCryptoAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, automation.id, keyVaultCryptoUserRole)
  scope: vault
  properties: { principalId: automation.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: keyVaultCryptoUserRole }
}

output containerRegistry string = registry.properties.loginServer
output websiteAppName string = website.name
output websiteUrl string = 'https://${website.properties.defaultHostName}'
output automationAppName string = automation.name
output automationUrl string = 'https://${automation.properties.defaultHostName}'
output storageAccountName string = storage.name
output keyVaultName string = vault.name
