/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

// Publicly hosted static asset -- email clients can't reference local/app
// assets, they need a real, always-on HTTPS URL. This is the same icon
// used as the site's PWA icon, so it's already stable infrastructure.
const LOGO_URL = 'https://aismartstore.co.za/icon-512.png'
const SITE_URL = 'https://aismartstore.co.za'

interface EmailShellProps {
  preview: string
  children: React.ReactNode
}

// Shared chrome for every transactional/auth email: branded header (logo +
// wordmark), a bordered card for the message body, and a consistent
// footer with company identification. Previously every template was a
// bare heading + paragraph + button with no branding at all -- this is
// the one place that changes for all six email types at once.
export const EmailShell = ({ preview, children }: EmailShellProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{preview}</Preview>
    <Body style={main}>
      <Container style={outer}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={brandBarTable}>
          <tbody>
            <tr>
              <td style={brandBarCell}>
                <table role="presentation" cellPadding={0} cellSpacing={0} style={brandBarInner}>
                  <tbody>
                    <tr>
                      <td style={{ verticalAlign: 'middle' }}>
                        <Img src={LOGO_URL} width={30} height={30} alt="AI Smart Store" style={logoImg} />
                      </td>
                      <td style={{ verticalAlign: 'middle', paddingLeft: '10px' }}>
                        <span style={wordmark}>Smart Store</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        <Section style={card}>{children}</Section>

        <Section style={footerSection}>
          <Text style={footerText}>
            AI Smart Store, a division of AI Job Chommie (Pty) Ltd. &middot;{' '}
            <Link href={SITE_URL} style={footerLink}>aismartstore.co.za</Link>
          </Text>
          <Text style={footerFine}>
            This is a transactional email sent because of account activity. You don't need to
            do anything if you didn't request it.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default EmailShell

const main = {
  backgroundColor: '#f4f4f7',
  fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  padding: '32px 12px',
}
const outer = { maxWidth: '520px', margin: '0 auto' }
const brandBarTable = { marginBottom: '18px' }
const brandBarCell = { padding: '0 6px' }
const brandBarInner = {
  backgroundColor: '#fdfdfb',
  border: '1px solid hsl(220, 13%, 91%)',
  borderRadius: '12px',
  padding: '14px 18px',
}
const logoImg = { display: 'block', borderRadius: '7px' }
const wordmark = {
  fontFamily: 'Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  fontSize: '18px',
  fontWeight: 800 as const,
  letterSpacing: '-0.01em',
  color: 'hsl(222, 47%, 11%)',
}
const card = {
  backgroundColor: '#ffffff',
  border: '1px solid hsl(220, 13%, 91%)',
  borderRadius: '16px',
  padding: '36px 32px',
}
const footerSection = { padding: '20px 6px 0' }
const footerText = { fontSize: '12px', color: 'hsl(220, 9%, 46%)', margin: '0 0 4px' }
const footerLink = { color: 'hsl(222, 89%, 56%)', textDecoration: 'underline' }
const footerFine = { fontSize: '11px', color: 'hsl(220, 9%, 65%)', margin: 0, lineHeight: '1.5' }

export const h1 = {
  fontSize: '24px',
  fontWeight: '700' as const,
  color: 'hsl(222, 47%, 11%)',
  fontFamily: 'Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  letterSpacing: '-0.02em',
  margin: '0 0 18px',
}
export const text = {
  fontSize: '15px',
  color: 'hsl(220, 9%, 38%)',
  lineHeight: '1.6',
  margin: '0 0 18px',
}
export const link = { color: 'hsl(222, 89%, 56%)', textDecoration: 'underline' }
export const button = {
  backgroundImage: 'linear-gradient(135deg, #06b6d4 0%, #7c3aed 50%, #d946ef 100%)',
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: '600' as const,
  borderRadius: '999px',
  padding: '14px 32px',
  textDecoration: 'none',
  display: 'inline-block',
}
export const noteBox = {
  backgroundColor: 'hsl(220, 20%, 97%)',
  border: '1px solid hsl(220, 13%, 91%)',
  borderRadius: '10px',
  padding: '14px 16px',
  margin: '20px 0 0',
}
export const noteText = { fontSize: '13px', color: 'hsl(220, 9%, 46%)', lineHeight: '1.5', margin: 0 }
export const codeStyle = {
  fontFamily: '"SF Mono", Menlo, Consolas, monospace',
  fontSize: '32px',
  fontWeight: '700' as const,
  color: 'hsl(222, 89%, 56%)',
  letterSpacing: '0.15em',
  margin: '4px 0 18px',
}
