// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// server/storage.ts
import { randomUUID } from "crypto";
var MemStorage = class {
  users;
  rentalInquiries;
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.rentalInquiries = /* @__PURE__ */ new Map();
  }
  async getUser(id) {
    return this.users.get(id);
  }
  async getUserByUsername(username) {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }
  async createUser(insertUser) {
    const id = randomUUID();
    const user = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  async createRentalInquiry(insertInquiry) {
    const id = randomUUID();
    const inquiry = {
      ...insertInquiry,
      id,
      createdAt: /* @__PURE__ */ new Date(),
      message: insertInquiry.message || null,
      sixMonthAgreement: insertInquiry.sixMonthAgreement ? "true" : "false",
      autopayAgreement: insertInquiry.autopayAgreement ? "true" : "false"
    };
    this.rentalInquiries.set(id, inquiry);
    return inquiry;
  }
  async getAllRentalInquiries() {
    return Array.from(this.rentalInquiries.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
  async getRentalInquiry(id) {
    return this.rentalInquiries.get(id);
  }
};
var storage = new MemStorage();

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var rentalInquiries = pgTable("rental_inquiries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  serviceAddress: text("service_address").notNull(),
  packageInterest: text("package_interest").notNull(),
  preferredInstallDate: text("preferred_install_date").notNull(),
  dryerHookupType: text("dryer_hookup_type").notNull(),
  sixMonthAgreement: text("six_month_agreement").notNull(),
  autopayAgreement: text("autopay_agreement").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var insertRentalInquirySchema = createInsertSchema(rentalInquiries).omit({
  id: true,
  createdAt: true
}).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone number is required"),
  serviceAddress: z.string().min(1, "Service address is required"),
  packageInterest: z.enum([
    "washer-dryer-used",
    "washer-dryer-new",
    "washer-only",
    "dryer-only",
    "repair-request"
  ], { errorMap: () => ({ message: "Please select a package" }) }),
  preferredInstallDate: z.string().min(1, "Installation day preference is required"),
  dryerHookupType: z.enum([
    "three-prong",
    "four-prong",
    "gas",
    "not-sure"
  ], { errorMap: () => ({ message: "Please select dryer hookup type" }) }),
  sixMonthAgreement: z.boolean().refine((val) => val === true, {
    message: "You must agree to the six month minimum rental period"
  }),
  autopayAgreement: z.boolean().refine((val) => val === true, {
    message: "You must agree to have a card on file for autopay"
  }),
  message: z.string().max(1e3, "Message must be 1000 characters or less").optional()
});

// server/routes.ts
import { z as z2 } from "zod";
async function registerRoutes(app2) {
  app2.post("/api/submit", async (req, res) => {
    try {
      const webhookUrl = process.env.GS_WEBHOOK_URL;
      const secret = process.env.WHIRLY_SECRET;
      if (!webhookUrl) {
        console.error("GS_WEBHOOK_URL environment variable not set");
        return res.status(500).json({ message: "Server configuration error" });
      }
      if (!secret) {
        console.error("WHIRLY_SECRET environment variable not set");
        return res.status(500).json({ message: "Server configuration error" });
      }
      const payloadWithToken = {
        ...req.body,
        token: secret
      };
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payloadWithToken)
      });
      if (!response.ok) {
        console.error("Google Apps Script webhook failed:", response.status, response.statusText);
        return res.status(500).json({ message: "Failed to submit form. Please try again later." });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error submitting to Google Apps Script:", error);
      res.status(500).json({ message: "Failed to submit form. Please try again later." });
    }
  });
  app2.post("/api/rental-inquiries", async (req, res) => {
    try {
      const validatedData = insertRentalInquirySchema.parse(req.body);
      const inquiry = await storage.createRentalInquiry(validatedData);
      res.json({ success: true, inquiry });
    } catch (error) {
      if (error instanceof z2.ZodError) {
        res.status(400).json({
          message: "Validation failed",
          errors: error.errors
        });
      } else {
        console.error("Error processing rental inquiry:", error);
        res.status(500).json({
          message: "Internal server error"
        });
      }
    }
  });
  app2.get("/api/rental-inquiries", async (req, res) => {
    try {
      const inquiries = await storage.getAllRentalInquiries();
      res.json(inquiries);
    } catch (error) {
      console.error("Error fetching rental inquiries:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  app2.get("/api/rental-inquiries/:id", async (req, res) => {
    try {
      const inquiry = await storage.getRentalInquiry(req.params.id);
      if (!inquiry) {
        return res.status(404).json({ message: "Inquiry not found" });
      }
      res.json(inquiry);
    } catch (error) {
      console.error("Error fetching rental inquiry:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
