import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { storage } from "./storage";
import { insertConversionSchema, users, tools, categories, insertUserSchema } from "@shared/schema";
import { ZodError } from "zod";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { eq } from "drizzle-orm";
import { MockAdminStorage } from "./storage";
import { generateSitemapXML, generateCategorySitemaps } from "../client/src/lib/sitemap";

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  },
});

// In-memory user storage for when database is disabled
const memoryUsers = new Map();

// User tracking middleware
const trackUser = async (req: any, res: any, next: any) => {
  try {
    const userToken = req.headers['x-user-token'] || req.cookies['user-token'] || randomUUID();
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (process.env.SKIP_DB_INIT === 'true') {
      // Use in-memory storage
      if (!memoryUsers.has(userToken)) {
        memoryUsers.set(userToken, {
          id: randomUUID(),
          authToken: userToken,
          userType: 'visitor',
          isActive: true,
          firstVisit: new Date(),
          lastActiveAt: new Date(),
          ipAddress,
          userAgent,
          metadata: { source: 'website' }
        });
        console.log(`New user tracked: ${userToken} (Total: ${memoryUsers.size})`);
      } else {
        // Update last active
        const user = memoryUsers.get(userToken);
        user.lastActiveAt = new Date();
        user.isActive = true;
        memoryUsers.set(userToken, user);
      }
    } else {
      // Use database
      const db = getDb();
      
      // Check if user exists
      const [existingUser] = await db.select().from(users).where(eq(users.authToken, userToken));
      
      if (!existingUser) {
        // Create new user
        await db.insert(users).values({
          id: randomUUID(),
          authToken: userToken,
          userType: 'visitor',
          isActive: true,
          firstVisit: new Date(),
          lastActiveAt: new Date(),
          ipAddress,
          userAgent,
          metadata: { source: 'website' }
        });
        console.log(`New user tracked in DB: ${userToken}`);
      } else {
        // Update last active
        await db.update(users)
          .set({ 
            lastActiveAt: new Date(),
            isActive: true 
          })
          .where(eq(users.id, existingUser.id));
      }
    }

    // Set cookie for future requests
    res.cookie('user-token', userToken, { 
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: true 
    });

    req.userToken = userToken;
    next();
  } catch (error) {
    console.error('User tracking error:', error);
    next();
  }
};

