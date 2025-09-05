import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from './db';
import { 
  userApiKeys, 
  apiPlans,
  conversions
} from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// Middleware to validate API keys
const validateApiKey = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const apiKey = authHeader.split(' ')[1];
    
    if (!apiKey || !apiKey.startsWith('ak_')) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    const db = getDb();
    // Hash the API key to check against database
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // Find the API key in database
    const keyResult = await db.select({
      id: userApiKeys.id,
      userToken: userApiKeys.userToken,
      planId: userApiKeys.planId,
      expiryDate: userApiKeys.expiryDate,
      isActive: userApiKeys.isActive,
      requestCount: userApiKeys.requestCount,
      planRequestLimit: apiPlans.requestLimit,
      planName: apiPlans.name,
    })
    .from(userApiKeys)
    .leftJoin(apiPlans, eq(userApiKeys.planId, apiPlans.id))
    .where(eq(userApiKeys.keyHash, keyHash))
    .limit(1);

    if (keyResult.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const keyData = keyResult[0];

    // Check if key is active
    if (!keyData.isActive) {
      return res.status(401).json({ error: 'API key is inactive' });
    }

    // Check if key has expired
    if (keyData.expiryDate && new Date() > new Date(keyData.expiryDate)) {
      return res.status(401).json({ error: 'API key has expired' });
    }

    // Check rate limits (monthly)
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    // For simplicity, we'll track monthly usage in the requestCount field
    // In a production system, you'd want a more sophisticated rate limiting system
    if (keyData.requestCount >= keyData.planRequestLimit) {
      return res.status(429).json({ 
        error: 'Monthly request limit exceeded',
        limit: keyData.planRequestLimit,
        used: keyData.requestCount
      });
    }

    // Add API key info to request for later use
    req.apiKey = {
      id: keyData.id,
      userToken: keyData.userToken,
      planId: keyData.planId,
      planName: keyData.planName,
      requestCount: keyData.requestCount,
      requestLimit: keyData.planRequestLimit,
    };

    next();
  } catch (error) {
    console.error('❌ API key validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// API conversion endpoint with validation
router.post('/convert', validateApiKey, async (req, res) => {
  try {
    const db = getDb();
    // Update request count
    await db.update(userApiKeys)
      .set({ 
        requestCount: req.apiKey.requestCount + 1,
        lastUsed: new Date()
      })
      .where(eq(userApiKeys.id, req.apiKey.id));

    // For now, return a mock response
    // In production, this would integrate with your actual conversion service
    res.json({
      success: true,
      message: 'File conversion initiated',
      conversionId: crypto.randomUUID(),
      status: 'processing',
      planInfo: {
        name: req.apiKey.planName,
        remainingRequests: req.apiKey.requestLimit - req.apiKey.requestCount - 1
      }
    });

  } catch (error) {
    console.error('❌ API conversion error:', error);
    res.status(500).json({ error: 'Conversion failed' });
  }
});

// API key info endpoint
router.get('/key-info', validateApiKey, async (req, res) => {
  try {
    res.json({
      success: true,
      keyInfo: {
        planName: req.apiKey.planName,
        requestCount: req.apiKey.requestCount,
        requestLimit: req.apiKey.requestLimit,
        remainingRequests: req.apiKey.requestLimit - req.apiKey.requestCount,
      }
    });
  } catch (error) {
    console.error('❌ API key info error:', error);
    res.status(500).json({ error: 'Failed to get key info' });
  }
});

// API health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;