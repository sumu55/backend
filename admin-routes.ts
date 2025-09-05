import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { getDb } from "./db";
import { MockAdminStorage } from "./storage";
import { memoryUsers } from "./routes";
import { setDevelopmentApiSettings } from "./user-api-routes";
import { 
  users, tools, categories, analytics, adsRevenue, systemSettings, activityLogs, conversions,
  apiPlans, userApiKeys, apiPayments, apiUsageLogs,
  insertToolSchema, insertCategorySchema, insertUserSchema, insertAnalyticsSchema, insertAdsRevenueSchema,
  insertSystemSettingSchema, insertActivityLogSchema, insertApiPlanSchema, insertUserApiKeySchema,
  insertApiPaymentSchema, insertApiUsageLogSchema
} from "@shared/schema";
import { eq, desc, count, sum, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ZodError } from "zod";

// Mock storage for development mode
let developmentApiSettings = {
  api_service_enabled: 'false'
};

// Configure multer for tool uploads
const toolUpload = multer({
  dest: "tools/temp/",
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.html')) {
      cb(null, true);
    } else {
      cb(new Error('Only HTML files are allowed'));
    }
  },
});

// Admin authentication middleware
const requireAdmin = (req: any, res: any, next: any) => {
  console.log('Admin auth check:', {
    hasSession: !!req.session,
    adminAuthenticated: req.session?.adminAuthenticated,
    nodeEnv: process.env.NODE_ENV,
    referer: req.get('Referer'),
    userAgent: req.get('User-Agent')
  });

  // Check for admin session (set by our secure login)
  if (req.session && req.session.adminAuthenticated) {
    console.log('✅ Admin access granted via session');
    next();
  } else {
    // Check if request is coming from our secure admin page
    const referer = req.get('Referer') || '';
    const hasSecureReferer = referer.includes('/pd-od?accesskey=');
    
    if (hasSecureReferer || process.env.NODE_ENV === 'development') {
      console.log('⚠️  Admin API access granted - secure referer or dev mode');
      next();
    } else {
      console.log('❌ Admin access denied - no valid session or secure referer');
      return res.status(401).json({ error: 'Unauthorized - Admin session required' });
    }
  }
};

