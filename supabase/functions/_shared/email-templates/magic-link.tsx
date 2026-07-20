/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailShell, button, h1, noteBox, noteText, text } from './EmailShell.tsx'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <EmailShell preview={`Your login link for ${siteName}`}>
    <Heading style={h1}>Your login link</Heading>
    <Text style={text}>
      Click the button below to log in to {siteName}. This link will expire shortly.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Log In
    </Button>
    <div style={noteBox}>
      <Text style={noteText}>If you didn't request this link, you can safely ignore this email.</Text>
    </div>
  </EmailShell>
)

export default MagicLinkEmail
