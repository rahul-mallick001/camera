import { useState, useRef, useEffect, useCallback, ReactNode, WheelEvent, MouseEvent } from 'react';
import { 
  Camera, 
  Video, 
  Square, 
  Settings, 
  Maximize, 
  Minimize, 
  Download, 
  Trash2, 
  RefreshCw,
  Sun,
  Contrast as ContrastIcon,
  Palette,
  ChevronRight,
  ChevronLeft,
  Circle,
  Activity,
  Layout,
  Maximize2,
  Ruler,
  Moon,
  Folder,
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface CameraDevice {
  deviceId: string;
  label: string;
}

interface FilterSettings {
  brightness: number;
  contrast: number;
  saturate: number;
  exposure: number; // Simulated via brightness/contrast
  zoom: number;
  shadow: number;
}

interface ROI {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
  type: 'rect' | 'circle';
}

const DEFAULT_ROI: ROI = { x: 10, y: 10, width: 30, height: 30, active: true, type: 'rect' };

const DEFAULT_FILTERS: FilterSettings = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  exposure: 0,
  zoom: 1,
  shadow: 0,
};

export default function App() {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [recordings, setRecordings] = useState<{ url: string; timestamp: number; type: 'video' | 'image' }[]>([]);
  const [filters, setFilters] = useState<FilterSettings>(DEFAULT_FILTERS);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [zoomCapabilities, setZoomCapabilities] = useState<{ min: number; max: number; step: number } | null>(null);
  const [roi, setRoi] = useState<ROI>(DEFAULT_ROI);
  const [pixelsPerMm, setPixelsPerMm] = useState(10);
  const [fps, setFps] = useState(0);
  const [targetFps, setTargetFps] = useState(30);
  const [videoSize, setVideoSize] = useState({ width: 1920, height: 1080 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isDraggingRoi, setIsDraggingRoi] = useState<'move' | 'resize' | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [directoryHandle, setDirectoryHandle] = useState<any | null>(null);
  const [autoSave, setAutoSave] = useState(false);
  const [recordingMimeType, setRecordingMimeType] = useState('video/webm;codecs=vp9,opus');
  const [supportedFormats, setSupportedFormats] = useState<{ label: string; value: string }[]>([]);
  const [isElectron, setIsElectron] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const requestRef = useRef<number | null>(null);

  // Get available camera devices
  const getDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${device.deviceId.slice(0, 5)}`
        }));
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
    } catch (err) {
      console.error("Error getting devices:", err);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    // Detect Electron
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.indexOf(' electron/') > -1) {
      setIsElectron(true);
    }

    getDevices();
    // Re-check devices when they change
    navigator.mediaDevices.ondevicechange = getDevices;

    // Detect supported recording formats
    const formats = [
      { label: 'WebM (VP9)', value: 'video/webm;codecs=vp9,opus' },
      { label: 'WebM (VP8)', value: 'video/webm;codecs=vp8,opus' },
      { label: 'WebM (H.264)', value: 'video/webm;codecs=h264,opus' },
      { label: 'MP4', value: 'video/mp4' },
    ];
    const supported = formats.filter(f => MediaRecorder.isTypeSupported(f.value));
    setSupportedFormats(supported);
    if (supported.length > 0 && !supported.find(f => f.value === recordingMimeType)) {
      setRecordingMimeType(supported[0].value);
    }

    return () => {
      navigator.mediaDevices.ondevicechange = null;
    };
  }, [getDevices]);

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let animationFrameId: number;

    const updateFps = () => {
      frameCount++;
      const currentTime = performance.now();
      if (currentTime - lastTime >= 1000) {
        setFps(Math.round((frameCount * 1000) / (currentTime - lastTime)));
        frameCount = 0;
        lastTime = currentTime;
      }
      animationFrameId = requestAnimationFrame(updateFps);
    };

    animationFrameId = requestAnimationFrame(updateFps);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Start camera stream
  const startStream = useCallback(async () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      const constraints = {
        video: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: targetFps }
        },
        audio: true
      };
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check for zoom capabilities
      const videoTrack = newStream.getVideoTracks()[0];
      const capabilities = videoTrack.getCapabilities() as any;
      
      // Update video size from track settings
      const settings = videoTrack.getSettings();
      if (settings.width && settings.height) {
        setVideoSize({ width: settings.width, height: settings.height });
      }

      if (capabilities.zoom) {
        setZoomCapabilities({
          min: capabilities.zoom.min,
          max: capabilities.zoom.max,
          step: capabilities.zoom.step
        });
        // Reset zoom to min on new stream
        setFilters(f => ({ ...f, zoom: capabilities.zoom.min }));
      } else {
        setZoomCapabilities(null);
        setFilters(f => ({ ...f, zoom: 1 }));
      }

      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
    } catch (err) {
      console.error("Error starting stream:", err);
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    if (selectedDeviceId) {
      startStream();
    }
  }, [selectedDeviceId]);

  // Apply hardware zoom if supported
  useEffect(() => {
    if (stream && zoomCapabilities) {
      const track = stream.getVideoTracks()[0];
      track.applyConstraints({
        advanced: [{ zoom: filters.zoom }]
      } as any).catch(err => console.error("Error applying zoom:", err));

      // Integrate with backend (Simulated Python Backend)
      fetch('/api/camera/zoom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zoomLevel: filters.zoom, deviceId: selectedDeviceId })
      }).catch(err => console.warn("Backend zoom update failed:", err));
    }
  }, [filters.zoom, stream, zoomCapabilities, selectedDeviceId]);

  // Handle scroll wheel zoom
  const handleWheel = (e: WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setFilters(f => {
      const newZoom = Math.max(
        zoomCapabilities?.min || 1, 
        Math.min(zoomCapabilities?.max || 5, f.zoom + delta)
      );
      return { ...f, zoom: parseFloat(newZoom.toFixed(2)) };
    });
  };

  // Recording logic
  const startRecording = () => {
    if (!stream || !videoRef.current) return;

    let recordingStream = stream;

    // If ROI is active, we record from a canvas
    if (roi.active) {
      const canvas = document.createElement('canvas');
      const video = videoRef.current;
      
      // Calculate actual pixel coordinates
      const actualWidth = video.videoWidth;
      const actualHeight = video.videoHeight;
      const roiX = (roi.x / 100) * actualWidth;
      const roiY = (roi.y / 100) * actualHeight;
      const roiW = (roi.width / 100) * actualWidth;
      const roiH = (roi.height / 100) * actualHeight;

      canvas.width = roiW;
      canvas.height = roiH;
      const ctx = canvas.getContext('2d', { alpha: false });

      const drawFrame = () => {
        if (ctx && video) {
          ctx.filter = filterString;
          ctx.save();
          if (roi.type === 'circle') {
            ctx.beginPath();
            ctx.arc(roiW / 2, roiH / 2, Math.min(roiW, roiH) / 2, 0, Math.PI * 2);
            ctx.clip();
          }
          ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);

          // Apply Shadow/Vignette
          if (filters.shadow !== 0) {
            const isNegative = filters.shadow < 0;
            const opacity = Math.abs(filters.shadow) / 100;
            const color = isNegative ? '255,255,255' : '0,0,0';
            
            const gradient = ctx.createRadialGradient(roiW / 2, roiH / 2, 0, roiW / 2, roiH / 2, Math.max(roiW, roiH) * 0.8);
            gradient.addColorStop(0, 'transparent');
            gradient.addColorStop(1, `rgba(${color},${opacity})`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, roiW, roiH);
          }

          ctx.restore();
          requestRef.current = requestAnimationFrame(drawFrame);
        }
      };
      drawFrame();
      recordingStream = canvas.captureStream(targetFps);
      
      // Add audio tracks from original stream if they exist
      stream.getAudioTracks().forEach(track => recordingStream.addTrack(track));
    }

    setRecordedChunks([]);
    const mediaRecorder = new MediaRecorder(recordingStream, {
      mimeType: recordingMimeType
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        setRecordedChunks(prev => [...prev, event.data]);
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
    setRecordingTime(0);
    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  };

  useEffect(() => {
    if (!isRecording && recordedChunks.length > 0) {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const timestamp = Date.now();
      const filename = `recording-${timestamp}.webm`;
      
      if (autoSave && directoryHandle) {
        saveToDirectory(blob, filename);
      }
      
      setRecordings(prev => [{ url, timestamp, type: 'video' }, ...prev]);
      setRecordedChunks([]);
    }
  }, [isRecording, recordedChunks, autoSave, directoryHandle]);

  const takeSnapshot = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    
    // Use actual video dimensions
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Apply the same filters as the preview
      ctx.filter = filterString;
      
      if (roi.active) {
        const actualWidth = video.videoWidth;
        const actualHeight = video.videoHeight;
        const roiX = (roi.x / 100) * actualWidth;
        const roiY = (roi.y / 100) * actualHeight;
        const roiW = (roi.width / 100) * actualWidth;
        const roiH = (roi.height / 100) * actualHeight;
        
        canvas.width = roiW;
        canvas.height = roiH;
        ctx.filter = filterString; // Re-apply after resize
        ctx.save();
        if (roi.type === 'circle') {
          ctx.beginPath();
          ctx.arc(roiW / 2, roiH / 2, Math.min(roiW, roiH) / 2, 0, Math.PI * 2);
          ctx.clip();
        }
        ctx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, roiW, roiH);
        ctx.restore();
      } else if (!zoomCapabilities && filters.zoom > 1) {
        // If hardware zoom isn't supported, we need to manually crop the canvas
        const zoom = filters.zoom;
        const sw = canvas.width / zoom;
        const sh = canvas.height / zoom;
        const sx = (canvas.width - sw) / 2;
        const sy = (canvas.height - sh) / 2;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      } else {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }

      // Apply Shadow/Vignette
      if (filters.shadow !== 0) {
        const isNegative = filters.shadow < 0;
        const opacity = Math.abs(filters.shadow) / 100;
        const color = isNegative ? '255,255,255' : '0,0,0';

        const gradient = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 0, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.8);
        gradient.addColorStop(0, 'transparent');
        gradient.addColorStop(1, `rgba(${color},${opacity})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const timestamp = Date.now();
      const filename = `snapshot-${timestamp}.png`;
      
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          if (autoSave && directoryHandle) {
            saveToDirectory(blob, filename);
          }
          setRecordings(prev => [{ url, timestamp, type: 'image' }, ...prev]);
        }
      }, 'image/png');

      // Visual feedback
      const flash = document.createElement('div');
      flash.className = 'absolute inset-0 bg-white z-50 pointer-events-none animate-flash';
      videoRef.current.parentElement?.appendChild(flash);
      setTimeout(() => flash.remove(), 500);
    }
  };

  // Fullscreen logic
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setTargetFps(30);
    setPixelsPerMm(10);
  };

  // ROI Interaction Logic
  // Calculate displayed video dimensions (object-cover)
  const getDisplayedVideoRect = () => {
    if (!containerSize.width || !containerSize.height || !videoSize.width || !videoSize.height) {
      return { width: containerSize.width, height: containerSize.height, x: 0, y: 0 };
    }

    const videoAspect = videoSize.width / videoSize.height;
    const containerAspect = containerSize.width / containerSize.height;

    let dw, dh, dx, dy;

    if (videoAspect > containerAspect) {
      // Video is wider than container, height matches
      dh = containerSize.height;
      dw = dh * videoAspect;
      dx = (containerSize.width - dw) / 2;
      dy = 0;
    } else {
      // Container is wider than video, width matches
      dw = containerSize.width;
      dh = dw / videoAspect;
      dx = 0;
      dy = (containerSize.height - dh) / 2;
    }

    return { width: dw, height: dh, x: dx, y: dy };
  };

  const videoRect = getDisplayedVideoRect();

  const handleRoiMouseDown = (e: MouseEvent, type: 'move' | 'resize') => {
    if (isRecording) return;
    setIsDraggingRoi(type);

    if (type === 'move' && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left - videoRect.x) / videoRect.width) * 100;
      const mouseY = ((e.clientY - rect.top - videoRect.y) / videoRect.height) * 100;
      setDragOffset({
        x: mouseX - roi.x,
        y: mouseY - roi.y
      });
    }
  };

  const handleRoiMouseMove = (e: MouseEvent) => {
    if (!isDraggingRoi || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left - videoRect.x) / videoRect.width) * 100;
    const y = ((e.clientY - rect.top - videoRect.y) / videoRect.height) * 100;

    if (isDraggingRoi === 'move') {
      setRoi(prev => ({
        ...prev,
        x: Math.max(0, Math.min(100 - prev.width, x - dragOffset.x)),
        y: Math.max(0, Math.min(100 - prev.height, y - dragOffset.y))
      }));
    } else if (isDraggingRoi === 'resize') {
      setRoi(prev => {
        const newWidth = Math.max(1, Math.min(100 - prev.x, x - prev.x));
        const newHeight = Math.max(1, Math.min(100 - prev.y, y - prev.y));
        
        if (prev.type === 'circle') {
          // For a perfect circle visually: width_px = height_px
          // width% * videoWidth = height% * videoHeight
          // So height% = width% * (videoWidth / videoHeight)
          const videoWidth = videoRef.current?.videoWidth || 1920;
          const videoHeight = videoRef.current?.videoHeight || 1080;
          const aspect = videoWidth / videoHeight;
          
          const finalWidth = Math.min(newWidth, 100 - prev.x, (100 - prev.y) / aspect);
          const finalHeight = finalWidth * aspect;
          
          return { ...prev, width: finalWidth, height: finalHeight };
        }
        
        return { ...prev, width: newWidth, height: newHeight };
      });
    }
  };

  const handleRoiMouseUp = () => {
    setIsDraggingRoi(null);
  };

  const centerRoi = () => {
    setRoi(prev => ({
      ...prev,
      x: (100 - prev.width) / 2,
      y: (100 - prev.height) / 2
    }));
  };

  const resetRoi = () => {
    setRoi({ ...DEFAULT_ROI, active: true });
  };

  const saveToDirectory = async (blob: Blob, fileName: string) => {
    if (!directoryHandle) return false;
    try {
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      console.error("Failed to save to directory:", err);
      return false;
    }
  };

  const quitApp = () => {
    if (isElectron) {
      // @ts-ignore
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('quit-app');
    }
  };

  const selectDirectory = async () => {
    try {
      // @ts-ignore
      const handle = await window.showDirectoryPicker();
      setDirectoryHandle(handle);
    } catch (err) {
      console.error("Directory selection failed:", err);
    }
  };

  const exportRecording = async (rec: any) => {
    try {
      const response = await fetch(rec.url);
      const blob = await response.blob();
      
      const isVideo = rec.type === 'video';
      const extension = isVideo ? (recordingMimeType.includes('mp4') ? 'mp4' : 'webm') : 'png';
      const mimeType = isVideo ? (recordingMimeType.includes('mp4') ? 'video/mp4' : 'video/webm') : 'image/png';

      // @ts-ignore
      const handle = await window.showSaveFilePicker({
        suggestedName: isVideo ? `recording-${rec.timestamp}.${extension}` : `snapshot-${rec.timestamp}.${extension}`,
        types: [{
          description: isVideo ? 'Video File' : 'Image File',
          accept: { [mimeType]: [`.${extension}`] },
        }],
      });
      
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  const setAspectRatio = (ratio: number) => {
    const videoWidth = videoSize.width;
    const videoHeight = videoSize.height;
    const videoRatio = videoWidth / videoHeight;

    setRoi(prev => {
      let newWidth = prev.width;
      let newHeight = (prev.width * videoRatio) / ratio;

      if (newHeight > 100) {
        newHeight = 100;
        newWidth = (newHeight * ratio) / videoRatio;
      }

      return {
        ...prev,
        width: newWidth,
        height: newHeight,
        x: Math.min(prev.x, 100 - newWidth),
        y: Math.min(prev.y, 100 - newHeight)
      };
    });
  };

  // CSS Filter string
  const filterString = `
    brightness(${filters.brightness + filters.exposure}%) 
    contrast(${filters.contrast}%) 
    saturate(${filters.saturate}%) 
  `;

  return (
    <div className="min-h-screen bg-beige-bg text-ink font-sans selection:bg-[#FF4444] selection:text-white overflow-hidden flex select-none" ref={containerRef}>
      {/* Sidebar - Controls */}
      <motion.div 
        initial={false}
        animate={{ width: isSidebarOpen ? 320 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="h-screen bg-beige-sidebar border-r border-line overflow-y-auto relative z-20"
      >
        <div className="p-6 space-y-8 min-w-[320px]">
          <div className="flex items-center justify-between">
            <h1 className="text-xs uppercase tracking-[0.2em] font-bold text-ink-muted">Control Unit</h1>
            <Settings size={14} className="text-ink-muted" />
          </div>

          {/* Camera Selection */}
          <div className="space-y-3">
            <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
              <Camera size={12} /> Input Source
            </label>
            <div className="relative">
              <select 
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full bg-white border border-line rounded px-3 py-2 text-xs focus:outline-none focus:border-[#FF4444] appearance-none cursor-pointer text-ink"
              >
                {devices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-muted">
                <RefreshCw size={12} />
              </div>
            </div>
          </div>

          {/* Save Directory */}
          <div className="space-y-3 pt-4 border-t border-line">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
                <Folder size={12} /> Save Location
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[8px] uppercase text-ink-muted font-bold">Auto-Save</span>
                <Switch 
                  checked={autoSave}
                  onChange={setAutoSave}
                  activeColor="#FF4444"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={selectDirectory}
                className="flex-1 bg-white border border-line rounded px-3 py-2 text-[10px] uppercase tracking-wider font-bold hover:bg-beige-bg transition-colors flex items-center justify-center gap-2"
              >
                <Save size={12} /> {directoryHandle ? "Change Folder" : "Select Folder"}
              </button>
            </div>
            {directoryHandle && (
              <div className="text-[9px] text-ink-muted truncate bg-white/50 px-2 py-1 rounded border border-line/50">
                Selected: {directoryHandle.name}
              </div>
            )}
          </div>

          {/* Desktop Controls */}
          {isElectron && (
            <div className="space-y-3 pt-4 border-t border-line">
              <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
                <Layout size={12} /> Desktop App
              </label>
              <button 
                onClick={quitApp}
                className="w-full text-[10px] uppercase tracking-wider py-2 bg-white border border-[#FF4444] text-[#FF4444] rounded hover:bg-[#FF4444] hover:text-white transition-all font-bold"
              >
                Quit Application
              </button>
            </div>
          )}

          {/* Recording Settings */}
          <div className="space-y-3 pt-4 border-t border-line">
            <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
              <Video size={12} /> Recording Options
            </label>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <span className="text-[8px] uppercase text-ink-muted font-bold">Output Format</span>
                <select 
                  value={recordingMimeType}
                  onChange={(e) => setRecordingMimeType(e.target.value)}
                  className="w-full bg-white border border-line rounded px-2 py-1.5 text-[10px] focus:outline-none focus:border-[#FF4444] appearance-none cursor-pointer text-ink"
                >
                  {supportedFormats.map(format => (
                    <option key={format.value} value={format.value}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[8px] uppercase text-ink-muted font-bold">Target FPS</span>
                <div className="flex items-center gap-2">
                  <input 
                    type="range" 
                    min="1" 
                    max="60" 
                    value={targetFps} 
                    onChange={(e) => setTargetFps(parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-[10px] font-bold w-6">{targetFps}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-ink-muted">Image Properties</label>
              <button 
                onClick={resetFilters}
                className="text-[10px] uppercase tracking-widest text-[#FF4444] font-bold hover:opacity-80 transition-opacity"
              >
                Reset
              </button>
            </div>

            <div className="space-y-5">
              <FilterSlider 
                label="Target FPS" 
                icon={<Activity size={12} />} 
                value={targetFps} 
                min={1} 
                max={120} 
                onChange={setTargetFps} 
              />
              <FilterSlider 
                label="Exposure" 
                icon={<Sun size={12} />} 
                value={filters.exposure} 
                min={-100} 
                max={100} 
                onChange={(v) => setFilters(f => ({ ...f, exposure: v }))} 
              />
              <FilterSlider 
                label="Brightness" 
                icon={<Sun size={12} />} 
                value={filters.brightness} 
                min={0} 
                max={200} 
                onChange={(v) => setFilters(f => ({ ...f, brightness: v }))} 
              />
              <FilterSlider 
                label="Contrast" 
                icon={<ContrastIcon size={12} />} 
                value={filters.contrast} 
                min={0} 
                max={200} 
                onChange={(v) => setFilters(f => ({ ...f, contrast: v }))} 
              />
              <FilterSlider 
                label="Saturation" 
                icon={<Palette size={12} />} 
                value={filters.saturate} 
                min={0} 
                max={200} 
                onChange={(v) => setFilters(f => ({ ...f, saturate: v }))} 
              />
              <div className="space-y-3">
                <FilterSlider 
                  label="Shadow / Deshadow" 
                  icon={<Moon size={12} />} 
                  value={filters.shadow} 
                  min={-100} 
                  max={100} 
                  onChange={(v) => setFilters(f => ({ ...f, shadow: v }))} 
                />
              </div>
              <FilterSlider 
                label="Zoom" 
                icon={<Maximize size={12} />} 
                value={filters.zoom} 
                min={zoomCapabilities?.min || 1} 
                max={zoomCapabilities?.max || 5} 
                step={zoomCapabilities?.step || 0.1}
                onChange={(v) => setFilters(f => ({ ...f, zoom: v }))} 
              />
            </div>
          </div>

          {/* ROI Controls */}
          <div className="space-y-4 pt-4 border-t border-line">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
                <Maximize size={12} /> Region of Interest
              </label>
              <Switch 
                checked={roi.active}
                onChange={(v) => setRoi(prev => ({ ...prev, active: v }))}
              />
            </div>
            {roi.active && (
              <div className="space-y-4">
                <div className="text-[9px] text-ink-muted leading-relaxed">
                  Drag the box in the viewport to move. Use the bottom-right handle to resize. 
                  Recording and snapshots will be cropped to this area.
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {roi.type === 'rect' ? (
                    <>
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase text-ink-muted font-bold">Width (mm)</label>
                        <input 
                          type="number" 
                          value={Math.round((roi.width / 100 * (videoRef.current?.videoWidth || 1920)) / pixelsPerMm)}
                          onChange={(e) => {
                            const mm = parseFloat(e.target.value);
                            const videoWidth = videoRef.current?.videoWidth || 1920;
                            const percentage = (mm * pixelsPerMm / videoWidth) * 100;
                            setRoi(prev => ({ ...prev, width: Math.min(100 - prev.x, Math.max(1, percentage)) }));
                          }}
                          className="w-full bg-white border border-line rounded px-2 py-1 text-[10px] focus:outline-none focus:border-[#FF4444] text-ink"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] uppercase text-ink-muted font-bold">Height (mm)</label>
                        <input 
                          type="number" 
                          value={Math.round((roi.height / 100 * (videoRef.current?.videoHeight || 1080)) / pixelsPerMm)}
                          onChange={(e) => {
                            const mm = parseFloat(e.target.value);
                            const videoHeight = videoRef.current?.videoHeight || 1080;
                            const percentage = (mm * pixelsPerMm / videoHeight) * 100;
                            setRoi(prev => ({ ...prev, height: Math.min(100 - prev.y, Math.max(1, percentage)) }));
                          }}
                          className="w-full bg-white border border-line rounded px-2 py-1 text-[10px] focus:outline-none focus:border-[#FF4444] text-ink"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 space-y-1">
                      <label className="text-[8px] uppercase text-ink-muted font-bold">Radius (mm)</label>
                      <input 
                        type="number" 
                        value={Math.round(((roi.width / 2) / 100 * (videoRef.current?.videoWidth || 1920)) / pixelsPerMm)}
                        onChange={(e) => {
                          const mm = parseFloat(e.target.value);
                          const videoWidth = videoRef.current?.videoWidth || 1920;
                          const videoHeight = videoRef.current?.videoHeight || 1080;
                          const radiusPx = mm * pixelsPerMm;
                          const widthPercentage = (radiusPx * 2 / videoWidth) * 100;
                          const aspect = videoWidth / videoHeight;
                          
                          const finalWidth = Math.min(100 - roi.x, widthPercentage, (100 - roi.y) / aspect);
                          const finalHeight = finalWidth * aspect;
                          
                          setRoi(prev => ({ 
                            ...prev, 
                            width: finalWidth, 
                            height: finalHeight 
                          }));
                        }}
                        className="w-full bg-white border border-line rounded px-2 py-1 text-[10px] focus:outline-none focus:border-[#FF4444] text-ink"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[8px] uppercase text-ink-muted font-bold">ROI Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setRoi(prev => ({ ...prev, type: 'rect' }))}
                      className={`text-[9px] uppercase tracking-wider py-1 border rounded transition-colors flex items-center justify-center gap-1 ${
                        roi.type === 'rect' 
                        ? 'bg-ink text-white border-ink' 
                        : 'bg-white border-line text-ink hover:bg-beige-bg'
                      }`}
                    >
                      <Square size={10} /> Rectangle
                    </button>
                    <button 
                      onClick={() => setRoi(prev => ({ ...prev, type: 'circle' }))}
                      className={`text-[9px] uppercase tracking-wider py-1 border rounded transition-colors flex items-center justify-center gap-1 ${
                        roi.type === 'circle' 
                        ? 'bg-ink text-white border-ink' 
                        : 'bg-white border-line text-ink hover:bg-beige-bg'
                      }`}
                    >
                      <Circle size={10} /> Circle
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[8px] uppercase text-ink-muted font-bold">Quick Actions</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={centerRoi}
                      className="text-[9px] uppercase tracking-wider py-1 bg-white border border-line rounded hover:bg-beige-bg transition-colors text-ink"
                    >
                      Center
                    </button>
                    <button 
                      onClick={resetRoi}
                      className="text-[9px] uppercase tracking-wider py-1 bg-white border border-line rounded hover:bg-beige-bg transition-colors text-ink"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[8px] uppercase text-ink-muted font-bold">Aspect Ratio</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button 
                      onClick={() => setAspectRatio(16/9)}
                      className="text-[9px] uppercase tracking-wider py-1 bg-white border border-line rounded hover:bg-beige-bg transition-colors text-ink"
                    >
                      16:9
                    </button>
                    <button 
                      onClick={() => setAspectRatio(4/3)}
                      className="text-[9px] uppercase tracking-wider py-1 bg-white border border-line rounded hover:bg-beige-bg transition-colors text-ink"
                    >
                      4:3
                    </button>
                    <button 
                      onClick={() => setAspectRatio(1)}
                      className="text-[9px] uppercase tracking-wider py-1 bg-white border border-line rounded hover:bg-beige-bg transition-colors text-ink"
                    >
                      1:1
                    </button>
                  </div>
                </div>

                <FilterSlider 
                  label="Calibration (px/mm)" 
                  icon={<Ruler size={12} />} 
                  iconColor="#FF4444"
                  value={pixelsPerMm} 
                  min={1} 
                  max={200} 
                  step={0.1}
                  onChange={setPixelsPerMm} 
                />
              </div>
            )}
          </div>

          {/* Recordings List */}
          <div className="space-y-4 pt-4 border-t border-line">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-ink-muted flex items-center gap-2">
                <Video size={12} /> Recent Captures
              </label>
              {recordings.length > 0 && (
                <button 
                  onClick={() => {
                    recordings.forEach(rec => URL.revokeObjectURL(rec.url));
                    setRecordings([]);
                  }}
                  className="text-[9px] uppercase tracking-wider text-[#FF4444] font-bold hover:opacity-80 transition-opacity"
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="space-y-2">
              <AnimatePresence>
                {recordings.length === 0 ? (
                  <div className="text-[10px] text-ink-muted italic py-4 text-center border border-dashed border-line rounded">
                    No recordings yet
                  </div>
                ) : (
                  recordings.map((rec, i) => (
                    <motion.div 
                      key={rec.timestamp}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="group flex items-center justify-between bg-white border border-line p-2 rounded hover:border-ink transition-colors"
                    >
                      <div className="flex flex-col">
                        <span className="text-[10px] text-ink font-bold">
                          {rec.type === 'video' ? 'REC_' : 'IMG_'}
                          {new Date(rec.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-[8px] text-ink-muted">{new Date(rec.timestamp).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {directoryHandle && (
                          <button 
                            onClick={async () => {
                              const response = await fetch(rec.url);
                              const blob = await response.blob();
                              const filename = rec.type === 'video' ? `recording-${rec.timestamp}.webm` : `snapshot-${rec.timestamp}.png`;
                              await saveToDirectory(blob, filename);
                            }}
                            className="p-1.5 text-ink-muted hover:text-[#FF4444] transition-colors"
                            title="Save to folder"
                          >
                            <Save size={12} />
                          </button>
                        )}
                        <button 
                          onClick={() => exportRecording(rec)}
                          className="p-1.5 text-ink-muted hover:text-[#FF4444] transition-colors"
                          title="Export As..."
                        >
                          <Maximize2 size={12} />
                        </button>
                        <a 
                          href={rec.url} 
                          download={rec.type === 'video' ? `recording-${rec.timestamp}.webm` : `snapshot-${rec.timestamp}.png`}
                          className="p-1.5 text-ink-muted hover:text-[#FF4444] transition-colors"
                        >
                          <Download size={12} />
                        </a>
                        <button 
                          onClick={() => setRecordings(prev => prev.filter((_, idx) => idx !== i))}
                          className="p-1.5 text-ink-muted hover:text-[#FF4444] transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main Viewport */}
      <div className="flex-1 relative flex flex-col bg-beige-bg">
        {/* Toggle Sidebar Button */}
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-30 p-2 bg-beige-sidebar border border-line rounded-full text-ink-muted hover:text-ink transition-colors shadow-lg"
        >
          {isSidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        {/* Top Bar - Status */}
        <div className="absolute top-0 left-0 right-0 p-6 flex items-center justify-between z-10 pointer-events-none">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line pointer-events-auto shadow-sm">
              <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
              <span className="text-[10px] uppercase tracking-widest font-bold text-ink">
                {isRecording ? 'Recording' : 'Real-Time Preview'}
              </span>
            </div>
            {isRecording && (
              <div className="bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line text-[#FF4444] text-[10px] font-bold tracking-widest pointer-events-auto shadow-sm">
                {formatTime(recordingTime)}
              </div>
            )}
            {!isRecording && (
              <div className="bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line text-ink-muted text-[10px] font-bold tracking-widest pointer-events-auto shadow-sm">
                STANDBY
              </div>
            )}
            <div className="bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line text-ink-muted text-[10px] font-bold tracking-widest pointer-events-auto shadow-sm flex items-center gap-2">
              <Activity size={10} className="text-[#FF4444]" />
              <span>{fps} FPS</span>
            </div>
            <div className="bg-white/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line text-ink-muted text-[10px] font-bold tracking-widest pointer-events-auto shadow-sm flex items-center gap-2">
              <Ruler size={10} className="text-[#FF4444]" />
              <div className="flex items-center gap-1.5">
                <div 
                  className="h-1 bg-ink rounded-full" 
                  style={{ width: `${Math.max(1, pixelsPerMm * (videoRect.width / videoSize.width))}px` }} 
                />
                <span className="text-[8px] uppercase tracking-widest">1mm</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pointer-events-auto">
            <button 
              onClick={toggleFullscreen}
              className="p-2 bg-white/80 backdrop-blur-md rounded-full border border-line text-ink-muted hover:text-ink transition-colors shadow-sm"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>

        {/* Video Container */}
        <div 
          className="flex-1 flex items-center justify-center overflow-hidden relative cursor-crosshair"
          onWheel={handleWheel}
          onMouseMove={handleRoiMouseMove}
          onMouseUp={handleRoiMouseUp}
          onMouseLeave={handleRoiMouseUp}
        >
          <video 
            ref={videoRef}
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transition-all duration-300"
            style={{ 
              filter: filterString,
              transform: !zoomCapabilities ? `scale(${filters.zoom})` : 'none'
            }}
          />

          {/* Shadow/Vignette Overlay */}
          <div 
            className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300"
            style={{
              background: `radial-gradient(circle, transparent 20%, ${filters.shadow < 0 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)'} 150%)`,
              opacity: Math.abs(filters.shadow) / 100
            }}
          />
          
          {/* ROI Overlay */}
          {roi.active && (
            <div 
              className={`absolute border-2 border-[#FF4444] bg-transparent ${isDraggingRoi ? 'transition-none shadow-[0_0_20px_rgba(255,68,68,0.4)]' : 'transition-shadow'} ${roi.type === 'circle' ? 'rounded-full' : ''}`}
              style={{
                left: `${videoRect.x + (roi.x / 100) * videoRect.width}px`,
                top: `${videoRect.y + (roi.y / 100) * videoRect.height}px`,
                width: `${(roi.width / 100) * videoRect.width}px`,
                height: `${(roi.height / 100) * videoRect.height}px`,
                cursor: isDraggingRoi ? 'grabbing' : 'grab'
              }}
              onMouseDown={(e) => handleRoiMouseDown(e, 'move')}
            >
              {/* Resize Handle */}
              <div 
                className={`absolute bottom-0 right-0 w-4 h-4 bg-[#FF4444] cursor-nwse-resize flex items-center justify-center ${roi.type === 'circle' ? 'rounded-full translate-x-1/2 translate-y-1/2' : ''}`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  handleRoiMouseDown(e, 'resize');
                }}
              >
                <div className="w-1 h-1 bg-white rounded-full" />
              </div>
              
              {/* ROI Label */}
              <div className={`absolute -top-5 left-0 bg-[#FF4444] text-white text-[8px] px-1 uppercase font-bold whitespace-nowrap flex items-center gap-1 ${roi.type === 'circle' ? 'translate-y-[-4px]' : ''}`}>
                <div className="w-1 h-1 bg-white animate-pulse" />
                {roi.type === 'circle' ? 'Circle' : 'Rect'} ROI: {Math.round((roi.width / 100 * videoSize.width) / pixelsPerMm)}mm x {Math.round((roi.height / 100 * videoSize.height) / pixelsPerMm)}mm
              </div>

              {/* Crosshairs */}
              <div className="absolute inset-0 pointer-events-none opacity-20">
                <div className="absolute top-1/2 left-0 right-0 h-[0.5px] bg-white" />
                <div className="absolute left-1/2 top-0 bottom-0 w-[0.5px] bg-white" />
                <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white" />
                <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white" />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white" />
              </div>
            </div>
          )}


        </div>

        {/* Bottom Bar - Main Controls */}
        <div className="absolute bottom-0 left-0 right-0 p-8 flex justify-center z-10">
          <div className="bg-white/80 backdrop-blur-xl border border-line rounded-full p-2 flex items-center gap-4 shadow-2xl">
            <button 
              onClick={takeSnapshot}
              className="w-12 h-12 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-beige-bg transition-all"
              title="Take Snapshot"
            >
              <Camera size={20} />
            </button>
            
            <button 
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all transform active:scale-95 ${
                isRecording 
                ? 'bg-[#FF4444] text-white shadow-[0_0_20px_rgba(255,68,68,0.4)]' 
                : 'bg-ink text-white hover:scale-105 shadow-lg'
              }`}
            >
              {isRecording ? <Square size={24} fill="currentColor" /> : <Circle size={24} fill="currentColor" />}
            </button>

            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="w-12 h-12 rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-beige-bg transition-all"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        input[type=range] {
          -webkit-appearance: none;
          background: transparent;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 2px;
          background: #222;
          border-radius: 1px;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #FF4444;
          cursor: pointer;
          margin-top: -5px;
          box-shadow: 0 0 10px rgba(255, 68, 68, 0.3);
        }
        input[type=range]:focus::-webkit-slider-runnable-track {
          background: #333;
        }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
        @keyframes flash {
          0% { opacity: 0.8; }
          100% { opacity: 0; }
        }
        .animate-flash {
          animation: flash 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

function Switch({ 
  checked, 
  onChange, 
  activeColor = "#FF4444"
}: { 
  checked: boolean; 
  onChange: (v: boolean) => void; 
  activeColor?: string;
}) {
  return (
    <button 
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 group cursor-pointer"
    >
      <div 
        className={`w-8 h-4 rounded-full relative transition-colors duration-300 ${checked ? '' : 'bg-line'}`}
        style={{ backgroundColor: checked ? activeColor : undefined }}
      >
        <div 
          className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all duration-300 shadow-sm ${checked ? 'left-4.5' : 'left-0.5'}`}
        />
      </div>
    </button>
  );
}

function FilterSlider({ 
  label, 
  icon, 
  iconColor,
  value, 
  min, 
  max, 
  step = 1,
  onChange 
}: { 
  label: string; 
  icon: ReactNode; 
  iconColor?: string;
  value: number; 
  min: number; 
  max: number; 
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-ink-muted">
        <div className="flex items-center gap-2">
          <span style={{ color: iconColor || 'currentColor' }}>{icon}</span>
          <span>{label}</span>
        </div>
        <input 
          type="number" 
          value={value} 
          min={min} 
          max={max} 
          step={step}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) onChange(val);
          }}
          className="bg-white border border-line rounded px-1.5 py-0.5 text-[10px] font-bold text-ink w-12 text-center focus:outline-none focus:border-[#FF4444]"
        />
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        step={step}
        value={value} 
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
      />
    </div>
  );
}
