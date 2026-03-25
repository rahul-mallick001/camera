import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Pro Camera Studio Backend is running." });
  });

  /**
   * Mock Camera Management API
   * Note: In this environment, we use Node.js/Express. 
   * This endpoint simulates the Python backend logic requested for camera management.
   */
  app.post("/api/camera/zoom", express.json(), (req, res) => {
    const { zoomLevel, deviceId } = req.body;
    console.log(`[BACKEND] Adjusting zoom for device ${deviceId} to ${zoomLevel}x`);
    
    // In a real Python/Native environment, this might interface with v4l2 or similar
    res.json({ 
      success: true, 
      appliedZoom: zoomLevel,
      status: "Camera parameters updated via backend simulation" 
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
