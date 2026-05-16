import React from 'react';

interface AgentCoreProps {
  state: 'idle' | 'listening' | 'speaking' | 'thinking';
  volume: number; // 0 to 1
}

const AgentCore: React.FC<AgentCoreProps> = ({ state, volume }) => {
  const getGlowColor = () => {
    switch (state) {
      case 'listening': return 'rgba(10, 226, 255, 0.8)';
      case 'speaking': return 'rgba(255, 60, 150, 0.8)';
      case 'thinking': return 'rgba(255, 200, 10, 0.8)';
      default: return 'rgba(255, 255, 255, 0.2)';
    }
  };

  const scale = 1 + (state === 'speaking' || state === 'listening' ? volume * 0.5 : 0);

  return (
    <div className="relative flex items-center justify-center w-64 h-64 sm:w-80 sm:h-80">
      {/* Outer Glow Ring */}
      <div 
        className="absolute inset-0 rounded-full blur-3xl opacity-20 transition-all duration-300"
        style={{ 
          backgroundColor: getGlowColor(),
          transform: `scale(${scale * 1.5})` 
        }}
      />
      
      {/* Secondary Glow */}
      <div 
        className="absolute inset-4 rounded-full blur-2xl opacity-40 transition-all duration-500"
        style={{ 
          backgroundColor: getGlowColor(),
          transform: `scale(${scale * 1.2})` 
        }}
      />

      {/* The Core Orb */}
      <div 
        className={`relative w-32 h-32 sm:w-40 sm:h-40 rounded-full transition-all duration-150 ease-out shadow-2xl backdrop-blur-md overflow-hidden
          ${state === 'thinking' ? 'animate-pulse' : ''}
        `}
        style={{ 
          transform: `scale(${scale})`,
          background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.8) 100%)`,
          border: '1px solid rgba(255,255,255,0.1)'
        }}
      >
        {/* Internal Visuals */}
        <div 
          className="absolute inset-0 opacity-60"
          style={{
            background: `radial-gradient(circle at center, ${getGlowColor()} 0%, transparent 70%)`
          }}
        />
        
        {/* Active Wave Pattern (CSS only) */}
        {(state === 'speaking' || state === 'listening') && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <div className="w-full h-full opacity-30 animate-spin-slow">
              <div 
                className="absolute inset-0 rounded-full" 
                style={{
                  border: `2px solid ${getGlowColor()}`,
                  clipPath: 'polygon(0% 0%, 100% 0%, 100% 30%, 0% 70%)'
                }} 
              />
            </div>
          </div>
        )}
      </div>

      {/* Label Indicator */}
      <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center">
        <span className="text-[10px] tracking-[0.3em] uppercase opacity-40 font-medium text-white mb-1">
          {state === 'idle' ? 'Ready' : state}
        </span>
        <div className="w-1 h-1 rounded-full bg-white opacity-20" />
      </div>
    </div>
  );
};

export default AgentCore;
