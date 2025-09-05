import dotenv from 'dotenv';
dotenv.config();

import express, { type Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import { registerRoutes } from "./routes";
import { registerAdminRoutes } from "./admin-routes";
import paymentRoutes from "./payment-routes.js";
import userApiRoutes from "./user-api-routes.js";
import apiRoutes from "./api-routes.js";
import { setupVite, serveStatic, log } from "./vite";
import { initializeDatabase } from "./db";
import path from "path";

const app = express();

// Enhanced CORS middleware for development and production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000', 
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    // Add your production domain here
    process.env.DOMAIN ? `https://${process.env.DOMAIN}` : null,
    process.env.DOMAIN ? `http://${process.env.DOMAIN}` : null,
    process.env.BASE_URL
  ].filter(Boolean);
  
  // Allow all origins in development, specific origins in production
  if (process.env.NODE_ENV === 'development' || !origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Session configuration for admin security
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.ADMIN_ACCESS_KEY || 'MY_SECRET_KEY_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Enable secure cookies in production
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true, // Prevent XSS attacks
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
  }
}));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize database first (unless skipped for testing)
  if (process.env.SKIP_DB_INIT !== 'true') {
    await initializeDatabase();
  } else {
    console.log('⚠️  Database initialization skipped (SKIP_DB_INIT=true)');
  }

  const server = await registerRoutes(app);

  // Register payment routes
  app.use('/api/payments', paymentRoutes);

  // Register user API routes
  app.use('/api/user', userApiRoutes);

  // Register public API routes (for API key authentication)
  app.use('/api/v1', apiRoutes);

  // Register admin routes
  registerAdminRoutes(app);

  // Admin Security Configuration
  const adminAccessKey = process.env.ADMIN_ACCESS_KEY || 'MY_SECRET_KEY_2024';
  
  // Create 404 page template
  const create404Page = () => `
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          text-align: center; 
          padding: 50px; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .error-container { 
          max-width: 500px; 
          background: white; 
          padding: 60px 40px; 
          border-radius: 20px; 
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          animation: fadeIn 0.6s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        h1 { 
          color: #e74c3c; 
          font-size: 120px; 
          margin: 0; 
          font-weight: 300;
          text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h2 { 
          color: #2c3e50; 
          margin: 20px 0; 
          font-weight: 600;
          font-size: 28px;
        }
        p { 
          color: #7f8c8d; 
          line-height: 1.6; 
          font-size: 16px;
          margin-bottom: 30px;
        }
        .icon {
          font-size: 60px;
          color: #e74c3c;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <div class="icon">🔍</div>
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>The page you are looking for does not exist or has been moved.</p>
      </div>
    </body>
    </html>
  `;
  
  // Block direct access to /admin
  app.get('/admin*', (req, res) => {
    res.status(404).send(create404Page());
  });

  // Secure admin access route
  app.get('/pd-od', (req: any, res) => {
    const providedKey = req.query.accesskey;
    
    log(`Admin access attempt: ${req.ip} - Key provided: ${providedKey ? 'Yes' : 'No'}`);
    
    if (!providedKey || providedKey !== adminAccessKey) {
      log(`Admin access denied: Invalid or missing access key`);
      return res.status(404).send(create404Page());
    }
    
    // Set admin session
    req.session.adminAuthenticated = true;
    req.session.adminAccessTime = Date.now();
    
    log(`Admin access granted: Valid access key provided`);
    // Valid access key - serve admin panel
    res.sendFile(path.join(process.cwd(), 'admin', 'index.html'));
  });

  // Serve admin static assets with session check
  app.use('/admin-static', (req: any, res, next) => {
    // Check if admin is authenticated via session or has secure referer
    const referer = req.get('Referer') || '';
    const hasSecureReferer = referer.includes('/pd-od?accesskey=');
    
    if ((req.session && req.session.adminAuthenticated) || hasSecureReferer) {
      express.static(path.join(process.cwd(), 'admin'))(req, res, next);
    } else {
      log(`Admin asset access denied: No valid session - ${req.path}`);
      res.status(404).send('Not Found');
    }
  });

  // Serve public assets (logo, favicon, etc.)
  app.use('/public', express.static(path.join(process.cwd(), 'public')));

  // Don't serve main website from server - let Vite handle SPA routing
  // app.get('/', (req, res) => {
  //   res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  // });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
