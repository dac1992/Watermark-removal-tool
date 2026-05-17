import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Transformer, Line as KonvaLine } from 'react-konva';
import { BoundingBox, BrushLine } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Trash2, MousePointer2, Brush } from 'lucide-react';
import { VideoControls } from './VideoControls';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface VideoCanvasProps {
  videoUrl: string;
  boxes: BoundingBox[];
  setBoxes: React.Dispatch<React.SetStateAction<BoundingBox[]>>;
  lines: BrushLine[];
  setLines: React.Dispatch<React.SetStateAction<BrushLine[]>>;
  onClear: () => void;
  drawMode: 'box' | 'brush';
  setDrawMode: (mode: 'box' | 'brush') => void;
  brushSize: number;
  onSizeChange?: (info: { canvasWidth: number, canvasHeight: number, videoWidth: number, videoHeight: number }) => void;
}

export const VideoCanvas: React.FC<VideoCanvasProps> = ({ 
  videoUrl, boxes, setBoxes, lines, setLines, onClear, drawMode, setDrawMode, brushSize, onSizeChange 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<any>(null);
  const transformerRef = useRef<any>(null);
  
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [newBox, setNewBox] = useState<BoundingBox | null>(null);
  const [selectedId, selectShape] = useState<string | null>(null);
  const [isDrawingBrush, setIsDrawingBrush] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (videoRef.current) {
        const { clientWidth, clientHeight, videoWidth, videoHeight } = videoRef.current;
        setSize({ width: clientWidth, height: clientHeight });
        if (onSizeChange) {
           onSizeChange({ canvasWidth: clientWidth, canvasHeight: clientHeight, videoWidth: videoWidth || clientWidth, videoHeight: videoHeight || clientHeight });
        }
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [videoUrl, onSizeChange]);

  // Hook transformer to selected shape
  useEffect(() => {
    if (selectedId && transformerRef.current && drawMode === 'box') {
      const node = stageRef.current.findOne('#' + selectedId);
      if (node) {
        transformerRef.current.nodes([node]);
        transformerRef.current.getLayer().batchDraw();
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([]);
    }
  }, [selectedId, boxes, drawMode]);

  const handleMouseDown = (e: any) => {
    if (e.target !== e.target.getStage()) {
      // We are preventing drawing if clicking on an existing shape, unless we implement different tools
      // For brush, maybe we can draw over them but let's keep it simple
      if (drawMode === 'box') return;
    }
    
    const pos = e.target.getStage().getPointerPosition();
    
    if (drawMode === 'box') {
      const id = uuidv4();
      setNewBox({ id, x: pos.x, y: pos.y, width: 0, height: 0 });
      selectShape(null); // Deselect on draw new
    } else if (drawMode === 'brush') {
      setIsDrawingBrush(true);
      selectShape(null);
      setLines([...lines, { id: uuidv4(), points: [pos.x, pos.y], brushSize }]);
    }
  };

  const handleMouseMove = (e: any) => {
    const pos = e.target.getStage().getPointerPosition();

    if (drawMode === 'box' && newBox) {
      setNewBox({
        ...newBox,
        width: pos.x - newBox.x,
        height: pos.y - newBox.y,
      });
    } else if (drawMode === 'brush' && isDrawingBrush) {
      let lastLine = lines[lines.length - 1];
      // append new point
      lastLine.points = lastLine.points.concat([pos.x, pos.y]);
      // replace last
      lines.splice(lines.length - 1, 1, lastLine);
      setLines(lines.concat());
    }
  };

  const handleMouseUp = () => {
    if (drawMode === 'box' && newBox) {
      if (Math.abs(newBox.width) > 5 && Math.abs(newBox.height) > 5) {
        const normalized = {
          ...newBox,
          x: newBox.width < 0 ? newBox.x + newBox.width : newBox.x,
          y: newBox.height < 0 ? newBox.y + newBox.height : newBox.y,
          width: Math.abs(newBox.width),
          height: Math.abs(newBox.height),
        };
        setBoxes([...boxes, normalized]);
        selectShape(normalized.id);
      }
      setNewBox(null);
    } else if (drawMode === 'brush' && isDrawingBrush) {
      setIsDrawingBrush(false);
    }
  };

  const checkDeselect = (e: any) => {
    const clickedOnEmpty = e.target === e.target.getStage();
    if (clickedOnEmpty) {
      selectShape(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Container header/info */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">操作工具:</span>
          
          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
            <button
               onClick={() => { setDrawMode('box'); selectShape(null); }}
               className={cn("px-3 py-1.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-slate-300",
                 drawMode === 'box' ? "bg-blue-600 text-white shadow-md" : "hover:text-white"
               )}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
              框选模式
            </button>
            <button
               onClick={() => { setDrawMode('brush'); selectShape(null); }}
               className={cn("px-3 py-1.5 flex items-center gap-1.5 rounded-md text-xs font-medium transition-all text-slate-300",
                 drawMode === 'brush' ? "bg-blue-600 text-white shadow-md" : "hover:text-white"
               )}
            >
              <Brush className="w-3.5 h-3.5" />
              涂抹模式
            </button>
          </div>
          <span className="text-xs text-slate-400 ml-2">
            {drawMode === 'box' ? "直接拖拽鼠标画框，选定后可调整大小" : "按住鼠标涂抹需要消除的水印部分"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs font-medium text-slate-400">
            已添加 <span className="text-blue-400 font-bold">{boxes.length + lines.length}</span> 个标记
          </div>
          {(boxes.length > 0 || lines.length > 0) && (
            <button 
              onClick={onClear}
              className="text-[10px] uppercase font-bold text-red-500/80 hover:text-red-500 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              全部清空
            </button>
          )}
        </div>
      </div>

      {/* Video Area */}
      <div className="relative group rounded-2xl overflow-hidden border border-slate-800 bg-black shadow-2xl mx-auto max-w-4xl">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-auto block"
          playsInline
          onLoadedMetadata={() => {
              if (videoRef.current) {
                  const { clientWidth, clientHeight, videoWidth, videoHeight } = videoRef.current;
                  setSize({ width: clientWidth, height: clientHeight });
                  if (onSizeChange) {
                      onSizeChange({ canvasWidth: clientWidth, canvasHeight: clientHeight, videoWidth: videoWidth || clientWidth, videoHeight: videoHeight || clientHeight });
                  }
              }
          }}
        />
        
        {/* Drawing layer - always active */}
        <div className="absolute inset-0 z-10 cursor-crosshair">
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={checkDeselect}
            className="w-full h-full"
          >
            <Layer>
              {lines.map((line, i) => (
                 <KonvaLine
                   key={line.id}
                   points={line.points}
                   stroke="#3b82f6"
                   strokeWidth={line.brushSize}
                   tension={0.5}
                   lineCap="round"
                   lineJoin="round"
                   opacity={0.5}
                   onClick={(e) => {
                       // Deselect box mode items if line is clicked
                       selectShape(null);
                   }}
                 />
              ))}

              {boxes.map((box, i) => (
                <React.Fragment key={box.id}>
                  <Rect
                    id={box.id}
                    x={box.x}
                    y={box.y}
                    width={box.width}
                    height={box.height}
                    fill="rgba(59, 130, 246, 0.15)"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    draggable={drawMode === 'box'}
                    onDragStart={() => selectShape(box.id)}
                    onDragEnd={(e) => {
                      const newBoxes = boxes.slice();
                      newBoxes[i] = {
                        ...box,
                        x: e.target.x(),
                        y: e.target.y(),
                      };
                      setBoxes(newBoxes);
                    }}
                    onTransformEnd={(e) => {
                      const node = e.target;
                      const scaleX = node.scaleX();
                      const scaleY = node.scaleY();

                      // Reset scale to 1 to match data model
                      node.scaleX(1);
                      node.scaleY(1);
                      
                      const newBoxes = boxes.slice();
                      newBoxes[i] = {
                         ...box,
                         x: node.x(),
                         y: node.y(),
                         width: Math.max(5, node.width() * scaleX),
                         height: Math.max(5, node.height() * scaleY)
                      };
                      setBoxes(newBoxes);
                    }}
                    onClick={(e) => {
                        e.cancelBubble = true;
                        selectShape(box.id);
                    }}
                  />
                  {/* Delete button (rendered via standard html / konva coordinates overlay could be easier if transformer enabled) */}
                </React.Fragment>
              ))}
              
              {newBox && (
                <Rect
                  x={newBox.x}
                  y={newBox.y}
                  width={newBox.width}
                  height={newBox.height}
                  fill="rgba(59, 130, 246, 0.3)"
                  stroke="#3b82f6"
                  strokeWidth={1}
                  dash={[4, 4]}
                />
              )}

              {drawMode === 'box' && <Transformer 
                 ref={transformerRef}
                 rotateEnabled={false}
                 enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right']}
                 boundBoxFunc={(oldBox, newBox) => {
                   if (newBox.width < 5 || newBox.height < 5) return oldBox;
                   return newBox;
                 }}
              />}
            </Layer>
          </Stage>
        </div>
      </div>

      <VideoControls videoRef={videoRef} />
    </div>
  );
};

