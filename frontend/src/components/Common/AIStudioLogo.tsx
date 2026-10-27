import React from 'react';

interface AIStudioLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  textClassName?: string;
}

export const AIStudioLogo: React.FC<AIStudioLogoProps> = ({
  size = 'md',
  showText = false,
  className = '',
  textClassName = '',
}) => {
  const iconSizes = {
    sm: 'w-7 h-7 rounded-xl',
    md: 'w-9 h-9 rounded-2xl',
    lg: 'w-12 h-12 rounded-3xl',
  };

  const svgSizes = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-7 h-7',
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className={`${iconSizes[size]} bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-400 flex items-center justify-center text-white shadow-xs group-hover:scale-105 transition-transform shrink-0`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${svgSizes[size]} text-white drop-shadow-xs`}
        >
          {/* Studio Hexagonal Workspace Outline */}
          <path
            d="M12 2L20.5 7V17L12 22L3.5 17V7L12 2Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
            opacity="0.38"
          />
          {/* Dynamic AI Studio 4-Point Star */}
          <path
            d="M12 4.5C12 8.642 8.642 12 4.5 12C8.642 12 12 15.358 12 19.5C12 15.358 15.358 12 19.5 12C15.358 12 12 8.642 12 4.5Z"
            fill="currentColor"
          />
          {/* Studio Glowing Core Nucleus */}
          <circle cx="12" cy="12" r="2.2" fill="#ffffff" />
          <circle cx="18" cy="6" r="1.25" fill="#ffffff" opacity="0.85" />
        </svg>
      </div>
      {showText && (
        <h1
          className={`font-bold text-sm sm:text-base tracking-tight text-m3-on-surface ${textClassName}`}
        >
          AI Studio
        </h1>
      )}
    </div>
  );
};
