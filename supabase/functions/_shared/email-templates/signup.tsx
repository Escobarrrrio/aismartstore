/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailShell, button, h1, link, noteBox, noteText, text } from './EmailShell.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <EmailShell preview={`Confirm your email for ${siteName}`}>
    <Heading style={h1}>Confirm your email</Heading>
    <Text style={text}>
      Thanks for signing up for{' '}
      <Link href={siteUrl} style={link}>
        <strong>{siteName}</strong>
      </Link>
      !
    </Text>
    <Text style={text}>
      Please confirm your email address (
      <Link href={`mailto:${recipient}`} style={link}>
        {recipient}
      </Link>
      ) by clicking the button below:
    </Text>
    <Button style={button} href={confirmationUrl}>
      Verify Email
    </Button>
    <div style={noteBox}>
      <Text style={noteText}>If you didn't create an account, you can safely ignore this email.</Text>
    </div>
  </EmailShell>
)

export default SignupEmail
