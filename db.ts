import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from "@shared/schema";

// These will be initialized in initializeDatabase
let connection: mysql.Connection;
let db: ReturnType<typeof drizzle>;

// Initialize database - create database if it doesn't exist
export async function initializeDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }

    const dbName = process.env.DATABASE_NAME || 'ai2pdf';
    const connectionWithoutDb = await mysql.createConnection({
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '3306'),
      user: process.env.DATABASE_USER || 'root',
      password: process.env.DATABASE_PASSWORD || 'password',
    });

    // Create database if it doesn't exist
    await connectionWithoutDb.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await connectionWithoutDb.end();

    // Initialize the main connection and db
    connection = await mysql.createConnection(process.env.DATABASE_URL);
    db = drizzle(connection, { schema, mode: 'default' });

    // Test the main connection
    await connection.ping();
    console.log('✅ Database connection established successfully');

    // Create tables if they don't exist
    await createTables();
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function createTables() {
  try {
    const createTablesSQL = [
      // Conversions table
      `CREATE TABLE IF NOT EXISTS conversions (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        from_format TEXT NOT NULL,
        to_format TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        download_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        metadata JSON
      )`,
      
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        auth_token VARCHAR(64) UNIQUE,
        user_type TEXT NOT NULL DEFAULT 'visitor',
        is_active BOOLEAN DEFAULT FALSE,
        api_key VARCHAR(64) UNIQUE,
        api_request_count INT DEFAULT 0,
        last_api_request TIMESTAMP NULL,
        first_visit TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_active_at TIMESTAMP NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        metadata JSON
      )`,
      
      // Categories table
      `CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        name VARCHAR(255) NOT NULL UNIQUE,
        slug VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        icon VARCHAR(100),
        color VARCHAR(7) DEFAULT '#3B82F6',
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,

      // Tools table
      `CREATE TABLE IF NOT EXISTS tools (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        name VARCHAR(255) NOT NULL,
        folder_name VARCHAR(255) NOT NULL UNIQUE,
        version VARCHAR(50) NOT NULL DEFAULT 'v1.0.0',
        file_path TEXT NOT NULL,
        category_id VARCHAR(36),
        description TEXT,
        keywords TEXT,
        meta_title VARCHAR(255),
        meta_description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        usage_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        metadata JSON,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      )`,
      
      // Analytics table
      `CREATE TABLE IF NOT EXISTS analytics (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        event_type TEXT NOT NULL,
        event_data JSON,
        user_id VARCHAR(36),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Ads revenue table
      `CREATE TABLE IF NOT EXISTS ads_revenue (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        platform TEXT NOT NULL,
        impressions INT DEFAULT 0,
        clicks INT DEFAULT 0,
        revenue DECIMAL(10,2) DEFAULT 0.00,
        cpm DECIMAL(10,2) DEFAULT 0.00,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metadata JSON
      )`,
      
      // System settings table
      `CREATE TABLE IF NOT EXISTS system_settings (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        \`key\` VARCHAR(255) NOT NULL UNIQUE,
        value TEXT,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      
      // Activity logs table
      `CREATE TABLE IF NOT EXISTS activity_logs (
        id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
        user_id VARCHAR(36),
        action TEXT NOT NULL,
        details JSON,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];
    
    for (const sql of createTablesSQL) {
      await connection.execute(sql);
    }
    
    console.log('✅ All database tables created/verified successfully');
    
    // Initialize default categories
    await initializeDefaultCategories();
  } catch (error) {
    console.error('❌ Failed to create tables:', error);
    throw error;
  }
}

async function initializeDefaultCategories() {
  try {
    // Check if categories already exist
    const [existingCategories] = await connection.execute('SELECT COUNT(*) as count FROM categories');
    
    if (existingCategories[0].count === 0) {
      const defaultCategories = [
        {
          id: 'pdf-tools',
          name: 'PDF Tools',
          slug: 'pdf-tools',
          description: 'Tools for PDF manipulation and processing',
          icon: 'fas fa-file-pdf',
          color: '#EF4444',
          sort_order: 1
        },
        {
          id: 'image-tools',
          name: 'Image Tools',
          slug: 'image-tools',
          description: 'Image editing and conversion tools',
          icon: 'fas fa-image',
          color: '#10B981',
          sort_order: 2
        },
        {
          id: 'text-tools',
          name: 'Text Tools',
          slug: 'text-tools',
          description: 'Text processing and editing utilities',
          icon: 'fas fa-font',
          color: '#3B82F6',
          sort_order: 3
        },
        {
          id: 'converter',
          name: 'Converters',
          slug: 'converter',
          description: 'File format conversion tools',
          icon: 'fas fa-exchange-alt',
          color: '#8B5CF6',
          sort_order: 4
        },
        {
          id: 'utilities',
          name: 'Utilities',
          slug: 'utilities',
          description: 'General purpose utility tools',
          icon: 'fas fa-tools',
          color: '#F59E0B',
          sort_order: 5
        },
        {
          id: 'security',
          name: 'Security',
          slug: 'security',
          description: 'Security and privacy tools',
          icon: 'fas fa-shield-alt',
          color: '#DC2626',
          sort_order: 6
        }
      ];

      for (const category of defaultCategories) {
        await connection.execute(`
          INSERT INTO categories (id, name, slug, description, icon, color, sort_order, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
        `, [
          category.id,
          category.name,
          category.slug,
          category.description,
          category.icon,
          category.color,
          category.sort_order
        ]);
      }
      
      console.log('✅ Default categories initialized');
    }
  } catch (error) {
    console.error('❌ Failed to initialize default categories:', error);
  }
}

// Export getters for connection and db
export function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return connection;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}