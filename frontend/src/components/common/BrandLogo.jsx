import { useId } from "react";

/**
 * Iconic vector brand mark for AI Quiz Studio:
 * Deep charcoal squircle + mint-emerald geometric "Q" + crisp quiz checkmark + 4-point AI spark.
 */
export function BrandLogo({ className = "size-9" }) {
  const uid = useId().replace(/:/g, "");
  const bgId = `aqs-bg-${uid}`;
  const mintId = `aqs-mint-${uid}`;
  const sparkId = `aqs-spark-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bgId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2A302E" />
          <stop offset="100%" stopColor="#171B1A" />
        </linearGradient>
        <linearGradient id={mintId} x1="14" y1="14" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C8FFEE" />
          <stop offset="55%" stopColor="#B0FDE0" />
          <stop offset="100%" stopColor="#4ADEB8" />
        </linearGradient>
        <linearGradient id={sparkId} x1="42" y1="8" x2="56" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#B0FDE0" />
        </linearGradient>
      </defs>

      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${bgId})`} />
      <rect
        x="2.75"
        y="2.75"
        width="58.5"
        height="58.5"
        rx="15.25"
        stroke="#B0FDE0"
        strokeOpacity="0.22"
        strokeWidth="1.5"
      />

      <path
        d="M34.5 14.5C24.28 13.7 15.5 21.75 15.5 32C15.5 41.66 23.34 49.5 33 49.5C42.66 49.5 50.5 41.66 50.5 32C50.5 30.8 50.38 29.62 50.14 28.48"
        stroke={`url(#${mintId})`}
        strokeWidth="6.2"
        strokeLinecap="round"
      />

      <path
        d="M25.5 32.5L31.2 38.2L40.5 27.5"
        stroke="#FFFFFF"
        strokeWidth="4.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M41.5 41.5L50.5 50.5"
        stroke={`url(#${mintId})`}
        strokeWidth="6.2"
        strokeLinecap="round"
      />

      <path
        d="M47.5 9.5C48.1 13.8 49.7 15.4 54 16C49.7 16.6 48.1 18.2 47.5 22.5C46.9 18.2 45.3 16.6 41 16C45.3 15.4 46.9 13.8 47.5 9.5Z"
        fill={`url(#${sparkId})`}
      />
    </svg>
  );
}
