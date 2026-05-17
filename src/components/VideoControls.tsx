import React, { useEffect, useState, useRef } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface VideoControlsProps {
  videoRef: React.RefObject<HTMLVideoElement>;
}

export const VideoControls: React.FC<VideoControlsProps> = ({ videoRef }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  
  const progressInputRef = useRef<HTMLInputElement>(null);
  const timeTextRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animationFrameId: number;

    const updateUI = () => {
      if (video.duration) {
        const progressVal = (video.currentTime / video.duration) * 100;
        if (progressInputRef.current) {
          progressInputRef.current.value = progressVal.toString();
        }
        if (timeTextRef.current) {
          timeTextRef.current.innerText = `${Math.floor(video.currentTime)}s / ${Math.floor(video.duration)}s`;
        }
      }
    };

    const loop = () => {
      updateUI();
      animationFrameId = requestAnimationFrame(loop);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      animationFrameId = requestAnimationFrame(loop);
    };

    const handlePause = () => {
      setIsPlaying(false);
      cancelAnimationFrame(animationFrameId);
      updateUI();
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      updateUI();
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', updateUI); 
    
    if (video.readyState >= 1) {
      setDuration(video.duration);
      updateUI();
    }

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', updateUI);
      cancelAnimationFrame(animationFrameId);
    };
  }, [videoRef]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        const playPromise = videoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch((error) => console.warn("Playback interrupted:", error));
        }
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoRef.current && videoRef.current.duration) {
      const time = (parseFloat(e.target.value) / 100) * videoRef.current.duration;
      videoRef.current.currentTime = time;
      if (progressInputRef.current) {
         progressInputRef.current.value = e.target.value;
      }
      if (timeTextRef.current) {
         timeTextRef.current.innerText = `${Math.floor(time)}s / ${Math.floor(videoRef.current.duration)}s`;
      }
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col gap-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <button 
          onClick={togglePlay}
          className="w-12 h-12 flex items-center justify-center bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg transition-all active:scale-95 shrink-0"
        >
          {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
        </button>
        
        <button 
          onClick={() => { if(videoRef.current) videoRef.current.currentTime = 0; }}
          className="w-10 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full transition-all shrink-0"
          title="重播"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <div className="flex-1 flex items-center gap-3">
          <input 
            ref={progressInputRef}
            type="range"
            min="0"
            max="100"
            step="0.1"
            defaultValue="0"
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-blue-500"
          />
          <span ref={timeTextRef} className="text-[10px] font-mono text-slate-500 w-16 text-right shrink-0">
            0s / {Math.floor(duration)}s
          </span>
        </div>
      </div>
    </div>
  );
};
