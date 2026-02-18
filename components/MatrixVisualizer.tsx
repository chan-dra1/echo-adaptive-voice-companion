import React, { useEffect, useRef } from 'react';

interface MatrixVisualizerProps {
    outputVolume: number; // 0 to 100
    inputVolume: number; // 0 to 100
    isActive: boolean;
}

const MatrixVisualizer: React.FC<MatrixVisualizerProps> = ({ outputVolume, inputVolume, isActive }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const timeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;

        // Grid configuration
        const cols = 30;
        const rows = 20;
        const spacing = 30;

        const render = () => {
            timeRef.current += 0.02;
            const width = canvas.width;
            const height = canvas.height;

            // Clear canvas with fade effect for trails? No, crisp for matrix.
            ctx.fillStyle = '#0f172a'; // Match background
            ctx.clearRect(0, 0, width, height);

            // Center of grid
            const centerX = width / 2;
            const centerY = height / 2;

            // Reactivity
            // Use outputVolume for the bulge intensity
            // Smooth out volume a bit? passed prop is instantaneous.
            // We can just use it directly for responsiveness.
            // normalize volume 0-100 to 0-1
            const intensity = Math.max(outputVolume, inputVolume) / 100;
            const baseBulge = isActive ? 0.2 : 0;
            const bulgeAmount = baseBulge + intensity * 2.0;

            ctx.fillStyle = isActive ? '#10b981' : '#334155'; // Emerald-500 or Slate-700
            ctx.strokeStyle = isActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.2)';

            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    // Normalized coordinates (-1 to 1)
                    const u = (i - cols / 2) / (cols / 2);
                    const v = (j - rows / 2) / (rows / 2);

                    // Distance from center
                    const dist = Math.sqrt(u * u + v * v);

                    // Bulge effect: displace Z based on distance and volume
                    // We simulate 3D by scaling spacing based on Z
                    // Z moves towards camera (positive) with volume

                    // Function: Gaussian-like bulge at center
                    const bulge = Math.exp(-dist * 3) * bulgeAmount;

                    // Oscillate slightly
                    const wave = Math.sin(dist * 5 - timeRef.current * 2) * 0.05 * (isActive ? 1 : 0);

                    const z = 1 + bulge + wave;

                    // Content
                    const x = centerX + u * (width / 2.5) * z;
                    const y = centerY + v * (height / 2.5) * z;

                    // Draw point
                    const size = 2 * z;

                    ctx.beginPath();
                    ctx.arc(x, y, size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            // Draw connecting lines (optional, maybe too busy for Matrix?)
            // Let's draw horizontal lines for "wireframe" look if active
            if (isActive && intensity > 0.1) {
                ctx.beginPath();
                // Horizontal lines
                for (let j = 0; j < rows; j++) {
                    // approximate path
                    // ... simplifying for performance, just dots looks cool for "Matrix code" feel?
                    // User said "Matrix Cube", maybe wireframe cube?
                    // "matrix cube bulges out"
                }
                // Let's stick to dots grid for now, it looks like a "field".
            }

            animationFrameId = requestAnimationFrame(render);
        };

        const resize = () => {
            if (canvas.parentElement) {
                canvas.width = canvas.parentElement.clientWidth;
                canvas.height = canvas.parentElement.clientHeight;
            }
        };

        window.addEventListener('resize', resize);
        resize();
        render();

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationFrameId);
        };
    }, [outputVolume, inputVolume, isActive]);

    return (
        <canvas
            ref={canvasRef}
            className="w-full h-full absolute inset-0 z-0"
        />
    );
};

export default MatrixVisualizer;
