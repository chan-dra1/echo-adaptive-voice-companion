import React from 'react';

interface AvatarDisplayProps {
  state: 'idle' | 'listening' | 'speaking' | 'thinking';
  volume: number; // 0 to 1
  cameraStream?: MediaStream | null; // For Picture-in-Picture
  avatarUrl?: string;
}

export default function AvatarDisplay({ state, volume, cameraStream, avatarUrl = '/ai-avatar.png' }: AvatarDisplayProps) {
  // Map volume to a scale factor for the avatar pulse
  const pulseScale = state === 'speaking' || state === 'listening' 
    ? 1 + volume * 0.15 
    : 1;

  // Render PiP camera view if available
  const videoRef = React.useRef<HTMLVideoElement>(null);
  
  React.useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  return (
    <div className="relative w-full max-w-lg mx-auto flex flex-col items-center justify-center">
      {/* Dynamic Avatar Container */}
      <div 
        className={`relative rounded-full transition-transform duration-100 ${
          state === 'thinking' ? 'animate-pulse' : ''
        }`}
        style={{ transform: `scale(${pulseScale})` }}
      >
        {/* Glow behind avatar based on state */}
        <div className={`absolute inset-0 rounded-full blur-3xl transition-colors duration-500 opacity-60 ${
          state === 'speaking' ? 'bg-cyan-400' :
          state === 'listening' ? 'bg-emerald-400' :
          state === 'thinking' ? 'bg-purple-500' : 'bg-transparent'
        }`} />

        {/* The Avatar Image */}
        <div className="relative z-10 w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
          <img 
            src={avatarUrl} 
            alt="AI Avatar" 
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* State Text */}
      <div className="absolute -bottom-12 flex flex-col items-center gap-2">
        <div className="flex gap-1 items-center">
           {state === 'thinking' && (
             <>
               <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
               <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
               <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"></span>
             </>
           )}
           {state === 'speaking' && (
             <div className="flex items-center gap-1">
                <span className="w-1 bg-cyan-400 rounded-full animate-pulse h-3"></span>
                <span className="w-1 bg-cyan-400 rounded-full animate-pulse h-4 [animation-delay:-0.2s]"></span>
                <span className="w-1 bg-cyan-400 rounded-full animate-pulse h-2 [animation-delay:-0.4s]"></span>
             </div>
           )}
           {state === 'listening' && (
             <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
           )}
        </div>
        <p className="text-sm font-mono tracking-widest text-white/50 uppercase">
          {state === 'idle' ? 'Ready' : state}
        </p>
      </div>

      {/* Picture-in-Picture Camera Feed */}
      {cameraStream && (
        <div className="absolute top-0 right-0 md:right-[-100px] w-24 h-32 md:w-32 md:h-40 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 bg-black">
           <video 
             ref={videoRef}
             autoPlay 
             playsInline 
             muted 
             className="w-full h-full object-cover scale-x-[-1]" 
           />
           <div className="absolute bottom-1 md:bottom-2 left-0 right-0 text-center">
              <span className="bg-black/60 backdrop-blur-md px-1 md:px-2 py-0.5 md:py-1 rounded-md text-[8px] md:text-[10px] font-mono text-emerald-400 tracking-wider">
                LIVE FEED
              </span>
           </div>
        </div>
      )}
    </div>
  );
}
