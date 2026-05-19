import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Trash2, 
  Settings2, 
  Download, 
  Play, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  Scissors,
  PlusCircle,
  Eraser,
  X
} from 'lucide-react';
import { VideoCanvas } from './components/VideoCanvas';
import { ImageCanvas } from './components/ImageCanvas';
import { BoundingBox, BrushLine, Task, MediaInfo } from './types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'video' | 'image'>('video');
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
  const [lines, setLines] = useState<BrushLine[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [drawMode, setDrawMode] = useState<'box' | 'brush'>('box');
  const [brushSize, setBrushSize] = useState(20);
  const [canvasInfo, setCanvasInfo] = useState({ canvasWidth: 1, canvasHeight: 1, videoWidth: 1, videoHeight: 1 });
  
  const [previewTask, setPreviewTask] = useState<Task | null>(null);

  const [params, setParams] = useState({
    blur: 15,
    strength: 5,
    mode: 'delogo',
    aiVendor: 'google',
    aiApiKey: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setTasks(data);
      }
    } catch (err) {
      // Silently ignore fetch errors during polling as they are expected during dev server restarts
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPreviewTask(null);
    setMedia(null);
    setBoxes([]);
    setLines([]);
    
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          const localUrl = URL.createObjectURL(file);
          setMedia({
            ...data,
            url: localUrl
          });
          if (data.type === 'image') {
              setActiveTab('image');
          } else {
              setActiveTab('video');
          }
        } catch (err) {
          setUploadError("返回数据解析错误");
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          setUploadError(`上传失败 (${xhr.status}): ${errData.error || '服务器内部错误'}`);
        } catch (e) {
          setUploadError(`上传失败 (${xhr.status})`);
        }
      }
      setIsUploading(false);
    };

    xhr.onerror = () => {
      setUploadError("网络请求错误，上传失败");
      setIsUploading(false);
    };

    xhr.open('POST', '/api/upload');
    xhr.send(formData);
  };

  const handleContinueEdit = (task: Task) => {
    if (!task.resultUrl) return;
    
    // We get the raw filename of the processed file from the resultUrl
    const rawFileName = task.resultUrl.split('/').pop() || task.fileName;
    
    setMedia({
      fileName: rawFileName,
      originalName: 'Edited_' + task.originalName,
      type: task.type,
      url: task.resultUrl
    });
    setPreviewTask(null);
    setBoxes([]);
    setLines([]);
    setActiveTab(task.type || 'video');
  };

  const submitTask = async () => {
    if (!media || (boxes.length === 0 && lines.length === 0)) return;

    setIsSubmitting(true);
    try {
      const scaleX = canvasInfo.videoWidth / Math.max(1, canvasInfo.canvasWidth);
      const scaleY = canvasInfo.videoHeight / Math.max(1, canvasInfo.canvasHeight);
      
      const scaledBoxes = boxes.map(b => ({
          x: b.x * scaleX,
          y: b.y * scaleY,
          width: b.width * scaleX,
          height: b.height * scaleY
      }));
      
      const scaledLines = lines.map(l => ({
          ...l,
          points: l.points.map((p, i) => i % 2 === 0 ? p * scaleX : p * scaleY),
          brushSize: l.brushSize * ((scaleX + scaleY) / 2)
      }));

      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: media.fileName,
          originalName: media.originalName,
          type: media.type,
          boxes: scaledBoxes,
          lines: scaledLines,
          params,
          videoWidth: canvasInfo.videoWidth,
          videoHeight: canvasInfo.videoHeight
        }),
      });
      setMedia(null);
      setBoxes([]);
      setLines([]);
      fetchTasks();
    } catch (err) {
      console.error("任务提交失败", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const clearAllMarks = () => {
    setBoxes([]);
    setLines([]);
  };

  const handleDownload = async (task: Task, e: React.MouseEvent) => {
    e.preventDefault();
    if (!task.resultUrl) return;
    
    try {
        const response = await fetch(task.resultUrl);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `watermark_removed_${task.originalName}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        console.error("下载出错", error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
                <Eraser className="w-6 h-6 text-white" />
              </div>
              <div className="pt-1">
                <div className="flex items-baseline gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-white leading-none">去水印工具</h1>
                  {/* 版本号在这里修改 👇 */}
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">v1.0.0</span>
                </div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-1.5 leading-none">专业去水印工具</p>
              </div>
            </div>
            
            {/* Nav Tabs */}
            <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 shrink-0">
              <button
                onClick={() => { setActiveTab('video'); setMedia(null); setBoxes([]); setLines([]); }}
                className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                  activeTab === 'video' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                )}
              >
                视频去水印
              </button>
              <button
                onClick={() => { setActiveTab('image'); setMedia(null); setBoxes([]); setLines([]); }}
                className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                  activeTab === 'image' ? "bg-slate-800 text-white shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                )}
              >
                图片去水印
              </button>
            </div>
          </div>
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-slate-200 px-4 py-2 rounded-lg border border-slate-800 transition-all font-medium text-sm shadow-xl"
          >
            <Upload className="w-4 h-4" />
            {activeTab === 'video' ? '上传新视频' : '上传新图片'}
          </button>
          <input 
            type="file" 
            key={activeTab} // ensure it re-renders
            ref={fileInputRef} 
            className="hidden" 
            accept={activeTab === 'video' ? "video/*" : "image/*"} 
            onChange={handleFileUpload}
          />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Editor / Preview Modal */}
        <div className="lg:col-span-2 space-y-6">
          {previewTask ? (
            <motion.div 
               initial={{ opacity: 0, scale: 0.95 }}
               animate={{ opacity: 1, scale: 1 }}
               className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl"
            >
                <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur z-10 sticky top-0">
                    <h2 className="font-bold text-white flex items-center gap-2">
                        <Play className="w-5 h-5 text-emerald-500" />
                        处理完成: {previewTask.originalName}
                    </h2>
                    <button 
                        onClick={() => setPreviewTask(null)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg transition-colors border border-slate-700"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6">
                    {previewTask.type === 'image' ? (
                        <img 
                            src={previewTask.resultUrl} 
                            alt="Processing result"
                            className="w-full aspect-video object-contain rounded-xl bg-black border border-slate-800 shadow-xl"
                        />
                    ) : (
                        <video 
                            src={previewTask.resultUrl} 
                            controls 
                            className="w-full aspect-video rounded-xl bg-black border border-slate-800 shadow-xl"
                        />
                    )}
                    <div className="mt-6 flex justify-end gap-3">
                       <button 
                         onClick={() => handleContinueEdit(previewTask)}
                         className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg transition-all"
                       >
                         <Eraser className="w-4 h-4" />
                         继续去水印
                       </button>
                       <button 
                         onClick={(e) => handleDownload(previewTask, e as any)}
                         className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg transition-all"
                       >
                         <Download className="w-4 h-4" />
                         立即下载保存
                       </button>
                    </div>
                </div>
            </motion.div>
          ) : !media ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="aspect-video bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-3xl flex flex-col items-center justify-center p-12 text-center group cursor-pointer hover:border-blue-500/50 transition-all shadow-inner"
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="w-full max-w-sm flex flex-col items-center">
                  <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6 shadow-xl border border-slate-800">
                    <Upload className="w-8 h-8 text-blue-500 animate-bounce" />
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-6">正在上传{activeTab === 'video' ? '视频' : '图片'}...</h2>
                  <div className="w-full bg-slate-800 rounded-full h-3 mb-2 shadow-inner overflow-hidden border border-slate-700">
                    <motion.div 
                      className="bg-blue-500 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="text-blue-400 font-bold font-mono">{uploadProgress}%</div>
                </div>
              ) : (
                <>
                  <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-xl border border-slate-800">
                    <Upload className="w-10 h-10 text-slate-500 group-hover:text-blue-500" />
                  </div>
                  <h2 className="text-2xl font-semibold text-white mb-2">上传{activeTab === 'video' ? '视频' : '图片'}开始去水印</h2>
                  <p className="text-slate-400 max-w-sm mb-4">拖放{activeTab === 'video' ? '视频' : '图片'}文件到此处，或点击浏览。</p>
                  {uploadError && (
                     <div className="flex items-center justify-center gap-2 text-rose-400 bg-rose-400/10 px-4 py-2 rounded-lg text-sm border border-rose-500/20">
                       <AlertCircle className="w-4 h-4" />
                       {uploadError}
                     </div>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 bg-blue-900/20 px-3 py-1.5 rounded-lg border border-blue-900/50">
                    <Scissors className="w-5 h-5 text-blue-500" />
                    编辑器: <span className="text-blue-200">{media.originalName}</span>
                  </h2>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => { setMedia(null); setBoxes([]); setLines([]); }}
                    className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-red-950 text-slate-500 hover:text-red-400 rounded-lg text-xs font-semibold border border-slate-800 transition-all"
                  >
                    <X className="w-4 h-4" />
                    放弃编辑并重置
                  </button>
                </div>
              </div>

              {media.type === 'image' ? (
                <ImageCanvas 
                  imageUrl={media.url} 
                  boxes={boxes} 
                  setBoxes={setBoxes} 
                  lines={lines}
                  setLines={setLines}
                  onClear={clearAllMarks}
                  drawMode={drawMode}
                  setDrawMode={setDrawMode}
                  brushSize={brushSize}
                  onSizeChange={setCanvasInfo}
                />
              ) : (
                <VideoCanvas 
                  videoUrl={media.url} 
                  boxes={boxes} 
                  setBoxes={setBoxes} 
                  lines={lines}
                  setLines={setLines}
                  onClear={clearAllMarks}
                  drawMode={drawMode}
                  setDrawMode={setDrawMode}
                  brushSize={brushSize}
                  onSizeChange={setCanvasInfo}
                />
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-4 shadow-lg">
                  <div className="flex items-center gap-2 text-white font-medium mb-2">
                    <Settings2 className="w-4 h-4" />
                    参数设置
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-xs mb-2">
                        <label className="text-slate-400">去涂算法 (Algorithm Mode)</label>
                      </div>
                      <select 
                        value={params.mode}
                        onChange={e => setParams({...params, mode: e.target.value as any})}
                        className="w-full bg-slate-950 border border-slate-700 text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 transition-colors shadow-inner"
                      >
                        <option value="ai">AI 大模型智能重绘 (超清无痕全新修复) [推荐]</option>
                        <option value="delogo">智能融合 (保留背景颜色特征) </option>
                        <option value="blur">高斯模糊 (平滑去除复杂部分)</option>
                        <option value="mosaic">马赛克 (像素化保护隐私)</option>
                        <option value="solid">纯色遮挡 (完全涂黑抹去)</option>
                      </select>
                    </div>
                    
                    {params.mode === 'ai' && (
                        <div className="space-y-4 pt-2 border-t border-slate-800">
                          <div>
                            <label className="text-slate-400 text-xs mb-2 block">AI 厂商 (AI Provider)</label>
                            <select 
                              value={params.aiVendor}
                              onChange={e => setParams({...params, aiVendor: e.target.value as any})}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 transition-colors shadow-inner"
                            >
                              <option value="google">Google Gemini (推荐)</option>
                              <option value="openai">OpenAI (需上传遮罩蒙版, 暂仅做展示)</option>
                              <option value="anthropic">Anthropic Claude</option>
                              <option value="aliyun">阿里云通义千问</option>
                              <option value="volcengine">字节跳动火山引擎 (Doubao)</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-slate-400 text-xs mb-2 block">API Key (用户提供)</label>
                            <input 
                              type="password" 
                              value={params.aiApiKey} 
                              onChange={e => setParams({...params, aiApiKey: e.target.value})}
                              placeholder={`输入 ${params.aiVendor} 的 API Key`}
                              spellCheck={false}
                              className="w-full bg-slate-950 border border-slate-700 text-slate-300 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 transition-colors shadow-inner font-mono"
                            />
                            {params.aiVendor === 'google' && (
                              <p className="text-[10px] text-slate-500 mt-1">请填写具备 gemini-2.5-flash-image 权限的 Key 以避免配额超限</p>
                            )}
                          </div>
                        </div>
                    )}

                    {drawMode === 'brush' && (
                        <div>
                          <div className="flex justify-between text-xs mb-2">
                            <label className="text-slate-400">画笔粗细 (Brush Size)</label>
                            <span className="text-blue-400">{brushSize}px</span>
                          </div>
                          <input 
                            type="range" 
                            min="5" max="100" 
                            value={brushSize} 
                            onChange={e => setBrushSize(parseInt(e.target.value))}
                            className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
                          />
                        </div>
                    )}
                    <div>
                      <div className="flex justify-between text-xs mb-2">
                        <label className="text-slate-400">遮罩平滑度 (Smoothing)</label>
                        <span className="text-blue-400">{params.blur}px</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" max="50" 
                        value={params.blur} 
                        onChange={e => setParams({...params, blur: parseInt(e.target.value)})}
                        className="w-full accent-blue-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-end">
                   <button 
                    disabled={(boxes.length === 0 && lines.length === 0) || isSubmitting}
                    onClick={submitTask}
                    className={cn(
                      "w-full h-16 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all transform active:scale-[0.98]",
                      (boxes.length > 0 || lines.length > 0) 
                        ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20" 
                        : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                    )}
                  >
                    {isSubmitting ? (
                        <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <>
                            <PlusCircle className="w-6 h-6" />
                            提交去水印任务
                        </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>

        {/* Right Column: Task Queue */}
        <div className="bg-slate-900/20 border border-slate-900 rounded-3xl flex flex-col h-[calc(100vh-160px)] overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-slate-900 flex items-center justify-between bg-slate-900/50 backdrop-blur-sm">
            <h3 className="font-bold flex items-center gap-2 text-slate-100">
              <Clock className="w-5 h-5 text-slate-500" />
              任务队列
            </h3>
            <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-tight shadow-inner">{tasks.length} 项任务</span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {tasks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 p-8 text-center text-balance">
                <Scissors className="w-12 h-12 mb-4" />
                <p className="text-sm font-medium">当前没有任何去水印任务</p>
                <p className="text-[10px] uppercase mt-2 tracking-wide">您的任务将出现在这里</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {tasks.map((task) => (
                  <motion.div 
                    key={task.id}
                    layout
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800 hover:border-slate-700 transition-colors group shadow-lg"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate text-white" title={task.originalName}>{task.originalName}</p>
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5 uppercase tracking-tighter">ID: {task.id.slice(0, 8)}</p>
                      </div>
                      <div className="shrink-0">
                        {task.status === 'completed' ? (
                          <div className="p-1.5 bg-emerald-500/10 rounded-full">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          </div>
                        ) : task.status === 'processing' ? (
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        ) : task.status === 'failed' ? (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-600" />
                        )}
                      </div>
                    </div>

                    {task.status === 'processing' && (
                      <div className="space-y-2 mt-4">
                        <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                          <span>处理中...</span>
                          <span>{task.progress}%</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden shadow-inner">
                          <motion.div 
                            className="h-full bg-blue-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${task.progress}%` }}
                            transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                          />
                        </div>
                      </div>
                    )}

                    {task.status === 'failed' && (
                      <div className="mt-2 text-[10px] text-red-400 bg-red-500/10 p-2 rounded border border-red-500/20 max-h-24 overflow-y-auto font-mono">
                        {task.error || "发生了未知错误"}
                      </div>
                    )}

                    {task.status === 'completed' && (
                      <div className="mt-4 flex gap-2">
                          <button 
                            onClick={() => setPreviewTask(task)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-all border border-slate-700"
                          >
                            <Play className="w-3.5 h-3.5" />
                            预览
                          </button>
                          <button 
                            onClick={(e) => handleDownload(task, e)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-emerald-950 hover:bg-emerald-600 text-emerald-400 hover:text-white rounded-xl text-xs font-bold transition-all border border-emerald-900/50 hover:border-emerald-500"
                          >
                            <Download className="w-3.5 h-3.5" />
                            下载
                          </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 flex flex-col items-center justify-center gap-4 border-t border-slate-900/50 mt-12 text-center">
        <div className="flex items-center gap-2 text-slate-500 text-[10px] font-bold uppercase tracking-[0.2em]">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse hidden sm:block"></div>
          专业级处理内核 v2.0
        </div>
        <p className="text-slate-600 text-[10px] uppercase tracking-widest px-4">确保视频原始质量，实现无痕水印移除, 支持框选与涂抹</p>
      </footer>
    </div>
  );
}
