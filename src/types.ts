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
  type?: 'video' | 'image';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  createdAt: string;
}

export interface MediaInfo {
  fileName: string;
  originalName: string;
  type?: 'video' | 'image';
  url: string;
}
