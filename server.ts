import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

// Configure ffmpeg static path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Storage for tasks (in-memory for this demo)
interface WatermarkTask {
  id: string;
  originalName: string;
  fileName: string;
  type: 'video' | 'image';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  error?: string;
  boxes: Array<{ x: number, y: number, width: number, height: number }>;
  lines?: Array<{ points: number[], brushSize: number }>;
  params: any;
  createdAt: Date;
  videoWidth?: number;
  videoHeight?: number;
}

const tasks: Record<string, WatermarkTask> = {};

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
const outputDir = path.join(process.cwd(), 'outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ storage });

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ limit: '500mb', extended: true }));

  // Fix for multer filename encoding (latin1 to utf8)
  const fixEncoding = (str: string) => {
    try {
      return Buffer.from(str, 'latin1').toString('utf8');
    } catch (e) {
      return str;
    }
  };

  // API Routes
  app.post("/api/upload", (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error("Multer upload error:", err);
        return res.status(500).json({ error: "Upload failed: " + err.message });
      }
      next();
    });
  }, (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    
    const originalName = fixEncoding(req.file.originalname);
    const isImage = req.file.mimetype.startsWith('image/');
    
    res.json({ 
      fileName: req.file.filename,
      originalName: originalName,
      type: isImage ? 'image' : 'video',
      url: `/uploads/${req.file.filename}` 
    });
  });

  app.post("/api/tasks", (req, res) => {
    const { fileName, originalName, type, boxes, lines, params, videoWidth, videoHeight } = req.body;
    const taskId = uuidv4();
    
    const newTask: WatermarkTask = {
      id: taskId,
      fileName,
      originalName,
      type: type || 'video',
      status: 'pending',
      progress: 0,
      boxes: boxes || [],
      lines: lines || [],
      params,
      videoWidth,
      videoHeight,
      createdAt: new Date(),
    };

    tasks[taskId] = newTask;
    
    processVideo(taskId);

    res.json(newTask);
  });

  app.get("/api/tasks", (req, res) => {
    res.json(Object.values(tasks).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
  });

  app.get("/api/tasks/:id", (req, res) => {
    const task = tasks[req.params.id];
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task);
  });

  // Static serving for uploads and outputs
  app.use('/uploads', express.static(uploadDir));
  app.use('/outputs', express.static(outputDir));

  // Process video with ffmpeg
  async function processVideo(taskId: string) {
    const task = tasks[taskId];
    task.status = 'processing';
    
    let inputPath = path.join(uploadDir, task.fileName);
    if (!fs.existsSync(inputPath)) {
        const altInputPath = path.join(outputDir, task.fileName);
        if (fs.existsSync(altInputPath)) {
            inputPath = altInputPath;
        }
    }
    const resultFileName = `processed_${task.id}_${task.fileName}`;
    const outputPath = path.join(outputDir, resultFileName);
    
    try {
      // Collect bounding boxes
      let maskBoxes = [...task.boxes];
      
      // Calculate bounding boxes for lines
      if (task.lines && task.lines.length > 0) {
        task.lines.forEach(line => {
          if (!line.points || line.points.length < 2) return;
          let minX = line.points[0];
          let maxX = line.points[0];
          let minY = line.points[1];
          let maxY = line.points[1];
          
          for (let i = 0; i < line.points.length; i += 2) {
            minX = Math.min(minX, line.points[i]);
            maxX = Math.max(maxX, line.points[i]);
            minY = Math.min(minY, line.points[i + 1]);
            maxY = Math.max(maxY, line.points[i + 1]);
          }
          
          // Add brush size padding
          const padding = (line.brushSize || 20) / 2;
          maskBoxes.push({
            x: minX - padding,
            y: minY - padding,
            width: (maxX - minX) + padding * 2,
            height: (maxY - minY) + padding * 2
          });
        });
      }

      // If no valid regions to blur, just copy
      if (maskBoxes.length === 0) {
         fs.copyFileSync(inputPath, outputPath);
         task.status = 'completed';
         task.resultUrl = `/outputs/${resultFileName}`;
         task.progress = 100;
         return;
      }
      
      const mode = task.params?.mode || 'delogo';
      let filterProcessed = false;
      let cmd = ffmpeg(inputPath);
      
      const validBoxes = maskBoxes.map(box => {
        let x = Math.max(1, Math.floor(box.x));
        let y = Math.max(1, Math.floor(box.y));
        let w = Math.max(1, Math.floor(box.width));
        let h = Math.max(1, Math.floor(box.height));
        
        if (task.videoWidth && task.videoHeight) {
          x = Math.max(1, Math.min(x, task.videoWidth - 3));
          y = Math.max(1, Math.min(y, task.videoHeight - 3));
          if (x + w >= task.videoWidth) { w = task.videoWidth - x - 1; }
          if (y + h >= task.videoHeight) { h = task.videoHeight - y - 1; }
        }
        return {x, y, w, h};
      }).filter(b => b.w > 0 && b.h > 0);

      if (validBoxes.length > 0) {
         if (mode === 'delogo' || mode === 'solid') {
            let filters: string[] = [];
            validBoxes.forEach((box) => {
               if (mode === 'delogo') {
                  filters.push(`delogo=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}`);
               } else if (mode === 'solid') {
                  filters.push(`drawbox=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}:color=black:t=fill`);
               }
            });
            cmd.videoFilters(filters.join(','));
            filterProcessed = true;
         } else if (mode === 'blur' || mode === 'mosaic') {
            let complexFilter: string[] = [];
            const splits = `[0:v]split=${validBoxes.length + 1}[bg]${validBoxes.map((_, i) => `[v${i}]`).join('')}`;
            complexFilter.push(splits);
            
            validBoxes.forEach((box, i) => {
               if (mode === 'blur') {
                  complexFilter.push(`[v${i}]crop=${box.w}:${box.h}:${box.x}:${box.y},gblur=sigma=${task.params.blur || 20}[b${i}]`);
               } else {
                  complexFilter.push(`[v${i}]crop=${box.w}:${box.h}:${box.x}:${box.y},scale=iw/10:-1,scale=iw*10:-1[b${i}]`);
               }
            });
            
            let lastBg = '[bg]';
            validBoxes.forEach((box, i) => {
               const nextBg = i === validBoxes.length - 1 ? '[vout]' : `[bg${i + 1}]`;
               complexFilter.push(`${lastBg}[b${i}]overlay=${box.x}:${box.y}${nextBg}`);
               lastBg = nextBg;
            });
            
            cmd.complexFilter(complexFilter.join(';'), ['vout']);
            filterProcessed = true;
         }
      }
      
      if (!filterProcessed) {
         fs.copyFileSync(inputPath, outputPath);
         task.status = 'completed';
         task.resultUrl = `/outputs/${resultFileName}`;
         task.progress = 100;
         return;
      }

      let outputOptions: string[] = [];
      if (task.type === 'video') {
        outputOptions = [
          '-c:v libx264',
          '-preset veryfast',
          '-crf 28',
          '-pix_fmt yuv420p',
          '-c:a aac',
          '-b:a 128k',
          '-movflags +faststart'
        ];
      } else {
        outputOptions = ['-q:v', '2', '-vframes', '1']; // high quality image output
      }

      cmd
        .outputOptions(outputOptions)
        .on('progress', (progress) => {
          if (progress.percent && task.status === 'processing') {
            task.progress = Math.min(99, Math.floor(progress.percent));
          }
        })
        .on('end', () => {
          task.status = 'completed';
          task.resultUrl = `/outputs/${resultFileName}`;
          task.progress = 100;
        })
        .on('error', (err, stdout, stderr) => {
          console.error("FFmpeg error:", err);
          console.error("FFmpeg stdout:", stdout);
          console.error("FFmpeg stderr:", stderr);
          task.status = 'failed';
          task.error = stderr ? String(stderr) : (err.message || String(err));
        })
        .save(outputPath);
      
    } catch (err) {
      console.error("Processing setup failed", err);
      task.status = 'failed';
    }
  }

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
