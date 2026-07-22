import type { SVGProps } from 'react'

/*
 * Minimal stroke icon set for the shell. 20x20 viewBox, 1.6 stroke,
 * currentColor — sized and colored by CSS.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="18"
      height="18"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

/* A pulse: something changed and is asking for attention. */
export const SignalsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 11h3l2.5-6 4 12 2.5-6h3" />
  </Icon>
)

export const IntelligenceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
    <path d="M6 13v-3M10 13V7M14 13v-5" />
  </Icon>
)

export const CompetitorsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="13.5" cy="8.5" r="2" />
    <path d="M2.5 16c.5-2.5 2.2-4 4.5-4s4 1.5 4.5 4M12 12.6c1.9.2 3.3 1.4 3.8 3.4" />
  </Icon>
)

export const CustomersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="6.5" r="3" />
    <path d="M4 17c.7-3.2 3-5 6-5s5.3 1.8 6 5" />
  </Icon>
)

export const MonthlyReviewIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="14" height="13" rx="2.5" />
    <path d="M3 8h14M7 2.5V5M13 2.5V5" />
  </Icon>
)

export const IntegrationsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7.5 3v4M12.5 3v4" />
    <path d="M5 7h10v2.5a5 5 0 0 1-10 0V7Z" />
    <path d="M10 14.5V17" />
  </Icon>
)

export const CollectionsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5 17 6l-7 3.5L3 6l7-3.5Z" />
    <path d="M3 10l7 3.5L17 10M3 14l7 3.5 7-3.5" />
  </Icon>
)

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" />
  </Icon>
)

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </Icon>
)

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icon>
)

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 10a6 6 0 1 1-1.8-4.3M16 2.5V6h-3.5" />
  </Icon>
)

export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.5 6.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v12A1.5 1.5 0 0 0 5 17.5h6a1.5 1.5 0 0 0 1.5-1.5v-2.5M8 10h9M14.5 7.5 17 10l-2.5 2.5" />
  </Icon>
)

/** Bauhly Backoffice mark — beacon ring on navy, brand orange core. */
export const BrandMark = (p: IconProps) => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" {...p}>
    <rect width="32" height="32" rx="8" fill="var(--nav-bg-soft, #13203a)" />
    <circle cx="16" cy="16" r="8" fill="none" stroke="var(--primary-500)" strokeWidth="3" />
    <circle cx="16" cy="16" r="2.5" fill="var(--signal-500)" />
  </svg>
)

export const CheckCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m6.8 10.2 2.2 2.2 4.2-4.6" />
  </Icon>
)

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 5.5V10l3 2" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3 2.5 16.5h15L10 3Z" />
    <path d="M10 8.5v3.5M10 14.6v.1" />
  </Icon>
)

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17 3 3 9.5l5.5 2L10.5 17 17 3Z" />
    <path d="M8.5 11.5 17 3" />
  </Icon>
)

export const ThumbUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9v8H3.5V9H6Zm0 0 3-5.5a1.7 1.7 0 0 1 1.7 1.7V8h4.4a1.5 1.5 0 0 1 1.5 1.7l-.9 5.8A1.8 1.8 0 0 1 13.9 17H6" />
  </Icon>
)

export const EditIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.8 3.7a1.7 1.7 0 0 1 2.4 2.4l-8.4 8.4-3.2.8.8-3.2 8.4-8.4Z" />
  </Icon>
)

export const StarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 3 2 4.3 4.7.5-3.5 3.2 1 4.6L10 13.2 5.8 15.6l1-4.6L3.3 7.8 8 7.3 10 3Z" />
  </Icon>
)

export const TrendUpIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 14.5 8 9l3 3 6-6.5" />
    <path d="M13 5.5h4v4" />
  </Icon>
)

export const PostsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3" width="13" height="14" rx="2" />
    <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" />
  </Icon>
)

export const ZapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 2.5 4.5 11h4l-1 6.5L14.5 9h-4l.5-6.5Z" />
  </Icon>
)
