/**
 * ComfyUI logo icon — a simple uppercase "C".
 * Styled to match DSH's monochrome outline icon convention.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

export const IconComfyUIOutline16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Large "C" shape, vertically and horizontally centered */}
    <text
      x="12"
      y="12"
      dominantBaseline="central"
      textAnchor="middle"
      fontFamily="Arial, sans-serif"
      fontSize="26"
      fontWeight="bold"
      fill="currentColor"
    >
      C
    </text>
  </svg>
)
