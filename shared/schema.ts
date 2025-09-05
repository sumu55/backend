import { sql } from "drizzle-orm";
import { mysqlTable, text, varchar, timestamp, int, json, boolean, decimal } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const conversions = mysqlTable("conversions", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  fromFormat: text("from_format").notNull(),
  toFormat: text("to_format").notNull(),
  originalFilename: text("original_filename").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: int("file_size").notNull(),
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  downloadUrl: text("download_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
  metadata: json("metadata"),
});

// Users table
export const users = mysqlTable("users", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  email: varchar("email", { length: 255 }).unique(),
  name: varchar("name", { length: 255 }),
  authToken: varchar("auth_token", { length: 64 }).unique(),
  userType: text("user_type").notNull().default("visitor"), // visitor, free, pro, developer, admin, active
  isActive: boolean("is_active").default(false),
  apiKey: varchar("api_key", { length: 64 }).unique(),
  apiRequestCount: int("api_request_count").default(0),
  lastApiRequest: timestamp("last_api_request"),
  firstVisit: timestamp("first_visit").default(sql`CURRENT_TIMESTAMP`),
  lastActiveAt: timestamp("last_active_at"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  metadata: json("metadata"),
});

// Categories table
export const categories = mysqlTable("categories", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  icon: varchar("icon", { length: 100 }),
  color: varchar("color", { length: 7 }).default("#3B82F6"),
  isActive: boolean("is_active").default(true),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Tools table
export const tools = mysqlTable("tools", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  name: varchar("name", { length: 255 }).notNull(),
  folderName: varchar("folder_name", { length: 255 }).notNull().unique(),
  version: varchar("version", { length: 50 }).notNull().default("v1.0.0"),
  filePath: text("file_path").notNull(),
  categoryId: varchar("category_id", { length: 36 }),
  description: text("description"),
  keywords: text("keywords"),
  metaTitle: varchar("meta_title", { length: 255 }),
  metaDescription: text("meta_description"),
  isActive: boolean("is_active").default(true),
  usageCount: int("usage_count").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  metadata: json("metadata"),
});

// Analytics table
export const analytics = mysqlTable("analytics", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  eventType: text("event_type").notNull(), // page_view, api_call, tool_usage, conversion
  eventData: json("event_data"),
  userId: varchar("user_id", { length: 36 }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Ads revenue table
export const adsRevenue = mysqlTable("ads_revenue", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  platform: text("platform").notNull(), // google_adsense, adsterra, custom
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  revenue: decimal("revenue", { precision: 10, scale: 2 }).default("0.00"),
  cpm: decimal("cpm", { precision: 10, scale: 2 }).default("0.00"),
  date: timestamp("date").default(sql`CURRENT_TIMESTAMP`),
  metadata: json("metadata"),
});

// System settings table
export const systemSettings = mysqlTable("system_settings", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
});

// Activity logs table
export const activityLogs = mysqlTable("activity_logs", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userId: varchar("user_id", { length: 36 }),
  action: text("action").notNull(),
  details: json("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// API Plans table
export const apiPlans = mysqlTable("api_plans", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  name: varchar("name", { length: 100 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("INR"),
  requestLimit: int("request_limit").notNull(), // requests per month
  features: json("features"), // array of features
  isActive: boolean("is_active").default(true),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// User API Keys table
export const userApiKeys = mysqlTable("user_api_keys", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userToken: varchar("user_token", { length: 64 }).notNull(), // Changed from userId to userToken
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(), // Changed from apiKey to keyHash for security
  planId: varchar("plan_id", { length: 36 }),
  isActive: boolean("is_active").default(true), // Changed from status to isActive boolean
  requestCount: int("request_count").default(0),
  lastUsed: timestamp("last_used"),
  expiryDate: timestamp("expiry_date"), // Changed from expiresAt to expiryDate
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
  metadata: json("metadata"),
});

// API Payments table
export const apiPayments = mysqlTable("api_payments", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  userToken: varchar("user_token", { length: 64 }).notNull(), // Changed from userId to userToken
  planId: varchar("plan_id", { length: 36 }).notNull(),
  orderId: varchar("order_id", { length: 100 }), // Changed from razorpayOrderId to orderId
  paymentId: varchar("payment_id", { length: 100 }), // Changed from razorpayPaymentId to paymentId
  signature: varchar("signature", { length: 255 }), // Added signature field
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("INR"),
  status: text("status").notNull().default("pending"), // pending, completed, failed, refunded
  paymentMethod: varchar("payment_method", { length: 50 }),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  metadata: json("metadata"),
});

// API Usage Logs table
export const apiUsageLogs = mysqlTable("api_usage_logs", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
  apiKeyId: varchar("api_key_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  requestSize: int("request_size"),
  responseSize: int("response_size"),
  responseTime: int("response_time"), // in milliseconds
  statusCode: int("status_code"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Schema exports
export const insertConversionSchema = createInsertSchema(conversions).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
});

export const insertToolSchema = createInsertSchema(tools).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAnalyticsSchema = createInsertSchema(analytics).omit({
  id: true,
  createdAt: true,
});

export const insertAdsRevenueSchema = createInsertSchema(adsRevenue).omit({
  id: true,
  date: true,
});

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  updatedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export const insertApiPlanSchema = createInsertSchema(apiPlans).omit({
  id: true,
  createdAt: true,
});

export const insertUserApiKeySchema = createInsertSchema(userApiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertApiPaymentSchema = createInsertSchema(apiPayments).omit({
  id: true,
  createdAt: true,
});

export const insertApiUsageLogSchema = createInsertSchema(apiUsageLogs).omit({
  id: true,
  createdAt: true,
});

// Type exports
export type InsertConversion = z.infer<typeof insertConversionSchema>;
export type Conversion = typeof conversions.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;
export type InsertTool = z.infer<typeof insertToolSchema>;
export type Tool = typeof tools.$inferSelect;
export type InsertAnalytics = z.infer<typeof insertAnalyticsSchema>;
export type Analytics = typeof analytics.$inferSelect;
export type InsertAdsRevenue = z.infer<typeof insertAdsRevenueSchema>;
export type AdsRevenue = typeof adsRevenue.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertApiPlan = z.infer<typeof insertApiPlanSchema>;
export type ApiPlan = typeof apiPlans.$inferSelect;
export type InsertUserApiKey = z.infer<typeof insertUserApiKeySchema>;
export type UserApiKey = typeof userApiKeys.$inferSelect;
export type InsertApiPayment = z.infer<typeof insertApiPaymentSchema>;
export type ApiPayment = typeof apiPayments.$inferSelect;
export type InsertApiUsageLog = z.infer<typeof insertApiUsageLogSchema>;
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
