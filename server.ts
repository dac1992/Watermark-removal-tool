import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { GoogleGenAI } from "@google/genai";
import Replicate from "replicate";

// Configure ffmpeg static path
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}

// Storage for tasks (in-memory for this demo)
interface WatermarkTask {
  id: string;
  sessionId: string;
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

const isVercel = process.env.VERCEL === "1" || process.env.VERCEL;

// Ensure upload directory exists
const uploadDir = isVercel ? '/tmp/uploads' : path.join(process.cwd(), 'uploads');
const outputDir = isVercel ? '/tmp/outputs' : path.join(process.cwd(), 'outputs');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

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

const app = express();

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
      url: `/api/uploads/${req.file.filename}` 
    });
  });

  app.post("/api/tasks", (req, res) => {
    const { sessionId, fileName, originalName, type, boxes, lines, params, videoWidth, videoHeight } = req.body;
    const finalSessionId = sessionId || 'default';
    const taskId = uuidv4();
    
    const newTask: WatermarkTask = {
      id: taskId,
      sessionId: finalSessionId,
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
    const sessionId = req.query.sessionId as string || 'default';
    const userTasks = Object.values(tasks)
        .filter(t => t.sessionId === sessionId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json(userTasks);
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
         task.resultUrl = `/api/outputs/${resultFileName}`;
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
         if (mode === 'ai') {
             try {
                 const framePath = path.join(outputDir, `frame_${task.id}.jpg`);
                 const cleanFramePath = path.join(outputDir, `clean_${task.id}.jpg`);
                 
                 await new Promise((resolve, reject) => {
                     ffmpeg(inputPath)
                       .outputOptions(['-vframes', '1', '-q:v', '2'])
                       .on('end', resolve)
                       .on('error', reject)
                       .save(framePath);
                 });
                 
                 const base64Data = fs.readFileSync(framePath).toString('base64');
                 const vendor = task.params?.aiVendor || 'google';
                 let aiBase64 = null;

                 if (vendor === 'google') {
                     const userApiKey = task.params?.aiApiKey?.trim() || process.env.GEMINI_API_KEY;
                     if (!userApiKey) throw new Error("请在界面中填写有效的 Gemini API Key");
                     
                     const aiClient = new GoogleGenAI({ apiKey: userApiKey });
                     const response = await aiClient.models.generateContent({
                         model: 'gemini-2.5-flash-image',
                         contents: {
                             parts: [
                                 { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
                                 { text: 'You are an advanced AI image restorer. Remove all watermarks, logos, subtitles and text from this image. Fill in the removed areas with a seamless and perfect reconstruction of the background. Do not alter any other part of the image.' },
                             ],
                         },
                     });
                     for (const part of response.candidates?.[0]?.content?.parts || []) {
                         if (part.inlineData) aiBase64 = part.inlineData.data;
                     }
                 } else if (vendor === 'replicate') {
                     const replicateKey = task.params?.aiApiKey?.trim() || process.env.REPLICATE_API_TOKEN;
                     if (!replicateKey) throw new Error("请在界面中填写有效的 Replicate API Token");

                     // Create mask image
                     const maskPath = path.join(outputDir, `mask_${task.id}.jpg`);
                     const vWidth = task.videoWidth || 1280;
                     const vHeight = task.videoHeight || 720;
                     const drawboxFilters = validBoxes.map(b => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=white:t=fill`);
                     
                     await new Promise((resolve, reject) => {
                         ffmpeg(framePath)
                           .outputOptions(['-vframes', '1', '-q:v', '2'])
                           .videoFilters(['drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill', ...drawboxFilters])
                           .on('end', resolve)
                           .on('error', reject)
                           .save(maskPath);
                     });
                     
                     const maskBase64 = fs.readFileSync(maskPath).toString('base64');
                     const replicateClient = new Replicate({ auth: replicateKey });
                     
                     type ReplicateModelVersion = `${string}/${string}:${string}`;
                     const modelId = "stability-ai/stable-diffusion-inpainting:95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3" as ReplicateModelVersion;

                     const output = await replicateClient.run(modelId, {
                         input: {
                             prompt: "seamless background matching the surrounding area perfectly, empty space, clean, seamless",
                             negative_prompt: "watermark, logo, text, subtitles, person, watermark overlay",
                             image: `data:image/jpeg;base64,${base64Data}`,
                             mask: `data:image/jpeg;base64,${maskBase64}`
                         }
                     }) as string[];
                     
                     if (output && output.length > 0) {
                         const imgUrl = output[0];
                         const imgRes = await fetch(imgUrl);
                         const arrayBuffer = await imgRes.arrayBuffer();
                         aiBase64 = Buffer.from(arrayBuffer).toString('base64');
                     }
                 } else if (vendor === 'openai_compatible') {
                     const apiKey = task.params?.aiApiKey?.trim();
                     if (!apiKey) throw new Error("请在界面中填写有效的代理 API Key");
                     
                     const baseUrl = (task.params?.aiBaseUrl?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
                     const modelId = task.params?.aiModel || 'dall-e-2';
                     
                     const vWidth = task.videoWidth || 1280;
                     const vHeight = task.videoHeight || 720;
                     
                     // Generate PNG image directly (OpenAI requires PNG)
                     const framePngPath = path.join(outputDir, `frame_${task.id}.png`);
                     await new Promise((resolve, reject) => {
                         ffmpeg(inputPath)
                           .outputOptions(['-vframes', '1', '-vcodec', 'png'])
                           .on('end', resolve)
                           .on('error', reject)
                           .save(framePngPath);
                     });
                     
                     // Generate Mask PNG image
                     const maskPngPath = path.join(outputDir, `mask_${task.id}.png`);
                     const drawboxFilters = validBoxes.map(b => `drawbox=x=${b.x}:y=${b.y}:w=${b.w}:h=${b.h}:color=white:t=fill`);
                     
                     await new Promise((resolve, reject) => {
                         ffmpeg(framePngPath)
                           .outputOptions(['-vframes', '1', '-vcodec', 'png'])
                           .videoFilters(['drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill', ...drawboxFilters])
                           .on('end', resolve)
                           .on('error', reject)
                           .save(maskPngPath);
                     });
                     
                     const { Blob } = require('buffer');
                     const formData = new FormData();
                     formData.append('image', new Blob([fs.readFileSync(framePngPath)], { type: 'image/png' }), 'image.png');
                     formData.append('mask', new Blob([fs.readFileSync(maskPngPath)], { type: 'image/png' }), 'mask.png');
                     formData.append('prompt', 'clean seamless background filling the masked area perfectly, no watermark, empty space');
                     formData.append('model', modelId);
                     
                     const res = await fetch(`${baseUrl}/images/edits`, {
                         method: "POST",
                         headers: {
                             "Authorization": `Bearer ${apiKey}`
                         },
                         body: formData
                     });
                     
                     if (!res.ok) {
                         const errText = await res.text();
                         throw new Error(`OpenAI 接口报错 [${res.status}]: ${errText.substring(0, 200)}`);
                     }
                     
                     const data = await res.json();
                     if (data?.data?.[0]?.url) {
                         const imgRes = await fetch(data.data[0].url);
                         const arrayBuffer = await imgRes.arrayBuffer();
                         aiBase64 = Buffer.from(arrayBuffer).toString('base64');
                     } else if (data?.data?.[0]?.b64_json) {
                         aiBase64 = data.data[0].b64_json;
                     } else {
                         throw new Error("OpenAI 返回数据无效");
                     }
                 } else if (vendor === 'grsai') {
                     const apiKey = task.params?.aiApiKey?.trim();
                     if (!apiKey) throw new Error("请在界面中填写有效的 Grsai API Key");
                     
                     const res = await fetch("https://grsaiapi.com/v1/api/generate", {
                         method: "POST",
                         headers: {
                             "Authorization": `Bearer ${apiKey}`,
                             "Content-Type": "application/json"
                         },
                         body: JSON.stringify({
                             model: "gpt-image-2",
                             prompt: "Please remove any watermarks, logos, or text from this image and restore the background perfectly. Make sure the rest of the image remains completely untouched.",
                             images: [`data:image/jpeg;base64,${base64Data}`],
                             replyType: "json"
                         })
                     });
                     
                     if (!res.ok) {
                         const errText = await res.text();
                         throw new Error(`Grsai 接口报错 [${res.status}]: ${errText.substring(0, 200)}`);
                     }
                     
                     const data = await res.json();
                     if (data?.status === 'succeeded' && data?.results?.[0]?.url) {
                         const imgRes = await fetch(data.results[0].url);
                         const arrayBuffer = await imgRes.arrayBuffer();
                         aiBase64 = Buffer.from(arrayBuffer).toString('base64');
                     } else {
                         throw new Error(`Grsai 生成失败或违规: ${data?.error || JSON.stringify(data)}`);
                     }
                 } else {
                     throw new Error(`暂不支持 ${vendor} 服务。`);
                 }

                 if (aiBase64) {
                     fs.writeFileSync(cleanFramePath, Buffer.from(aiBase64, 'base64'));
                     cmd.input(cleanFramePath);
                     
                     let complexFilter: string[] = [];
                     // scale to video dimensions to be safe
                     complexFilter.push(`[1:v]scale=${task.videoWidth || 'iw'}:${task.videoHeight || 'ih'}[clean_scaled]`);
                     
                     validBoxes.forEach((box, i) => {
                         complexFilter.push(`[clean_scaled]crop=${box.w}:${box.h}:${box.x}:${box.y}[patch${i}]`);
                     });

                     let lastBg = '[0:v]';
                     validBoxes.forEach((box, i) => {
                         const nextBg = i === validBoxes.length - 1 ? '[vout]' : `[bg${i + 1}]`;
                         complexFilter.push(`${lastBg}[patch${i}]overlay=${box.x}:${box.y}${nextBg}`);
                         lastBg = nextBg;
                     });

                     cmd.complexFilter(complexFilter.join(';'), ['vout']);
                     filterProcessed = true;
                 } else {
                     throw new Error("No image generated by AI vendor.");
                 }
             } catch (aiErr) {
                 console.error("AI Generation failed, falling back to delogo", aiErr);
                 // fallback to delogo
                 let filters: string[] = [];
                 validBoxes.forEach((box) => {
                    filters.push(`delogo=x=${box.x}:y=${box.y}:w=${box.w}:h=${box.h}`);
                 });
                 cmd.videoFilters(filters.join(','));
                 filterProcessed = true;
             }
         } else if (mode === 'delogo' || mode === 'solid') {
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
         task.resultUrl = `/api/outputs/${resultFileName}`;
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
          task.resultUrl = `/api/outputs/${resultFileName}`;
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

  // Custom routes to serve files on Vercel since express.static acts weirdly with /tmp on serverless
  app.get('/api/uploads/:filename', (req, res) => {
      const filePath = path.join(uploadDir, req.params.filename);
      if (fs.existsSync(filePath)) {
          res.sendFile(filePath);
      } else {
          res.status(404).send('File not found');
      }
  });

  app.get('/api/outputs/:filename', (req, res) => {
      const filePath = path.join(outputDir, req.params.filename);
      if (fs.existsSync(filePath)) {
          res.sendFile(filePath);
      } else {
          res.status(404).send('File not found');
      }
  });

export default app;

if (!isVercel) {
  async function startServer() {
      const PORT = Number(process.env.PORT) || 3000;
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
}
