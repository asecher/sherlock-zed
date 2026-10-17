import { css, type Handle, type RemixNode } from 'remix/component'

import { m } from '../i18n.ts'
import { routes } from '../routes.ts'
import { ConnectionBadge } from './connection-badge.tsx'
import { LocaleSwitcher } from './locale-switcher.tsx'

interface AppShellProps {
  children?: RemixNode
  pathname: string
}

export function AppShell(handle: Handle<AppShellProps>) {
  return () => {
    let { children, pathname } = handle.props

    return (
      <div mix={appStyle}>
        <header mix={headerStyle}>
          <div mix={headerInnerStyle}>
            <a href={routes.home.href()} mix={brandStyle}>
              <span mix={brandIconStyle}>
                <CompassIcon />
              </span>
              <span mix={brandNameStyle}>{m.brand_name()}</span>
            </a>

            <nav aria-label={m.nav_primary()} mix={navListStyle}>
              <a
                aria-current={pathname === routes.home.href() ? 'page' : undefined}
                href={routes.home.href()}
                mix={[
                  navLinkStyle,
                  pathname === routes.home.href() ? activeNavStyle : inactiveNavStyle,
                ]}
              >
                {m.nav_field_notes()}
              </a>
              <a
                aria-current={pathname === routes.offline.href() ? 'page' : undefined}
                href={routes.offline.href()}
                mix={[
                  navLinkStyle,
                  pathname === routes.offline.href() ? activeNavStyle : inactiveNavStyle,
                ]}
              >
                {m.nav_offline_kit()}
              </a>
            </nav>

            <div mix={headerToolsStyle}>
              <LocaleSwitcher />
              <ConnectionBadge />
            </div>
          </div>
        </header>

        <div mix={contentStyle}>{children}</div>

        <footer mix={footerStyle}>
          <div mix={footerInnerStyle}>
            <p>{m.footer_built_with()}</p>
            <p>{m.footer_tagline()}</p>
          </div>
        </footer>
      </div>
    )
  }
}

function CompassIcon() {
  return () => (
    <svg aria-hidden="true" fill="none" mix={compassStyle} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.5" />
      <path d="m15.7 8.3-2.1 5.3-5.3 2.1 2.1-5.3 5.3-2.1Z" fill="currentColor" />
    </svg>
  )
}

const appStyle = css({
  '--cream': '#f4efe3',
  '--paper': '#fffaf0',
  '--ink': '#17231f',
  '--moss': '#173f35',
  '--sage': '#a8c3a0',
  '--sun': '#efb83f',
  '--clay': '#c86f4a',
  display: 'flex',
  minHeight: '100vh',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--cream)',
  color: 'var(--ink)',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  '& p': { marginBlock: 0 },
  '& ::selection': { background: 'var(--sun)', color: 'var(--ink)' },
})

const headerStyle = css({
  position: 'relative',
  zIndex: 20,
  borderBottom: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)',
  background: 'color-mix(in srgb, var(--cream) 95%, transparent)',
})

const headerInnerStyle = css({
  display: 'flex',
  width: '100%',
  maxWidth: '80rem',
  marginInline: 'auto',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1.25rem',
  padding: '1rem 1.25rem',
  '@media (min-width: 40rem)': { paddingInline: '2rem' },
})

const brandStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  color: 'inherit',
  fontWeight: 700,
  letterSpacing: '-0.025em',
  textDecoration: 'none',
  '&:focus-visible': { outline: '2px solid var(--moss)', outlineOffset: '4px' },
  '&:hover > span:first-child': { transform: 'rotate(-12deg)' },
})

const brandIconStyle = css({
  display: 'grid',
  width: '2.25rem',
  height: '2.25rem',
  placeItems: 'center',
  borderRadius: '999px',
  background: 'var(--moss)',
  color: 'var(--cream)',
  transition: 'transform 160ms ease',
})

const brandNameStyle = css({
  display: 'none',
  fontSize: '1.125rem',
  '@media (min-width: 40rem)': { display: 'inline' },
})

const navListStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  '@media (min-width: 40rem)': { gap: '1.25rem' },
})

const headerToolsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
})

const navLinkStyle = css({
  borderRadius: '999px',
  padding: '0.5rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  textDecoration: 'none',
  transition: 'background-color 160ms ease, color 160ms ease',
  '&:focus-visible': { outline: '2px solid var(--moss)', outlineOffset: '2px' },
  '@media (min-width: 40rem)': { paddingInline: '0.75rem', fontSize: '0.875rem' },
})

const activeNavStyle = css({ background: 'var(--ink)', color: 'var(--cream)' })

const inactiveNavStyle = css({
  color: 'color-mix(in srgb, var(--ink) 65%, transparent)',
  '&:hover': {
    background: 'color-mix(in srgb, var(--ink) 5%, transparent)',
    color: 'var(--ink)',
  },
})

const contentStyle = css({ flex: '1 1 0%' })

const footerStyle = css({
  borderTop: '1px solid color-mix(in srgb, var(--ink) 10%, transparent)',
  padding: '1.5rem 1.25rem',
  '@media (min-width: 40rem)': { paddingInline: '2rem' },
})

const footerInnerStyle = css({
  display: 'flex',
  maxWidth: '80rem',
  marginInline: 'auto',
  flexDirection: 'column',
  gap: '0.5rem',
  color: 'color-mix(in srgb, var(--ink) 55%, transparent)',
  fontSize: '0.875rem',
  '@media (min-width: 40rem)': {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
})

const compassStyle = css({ width: '1.25rem', height: '1.25rem' })
