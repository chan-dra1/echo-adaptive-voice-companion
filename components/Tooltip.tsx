import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top', delay = 200 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    if (isVisible && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const tooltipWidth = 200; // Approximate width
      const tooltipHeight = 40; // Approximate height

      let x = rect.left + rect.width / 2;
      let y = rect.top;

      switch (position) {
        case 'top':
          x = rect.left + rect.width / 2 - tooltipWidth / 2;
          y = rect.top - tooltipHeight - 8;
          break;
        case 'bottom':
          x = rect.left + rect.width / 2 - tooltipWidth / 2;
          y = rect.bottom + 8;
          break;
        case 'left':
          x = rect.left - tooltipWidth - 8;
          y = rect.top + rect.height / 2 - tooltipHeight / 2;
          break;
        case 'right':
          x = rect.right + 8;
          y = rect.top + rect.height / 2 - tooltipHeight / 2;
          break;
      }

      setCoords({ x, y });
    }
  }, [isVisible, position]);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-800 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-800 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-800 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-800 border-y-transparent border-l-transparent',
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && content && (
        <div
          className={`absolute ${positionClasses[position]} z-50 pointer-events-none`}
          role="tooltip"
        >
          <div className="bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow-xl border border-white/10 whitespace-nowrap">
            {content}
            <div className={`absolute ${arrowClasses[position]} w-0 h-0 border-4`} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Tooltip;
