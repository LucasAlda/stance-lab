import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import styles from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Stance Lab · Balance Board' }],
    links: [{ rel: 'stylesheet', href: styles }],
  }),
  component: () => <html lang="es"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html>,
})