export function registerAdminRoutes(app: Express) {
  // Apply admin middleware to all admin routes
  app.use('/api/admin', requireAdmin);

  // Dashboard Overview
  app.get('/api/admin/dashboard', async (req, res) => {
    console.log('📊 Dashboard API called');
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        console.log('Using in-memory data for dashboard');
        // Use in-memory data
        const totalUsers = memoryUsers.size;
        const activeUsers = Array.from(memoryUsers.values()).filter(user => {
          const lastActive = new Date(user.lastActiveAt);
          const now = new Date();
          const diffMinutes = (now.getTime() - lastActive.getTime()) / (1000 * 60);
          return diffMinutes < 30; // Active in last 30 minutes
        }).length;

        // Count files in uploads directory
        let totalFiles = 0;
        try {
          const uploadDir = path.join(process.cwd(), 'uploads');
          const files = await fs.readdir(uploadDir);
          totalFiles = files.filter(file => file !== '.gitkeep').length;
        } catch (error) {
          totalFiles = 0;
        }

        res.json({
          users: { total: totalUsers, active: activeUsers },
          tools: { total: MockAdminStorage.getTools().length },
          files: { total: totalFiles }
        });
        return;
      }

      const db = getDb();
      
      // Get user counts
      const [totalUsers] = await db.select({ count: count() }).from(users);
      const [activeUsers] = await db.select({ count: count() }).from(users).where(eq(users.isActive, true));
      
      // Get tools count
      const [totalTools] = await db.select({ count: count() }).from(tools);
      
      // Get files count from conversions
      const [totalFiles] = await db.select({ count: count() }).from(conversions);

      res.json({
        users: {
          total: totalUsers.count,
          active: activeUsers.count
        },
        tools: {
          total: totalTools.count
        },
        files: {
          total: totalFiles.count
        }
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.json({
        users: { total: 0, active: 0 },
        tools: { total: 0 },
        files: { total: 0 }
      });
    }
  });

  // Get traffic analytics
  app.get('/api/admin/analytics/traffic', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        res.json(MockAdminStorage.getTrafficData());
        return;
      }

      const db = getDb();
      const { period = '7d' } = req.query;
      
      let dateFilter;
      switch (period) {
        case '24h':
          dateFilter = sql`created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`;
          break;
        case '7d':
          dateFilter = sql`created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
          break;
        case '30d':
          dateFilter = sql`created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
          break;
        default:
          dateFilter = sql`created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
      }
      
      const trafficData = await db.select({
        date: sql`DATE(created_at)`,
        pageViews: count(),
      })
      .from(analytics)
      .where(sql`event_type = 'page_view' AND ${dateFilter}`)
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`);

      res.json(trafficData);
    } catch (error) {
      console.error('Traffic analytics error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Ad Blocker Reporting
  app.post('/api/admin/ad-blocker-report', async (req, res) => {
    try {
      const report = req.body;
      console.log('🚨 Ad blocker detection report:', {
        timestamp: report.timestamp,
        userAgent: report.userAgent?.substring(0, 50) + '...',
        url: report.url,
        detectionResults: report.detectionResults?.length || 0,
        injectionAttempts: report.injectionAttempts,
        bypassAttempted: report.bypassAttempted
      });
      
      // Log to activity logs if database is available
      if (process.env.SKIP_DB_INIT !== 'true') {
        const db = getDb();
        await db.insert(activityLogs).values({
          id: randomUUID(),
          userId: 'system',
          action: 'ad_blocker_detected',
          details: JSON.stringify(report),
          ipAddress: req.ip || 'unknown'
        });
      }
      
      res.json({ success: true, message: 'Report received' });
    } catch (error) {
      console.error('Ad blocker report error:', error);
      res.status(500).json({ error: 'Failed to process report' });
    }
  });

  // Ad Blocker Reports endpoint
  app.get('/api/admin/ad-blocker-reports', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Return mock data when DB is skipped
        res.json([
          {
            timestamp: new Date().toISOString(),
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            url: 'http://localhost:5000/',
            screenResolution: '1920x1080',
            detectionResults: [{ isBlocked: true, method: 'element_visibility' }],
            injectionAttempts: 1,
            bypassAttempted: true
          }
        ]);
        return;
      }

      const db = getDb();
      
      // Get ad blocker detection reports from activity logs
      const reports = await db.select({
        id: activityLogs.id,
        timestamp: activityLogs.createdAt,
        details: activityLogs.details,
        ipAddress: activityLogs.ipAddress
      })
      .from(activityLogs)
      .where(sql`action = 'ad_blocker_detected'`)
      .orderBy(desc(activityLogs.createdAt))
      .limit(100);
      
      // Parse the details JSON and format the response
      const formattedReports = reports.map(report => {
        try {
          const details = typeof report.details === 'string' ? JSON.parse(report.details) : report.details;
          return {
            timestamp: report.timestamp,
            userAgent: details.userAgent || 'Unknown',
            url: details.url || 'Unknown',
            screenResolution: details.screenResolution || 'Unknown',
            detectionResults: details.detectionResults || [],
            injectionAttempts: details.injectionAttempts || 0,
            bypassAttempted: details.bypassAttempted || false,
            ipAddress: report.ipAddress
          };
        } catch (error) {
          console.error('Failed to parse ad blocker report details:', error);
          return {
            timestamp: report.timestamp,
            userAgent: 'Parse Error',
            url: 'Parse Error',
            screenResolution: 'Unknown',
            detectionResults: [],
            injectionAttempts: 0,
            bypassAttempted: false,
            ipAddress: report.ipAddress
          };
        }
      });
      
      res.json(formattedReports);
    } catch (error) {
      console.error('Ad blocker reports error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Ad Statistics endpoint
  app.get('/api/admin/ad-stats', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Return mock data when DB is skipped
        res.json({
          revenue: 0.00,
          adBlockerDetection: 0,
          bypassSuccess: 0,
          impressions: 0,
          bannerAdsCount: 1,
          interstitialAdsCount: 1
        });
        return;
      }

      const db = getDb();
      
      // Get ad blocker detection reports
      const adBlockerReports = await db.select({
        count: count()
      })
      .from(activityLogs)
      .where(sql`action = 'ad_blocker_detected' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
      
      // Get total users for calculating percentage
      const totalUsers = await db.select({ count: count() })
      .from(users)
      .where(sql`created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
      
      // Get ads revenue data
      const revenueData = await db.select({
        revenue: sum(adsRevenue.revenue)
      })
      .from(adsRevenue)
      .where(sql`date >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
      
      // Get ad impressions
      const impressionsData = await db.select({
        impressions: sum(adsRevenue.impressions)
      })
      .from(adsRevenue)
      .where(sql`date >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
      
      const adBlockerCount = adBlockerReports[0]?.count || 0;
      const totalUserCount = totalUsers[0]?.count || 1;
      const adBlockerPercentage = Math.round((adBlockerCount / totalUserCount) * 100);
      
      res.json({
        revenue: parseFloat(String(revenueData[0]?.revenue || 0)),
        adBlockerDetection: adBlockerPercentage,
        bypassSuccess: Math.max(0, 100 - adBlockerPercentage), // Simple calculation
        impressions: parseInt(String(impressionsData[0]?.impressions || 0)),
        bannerAdsCount: 1, // Can be made dynamic based on settings
        interstitialAdsCount: 1 // Can be made dynamic based on settings
      });
    } catch (error) {
      console.error('Ad stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Categories Management
  app.get('/api/admin/categories', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Return default categories
        const defaultCategories = [
          { id: 'pdf-tools', name: 'PDF Tools', slug: 'pdf-tools', icon: 'fas fa-file-pdf', color: '#EF4444', description: 'Tools for PDF manipulation' },
          { id: 'image-tools', name: 'Image Tools', slug: 'image-tools', icon: 'fas fa-image', color: '#10B981', description: 'Image editing and conversion tools' },
          { id: 'text-tools', name: 'Text Tools', slug: 'text-tools', icon: 'fas fa-font', color: '#3B82F6', description: 'Text processing utilities' },
          { id: 'converter', name: 'Converters', slug: 'converter', icon: 'fas fa-exchange-alt', color: '#8B5CF6', description: 'File format converters' },
          { id: 'utilities', name: 'Utilities', slug: 'utilities', icon: 'fas fa-tools', color: '#F59E0B', description: 'General purpose utilities' },
          { id: 'security', name: 'Security', slug: 'security', icon: 'fas fa-shield-alt', color: '#EF4444', description: 'Security and privacy tools' }
        ];
        res.json(defaultCategories);
        return;
      }

      const db = getDb();
      const categoriesList = await db.select().from(categories).orderBy(categories.sortOrder);
      res.json(categoriesList);
    } catch (error) {
      console.error('Categories list error:', error);
      res.json([]);
    }
  });

  // Tools Management
  app.get('/api/admin/tools', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        res.json(MockAdminStorage.getTools());
        return;
      }

      const db = getDb();
      const toolsList = await db.select().from(tools).orderBy(desc(tools.createdAt));
      res.json(toolsList);
    } catch (error) {
      console.error('Tools list error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/tools', toolUpload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No HTML file uploaded' });
      }

      const { 
        name, 
        description, 
        folderName, 
        version = 'v1.0.0', 
        categoryId,
        metaTitle,
        metaDescription,
        keywords
      } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Tool name is required' });
      }

      const finalFolderName = folderName || name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      
      // Create tool directory
      const toolDir = path.join(process.cwd(), 'tools', 'usertool', finalFolderName);
      await fs.mkdir(toolDir, { recursive: true });
      
      // Move uploaded file to tool directory
      const finalPath = path.join(toolDir, 'index.html');
      await fs.rename(req.file.path, finalPath);

      if (process.env.SKIP_DB_INIT !== 'true') {
        // Save to database
        const db = getDb();
        const toolData = {
          name,
          description: description || null,
          folderName: finalFolderName,
          version,
          filePath: finalPath,
          categoryId: categoryId || null,
          metaTitle: metaTitle || null,
          metaDescription: metaDescription || null,
          keywords: keywords || null,
          isActive: true,
          usageCount: 0,
          metadata: {
            originalFilename: req.file.originalname,
            fileSize: req.file.size,
            uploadedAt: new Date().toISOString()
          }
        };

        const validatedData = insertToolSchema.parse(toolData);
        const toolId = randomUUID();
        
        await db.insert(tools).values({
          id: toolId,
          ...validatedData
        });

        // Log activity
        await db.insert(activityLogs).values({
          id: randomUUID(),
          action: 'tool_created',
          details: { toolName: name, folderName: finalFolderName },
          ipAddress: req.ip
        });

        res.status(201).json({ 
          message: 'Tool created successfully',
          tool: { id: toolId, ...toolData },
          url: `/tools/${finalFolderName}`
        });
      } else {
        // Mock mode
        MockAdminStorage.addTool({
          name,
          description,
          folderName: finalFolderName,
          version,
          filePath: finalPath,
          categoryId,
          metaTitle,
          metaDescription,
          keywords,
          isActive: true
        });

        res.status(201).json({ 
          message: 'Tool created successfully',
          url: `/tools/${finalFolderName}`
        });
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: 'Invalid data', details: error.errors });
      }
      console.error('Tool creation error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.delete('/api/admin/tools/:id', async (req, res) => {
    try {
      const db = getDb();
      const toolId = req.params.id;
      
      // Get tool info
      const [tool] = await db.select().from(tools).where(eq(tools.id, toolId));
      if (!tool) {
        return res.status(404).json({ error: 'Tool not found' });
      }

      // Remove tool directory
      const toolDir = path.join(process.cwd(), 'tools', 'usertool', tool.folderName);
      try {
        await fs.rm(toolDir, { recursive: true, force: true });
      } catch (fsError) {
        console.warn('Failed to remove tool directory:', fsError);
      }

      // Remove from database
      await db.delete(tools).where(eq(tools.id, toolId));

      // Log activity
      await db.insert(activityLogs).values({
        id: randomUUID(),
        action: 'tool_deleted',
        details: { toolName: tool.name, folderName: tool.folderName },
        ipAddress: req.ip
      });

      res.json({ message: 'Tool deleted successfully' });
    } catch (error) {
      console.error('Tool deletion error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Users Management
  app.get('/api/admin/users', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Return in-memory users
        const usersList = Array.from(memoryUsers.values()).map(user => ({
          ...user,
          createdAt: user.firstVisit
        }));
        res.json(usersList);
        return;
      }

      const db = getDb();
      const usersList = await db.select().from(users).orderBy(desc(users.createdAt));
      res.json(usersList);
    } catch (error) {
      console.error('Users list error:', error);
      res.json([]);
    }
  });

  // Delete user
  app.delete('/api/admin/users/:id', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Delete from memory
        const userToDelete = Array.from(memoryUsers.entries()).find(([token, user]) => user.id === req.params.id);
        if (userToDelete) {
          memoryUsers.delete(userToDelete[0]);
        }
        res.json({ message: 'User deleted successfully' });
        return;
      }

      const db = getDb();
      await db.delete(users).where(eq(users.id, req.params.id));
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete all users
  app.delete('/api/admin/users', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Clear memory users
        memoryUsers.clear();
        res.json({ message: 'All users deleted successfully' });
        return;
      }

      const db = getDb();
      await db.delete(users);
      res.json({ message: 'All users deleted successfully' });
    } catch (error) {
      console.error('Delete all users error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Ads Management
  app.get('/api/admin/ads/revenue', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        res.json(MockAdminStorage.getRevenueData());
        return;
      }

      const db = getDb();
      const { period = '7d' } = req.query;
      
      let dateFilter;
      switch (period) {
        case '24h':
          dateFilter = sql`date >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`;
          break;
        case '7d':
          dateFilter = sql`date >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
          break;
        case '30d':
          dateFilter = sql`date >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
          break;
        default:
          dateFilter = sql`date >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
      }
      
      const revenueData = await db.select({
        date: sql`DATE(date)`,
        revenue: sum(adsRevenue.revenue),
        impressions: sum(adsRevenue.impressions),
        clicks: sum(adsRevenue.clicks),
        platform: adsRevenue.platform
      })
      .from(adsRevenue)
      .where(dateFilter)
      .groupBy(sql`DATE(date), platform`)
      .orderBy(sql`DATE(date)`);

      res.json(revenueData);
    } catch (error) {
      console.error('Ads revenue error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // System Settings
  app.get('/api/admin/settings', async (req, res) => {
    try {
      const db = getDb();
      const settings = await db.select().from(systemSettings);
      
      // Convert to key-value object
      const settingsObj = settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value || '';
        return acc;
      }, {} as Record<string, string>);
      
      res.json(settingsObj);
    } catch (error) {
      console.error('Settings error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/admin/settings', async (req, res) => {
    try {
      const db = getDb();
      const { key, value, description } = req.body;
      
      if (!key) {
        return res.status(400).json({ error: 'Setting key is required' });
      }

      // Upsert setting using a simpler approach
      const existingSetting = await db.select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key))
        .limit(1);
      
      if (existingSetting.length > 0) {
        // Update existing
        await db.update(systemSettings)
          .set({ value, description, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(systemSettings.key, key));
      } else {
        // Insert new
        await db.insert(systemSettings).values({
          id: randomUUID(),
          key,
          value,
          description
        });
      }

      res.json({ message: 'Setting updated successfully' });
    } catch (error) {
      console.error('Settings update error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // File Management
  app.get('/api/admin/files', async (req, res) => {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads');
      const files = await fs.readdir(uploadDir);
      
      const fileDetails = await Promise.all(
        files.filter(file => file !== '.gitkeep').map(async (file) => {
          const filePath = path.join(uploadDir, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            size: stats.size,
            modified: stats.mtime
          };
        })
      );

      res.json(fileDetails);
    } catch (error) {
      console.error('Files list error:', error);
      res.json([]);
    }
  });

  // Delete file
  app.delete('/api/admin/files/:filename', async (req, res) => {
    try {
      const filename = decodeURIComponent(req.params.filename);
      const filePath = path.join(process.cwd(), 'uploads', filename);
      
      await fs.unlink(filePath);
      res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete all files
  app.delete('/api/admin/files', async (req, res) => {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads');
      const files = await fs.readdir(uploadDir);
      
      await Promise.all(
        files.filter(file => file !== '.gitkeep').map(file => 
          fs.unlink(path.join(uploadDir, file))
        )
      );

      res.json({ message: 'All files deleted successfully' });
    } catch (error) {
      console.error('Delete all files error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete all data
  app.delete('/api/admin/delete-all', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT !== 'true') {
        const db = getDb();
        await db.delete(users);
        await db.delete(tools);
        await db.delete(conversions);
        await db.delete(analytics);
      }

      // Delete all files
      const uploadDir = path.join(process.cwd(), 'uploads');
      const files = await fs.readdir(uploadDir);
      await Promise.all(
        files.filter(file => file !== '.gitkeep').map(file => 
          fs.unlink(path.join(uploadDir, file))
        )
      );

      res.json({ message: 'All data deleted successfully' });
    } catch (error) {
      console.error('Delete all data error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Analytics endpoints
  app.get('/api/admin/analytics/users', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Generate analytics from memory users
        const usersByDate = new Map();
        Array.from(memoryUsers.values()).forEach(user => {
          const date = new Date(user.firstVisit).toISOString().split('T')[0];
          usersByDate.set(date, (usersByDate.get(date) || 0) + 1);
        });

        const data = Array.from(usersByDate.entries()).map(([date, count]) => ({
          date,
          count
        })).sort((a, b) => a.date.localeCompare(b.date));

        res.json(data);
        return;
      }

      const db = getDb();
      const data = await db.select({
        date: sql`DATE(created_at)`,
        count: count()
      })
      .from(users)
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`);

      res.json(data);
    } catch (error) {
      console.error('User analytics error:', error);
      res.json([]);
    }
  });

  app.get('/api/admin/analytics/files', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        res.json([]);
        return;
      }

      const db = getDb();
      const data = await db.select({
        date: sql`DATE(created_at)`,
        count: count()
      })
      .from(conversions)
      .groupBy(sql`DATE(created_at)`)
      .orderBy(sql`DATE(created_at)`);

      res.json(data);
    } catch (error) {
      console.error('File analytics error:', error);
      res.json([]);
    }
  });

  // ================================
  // API Management Endpoints
  // ================================

  // Get API system status
  app.get('/api/admin/api-status', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Use in-memory development settings
        const enabled = developmentApiSettings.api_service_enabled === 'true';
        res.json({ 
          enabled, 
          totalKeys: 0, 
          totalUsers: 0,
          totalRevenue: 0
        });
        return;
      }

      const db = getDb();
      
      // Get API service status from settings
      const [apiSetting] = await db.select()
        .from(systemSettings)
        .where(eq(systemSettings.key, 'api_service_enabled'));
      
      const enabled = apiSetting?.value === 'true';

      // Get API statistics
      const [totalKeys] = await db.select({ count: count() }).from(userApiKeys);
      const [activeUsers] = await db.select({ count: count() })
        .from(userApiKeys)
        .where(eq(userApiKeys.status, 'active'));
      
      const [totalRevenue] = await db.select({ total: sum(apiPayments.amount) })
        .from(apiPayments)
        .where(eq(apiPayments.status, 'completed'));

      res.json({
        enabled,
        totalKeys: totalKeys.count || 0,
        totalUsers: activeUsers.count || 0,
        totalRevenue: totalRevenue.total || 0
      });
    } catch (error) {
      console.error('API status error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Toggle API service
  app.post('/api/admin/toggle-api-service', async (req, res) => {
    try {
      const { enabled } = req.body;
      
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid enabled value' });
      }

      if (process.env.SKIP_DB_INIT === 'true') {
        // Store in development memory and sync with user-api-routes
        developmentApiSettings.api_service_enabled = enabled.toString();
        setDevelopmentApiSettings(developmentApiSettings);
        console.log(`🔧 API Service ${enabled ? 'enabled' : 'disabled'} (dev mode)`);
        res.json({ success: true, enabled });
        return;
      }

      const db = getDb();
      
      // Update or insert API service setting
      await db.insert(systemSettings)
        .values({
          id: randomUUID(),
          key: 'api_service_enabled',
          value: enabled.toString(),
          description: 'Controls whether API service is available to users'
        })
        .onDuplicateKeyUpdate({
          value: enabled.toString(),
          updatedAt: sql`CURRENT_TIMESTAMP`
        });

      // Log the change
      await db.insert(activityLogs).values({
        id: randomUUID(),
        userId: 'admin',
        action: 'api_service_toggled',
        details: JSON.stringify({ enabled, timestamp: new Date() }),
        ipAddress: req.ip || 'unknown'
      });

      console.log(`🔧 API Service ${enabled ? 'enabled' : 'disabled'} by admin`);
      res.json({ success: true, enabled });
    } catch (error) {
      console.error('Toggle API service error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get API plans
  app.get('/api/admin/api-plans', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        // Return default plans for development
        const defaultPlans = [
          {
            id: 'plan-basic',
            name: 'Basic API Access',
            price: 200,
            currency: 'INR',
            requestLimit: 1000,
            features: ['1000 API calls/month', 'Email support', 'Basic documentation'],
            isActive: true,
            sortOrder: 1
          },
          {
            id: 'plan-standard',
            name: 'Standard API Access',
            price: 600,
            currency: 'INR',
            requestLimit: 5000,
            features: ['5000 API calls/month', 'Priority support', 'Advanced documentation', 'Webhooks'],
            isActive: true,
            sortOrder: 2
          },
          {
            id: 'plan-premium',
            name: 'Premium API Access',
            price: 900,
            currency: 'INR',
            requestLimit: 10000,
            features: ['10000 API calls/month', 'Priority support', 'Complete documentation', 'Webhooks', 'Custom integrations'],
            isActive: true,
            sortOrder: 3
          }
        ];
        res.json(defaultPlans);
        return;
      }

      const db = getDb();
      const plans = await db.select().from(apiPlans).where(eq(apiPlans.isActive, true)).orderBy(apiPlans.sortOrder);
      res.json(plans);
    } catch (error) {
      console.error('API plans error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get API usage statistics
  app.get('/api/admin/api-usage', async (req, res) => {
    try {
      if (process.env.SKIP_DB_INIT === 'true') {
        res.json({
          totalRequests: 0,
          requestsToday: 0,
          topEndpoints: [],
          recentActivity: []
        });
        return;
      }

      const db = getDb();
      
      // Get total requests
      const [totalRequests] = await db.select({ count: count() }).from(apiUsageLogs);
      
      // Get requests today
      const [requestsToday] = await db.select({ count: count() })
        .from(apiUsageLogs)
        .where(sql`DATE(created_at) = CURDATE()`);
      
      // Get top endpoints
      const topEndpoints = await db.select({
        endpoint: apiUsageLogs.endpoint,
        count: count()
      })
      .from(apiUsageLogs)
      .groupBy(apiUsageLogs.endpoint)
      .orderBy(desc(count()))
      .limit(5);

      // Get recent activity
      const recentActivity = await db.select({
        endpoint: apiUsageLogs.endpoint,
        method: apiUsageLogs.method,
        statusCode: apiUsageLogs.statusCode,
        createdAt: apiUsageLogs.createdAt
      })
      .from(apiUsageLogs)
      .orderBy(desc(apiUsageLogs.createdAt))
      .limit(10);

      res.json({
        totalRequests: totalRequests.count || 0,
        requestsToday: requestsToday.count || 0,
        topEndpoints,
        recentActivity
      });
    } catch (error) {
      console.error('API usage error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}