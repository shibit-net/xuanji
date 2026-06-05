import React from 'react';
import {
  Bot, Wrench, Package, FileText, Brain,
  Clock, ShieldCheck,
} from 'lucide-react';

export interface GlassIconsItem {
  icon: React.ReactElement;
  color: string;
  label: string;
  customClass?: string;
}

export interface GlassIconsProps {
  items: GlassIconsItem[];
  className?: string;
}

const gradientMapping: Record<string, string> = {
  blue: 'linear-gradient(hsl(223, 90%, 50%), hsl(208, 90%, 50%))',
  purple: 'linear-gradient(hsl(283, 90%, 50%), hsl(268, 90%, 50%))',
  red: 'linear-gradient(hsl(3, 90%, 50%), hsl(348, 90%, 50%))',
  indigo: 'linear-gradient(hsl(253, 90%, 50%), hsl(238, 90%, 50%))',
  orange: 'linear-gradient(hsl(43, 90%, 50%), hsl(28, 90%, 50%))',
  green: 'linear-gradient(hsl(123, 90%, 40%), hsl(108, 90%, 40%))'
};

const getBackgroundStyle = (color: string): React.CSSProperties => {
  if (gradientMapping[color]) {
    return { background: gradientMapping[color] };
  }
  return { background: color };
};

// ─── 单个毛玻璃图标 ──────────────────────────

export interface GlassIconProps {
  icon: React.ReactElement;
  color: string;
  size?: number;
  className?: string;
}

export const GlassIcon: React.FC<GlassIconProps> = ({ icon, color, size = 14, className }) => {
  const containerSize = size * 1.2; // 留出玻璃层边距
  const iconSize = size;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[4px] ${className || ''}`}
      style={{
        width: containerSize,
        height: containerSize,
        position: 'relative',
        ...getBackgroundStyle(color),
        boxShadow: '0 1px 3px hsla(223, 10%, 10%, 0.15)',
      }}
    >
      {/* 玻璃层 */}
      <span
        className="absolute inset-0 rounded-[4px] flex items-center justify-center"
        style={{
          background: 'hsla(0,0%,100%,0.15)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          boxShadow: '0 0 0 0.5px hsla(0,0%,100%,0.3) inset',
        }}
      >
        <span
          className="flex items-center justify-center text-white"
          style={{ width: iconSize, height: iconSize }}
          aria-hidden="true"
        >
          {React.cloneElement(icon, { size: iconSize, strokeWidth: 2 })}
        </span>
      </span>
    </span>
  );
};

// ─── 语义命名导出 ────────────────────────────

export const GlassRobotIcon   = (props: { size?: number; className?: string }) => <GlassIcon icon={<Bot />} color="blue" {...props} />;
export const GlassToolsIcon   = (props: { size?: number; className?: string }) => <GlassIcon icon={<Wrench />} color="indigo" {...props} />;
export const GlassPackageIcon = (props: { size?: number; className?: string }) => <GlassIcon icon={<Package />} color="orange" {...props} />;
export const GlassFileIcon    = (props: { size?: number; className?: string }) => <GlassIcon icon={<FileText />} color="purple" {...props} />;
export const GlassBrainIcon   = (props: { size?: number; className?: string }) => <GlassIcon icon={<Brain />} color="purple" {...props} />;
export const GlassClockIcon   = (props: { size?: number; className?: string }) => <GlassIcon icon={<Clock />} color="green" {...props} />;
export const GlassShieldIcon  = (props: { size?: number; className?: string }) => <GlassIcon icon={<ShieldCheck />} color="red" {...props} />;

const GlassIcons: React.FC<GlassIconsProps> = ({ items, className }) => {
  return (
    <div className={`grid gap-[5em] grid-cols-2 md:grid-cols-3 mx-auto py-[3em] overflow-visible ${className || ''}`}>
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          aria-label={item.label}
          className={`relative bg-transparent outline-none border-none cursor-pointer w-[4.5em] h-[4.5em] [perspective:24em] [transform-style:preserve-3d] [-webkit-tap-highlight-color:transparent] group ${
            item.customClass || ''
          }`}
        >
          <span
            className="absolute top-0 left-0 w-full h-full rounded-[1.25em] block transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.83,0,0.17,1)] origin-[100%_100%] rotate-[15deg] [will-change:transform] group-hover:[transform:rotate(25deg)_translate3d(-0.5em,-0.5em,0.5em)]"
            style={{
              ...getBackgroundStyle(item.color),
              boxShadow: '0.5em -0.5em 0.75em hsla(223, 10%, 10%, 0.15)'
            }}
          ></span>

          <span
            className="absolute top-0 left-0 w-full h-full rounded-[1.25em] bg-[hsla(0,0%,100%,0.15)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.83,0,0.17,1)] origin-[80%_50%] flex backdrop-blur-[0.75em] [-webkit-backdrop-filter:blur(0.75em)] [-moz-backdrop-filter:blur(0.75em)] [will-change:transform] transform group-hover:[transform:translate3d(0,0,2em)]"
            style={{
              boxShadow: '0 0 0 0.1em hsla(0, 0%, 100%, 0.3) inset'
            }}
          >
            <span className="m-auto w-[1.5em] h-[1.5em] flex items-center justify-center" aria-hidden="true">
              {item.icon}
            </span>
          </span>

          <span className="absolute top-full left-0 right-0 text-center whitespace-nowrap leading-[2] text-base opacity-0 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.83,0,0.17,1)] translate-y-0 group-hover:opacity-100 group-hover:[transform:translateY(20%)]">
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
};

export default GlassIcons;
