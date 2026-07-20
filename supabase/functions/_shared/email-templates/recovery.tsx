/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailShell, button, h1, noteBox, noteText, text } from './EmailShell.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <EmailShell preview={`Reset your password for ${siteName}`}>
    <Heading style={h1}>Reset your password</Heading>
    <Text style={text}>
      We received a request to reset your password for {siteName}. Click the button below to
      choose a new password.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Reset Password
    </Button>
    <div style={noteBox}>
      <Text style={noteText}>
        If you didn't request a password reset, you can safely ignore this email — your
        password will not be changed.
      </Text>
    </div>
  </EmailShell>
)

export default RecoveryEmail
