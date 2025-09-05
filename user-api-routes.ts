import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from './db';
import { 
  systemSettings,
  userApiKeys, 
  apiPlans,
  insertUserApiKeySchema
} from '@shared/schema';
import { eq, and } from 'drizzle-orm';

// Import the development API settings from admin-routes
// In development mode, we need to check the same in-memory storage
let developmentApiSettings: { api_service_enabled: string } | null = null;

// Function to get development settings (will be called from admin-routes)
export function setDevelopmentApiSettings(settings: { api_service_enabled: string }) {
  developmentApiSettings = settings;
  console.log('🔄 Development API settings updated:', settings);
}

export function getDevelopmentApiSettings() {
  return developmentApiSettings || { api_service_enabled: 'false' };
}

const router = Router();

// Check API service status
router.get('/api-status', async (req, res) => {
  try {
    if (process.env.SKIP_DB_INIT === 'true') {
      // Use in-memory development settings
      const devSettings = getDevelopmentApiSettings();
      const enabled = devSettings.api_service_enabled === 'true';
      
      res.json({
        enabled,
        message: enabled ? 'API service is active' : 'API service is currently disabled by admin'
      });
      return;
    }
    
    const db = getDb();
    const settings = await db.select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'api_service_enabled'))
      .limit(1);

    const enabled = settings.length > 0 ? settings[0].value === 'true' : false;

    res.json({
      enabled,
      message: enabled ? 'API service is active' : 'API service is currently disabled by admin'
    });

  } catch (error) {
    console.error('❌ Error checking API status:', error);
    res.status(500).json({ 
      enabled: false, 
      message: 'Failed to check API status' 
    });
  }
});

// Get user's API keys
router.get('/api-keys', async (req, res) => {
  try {
    const userToken = req.userToken;
    
    if (process.env.SKIP_DB_INIT === 'true') {
      // Use in-memory development settings
      const devSettings = getDevelopmentApiSettings();
      const enabled = devSettings.api_service_enabled === 'true';
      
      if (!enabled) {
        return res.json({
          locked: true,
          message: 'API service is currently disabled by admin'
        });
      }
      
      // Return empty keys for development
      return res.json({
        locked: false,
        keys: []
      });
    }
    
    const db = getDb();

    // Check if API service is enabled
    const settings = await db.select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'api_service_enabled'))
      .limit(1);

    const enabled = settings.length > 0 ? settings[0].value === 'true' : false;

    if (!enabled) {
      return res.json({
        locked: true,
        message: 'API service is currently disabled by admin'
      });
    }

    // Get user's API keys
    const apiKeys = await db.select({
      id: userApiKeys.id,
      apiKey: userApiKeys.keyHash, // We'll mask this in the response
      planId: userApiKeys.planId,
      status: userApiKeys.isActive,
      requestCount: userApiKeys.requestCount,
      lastUsed: userApiKeys.lastUsed,
      expiresAt: userApiKeys.expiryDate,
      createdAt: userApiKeys.createdAt,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.userToken, userToken))
    .orderBy(userApiKeys.createdAt);

    // Mask API keys for security (show only last 8 characters)
    const maskedKeys = apiKeys.map(key => ({
      ...key,
      apiKey: `ak_${'*'.repeat(40)}${key.apiKey.slice(-8)}`, // Show pattern + last 8 chars
      status: key.status ? 'active' : 'inactive'
    }));

    res.json({
      locked: false,
      keys: maskedKeys
    });

  } catch (error) {
    console.error('❌ Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Get available API plans
router.get('/api-plans', async (req, res) => {
  try {
    const db = getDb();
    const plans = await db.select()
      .from(apiPlans)
      .where(eq(apiPlans.isActive, true))
      .orderBy(apiPlans.price);

    res.json(plans);

  } catch (error) {
    console.error('❌ Error fetching API plans:', error);
    res.status(500).json({ error: 'Failed to fetch API plans' });
  }
});

// Generate new API key (requires active subscription)
router.post('/generate-api-key', async (req, res) => {
  try {
    const userToken = req.userToken;
    
    if (process.env.SKIP_DB_INIT === 'true') {
      // Use in-memory development settings
      const devSettings = getDevelopmentApiSettings();
      const enabled = devSettings.api_service_enabled === 'true';
      
      if (!enabled) {
        return res.status(403).json({ 
          error: 'API service is currently disabled by admin' 
        });
      }
      
      // Return mock response for development
      return res.status(400).json({ 
        error: 'No active subscription found. Please subscribe to a plan first.' 
      });
    }
    
    const db = getDb();

    // Check if API service is enabled
    const settings = await db.select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'api_service_enabled'))
      .limit(1);

    const enabled = settings.length > 0 ? settings[0].value === 'true' : false;

    if (!enabled) {
      return res.status(403).json({ 
        error: 'API service is currently disabled by admin' 
      });
    }

    // Check if user has an active subscription
    const activeKey = await db.select()
      .from(userApiKeys)
      .where(and(
        eq(userApiKeys.userToken, userToken),
        eq(userApiKeys.isActive, true)
      ))
      .limit(1);

    if (activeKey.length === 0) {
      return res.status(400).json({ 
        error: 'Active subscription required to generate API keys' 
      });
    }

    // Check if user already has a key (limit one per subscription)
    const existingKeys = await db.select()
      .from(userApiKeys)
      .where(eq(userApiKeys.userToken, userToken));

    if (existingKeys.length >= 3) { // Limit to 3 keys per user
      return res.status(400).json({ 
        error: 'Maximum number of API keys reached (3)' 
      });
    }

    // Generate new API key
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Use the same plan as the active subscription
    const newKeyData = {
      userToken,
      keyHash,
      planId: activeKey[0].planId,
      expiryDate: activeKey[0].expiryDate,
      isActive: true,
    };

    const validatedKey = insertUserApiKeySchema.parse(newKeyData);
    const [insertedKey] = await db.insert(userApiKeys).values(validatedKey).returning();

    console.log('✅ New API key generated for user:', userToken);

    res.json({
      id: insertedKey.id,
      apiKey: apiKey, // Return the actual key only once
      planId: insertedKey.planId,
      status: 'active',
      requestCount: 0,
      lastUsed: null,
      expiresAt: insertedKey.expiryDate,
      createdAt: insertedKey.createdAt,
    });

  } catch (error) {
    console.error('❌ Error generating API key:', error);
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Revoke API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const userToken = req.userToken;
    const { keyId } = req.params;
    const db = getDb();

    // Update key to inactive
    await db.update(userApiKeys)
      .set({ isActive: false })
      .where(and(
        eq(userApiKeys.id, keyId),
        eq(userApiKeys.userToken, userToken)
      ));

    res.json({ message: 'API key revoked successfully' });

  } catch (error) {
    console.error('❌ Error revoking API key:', error);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;