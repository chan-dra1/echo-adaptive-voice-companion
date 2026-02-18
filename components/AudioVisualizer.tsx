import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  inputVolume: number;
  outputVolume: number;
  isActive: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ inputVolume, outputVolume, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);
  const pulseRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Idle State
      if (!isActive) {
        const breathe = Math.sin(Date.now() / 2000) * 5 + 60;
        ctx.beginPath();
        ctx.arc(centerX, centerY, breathe, 0, Math.PI * 2);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.3;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, breathe - 15, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.globalAlpha = 0.1;
        ctx.fill();
        return;
      }

      // Check dominant source
      const isAiSpeaking = outputVolume > 5;
      const isUserSpeaking = inputVolume > 5;

      // Update dynamics
      let rotationSpeed = 0.002;
      let targetPulse = 0;
      
      if (isAiSpeaking) {
          rotationSpeed = 0.01;
          targetPulse = outputVolume * 0.5;
      } else if (isUserSpeaking) {
          rotationSpeed = 0.03; 
          targetPulse = inputVolume * 0.8;
      }

      rotationRef.current += rotationSpeed;
      pulseRef.current += (targetPulse - pulseRef.current) * 0.1;

      const baseRadius = 60 + (pulseRef.current * 0.2);

      // ----------------------------
      // AI VISUAL (Smooth, Harmonic)
      // ----------------------------
      if (!isUserSpeaking || isAiSpeaking) {
         const colorR = 120 + (outputVolume * 2);
         const colorB = 255;
         const colorG = 100;
         const aiColor = `rgba(${colorR}, ${colorG}, ${colorB}, 0.8)`;
         
         // Core
         const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius * 1.5);
         gradient.addColorStop(0, 'rgba(139, 92, 246, 0.2)'); // Violet
         gradient.addColorStop(1, 'rgba(0,0,0,0)');
         ctx.fillStyle = gradient;
         ctx.beginPath();
         ctx.arc(centerX, centerY, baseRadius * 2, 0, Math.PI*2);
         ctx.fill();

         // Smooth Waves
         ctx.strokeStyle = aiColor;
         ctx.lineWidth = 2;
         for (let i = 0; i < 3; i++) {
             ctx.beginPath();
             for (let angle = 0; angle <= 360; angle += 2) {
                 const rad = (angle * Math.PI) / 180;
                 const offset = (i * 20);
                 const wave = Math.sin((rad * 6) + rotationRef.current + i) * (outputVolume * 0.3);
                 const r = baseRadius + offset + wave;
                 const x = centerX + Math.cos(rad) * r;
                 const y = centerY + Math.sin(rad) * r;
                 if (angle === 0) ctx.moveTo(x, y);
                 else ctx.lineTo(x, y);
             }
             ctx.stroke();
         }
      }

      // ----------------------------
      // USER VISUAL (Spiky, Reactive)
      // ----------------------------
      if (isUserSpeaking) {
         const userColor = `rgba(20, 220, 180, ${Math.min(1, inputVolume / 20)})`; // Teal
         
         ctx.strokeStyle = userColor;
         ctx.lineWidth = 2.5;
         
         // Spiky Waveform
         ctx.beginPath();
         for (let angle = 0; angle <= 360; angle += 3) {
             const rad = (angle * Math.PI) / 180;
             // High frequency noise for "voice" texture
             const noise = Math.random() * (inputVolume * 0.5);
             const spike = Math.sin((rad * 20) - (rotationRef.current * 4)) * (inputVolume * 0.4);
             const r = baseRadius + 10 + spike + noise;
             const x = centerX + Math.cos(rad) * r;
             const y = centerY + Math.sin(rad) * r;
             if (angle === 0) ctx.moveTo(x, y);
             else ctx.lineTo(x, y);
         }
         ctx.closePath();
         ctx.stroke();
         
         // Inner energetic core
         ctx.beginPath();
         ctx.arc(centerX, centerY, baseRadius * 0.8, 0, Math.PI * 2);
         ctx.fillStyle = 'rgba(20, 220, 180, 0.1)';
         ctx.fill();
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [inputVolume, outputVolume, isActive]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
};

export default React.memo(AudioVisualizer);
