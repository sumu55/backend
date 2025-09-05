import { type Conversion, type InsertConversion, conversions } from "@shared/schema";
import { randomUUID } from "crypto";
import { getDb } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  getConversion(id: string): Promise<Conversion | undefined>;
  createConversion(conversion: InsertConversion): Promise<Conversion>;
  updateConversion(id: string, updates: Partial<Conversion>): Promise<Conversion | undefined>;
  deleteConversion(id: string): Promise<boolean>;
  createBatchConversion(conversions: InsertConversion[]): Promise<Conversion[]>;
  getBatchConversions(batchId: string): Promise<Conversion[]>;
}

export class DatabaseStorage implements IStorage {
  async getConversion(id: string): Promise<Conversion | undefined> {
    const db = getDb();
    const [conversion] = await db.select().from(conversions).where(eq(conversions.id, id));
    return conversion || undefined;
  }

  async createConversion(insertConversion: InsertConversion): Promise<Conversion> {
    const db = getDb();
    const id = randomUUID();
    await db
      .insert(conversions)
      .values({
        id,
        ...insertConversion,
        metadata: insertConversion.metadata || null,
        status: insertConversion.status || "pending",
        downloadUrl: insertConversion.downloadUrl || null,
      });
    
    // Fetch the inserted record
    const [conversion] = await db.select().from(conversions).where(eq(conversions.id, id));
    return conversion;
  }

  async updateConversion(id: string, updates: Partial<Conversion>): Promise<Conversion | undefined> {
    const db = getDb();
    await db
      .update(conversions)
      .set(updates)
      .where(eq(conversions.id, id));
    
    // Fetch the updated record
    const [updated] = await db.select().from(conversions).where(eq(conversions.id, id));
    return updated || undefined;
  }

  async deleteConversion(id: string): Promise<boolean> {
    const db = getDb();
    const result = await db.delete(conversions).where(eq(conversions.id, id));
    return (result as any).affectedRows > 0;
  }

  async createBatchConversion(batchConversions: InsertConversion[]): Promise<Conversion[]> {
    const db = getDb();
    const batchId = randomUUID();
    const conversionsWithBatch = batchConversions.map(conv => ({
      id: randomUUID(),
      ...conv,
      metadata: { 
        ...(conv.metadata as Record<string, any> || {}), 
        batchId,
        batchSize: batchConversions.length 
      },
      status: conv.status || "pending",
      downloadUrl: conv.downloadUrl || null,
    }));
    
    await db
      .insert(conversions)
      .values(conversionsWithBatch);
    
    // Fetch the inserted records by batchId
    return this.getBatchConversions(batchId);
  }

  async getBatchConversions(batchId: string): Promise<Conversion[]> {
    const db = getDb();
    // Use MySQL JSON_EXTRACT function to query JSON field
    const result = await db.select().from(conversions);
    return result.filter(conv => 
      conv.metadata && 
      typeof conv.metadata === 'object' && 
      'batchId' in conv.metadata && 
      conv.metadata.batchId === batchId
    );
  }
}

// Mock storage for testing without database
class MockStorage implements IStorage {
  private conversions: Map<string, Conversion> = new Map();

  async getConversion(id: string): Promise<Conversion | undefined> {
    return this.conversions.get(id);
  }

  async createConversion(insertConversion: InsertConversion): Promise<Conversion> {
    const id = randomUUID();
    const conversion: Conversion = {
      id,
      ...insertConversion,
      createdAt: new Date(),
      completedAt: null,
      metadata: insertConversion.metadata || null,
      status: insertConversion.status || "pending",
      downloadUrl: insertConversion.downloadUrl || null,
    };
    this.conversions.set(id, conversion);
    return conversion;
  }

  async updateConversion(id: string, updates: Partial<Conversion>): Promise<Conversion | undefined> {
    const existing = this.conversions.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.conversions.set(id, updated);
    return updated;
  }

  async deleteConversion(id: string): Promise<boolean> {
    return this.conversions.delete(id);
  }

  async createBatchConversion(batchConversions: InsertConversion[]): Promise<Conversion[]> {
    const batchId = randomUUID();
    const results: Conversion[] = [];
    
    for (const conv of batchConversions) {
      const conversion = await this.createConversion({
        ...conv,
        metadata: { 
          ...(conv.metadata as Record<string, any> || {}), 
          batchId,
          batchSize: batchConversions.length 
        },
      });
      results.push(conversion);
    }
    
    return results;
  }

  async getBatchConversions(batchId: string): Promise<Conversion[]> {
    return Array.from(this.conversions.values()).filter(conv => 
      conv.metadata && 
      typeof conv.metadata === 'object' && 
      'batchId' in conv.metadata && 
      conv.metadata.batchId === batchId
    );
  }
}

// Mock admin functions for testing
export class MockAdminStorage {
  private static tools: any[] = [
    {
      id: '1',
      name: 'PDF Splitter',
      folderName: 'pdf-splitter',
      version: 'v1.0.0',
      isActive: true,
      usageCount: 150,
      createdAt: new Date('2024-01-15')
    },
    {
      id: '2', 
      name: 'Image Converter',
      folderName: 'image-converter',
      version: 'v1.2.0',
      isActive: true,
      usageCount: 89,
      createdAt: new Date('2024-02-01')
    }
  ];

  static getDashboardData() {
    return {
      users: { total: 1250, pro: 89, developers: 23 },
      tools: { active: this.tools.filter(t => t.isActive).length },
      api: { requestsToday: 456 },
      ads: { revenueToday: 23.45, impressionsToday: 12500, clicksToday: 89 }
    };
  }

  static getTools() {
    return this.tools;
  }

  static addTool(tool: any) {
    const newTool = {
      id: randomUUID(),
      ...tool,
      usageCount: 0,
      createdAt: new Date()
    };
    this.tools.push(newTool);
    return newTool;
  }

  static deleteTool(id: string) {
    const index = this.tools.findIndex(t => t.id === id);
    if (index > -1) {
      this.tools.splice(index, 1);
      return true;
    }
    return false;
  }

  static getTrafficData() {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        pageViews: Math.floor(Math.random() * 1000) + 500
      });
    }
    return data;
  }

  static getRevenueData() {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      data.push({
        date: date.toISOString().split('T')[0],
        revenue: (Math.random() * 50 + 10).toFixed(2),
        impressions: Math.floor(Math.random() * 5000) + 1000,
        clicks: Math.floor(Math.random() * 100) + 20,
        platform: 'google_adsense'
      });
    }
    return data;
  }

  static getUsers() {
    return [
      { email: 'user1@example.com', userType: 'free', apiRequestCount: 45 },
      { email: 'user2@example.com', userType: 'pro', apiRequestCount: 234 },
      { email: 'dev@example.com', userType: 'developer', apiRequestCount: 1250 }
    ];
  }
}

// Use mock storage if database is skipped, otherwise use database storage
export const storage = new MockStorage(); // Always use mock storage for now
