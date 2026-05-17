export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrushLine {
  id: string;
  points: number[];
  brushSize: number;
}

export interface Task {
  id: string;
  originalName: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  createdAt: string;
}

export interface VideoInfo {
  fileName: string;
  originalName: string;
  url: string;
}
