import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { registerRoutes } from "./routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerApiRoutes } from "./api-routes.js";
import { registerUserApiRoutes } from "./user-api-routes.js";
import { registerPaymentRoutes } from "./payment-routes.js";

// ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration for Hostinger frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'https://ai2pdf.in',
  'https://www.ai2pdf.in',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('Blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-token']
}));

// Middleware
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'API is running',
    version: 'v1.0.0',
    endpoints: {
      conversions: '/api/conversions',
      convert: '/api/convert',
      admin: '/api/admin',
      userApi: '/api/v1',
      payments: '/api/payments'
    },
    timestamp: new Date().toISOString()
  });
});

// Register all routes
async function setupRoutes() {
  try {
    // Main conversion routes
    const server = await registerRoutes(app);
    
    // Admin routes
    registerAdminRoutes(app);
    
    // API routes for developers
    registerApiRoutes(app);
    
    // User API routes
    registerUserApiRoutes(app);
    
    // Payment routes
    registerPaymentRoutes(app);
    
    console.log('✅ All routes registered successfully');
    return server;
  } catch (error) {
    console.error('❌ Error setting up routes:', error);
    throw error;
  }
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy violation' });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    availableEndpoints: [
      '/health',
      '/api/status',
      '/api/conversions',
      '/api/convert',
      '/api/admin',
      '/api/v1',
      '/api/payments'
    ]
  });
});

// Start server
async function startServer() {
  try {
    await setupRoutes();
    
    app.listen(PORT, () => {
      console.log(`🚀 Ai2PDF Backend Server running on port ${PORT}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log(`📡 API Status: http://localhost:${PORT}/api/status`);
      console.log(`🎯 Allowed origins: ${allowedOrigins.join(', ')}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();