// Export memory users for admin access
export { memoryUsers };

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply user tracking to all routes
  app.use(trackUser);

  // Get conversion by ID
  app.get("/api/conversions/:id", async (req, res) => {
    try {
      const conversion = await storage.getConversion(req.params.id);
      if (!conversion) {
        return res.status(404).json({ error: "Conversion not found" });
      }
      res.json(conversion);
    } catch (error) {
      console.error("Error fetching conversion:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get batch conversions by batch ID
  app.get("/api/conversions/batch/:batchId", async (req, res) => {
    try {
      const conversions = await storage.getBatchConversions(req.params.batchId);
      res.json(conversions);
    } catch (error) {
      console.error("Error fetching batch conversions:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Legacy conversion endpoint for backward compatibility
  app.post("/api/convert", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { fromFormat, toFormat, quality, settings } = req.body;
      
      if (!fromFormat || !toFormat) {
        return res.status(400).json({ message: "fromFormat and toFormat are required" });
      }

      // Parse advanced settings if provided
      let parsedSettings = {};
      if (settings) {
        try {
          parsedSettings = JSON.parse(settings);
        } catch (error) {
          console.warn("Invalid settings JSON:", settings);
        }
      }

      // Create conversion record using new schema
      const conversionData = {
        fromFormat,
        toFormat,
        originalFilename: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        status: "pending" as const,
        metadata: {
          quality: quality || "high",
          settings: parsedSettings,
          uploadedFileName: req.file.filename,
          originalName: req.file.originalname,
          mimetype: req.file.mimetype,
        },
      };

      const validatedData = insertConversionSchema.parse(conversionData);
      const conversion = await storage.createConversion(validatedData);

      // Simulate file conversion process
      setTimeout(async () => {
        try {
          console.log(`Starting conversion for ${conversion.id}`);
          const processingTime = quality === "high" ? 3000 : quality === "medium" ? 2000 : 1000;
          await new Promise(resolve => setTimeout(resolve, processingTime));
          
          console.log(`Updating conversion ${conversion.id} to completed`);
          await storage.updateConversion(conversion.id, {
            status: "completed",
            downloadUrl: `/api/download/${conversion.id}`,
            completedAt: new Date(),
          });
          console.log(`Conversion ${conversion.id} completed successfully`);
        } catch (error) {
          console.error("Error processing conversion:", error);
          await storage.updateConversion(conversion.id, {
            status: "failed",
          });
        }
      }, 100);

      res.json(conversion);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Conversion error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // New conversion endpoint
  app.post("/api/conversions", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { fromFormat, toFormat, quality, settings } = req.body;

      if (!fromFormat || !toFormat) {
        return res.status(400).json({ error: "Missing format parameters" });
      }

      // Parse advanced settings if provided
      let parsedSettings = {};
      if (settings) {
        try {
          parsedSettings = JSON.parse(settings);
        } catch (error) {
          console.warn("Invalid settings JSON:", settings);
        }
      }

      const conversionData = {
        fromFormat,
        toFormat,
        originalFilename: req.file.originalname,
        filePath: req.file.path,
        fileSize: req.file.size,
        status: "pending" as const,
        metadata: {
          quality: quality || "high",
          settings: parsedSettings,
        },
      };

      // Validate with schema
      const validatedData = insertConversionSchema.parse(conversionData);
      
      const conversion = await storage.createConversion(validatedData);

      // Simulate processing
      setTimeout(async () => {
        try {
          const processingTime = quality === "high" ? 3000 : quality === "medium" ? 2000 : 1000;
          await new Promise(resolve => setTimeout(resolve, processingTime));
          
          await storage.updateConversion(conversion.id, {
            status: "completed",
            downloadUrl: `/api/download/${conversion.id}`,
            completedAt: new Date(),
          });
        } catch (error) {
          console.error("Error processing conversion:", error);
          await storage.updateConversion(conversion.id, {
            status: "failed",
          });
        }
      }, 100);

      res.status(201).json(conversion);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error creating conversion:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Batch conversion endpoint
  app.post("/api/conversions/batch", upload.array("files", 10), async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const { fromFormat, toFormat, quality, settings } = req.body;

      if (!fromFormat || !toFormat) {
        return res.status(400).json({ error: "Missing format parameters" });
      }

      // Parse advanced settings if provided
      let parsedSettings = {};
      if (settings) {
        try {
          parsedSettings = JSON.parse(settings);
        } catch (error) {
          console.warn("Invalid settings JSON:", settings);
        }
      }

      // Create conversion data for each file
      const conversionsData = files.map(file => ({
        fromFormat,
        toFormat,
        originalFilename: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        status: "pending" as const,
        metadata: {
          quality: quality || "high",
          settings: parsedSettings,
          isBatch: true,
        },
      }));

      // Validate each conversion
      const validatedConversions = conversionsData.map(data => 
        insertConversionSchema.parse(data)
      );

      // Create batch conversion
      const conversions = await storage.createBatchConversion(validatedConversions);

      // Process each conversion asynchronously
      conversions.forEach((conversion, index) => {
        setTimeout(async () => {
          try {
            const processingTime = (quality === "high" ? 3000 : quality === "medium" ? 2000 : 1000) + (index * 500);
            await new Promise(resolve => setTimeout(resolve, processingTime));
            
            await storage.updateConversion(conversion.id, {
              status: "completed",
              downloadUrl: `/api/download/${conversion.id}`,
              completedAt: new Date(),
            });
          } catch (error) {
            console.error(`Error processing conversion ${conversion.id}:`, error);
            await storage.updateConversion(conversion.id, {
              status: "failed",
            });
          }
        }, 100 + (index * 100));
      });

      res.status(201).json({
        batchId: (conversions[0].metadata as any)?.batchId,
        conversions,
        totalFiles: conversions.length,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      console.error("Error creating batch conversion:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Download converted file
  app.get("/api/download/:id", async (req, res) => {
    try {
      const conversion = await storage.getConversion(req.params.id);
      if (!conversion) {
        return res.status(404).json({ error: "Conversion not found" });
      }

      if (conversion.status !== "completed") {
        return res.status(400).json({ error: "Conversion not completed" });
      }

      const filePath = conversion.filePath;
      
      try {
        await fs.access(filePath);
        const ext = path.extname(conversion.originalFilename);
        const baseName = path.basename(conversion.originalFilename, ext);
        const filename = `${baseName}_converted.${conversion.toFormat}`;
        res.download(filePath, filename);
      } catch (error) {
        res.status(404).json({ error: "File not found" });
      }
    } catch (error) {
      console.error("Error downloading file:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Batch download endpoint
  app.get("/api/download/batch/:batchId", async (req, res) => {
    try {
      const conversions = await storage.getBatchConversions(req.params.batchId);
      
      if (conversions.length === 0) {
        return res.status(404).json({ error: "Batch not found" });
      }

      const completedConversions = conversions.filter(c => c.status === "completed");
      
      if (completedConversions.length === 0) {
        return res.status(400).json({ error: "No completed conversions in batch" });
      }

      // For now, return the first file (in real implementation, create ZIP)
      const firstConversion = completedConversions[0];
      const filePath = firstConversion.filePath;
      
      try {
        await fs.access(filePath);
        const filename = `batch_${req.params.batchId}.zip`;
        res.download(filePath, filename);
      } catch (error) {
        res.status(404).json({ error: "Files not found" });
      }
    } catch (error) {
      console.error("Error downloading batch:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Sitemap generation endpoints
  app.get("/sitemap.xml", (req, res) => {
    try {
      const sitemap = generateSitemapXML();
      res.set('Content-Type', 'application/xml');
      res.send(sitemap);
    } catch (error) {
      console.error('Error generating sitemap:', error);
      res.status(500).json({ error: 'Failed to generate sitemap' });
    }
  });

  // Category-specific sitemaps
  app.get("/sitemap-:category.xml", (req, res) => {
    try {
      const { category } = req.params;
      const categorySitemaps = generateCategorySitemaps();
      
      if (!categorySitemaps[category]) {
        return res.status(404).json({ error: 'Category sitemap not found' });
      }
      
      res.set('Content-Type', 'application/xml');
      res.send(categorySitemaps[category]);
    } catch (error) {
      console.error('Error generating category sitemap:', error);
      res.status(500).json({ error: 'Failed to generate category sitemap' });
    }
  });

  // API endpoint for sitemap data
  app.get("/api/sitemap", (req, res) => {
    try {
      const sitemap = generateSitemapXML();
      res.json({ sitemap });
    } catch (error) {
      console.error('Error generating sitemap data:', error);
      res.status(500).json({ error: 'Failed to generate sitemap data' });
    }
  });

  // Test route to trigger user tracking
  app.get("/api/track-user", (req, res) => {
    res.json({ 
      message: "User tracked successfully", 
      userToken: req.userToken,
      totalUsers: process.env.SKIP_DB_INIT === 'true' ? memoryUsers.size : 'DB mode'
    });
  });

  // Homepage route that triggers user tracking
  // Instead of redirecting, let client-side routing handle the path
  // app.get("/", (req, res) => {
  //   // User tracking middleware already ran, just redirect to main app
  //   res.redirect('/convert/pdf-to-word');
  // });

  // Tools listing page
  app.get("/tools", async (req, res) => {
    try {
      let toolsList = [];
      let categoriesList = [];

      if (process.env.SKIP_DB_INIT !== 'true') {
        const db = getDb();
        toolsList = await db.select().from(tools).where(eq(tools.isActive, true));
        categoriesList = await db.select().from(categories).where(eq(categories.isActive, true));
      } else {
        // Mock data
        toolsList = MockAdminStorage.getTools().filter(tool => tool.isActive);
        categoriesList = [
          { id: 'pdf-tools', name: 'PDF Tools', icon: 'fas fa-file-pdf', color: '#EF4444' },
          { id: 'image-tools', name: 'Image Tools', icon: 'fas fa-image', color: '#10B981' },
          { id: 'text-tools', name: 'Text Tools', icon: 'fas fa-font', color: '#3B82F6' },
          { id: 'converter', name: 'Converters', icon: 'fas fa-exchange-alt', color: '#8B5CF6' },
          { id: 'utilities', name: 'Utilities', icon: 'fas fa-tools', color: '#F59E0B' },
          { id: 'security', name: 'Security', icon: 'fas fa-shield-alt', color: '#DC2626' }
        ];
      }

      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Tools - Ai2PDF</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
            <style>
                .tool-card {
                    transition: all 0.3s ease;
                    transform-style: preserve-3d;
                }
                .tool-card:hover {
                    transform: translateY(-5px) rotateX(5deg);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
                }
                .category-badge {
                    background: linear-gradient(135deg, var(--category-color), var(--category-color-dark));
                }
            </style>
        </head>
        <body class="bg-gray-50 min-h-screen">
            <div class="container mx-auto px-4 py-8">
                <div class="text-center mb-12">
                    <h1 class="text-4xl font-bold text-gray-800 mb-4">Available Tools</h1>
                    <p class="text-xl text-gray-600">Choose from our collection of powerful PDF and utility tools</p>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    ${toolsList.map(tool => `
                        <div class="tool-card bg-white rounded-xl shadow-lg overflow-hidden">
                            <div class="p-6">
                                <div class="flex items-center justify-between mb-4">
                                    <div class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <i class="fas fa-tools text-blue-600 text-xl"></i>
                                    </div>
                                    <span class="category-badge text-white text-xs px-3 py-1 rounded-full" 
                                          style="--category-color: #3B82F6; --category-color-dark: #2563EB;">
                                        ${tool.categoryId || 'General'}
                                    </span>
                                </div>
                                
                                <h3 class="text-xl font-bold text-gray-800 mb-2">${tool.name}</h3>
                                <p class="text-gray-600 mb-4">${tool.description || 'A powerful tool for your needs'}</p>
                                
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center text-sm text-gray-500">
                                        <i class="fas fa-eye mr-1"></i>
                                        <span>${tool.usageCount || 0} uses</span>
                                    </div>
                                    <a href="/tools/${tool.folderName}" 
                                       class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                                        Use Tool
                                    </a>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>

                ${toolsList.length === 0 ? `
                    <div class="text-center py-16">
                        <div class="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
                            <i class="fas fa-tools text-gray-400 text-3xl"></i>
                        </div>
                        <h3 class="text-2xl font-bold text-gray-600 mb-4">No Tools Available</h3>
                        <p class="text-gray-500">Tools will appear here once they are added by administrators.</p>
                    </div>
                ` : ''}

                <div class="text-center mt-12">
                    <a href="/" class="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors">
                        <i class="fas fa-home mr-2"></i>Back to Home
                    </a>
                </div>
            </div>
        </body>
        </html>
      `);
    } catch (error) {
      console.error('Error loading tools page:', error);
      res.status(500).send('Internal server error');
    }
  });

  // Serve user tools
  app.get("/tools/:toolName", async (req, res) => {
    try {
      const toolName = req.params.toolName;
      const toolPath = path.join(process.cwd(), 'tools', 'usertool', toolName, 'index.html');
      
      // Check if tool exists
      try {
        await fs.access(toolPath);
        res.sendFile(toolPath);
      } catch (error) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Tool Not Found - Ai2PDF</title>
              <script src="https://cdn.tailwindcss.com"></script>
          </head>
          <body class="bg-gray-100 min-h-screen flex items-center justify-center">
              <div class="text-center">
                  <div class="mb-8">
                      <i class="fas fa-tools text-6xl text-gray-400"></i>
                  </div>
                  <h1 class="text-3xl font-bold text-gray-800 mb-4">Tool Not Found</h1>
                  <p class="text-gray-600 mb-8">The tool "${toolName}" could not be found.</p>
                  <a href="/" class="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors">
                      Back to Home
                  </a>
              </div>
          </body>
          </html>
        `);
      }
    } catch (error) {
      console.error('Error serving tool:', error);
      res.status(500).send('Internal server error');
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}